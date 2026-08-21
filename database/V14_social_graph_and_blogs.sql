-- Live Coders V14: multi-page blog image galleries, mentions and friend-first viral feed signals.
-- Run after V13_product_upgrade.sql.

alter table public.posts
  add column if not exists visibility text not null default 'public'
  check (visibility in ('public','friends'));

create table if not exists public.post_mentions (
  post_id uuid not null references public.posts(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, mentioned_user_id)
);

create index if not exists post_mentions_user_idx on public.post_mentions(mentioned_user_id, created_at desc);
create index if not exists post_mentions_post_idx on public.post_mentions(post_id);

alter table public.post_mentions enable row level security;
drop policy if exists post_mentions_select_authenticated on public.post_mentions;
create policy post_mentions_select_authenticated on public.post_mentions
for select to authenticated using (true);
drop policy if exists post_mentions_insert_own_post on public.post_mentions;
create policy post_mentions_insert_own_post on public.post_mentions
for insert to authenticated
with check (exists (select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()));
drop policy if exists post_mentions_delete_own_post on public.post_mentions;
create policy post_mentions_delete_own_post on public.post_mentions
for delete to authenticated
using (exists (select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()));

create or replace function public.notify_post_mention()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.mentioned_user_id <> (select author_id from public.posts where id=new.post_id) then
    insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
    select new.mentioned_user_id,p.author_id,'post_mention',new.post_id,'post',
      '@'||coalesce((select username from public.profiles where id=p.author_id),'developer')||' tagged you in a post.'
    from public.posts p
    where p.id=new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists post_mention_notification on public.post_mentions;
create trigger post_mention_notification
after insert on public.post_mentions
for each row execute function public.notify_post_mention();

-- Friend-circle helper: mutual follows are treated as friends for feed ranking.
create or replace function public.get_friend_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path=public
as $$
  select f1.following_id
  from public.follows f1
  join public.follows f2
    on f2.follower_id=f1.following_id
   and f2.following_id=auth.uid()
  where f1.follower_id=auth.uid();
$$;

grant execute on function public.get_friend_ids() to authenticated;

-- Lightweight virality score: fresh posts with engagement rise over time instead of
-- replacing the friend-first experience. The client combines this with interests.
create or replace function public.post_virality_score(p public.posts)
returns numeric
language sql
stable
as $$
  select
    (coalesce(p.like_count,0)*3.0)
    + (coalesce(p.comment_count,0)*5.0)
    + (coalesce(p.view_count,0)*0.35)
    + greatest(0,48-extract(epoch from (now()-p.created_at))/3600)/48.0*18.0;
$$;

-- Storage policy already exists in V12. Blog pages reuse the post-media bucket.

-- LIVE CODERS V6
-- Existing database migration.
-- Fixes community editing RLS, repairs community chat membership,
-- adds stored channels/events/resources, and creates the workspace structure.

begin;

-- ================================================================
-- 1. COMMUNITY WORKSPACE TABLES
-- ================================================================

create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null,
  slug text not null,
  topic text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (community_id, slug)
);

alter table public.community_messages
  add column if not exists channel_id uuid
  references public.community_channels(id) on delete set null;

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_files (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  url text not null,
  file_type text,
  created_at timestamptz not null default now()
);

create index if not exists community_channels_community_idx
  on public.community_channels(community_id, position);
create index if not exists community_messages_channel_idx
  on public.community_messages(channel_id, created_at);
create index if not exists community_events_idx
  on public.community_events(community_id, starts_at);
create index if not exists community_files_idx
  on public.community_files(community_id, created_at desc);

-- Remove the old two-argument RPC from V5 so there is no stale overload.
drop function if exists public.send_community_message(uuid,text);

-- ================================================================
-- 2. SECURE COMMUNITY FUNCTIONS
-- ================================================================

create or replace function public.ensure_default_community_channels(community_id_input uuid)
returns setof public.community_channels
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if not exists (
    select 1 from public.community_members
    where community_id=community_id_input and user_id=auth.uid()
  ) and not exists (
    select 1 from public.communities
    where id=community_id_input and creator_id=auth.uid()
  ) then
    raise exception 'You are not a member of this community';
  end if;

  insert into public.community_channels(community_id,name,slug,topic,position) values
    (community_id_input,'general','general','General discussion about ideas, startups and tech',0),
    (community_id_input,'project-updates','project-updates','Share progress, launches and project updates',1),
    (community_id_input,'help-needed','help-needed','Ask for help and solve problems together',2),
    (community_id_input,'resources','resources','Useful resources, links and learning material',3),
    (community_id_input,'off-topic','off-topic','Everything outside the main work',4)
  on conflict (community_id,slug) do nothing;

  update public.community_messages m
  set channel_id=(
    select ch.id
    from public.community_channels ch
    where ch.community_id=m.community_id and ch.slug='general'
    limit 1
  )
  where m.community_id=community_id_input and m.channel_id is null;

  return query
  select *
  from public.community_channels
  where community_id=community_id_input
  order by position;
end;
$$;

create or replace function public.update_community(
  community_id_input uuid,
  name_input text,
  description_input text,
  category_input text default null,
  skills_input text[] default '{}',
  rules_input text default null,
  remote_mode_input text default 'Remote',
  recruitment_input boolean default false,
  location_input text default null,
  logo_url_input text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if not exists (
    select 1 from public.communities
    where id=community_id_input and creator_id=auth.uid()
  ) then
    raise exception 'Only the community creator can edit this community';
  end if;

  update public.communities
  set
    name=trim(name_input),
    description=trim(description_input),
    category=nullif(trim(category_input),''),
    required_skills=coalesce(skills_input,'{}'),
    rules=nullif(trim(rules_input),''),
    remote_mode=coalesce(remote_mode_input,'Remote'),
    recruitment_enabled=coalesce(recruitment_input,false),
    location=nullif(trim(location_input),''),
    logo_url=coalesce(logo_url_input,logo_url),
    updated_at=now()
  where id=community_id_input;
end;
$$;

create or replace function public.send_community_message(
  community_id_input uuid,
  channel_id_input uuid default null,
  content_input text default ''
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  message_id uuid;
  target_channel uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if length(trim(coalesce(content_input,'')))=0 then
    raise exception 'Message cannot be empty';
  end if;

  if not exists (
    select 1 from public.community_members
    where community_id=community_id_input and user_id=auth.uid()
  ) then
    raise exception 'Join this community before sending messages';
  end if;

  if channel_id_input is not null then
    if not exists (
      select 1 from public.community_channels
      where id=channel_id_input and community_id=community_id_input
    ) then
      raise exception 'Channel does not belong to this community';
    end if;
    target_channel:=channel_id_input;
  else
    select id into target_channel
    from public.community_channels
    where community_id=community_id_input
    order by position
    limit 1;
  end if;

  insert into public.community_messages(
    community_id,channel_id,sender_id,content
  ) values (
    community_id_input,target_channel,auth.uid(),trim(content_input)
  ) returning id into message_id;

  return message_id;
end;
$$;

-- ================================================================
-- 3. REPAIR ALL EXISTING COMMUNITIES
-- ================================================================

insert into public.community_members(community_id,user_id,role)
select c.id,c.creator_id,'creator'
from public.communities c
where c.creator_id is not null
on conflict (community_id,user_id)
do update set role='creator';

insert into public.community_members(community_id,user_id,role)
select a.community_id,a.applicant_id,'member'
from public.community_applications a
where a.status='accepted'
on conflict (community_id,user_id) do nothing;

-- Create the default channels for every existing community.
do $$
declare c record;
begin
  for c in select id from public.communities loop
    insert into public.community_channels(community_id,name,slug,topic,position) values
      (c.id,'general','general','General discussion about ideas, startups and tech',0),
      (c.id,'project-updates','project-updates','Share progress, launches and project updates',1),
      (c.id,'help-needed','help-needed','Ask for help and solve problems together',2),
      (c.id,'resources','resources','Useful resources, links and learning material',3),
      (c.id,'off-topic','off-topic','Everything outside the main work',4)
    on conflict (community_id,slug) do nothing;

    update public.community_messages m
    set channel_id=(
      select ch.id from public.community_channels ch
      where ch.community_id=m.community_id and ch.slug='general' limit 1
    )
    where m.community_id=c.id and m.channel_id is null;
  end loop;
end $$;

update public.communities c
set member_count=(
  select count(*) from public.community_members m
  where m.community_id=c.id
);

-- ================================================================
-- 4. RLS FOR NEW WORKSPACE DATA
-- ================================================================

alter table public.community_channels enable row level security;
alter table public.community_events enable row level security;
alter table public.community_files enable row level security;

drop policy if exists community_channels_select_member on public.community_channels;
drop policy if exists community_channels_manage_creator on public.community_channels;
create policy community_channels_select_member
on public.community_channels for select to authenticated
using (
  exists(select 1 from public.community_members cm
         where cm.community_id=community_channels.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c
            where c.id=community_channels.community_id and c.creator_id=auth.uid())
);

create policy community_channels_manage_creator
on public.community_channels for all to authenticated
using (exists(select 1 from public.communities c
              where c.id=community_channels.community_id and c.creator_id=auth.uid()))
with check (exists(select 1 from public.communities c
                   where c.id=community_channels.community_id and c.creator_id=auth.uid()));

drop policy if exists community_events_select_member on public.community_events;
drop policy if exists community_events_insert_creator on public.community_events;
drop policy if exists community_events_update_creator on public.community_events;
drop policy if exists community_events_delete_creator on public.community_events;
create policy community_events_select_member
on public.community_events for select to authenticated
using (
  exists(select 1 from public.community_members cm
         where cm.community_id=community_events.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c
            where c.id=community_events.community_id and c.creator_id=auth.uid())
);
create policy community_events_insert_creator
on public.community_events for insert to authenticated
with check (
  auth.uid()=creator_id and exists(select 1 from public.communities c
  where c.id=community_events.community_id and c.creator_id=auth.uid())
);
create policy community_events_update_creator
on public.community_events for update to authenticated
using(auth.uid()=creator_id) with check(auth.uid()=creator_id);
create policy community_events_delete_creator
on public.community_events for delete to authenticated
using(auth.uid()=creator_id);

drop policy if exists community_files_select_member on public.community_files;
drop policy if exists community_files_insert_member on public.community_files;
create policy community_files_select_member
on public.community_files for select to authenticated
using (
  exists(select 1 from public.community_members cm
         where cm.community_id=community_files.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c
            where c.id=community_files.community_id and c.creator_id=auth.uid())
);
create policy community_files_insert_member
on public.community_files for insert to authenticated
with check (
  auth.uid()=uploader_id and exists(select 1 from public.community_members cm
  where cm.community_id=community_files.community_id and cm.user_id=auth.uid())
);

-- ================================================================
-- 5. STORAGE POLICY: COMMUNITY LOGOS
-- ================================================================
-- V6 uploads each new logo under community_id/timestamp-logo.ext,
-- avoiding Storage upsert/update RLS conflicts.

drop policy if exists community_avatar_creator_upload on storage.objects;
create policy community_avatar_creator_upload
on storage.objects for insert to authenticated
with check (
  bucket_id='community-avatars'
  and (storage.foldername(name))[1] is not null
  and exists(
    select 1 from public.communities c
    where c.id=(storage.foldername(name))[1]::uuid
      and c.creator_id=auth.uid()
  )
);

drop policy if exists community_avatar_creator_update on storage.objects;
create policy community_avatar_creator_update
on storage.objects for update to authenticated
using (
  bucket_id='community-avatars'
  and exists(
    select 1 from public.communities c
    where c.id=(storage.foldername(name))[1]::uuid
      and c.creator_id=auth.uid()
  )
)
with check (
  bucket_id='community-avatars'
  and exists(
    select 1 from public.communities c
    where c.id=(storage.foldername(name))[1]::uuid
      and c.creator_id=auth.uid()
  )
);

grant execute on function public.ensure_default_community_channels(uuid) to authenticated;
grant execute on function public.update_community(uuid,text,text,text,text[],text,text,boolean,text,text) to authenticated;
grant execute on function public.send_community_message(uuid,uuid,text) to authenticated;

-- ================================================================
-- 6. REALTIME
-- ================================================================

do $$ begin
  alter publication supabase_realtime add table public.community_channels;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.community_events;
exception when duplicate_object then null;
end $$;

commit;

-- ================================================================
-- AFTER RUNNING THIS FILE
-- ================================================================
-- Refresh your browser. Existing communities are repaired automatically.
-- New communities get five channels automatically.
-- Community edit uses a SECURITY DEFINER RPC instead of a direct RLS update.
-- Community chat messages are stored with a channel_id.

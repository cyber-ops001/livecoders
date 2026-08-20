-- LIVE CODERS V7 DATABASE PATCH
-- Run this once on an existing V6 database.
-- This patch fixes community-logo RLS failures, repairs memberships/channels,
-- and adds the database guarantees used by the V7 community workspace.

begin;

-- 1) Ensure every creator is a member so creator-only workspace actions work.
insert into public.community_members (community_id, user_id, role)
select c.id, c.creator_id, 'creator'
from public.communities c
where c.creator_id is not null
on conflict (community_id, user_id)
do update set role = 'creator';

-- 2) Ensure accepted applicants are members.
insert into public.community_members (community_id, user_id, role)
select a.community_id, a.applicant_id, 'member'
from public.community_applications a
where a.status = 'accepted'
on conflict (community_id, user_id) do nothing;

-- 3) Rebuild the default channels for all existing communities.
insert into public.community_channels (community_id, name, slug, topic, position)
select c.id, x.name, x.slug, x.topic, x.position
from public.communities c
cross join (values
  ('general','general','General discussion about ideas, startups and tech',0),
  ('project-updates','project-updates','Share progress, launches and project updates',1),
  ('help-needed','help-needed','Ask for help and solve problems together',2),
  ('resources','resources','Useful resources, links and learning material',3),
  ('off-topic','off-topic','Everything outside the main work',4)
) as x(name,slug,topic,position)
on conflict (community_id,slug) do nothing;

-- 4) Put legacy community messages into #general.
update public.community_messages m
set channel_id = ch.id
from public.community_channels ch
where m.community_id = ch.community_id
  and ch.slug = 'general'
  and m.channel_id is null;

-- 5) Community logo storage.
-- The browser uploads to:
--   community-avatars/<auth-user-id>/<community-id>/<random-file>
-- The upload policy deliberately checks the authenticated user's folder only.
-- Attaching the resulting URL to a community is still protected by the
-- SECURITY DEFINER update_community() function, which checks creator_id.
insert into storage.buckets (id, name, public)
values ('community-avatars','community-avatars',true)
on conflict (id) do update set public=true;

drop policy if exists community_avatar_creator_upload on storage.objects;
drop policy if exists community_avatar_creator_update on storage.objects;
drop policy if exists community_avatar_creator_delete on storage.objects;
drop policy if exists community_avatar_creator_upload_v7 on storage.objects;
drop policy if exists community_avatar_creator_update_v7 on storage.objects;
drop policy if exists community_avatar_creator_delete_v7 on storage.objects;

create policy community_avatar_creator_upload_v7
on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy community_avatar_creator_update_v7
on storage.objects for update to authenticated
using (
  bucket_id = 'community-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'community-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy community_avatar_creator_delete_v7
on storage.objects for delete to authenticated
using (
  bucket_id = 'community-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public viewing remains available.
drop policy if exists community_avatar_public_read on storage.objects;
create policy community_avatar_public_read
on storage.objects for select
using (bucket_id = 'community-avatars');

-- 6) Make sure the secure community update function is present.
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
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if not exists (
    select 1 from public.communities
    where id = community_id_input
      and creator_id = auth.uid()
  ) then
    raise exception 'Only the community creator can edit this community';
  end if;

  update public.communities
  set name = trim(name_input),
      description = trim(description_input),
      category = nullif(trim(category_input), ''),
      required_skills = coalesce(skills_input, '{}'),
      rules = nullif(trim(rules_input), ''),
      remote_mode = coalesce(nullif(trim(remote_mode_input), ''), 'Remote'),
      recruitment_enabled = coalesce(recruitment_input, false),
      location = nullif(trim(location_input), ''),
      logo_url = coalesce(nullif(trim(logo_url_input), ''), logo_url),
      updated_at = now()
  where id = community_id_input;
end;
$$;

grant execute on function public.update_community(uuid,text,text,text,text[],text,text,boolean,text,text) to authenticated;

-- 7) Keep the community counters accurate.
update public.communities c
set member_count = (
  select count(*) from public.community_members m
  where m.community_id = c.id
),
view_count = (
  select count(*) from public.community_views v
  where v.community_id = c.id
);

commit;

-- Verify after running:
-- select id,name,creator_id,member_count,view_count,logo_url from public.communities order by created_at desc;
-- select community_id,user_id,role from public.community_members order by joined_at desc;
-- select community_id,name,slug from public.community_channels order by community_id,position;

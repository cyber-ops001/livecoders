-- LIVE CODERS V5 — NON-DESTRUCTIVE REPAIR FOR AN EXISTING V4 DATABASE
-- Run this once in Supabase SQL Editor if V4 is already installed.

create or replace function public.ensure_community_creator_membership(community_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then
    raise exception 'Only the community creator can repair creator membership';
  end if;
  insert into public.community_members(community_id,user_id,role)
  values(community_id_input,auth.uid(),'creator')
  on conflict (community_id,user_id) do update set role='creator';
end;
$$;

grant execute on function public.ensure_community_creator_membership(uuid) to authenticated;

-- Restore creator membership for every existing community.
insert into public.community_members(community_id,user_id,role)
select c.id,c.creator_id,'creator'
from public.communities c
where c.creator_id is not null
on conflict (community_id,user_id) do update set role='creator';

-- Restore membership for applications that were already accepted.
insert into public.community_members(community_id,user_id,role)
select a.community_id,a.applicant_id,'member'
from public.community_applications a
where a.status='accepted'
on conflict (community_id,user_id) do nothing;

-- Fix the existing community member count after repair.
update public.communities c
set member_count=(select count(*) from public.community_members m where m.community_id=c.id);

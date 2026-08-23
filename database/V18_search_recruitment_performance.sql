-- Live Coders V18: reliable search, recruitment modes, Trading & Finance, faster community discovery.
-- Recruitment modes:
--   open        = anyone can join instantly
--   application = applicant submits a request for community head approval
--   closed      = no new joins/applications

alter table public.communities
  add column if not exists recruitment_mode text not null default 'application';

update public.communities
set recruitment_mode = case
  when recruitment_enabled then 'application'
  else 'closed'
end
where recruitment_mode is null
   or recruitment_mode not in ('open','application','closed');

alter table public.communities
  drop constraint if exists communities_recruitment_mode_check;

alter table public.communities
  add constraint communities_recruitment_mode_check
  check (recruitment_mode in ('open','application','closed'));

create or replace function public.create_community(
  name_input text,
  description_input text,
  category_input text default null,
  skills_input text[] default '{}',
  rules_input text default null,
  remote_mode_input text default 'Remote',
  recruitment_input boolean default false,
  location_input text default null,
  logo_url_input text default null,
  recruitment_mode_input text default 'application'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; mode text;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  mode := case when recruitment_mode_input in ('open','application','closed') then recruitment_mode_input else 'closed' end;
  if length(trim(coalesce(name_input,''))) < 2 then raise exception 'Community name is required'; end if;

  insert into public.communities(
    creator_id,name,description,category,required_skills,rules,remote_mode,
    recruitment_enabled,recruitment_mode,location,logo_url
  )
  values(
    auth.uid(),trim(name_input),trim(description_input),
    nullif(trim(category_input),''),
    coalesce(skills_input,'{}'),
    nullif(trim(rules_input),''),
    coalesce(remote_mode_input,'Remote'),
    mode <> 'closed',
    mode,
    nullif(trim(location_input),''),
    logo_url_input
  )
  returning id into cid;

  insert into public.community_members(community_id,user_id,role)
  values(cid,auth.uid(),'creator')
  on conflict (community_id,user_id) do update set role='creator';

  insert into public.community_channels(community_id,name,slug,topic,position)
  values
    (cid,'general','general','General discussion about ideas, startups and tech',0),
    (cid,'project-updates','project-updates','Share progress, launches and project updates',1),
    (cid,'help-needed','help-needed','Ask for help and solve problems together',2),
    (cid,'resources','resources','Useful resources, links and learning material',3),
    (cid,'off-topic','off-topic','Everything outside the main work',4)
  on conflict (community_id,slug) do nothing;

  return cid;
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
  logo_url_input text default null,
  recruitment_mode_input text default 'application'
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare mode text;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists (
    select 1 from public.communities
    where id=community_id_input and creator_id=auth.uid()
  ) then
    raise exception 'Only the community creator can edit this community';
  end if;

  mode := case when recruitment_mode_input in ('open','application','closed') then recruitment_mode_input
               when recruitment_input then 'application'
               else 'closed' end;

  update public.communities
  set
    name=trim(name_input),
    description=trim(description_input),
    category=nullif(trim(category_input),''),
    required_skills=coalesce(skills_input,'{}'),
    rules=nullif(trim(rules_input),''),
    remote_mode=coalesce(nullif(trim(remote_mode_input),''),'Remote'),
    recruitment_enabled=(mode <> 'closed'),
    recruitment_mode=mode,
    location=nullif(trim(location_input),''),
    logo_url=coalesce(nullif(trim(logo_url_input),''),logo_url),
    updated_at=now()
  where id=community_id_input;
end;
$$;

grant execute on function public.create_community(text,text,text,text[],text,text,boolean,text,text,text) to authenticated;
grant execute on function public.update_community(uuid,text,text,text,text[],text,text,boolean,text,text,text) to authenticated;

-- Safe join RPC for open recruitment. This prevents the client from bypassing
-- the recruitment mode by inserting directly into community_members.
create or replace function public.join_open_community(community_id_input uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare mode text;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;

  select recruitment_mode into mode
  from public.communities
  where id=community_id_input;

  if mode is null then raise exception 'Community not found'; end if;
  if mode <> 'open' then raise exception 'This community does not allow direct joining'; end if;

  insert into public.community_members(community_id,user_id,role)
  values(community_id_input,auth.uid(),'member')
  on conflict (community_id,user_id) do nothing;
end;
$$;

grant execute on function public.join_open_community(uuid) to authenticated;

-- Keep the search columns indexed for the common discovery path.
-- Ensure pending applications are always visible to the community creator
-- through a secure RPC, independent of client-side RLS assumptions.
create or replace function public.get_pending_community_applications(community_id_input uuid)
returns table(
  id uuid,
  status text,
  answers jsonb,
  created_at timestamptz,
  applicant_id uuid,
  username text,
  display_name text,
  full_name text,
  avatar_url text,
  location text
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(
    select 1 from public.communities
    where communities.id=community_id_input and creator_id=auth.uid()
  ) then
    raise exception 'Only the community head can view pending applications';
  end if;

  return query
  select a.id,a.status,a.answers,a.created_at,p.id,p.username,p.display_name,p.full_name,p.avatar_url,p.location
  from public.community_applications a
  join public.profiles p on p.id=a.applicant_id
  where a.community_id=community_id_input
    and a.status='pending'
  order by a.created_at desc;
end;
$$;

grant execute on function public.get_pending_community_applications(uuid) to authenticated;

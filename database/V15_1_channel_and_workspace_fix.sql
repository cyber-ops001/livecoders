-- Live Coders V15.1
-- Fix channel deletion being undone by the default-channel seeder.
-- The seeder now creates defaults only when a community has zero channels.
-- Also keeps the delete RPC protected so only the community creator can delete.

create or replace function public.ensure_default_community_channels(community_id_input uuid)
returns setof public.community_channels
language plpgsql
security definer
set search_path=public as $$
declare channel_count integer;
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

  select count(*) into channel_count
  from public.community_channels
  where community_id=community_id_input;

  if channel_count = 0 then
    insert into public.community_channels(community_id,name,slug,topic,position) values
      (community_id_input,'general','general','General discussion about ideas, startups and tech',0),
      (community_id_input,'project-updates','project-updates','Share progress, launches and project updates',1),
      (community_id_input,'help-needed','help-needed','Ask for help and solve problems together',2),
      (community_id_input,'resources','resources','Useful resources, links and learning material',3),
      (community_id_input,'off-topic','off-topic','Everything outside the main work',4)
    on conflict (community_id,slug) do nothing;
  end if;

  update public.community_messages m
  set channel_id=(
    select ch.id from public.community_channels ch
    where ch.community_id=m.community_id and ch.slug='general'
    limit 1
  )
  where m.community_id=community_id_input and m.channel_id is null;

  return query
  select * from public.community_channels
  where community_id=community_id_input
  order by position, created_at;
end;
$$;

grant execute on function public.ensure_default_community_channels(uuid) to authenticated;

create or replace function public.delete_community_channel(community_id_input uuid, channel_id_input uuid)
returns void
language plpgsql
security definer
set search_path=public as $$
declare channel_count integer;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then
    raise exception 'Only the community head can delete channels';
  end if;
  if not exists(select 1 from public.community_channels where id=channel_id_input and community_id=community_id_input) then
    raise exception 'Channel does not belong to this community';
  end if;
  select count(*) into channel_count from public.community_channels where community_id=community_id_input;
  if channel_count <= 1 then raise exception 'A community must keep at least one channel'; end if;
  delete from public.community_channels where id=channel_id_input and community_id=community_id_input;
end;
$$;

grant execute on function public.delete_community_channel(uuid,uuid) to authenticated;

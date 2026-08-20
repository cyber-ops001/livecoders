-- Live Coders V10: allow community heads to delete channels safely.
-- Run after V9. Existing data is preserved.
create or replace function public.delete_community_channel(community_id_input uuid, channel_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
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
  if channel_count <= 1 then
    raise exception 'A community must keep at least one channel';
  end if;
  delete from public.community_channels where id=channel_id_input and community_id=community_id_input;
end; $$;
grant execute on function public.delete_community_channel(uuid,uuid) to authenticated;

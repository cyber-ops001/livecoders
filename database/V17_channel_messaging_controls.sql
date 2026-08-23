-- Live Coders V17: channel communication controls + secure recruitment review.
-- Run after V16_fix_channel_deletion_and_defaults.sql.

alter table public.community_channels
  add column if not exists messaging_locked boolean not null default false;

create index if not exists community_channels_lock_idx
  on public.community_channels(community_id, messaging_locked);

create or replace function public.set_community_channel_lock(
  community_id_input uuid,
  channel_id_input uuid,
  locked_input boolean
)
returns public.community_channels
language plpgsql
security definer
set search_path=public
as $$
declare result public.community_channels;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then
    raise exception 'Only the community head can lock or unlock channels';
  end if;
  update public.community_channels
  set messaging_locked=coalesce(locked_input,false)
  where id=channel_id_input and community_id=community_id_input
  returning * into result;
  if result.id is null then raise exception 'Channel not found'; end if;
  return result;
end;
$$;

grant execute on function public.set_community_channel_lock(uuid,uuid,boolean) to authenticated;

create or replace function public.send_community_message(
  community_id_input uuid,
  channel_id_input uuid default null,
  content_input text default '',
  attachment_url_input text default null,
  attachment_name_input text default null,
  attachment_type_input text default null,
  voice_url_input text default null,
  voice_duration_input integer default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare message_id uuid; target_channel uuid; is_creator boolean := false;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.community_members where community_id=community_id_input and user_id=auth.uid()) then
    raise exception 'Join this community before sending messages';
  end if;
  select creator_id=auth.uid() into is_creator from public.communities where id=community_id_input;
  if channel_id_input is not null then
    if not exists(select 1 from public.community_channels where id=channel_id_input and community_id=community_id_input) then
      raise exception 'Channel does not belong to this community';
    end if;
    select id into target_channel from public.community_channels where id=channel_id_input and community_id=community_id_input;
  else
    select id into target_channel from public.community_channels where community_id=community_id_input order by position limit 1;
  end if;
  if target_channel is null then raise exception 'No channel is available'; end if;
  if exists(select 1 from public.community_channels where id=target_channel and messaging_locked=true) and not coalesce(is_creator,false) then
    raise exception 'Messaging is disabled in this channel by the community head';
  end if;
  if length(trim(coalesce(content_input,'')))=0 and attachment_url_input is null and voice_url_input is null then
    raise exception 'Message cannot be empty';
  end if;
  insert into public.community_messages(community_id,channel_id,sender_id,content,attachment_url,attachment_name,attachment_type,voice_url,voice_duration_seconds)
  values(community_id_input,target_channel,auth.uid(),trim(coalesce(content_input,'')),attachment_url_input,attachment_name_input,attachment_type_input,voice_url_input,voice_duration_input)
  returning id into message_id;
  return message_id;
end;
$$;

grant execute on function public.send_community_message(uuid,uuid,text,text,text,text,text,integer) to authenticated;

create or replace function public.review_community_application(
  application_id_input uuid,
  status_input text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; applicant uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if status_input not in ('accepted','rejected') then raise exception 'Invalid application decision'; end if;
  select community_id, applicant_id into cid, applicant
  from public.community_applications
  where id=application_id_input and status='pending';
  if cid is null then raise exception 'Application not found or already reviewed'; end if;
  if not exists(select 1 from public.communities where id=cid and creator_id=auth.uid()) then
    raise exception 'Only the community head can review applications';
  end if;
  update public.community_applications
  set status=status_input, reviewed_by=auth.uid(), updated_at=now()
  where id=application_id_input;
  if status_input='accepted' then
    insert into public.community_members(community_id,user_id,role)
    values(cid,applicant,'member')
    on conflict (community_id,user_id) do nothing;
  end if;
end;
$$;

grant execute on function public.review_community_application(uuid,text) to authenticated;

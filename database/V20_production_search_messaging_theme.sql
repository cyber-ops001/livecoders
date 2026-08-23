-- Live Coders V20: production messaging semantics + global/community search separation.

-- Delete for me: hidden only from the current user's view.
alter table public.messages add column if not exists hidden_for uuid[] not null default '{}';
alter table public.community_messages add column if not exists hidden_for uuid[] not null default '{}';

create index if not exists messages_hidden_for_gin_idx on public.messages using gin(hidden_for);
create index if not exists community_messages_hidden_for_gin_idx on public.community_messages using gin(hidden_for);

create or replace function public.delete_direct_message_for_me(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id where m.id=message_id_input and cm.user_id=auth.uid()) then
    raise exception 'You cannot delete this message';
  end if;
  update public.messages
  set hidden_for=array_append(coalesce(hidden_for,'{}'::uuid[]),auth.uid())
  where id=message_id_input and not (auth.uid() = any(coalesce(hidden_for,'{}'::uuid[])));
end; $$;
grant execute on function public.delete_direct_message_for_me(uuid) to authenticated;

create or replace function public.delete_community_message_for_me(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
declare community_id_value uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  select community_id into community_id_value from public.community_messages where id=message_id_input;
  if community_id_value is null or not exists(select 1 from public.community_members where community_id=community_id_value and user_id=auth.uid()) then
    raise exception 'You cannot delete this message';
  end if;
  update public.community_messages
  set hidden_for=array_append(coalesce(hidden_for,'{}'::uuid[]),auth.uid())
  where id=message_id_input and not (auth.uid() = any(coalesce(hidden_for,'{}'::uuid[])));
end; $$;
grant execute on function public.delete_community_message_for_me(uuid) to authenticated;

-- Keep unsend semantics explicit: the sender removes the visible payload for everyone.
create or replace function public.unsend_direct_message(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  update public.messages
  set deleted_at=now(), deleted_by=auth.uid(), content='', attachment_url=null, attachment_name=null, attachment_type=null, voice_url=null, voice_duration_seconds=null
  where id=message_id_input and sender_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'You can only unsend your own message'; end if;
end; $$;
grant execute on function public.unsend_direct_message(uuid) to authenticated;

create or replace function public.unsend_community_message(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  update public.community_messages
  set deleted_at=now(), deleted_by=auth.uid(), content='', attachment_url=null, attachment_name=null, attachment_type=null, voice_url=null, voice_duration_seconds=null
  where id=message_id_input and sender_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'You can only unsend your own message'; end if;
end; $$;
grant execute on function public.unsend_community_message(uuid) to authenticated;

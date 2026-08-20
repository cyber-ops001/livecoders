-- LIVE CODERS V9 — CREATE CHANNEL FIX
-- Run this after V8 on an existing database.
-- Fixes: INSERT has more target columns than expressions.

create or replace function public.create_community_channel(
  community_id_input uuid,
  name_input text,
  topic_input text default ''
)
returns public.community_channels
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.community_channels;
  slug_value text;
  clean_name text;
  next_position integer;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if not exists (
    select 1
    from public.communities
    where id = community_id_input
      and creator_id = auth.uid()
  ) then
    raise exception 'Only the community head can create channels';
  end if;

  clean_name := trim(name_input);
  if clean_name = '' then
    raise exception 'Channel name is required';
  end if;

  slug_value := trim(both '-' from regexp_replace(
    lower(clean_name),
    '[^a-z0-9]+',
    '-',
    'g'
  ));

  if slug_value = '' then
    raise exception 'Use letters or numbers in the channel name';
  end if;

  if exists (
    select 1
    from public.community_channels
    where community_id = community_id_input
      and slug = slug_value
  ) then
    raise exception 'A channel with this name already exists';
  end if;

  select coalesce(max(position), -1) + 1
    into next_position
  from public.community_channels
  where community_id = community_id_input;

  insert into public.community_channels (
    community_id,
    name,
    slug,
    topic,
    position
  )
  values (
    community_id_input,
    clean_name,
    slug_value,
    nullif(trim(topic_input), ''),
    next_position
  )
  returning * into result;

  return result;
end;
$$;

grant execute on function public.create_community_channel(uuid, text, text)
to authenticated;

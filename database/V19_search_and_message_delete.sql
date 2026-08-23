-- Live Coders V19: reliable global search + user message deletion.
-- Search is handled by a single SECURITY DEFINER RPC so the UI does not
-- depend on several client-side PostgREST OR queries/relationships.

create or replace function public.search_livecoders(search_query_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  term text := lower(trim(coalesce(search_query_input,'')));
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in';
  end if;

  if length(term) < 1 then
    return jsonb_build_object('users','[]'::jsonb,'posts','[]'::jsonb,'communities','[]'::jsonb);
  end if;

  term := left(term, 100);

  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(to_jsonb(u) order by u.rank, u.display_name nulls last, u.username)
      from (
        select
          p.id,
          p.username,
          p.display_name,
          p.full_name,
          p.avatar_url,
          p.bio,
          p.skills,
          p.location,
          case
            when lower(coalesce(p.username,'')) = term then 0
            when lower(coalesce(p.display_name,'')) = term then 1
            when lower(coalesce(p.full_name,'')) = term then 2
            else 3
          end as rank
        from public.profiles p
        where lower(coalesce(p.username,'')) like '%' || term || '%'
           or lower(coalesce(p.display_name,'')) like '%' || term || '%'
           or lower(coalesce(p.full_name,'')) like '%' || term || '%'
           or lower(coalesce(p.bio,'')) like '%' || term || '%'
           or lower(coalesce(p.location,'')) like '%' || term || '%'
           or exists (
             select 1 from unnest(coalesce(p.skills,'{}'::text[])) skill
             where lower(skill) like '%' || term || '%'
           )
        order by rank, p.display_name nulls last, p.username
        limit 20
      ) u
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.rank, x.created_at desc)
      from (
        select
          p.id,
          p.title,
          p.content,
          p.category,
          p.post_type,
          p.created_at,
          p.author_id,
          p.like_count,
          p.comment_count,
          p.view_count,
          pr.username as author_username,
          coalesce(pr.display_name,pr.full_name,pr.username) as author_name,
          pr.avatar_url as author_avatar_url,
          case
            when lower(coalesce(p.title,'')) = term then 0
            when lower(coalesce(p.title,'')) like term || '%' then 1
            when lower(coalesce(p.category,'')) like '%' || term || '%' then 2
            else 3
          end as rank
        from public.posts p
        left join public.profiles pr on pr.id=p.author_id
        where lower(coalesce(p.title,'')) like '%' || term || '%'
           or lower(coalesce(p.content,'')) like '%' || term || '%'
           or lower(coalesce(p.category,'')) like '%' || term || '%'
           or exists (
             select 1 from unnest(coalesce(p.tags,'{}'::text[])) tag
             where lower(tag) like '%' || term || '%'
           )
        order by rank, p.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.rank, c.member_count desc nulls last, c.name)
      from (
        select
          c.id,
          c.name,
          c.description,
          c.logo_url,
          c.category,
          c.member_count,
          c.view_count,
          c.recruitment_enabled,
          c.recruitment_mode,
          c.location,
          c.remote_mode,
          c.creator_id,
          case
            when lower(coalesce(c.name,'')) = term then 0
            when lower(coalesce(c.name,'')) like term || '%' then 1
            when lower(coalesce(c.category,'')) like '%' || term || '%' then 2
            else 3
          end as rank
        from public.communities c
        where lower(coalesce(c.name,'')) like '%' || term || '%'
           or lower(coalesce(c.description,'')) like '%' || term || '%'
           or lower(coalesce(c.category,'')) like '%' || term || '%'
           or lower(coalesce(c.location,'')) like '%' || term || '%'
        order by rank, c.member_count desc nulls last, c.name
        limit 20
      ) c
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.search_livecoders(text) to authenticated;

-- Delete/unsend an individual message. This is intentionally a soft delete:
-- the message row remains for conversation integrity, while its visible payload
-- is removed. Users can only delete their own messages.
create or replace function public.delete_direct_message(message_id_input uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  update public.messages
  set deleted_at=now(),
      deleted_by=auth.uid(),
      content='',
      attachment_url=null,
      attachment_name=null,
      attachment_type=null,
      voice_url=null,
      voice_duration_seconds=null
  where id=message_id_input
    and sender_id=auth.uid()
    and deleted_at is null;
  if not found then raise exception 'You can only delete your own message'; end if;
end;
$$;

grant execute on function public.delete_direct_message(uuid) to authenticated;

create or replace function public.delete_community_message(message_id_input uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  update public.community_messages
  set deleted_at=now(),
      deleted_by=auth.uid(),
      content='',
      attachment_url=null,
      attachment_name=null,
      attachment_type=null,
      voice_url=null,
      voice_duration_seconds=null
  where id=message_id_input
    and sender_id=auth.uid()
    and deleted_at is null;
  if not found then raise exception 'You can only delete your own message'; end if;
end;
$$;

grant execute on function public.delete_community_message(uuid) to authenticated;

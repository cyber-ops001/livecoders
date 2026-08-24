-- Live Coders v20.6.8: follow controls + follow/unfollow activity notifications.
-- Run after V20_production_search_messaging_theme.sql.

create or replace function public.notify_unfollow()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notifications(
    recipient_id,
    actor_id,
    notification_type,
    related_entity_id,
    related_entity_type,
    message
  )
  select
    old.following_id,
    old.follower_id,
    'unfollow',
    old.following_id,
    'profile',
    '@'||coalesce((select username from public.profiles where id=old.follower_id),'developer')||' unfollowed you.'
  where old.following_id <> old.follower_id;
  return old;
end;
$$;

drop trigger if exists unfollow_notification on public.follows;
create trigger unfollow_notification
after delete on public.follows
for each row execute function public.notify_unfollow();

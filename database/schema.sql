-- ============================================================================
-- LIVE CODERS — MASTER SUPABASE SCHEMA
-- Clean, schematic, idempotent, and safe to run again.
-- ============================================================================
-- Architecture
--
-- profiles                    account/profile data + avatar + location
-- follows                     follower/following graph
-- posts                       public developer posts
-- post_likes                  post likes
-- post_comments               post comments
-- post_views                  post-view history
-- notifications               likes/comments/follows/applications/messages
-- communities                 community/project/recruitment data
-- community_members           membership + roles
-- community_applications      join/recruitment applications
-- community_messages          community chat
-- projects                    developer projects linked to communities
-- conversations               one-to-one chat containers
-- conversation_members        one-to-one participants + read state
-- messages                    one-to-one messages
-- ============================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- 0. SAFE LEGACY TABLE RENAMES
-- --------------------------------------------------------------------------
-- IMPORTANT: quoted names are used so PostgreSQL never mistakes camelCase
-- tables for lower-case identifiers. If the old table does not exist, nothing
-- happens and the new schema continues normally.
do $$
begin
  if to_regclass('public."postComments"') is not null
     and to_regclass('public.post_comments') is null then
    alter table public."postComments" rename to post_comments;
  end if;
  if to_regclass('public."postLikes"') is not null
     and to_regclass('public.post_likes') is null then
    alter table public."postLikes" rename to post_likes;
  end if;
  if to_regclass('public."postViews"') is not null
     and to_regclass('public.post_views') is null then
    alter table public."postViews" rename to post_views;
  end if;
  if to_regclass('public."conversationMembers"') is not null
     and to_regclass('public.conversation_members') is null then
    alter table public."conversationMembers" rename to conversation_members;
  end if;
  if to_regclass('public."communityMembers"') is not null
     and to_regclass('public.community_members') is null then
    alter table public."communityMembers" rename to community_members;
  end if;
  if to_regclass('public."communityAdmins"') is not null
     and to_regclass('public.community_admins') is null then
    alter table public."communityAdmins" rename to community_admins;
  end if;
  if to_regclass('public."communityApplications"') is not null
     and to_regclass('public.community_applications') is null then
    alter table public."communityApplications" rename to community_applications;
  end if;
  if to_regclass('public."communityPosts"') is not null
     and to_regclass('public.community_posts') is null then
    alter table public."communityPosts" rename to community_posts;
  end if;
  if to_regclass('public."communityMessages"') is not null
     and to_regclass('public.community_messages') is null then
    alter table public."communityMessages" rename to community_messages;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1. PROFILES
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text,
  display_name text,
  avatar_url text,
  bio text,
  location text,
  skills text[] not null default '{}',
  programming_languages text[] not null default '{}',
  technologies text[] not null default '{}',
  experience text,
  education text,
  achievements text,
  resume_url text,
  github_url text,
  linkedin_url text,
  portfolio_url text,
  website_url text,
  startup_interests text[] not null default '{}',
  online_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists skills text[] not null default '{}';
alter table public.profiles add column if not exists programming_languages text[] not null default '{}';
alter table public.profiles add column if not exists technologies text[] not null default '{}';
alter table public.profiles add column if not exists experience text;
alter table public.profiles add column if not exists education text;
alter table public.profiles add column if not exists achievements text;
alter table public.profiles add column if not exists resume_url text;
alter table public.profiles add column if not exists github_url text;
alter table public.profiles add column if not exists linkedin_url text;
alter table public.profiles add column if not exists portfolio_url text;
alter table public.profiles add column if not exists website_url text;
alter table public.profiles add column if not exists startup_interests text[] not null default '{}';
alter table public.profiles add column if not exists online_at timestamptz;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- --------------------------------------------------------------------------
-- 2. POSTS + POST ACTIVITY
-- V4 replaces legacy non-unique view tables with one-view-per-user keys.
drop table if exists public.profile_views cascade;
drop table if exists public.post_views cascade;
drop table if exists public.community_views cascade;
drop function if exists public.record_profile_view(uuid);
drop function if exists public.notify_profile_view();

-- --------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  category text not null default 'Developer Problem',
  status text not null default 'Open'
    check (status in ('Open','Being Solved','Solved','Closed')),
  like_count integer not null default 0,
  comment_count integer not null default 0,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.post_comments(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  is_accepted boolean not null default false,
  like_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id,user_id)
);

create table if not exists public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (post_id,viewer_id)
);

-- --------------------------------------------------------------------------
-- 3. FOLLOWING + SOCIAL GRAPH
-- --------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id,following_id),
  check (follower_id <> following_id)
);

-- Live Coders tracks content engagement instead: post_views and community_views.


-- --------------------------------------------------------------------------
-- 4. NOTIFICATIONS
-- --------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  notification_type text not null,
  related_entity_id uuid,
  related_entity_type text,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 5. COMMUNITIES
-- --------------------------------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null,
  logo_url text,
  banner_url text,
  category text,
  rules text,
  recruitment_enabled boolean not null default false,
  eligibility_requirements text,
  required_skills text[] not null default '{}',
  roles text[] not null default '{}',
  openings integer not null default 0 check (openings >= 0),
  application_questions jsonb not null default '[]'::jsonb,
  location text,
  remote_mode text not null default 'Remote'
    check (remote_mode in ('Remote','Onsite','Hybrid')),
  social_links jsonb not null default '{}'::jsonb,
  member_count integer not null default 0,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists communities_name_unique_idx
  on public.communities (lower(trim(name)));

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('creator','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (community_id,user_id)
);

create table if not exists public.community_admins (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (community_id,user_id)
);

create table if not exists public.community_applications (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id,applicant_id)
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null,
  slug text not null,
  topic text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(community_id, slug)
);

alter table public.community_messages add column if not exists channel_id uuid references public.community_channels(id) on delete set null;

create table if not exists public.community_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_files (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  url text not null,
  file_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.community_views (
  community_id uuid not null references public.communities(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (community_id,viewer_id)
);

-- --------------------------------------------------------------------------
-- 6. PROJECTS
-- --------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete set null,
  name text not null,
  description text,
  url text,
  repository_url text,
  technologies text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 7. ONE-TO-ONE MESSAGING
-- --------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 7B. OLD-SCHEMA COMPATIBILITY COLUMNS
-- --------------------------------------------------------------------------
alter table public.posts add column if not exists like_count integer not null default 0;
alter table public.posts add column if not exists comment_count integer not null default 0;
alter table public.post_comments add column if not exists like_count integer not null default 0;
alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.posts add column if not exists tags text[] not null default '{}';
alter table public.posts add column if not exists category text not null default 'Developer Problem';
alter table public.posts add column if not exists status text not null default 'Open';
alter table public.projects add column if not exists community_id uuid references public.communities(id) on delete set null;
alter table public.communities add column if not exists logo_url text;
alter table public.communities add column if not exists banner_url text;
alter table public.communities add column if not exists recruitment_enabled boolean not null default false;
alter table public.communities add column if not exists location text;
alter table public.communities add column if not exists view_count integer not null default 0;
alter table public.community_applications add column if not exists answers jsonb not null default '{}'::jsonb;


-- Deduplicate legacy view rows before V4 unique view keys are enforced.
delete from public.post_views a using public.post_views b
where a.ctid < b.ctid and a.post_id=b.post_id and a.viewer_id=b.viewer_id;
delete from public.community_views a using public.community_views b
where a.ctid < b.ctid and a.community_id=b.community_id and a.viewer_id=b.viewer_id;

-- --------------------------------------------------------------------------
-- 8. SEARCH / INDEXES
-- --------------------------------------------------------------------------
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_display_name_idx on public.profiles(lower(display_name));
create index if not exists posts_created_idx on public.posts(created_at desc);
create index if not exists posts_author_idx on public.posts(author_id,created_at desc);
create index if not exists post_comments_post_idx on public.post_comments(post_id,created_at);
create index if not exists post_likes_post_idx on public.post_likes(post_id,created_at);
create index if not exists post_views_post_idx on public.post_views(post_id,viewed_at desc);
create index if not exists comment_likes_comment_idx on public.comment_likes(comment_id,created_at desc);
create index if not exists community_views_community_idx on public.community_views(community_id,viewed_at desc);
create index if not exists follows_following_idx on public.follows(following_id,created_at desc);
create index if not exists follows_follower_idx on public.follows(follower_id,created_at desc);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,created_at desc);
create index if not exists community_members_user_idx on public.community_members(user_id,joined_at desc);
create index if not exists community_members_community_idx on public.community_members(community_id,joined_at);
create index if not exists community_applications_community_idx on public.community_applications(community_id,status,created_at desc);
create index if not exists community_applications_applicant_idx on public.community_applications(applicant_id,created_at desc);
create index if not exists community_messages_idx on public.community_messages(community_id,created_at);
create index if not exists community_messages_channel_idx on public.community_messages(channel_id,created_at);
create index if not exists community_channels_community_idx on public.community_channels(community_id,position);
create index if not exists community_events_idx on public.community_events(community_id,starts_at);
create index if not exists community_files_idx on public.community_files(community_id,created_at desc);
create index if not exists community_views_viewer_idx on public.community_views(viewer_id,viewed_at desc);
create index if not exists projects_owner_idx on public.projects(owner_id,created_at desc);
create index if not exists projects_community_idx on public.projects(community_id,created_at desc);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id,conversation_id);
create index if not exists messages_conversation_idx on public.messages(conversation_id,created_at);

-- Case-insensitive username uniqueness. Existing data with exact duplicate
-- usernames should be cleaned before this line if such data exists.
create unique index if not exists profiles_username_ci_unique_idx
  on public.profiles(lower(username));

-- --------------------------------------------------------------------------
-- 9. PROFILE IDENTITY VALIDATION
-- --------------------------------------------------------------------------
create or replace function public.validate_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
  normalized_username text;
begin
  new.username := lower(trim(new.username));
  new.full_name := nullif(trim(new.full_name),'');
  new.display_name := nullif(trim(coalesce(new.display_name,new.full_name)), '');

  if new.display_name is null then
    raise exception 'Full name is required';
  end if;

  if new.username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must contain 3-30 lowercase letters, numbers or underscores';
  end if;

  normalized_name := lower(trim(new.display_name));
  normalized_username := lower(trim(new.username));

  -- Advisory locks make the checks safe even if two signups happen together.
  perform pg_advisory_xact_lock(hashtext('livecoders:name:' || normalized_name));
  perform pg_advisory_xact_lock(hashtext('livecoders:username:' || normalized_username));

  if exists (
    select 1 from public.profiles p
    where p.id <> new.id
      and lower(trim(coalesce(p.display_name,p.full_name,''))) = normalized_name
  ) then
    raise exception 'That name is already in use';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id <> new.id
      and lower(trim(p.username)) = normalized_username
  ) then
    raise exception 'That username is already in use';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_identity_validation on public.profiles;
create trigger profiles_identity_validation
before insert or update of username,full_name,display_name
on public.profiles
for each row execute function public.validate_profile_identity();

-- --------------------------------------------------------------------------
-- 10. AUTO-CREATE PROFILE AFTER AUTH SIGNUP
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
  requested_name text;
  generated_username text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  requested_name := trim(coalesce(new.raw_user_meta_data->>'fullName',''));

  generated_username := regexp_replace(requested_username,'[^a-z0-9_]','','g');
  if length(generated_username) < 3 then
    generated_username := 'coder_' || substr(replace(new.id::text,'-',''),1,8);
  end if;

  insert into public.profiles(id,username,full_name,display_name)
  values(new.id,generated_username,nullif(requested_name,''),nullif(requested_name,''))
  on conflict (id) do update set
    username = excluded.username,
    full_name = excluded.full_name,
    display_name = excluded.display_name,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- 11. CONTENT VIEW RPCs
-- --------------------------------------------------------------------------
-- Each authenticated profile counts at most once per post/community.
create or replace function public.record_post_view(post_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.post_views(post_id,viewer_id)
  values(post_id_input,auth.uid())
  on conflict (post_id,viewer_id) do nothing;
end;
$$;

create or replace function public.record_community_view(community_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.community_views(community_id,viewer_id)
  values(community_id_input,auth.uid())
  on conflict (community_id,viewer_id) do nothing;
end;
$$;

-- --------------------------------------------------------------------------
-- 12. POST COUNTERS + ACTIVITY NOTIFICATIONS
-- --------------------------------------------------------------------------
create or replace function public.refresh_post_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid;
begin
  pid := coalesce(new.post_id,old.post_id);
  update public.posts
  set like_count=(select count(*) from public.post_likes where post_id=pid),
      comment_count=(select count(*) from public.post_comments where post_id=pid),
      view_count=(select count(*) from public.post_views where post_id=pid)
  where id=pid;
  return coalesce(new,old);
end;
$$;

drop trigger if exists post_likes_counter on public.post_likes;
create trigger post_likes_counter after insert or delete on public.post_likes
for each row execute function public.refresh_post_counts();

drop trigger if exists post_comments_counter on public.post_comments;
create trigger post_comments_counter after insert or delete on public.post_comments
for each row execute function public.refresh_post_counts();

drop trigger if exists post_views_counter on public.post_views;
create trigger post_views_counter after insert on public.post_views
for each row execute function public.refresh_post_counts();

create or replace function public.refresh_comment_like_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  cid := coalesce(new.comment_id,old.comment_id);
  update public.post_comments
  set like_count=(select count(*) from public.comment_likes where comment_id=cid), updated_at=now()
  where id=cid;
  return coalesce(new,old);
end;
$$;

drop trigger if exists comment_likes_counter on public.comment_likes;
create trigger comment_likes_counter after insert or delete on public.comment_likes
for each row execute function public.refresh_comment_like_count();

create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
  select new.following_id,new.follower_id,'follow',new.following_id,'profile',
    '@'||coalesce((select username from public.profiles where id=new.follower_id),'developer')||' started following you.'
  where new.following_id <> new.follower_id;
  return new;
end;
$$;

drop trigger if exists follow_notification on public.follows;
create trigger follow_notification after insert on public.follows
for each row execute function public.notify_follow();

create or replace function public.notify_post_like()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
  select p.author_id,new.user_id,'post_like',new.post_id,'post',
    '@'||coalesce((select username from public.profiles where id=new.user_id),'developer')||' liked your post.'
  from public.posts p
  where p.id=new.post_id and p.author_id<>new.user_id;
  return new;
end;
$$;

drop trigger if exists like_notification on public.post_likes;
create trigger like_notification after insert on public.post_likes
for each row execute function public.notify_post_like();

create or replace function public.notify_post_comment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.parent_id is null then
    insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
    select p.author_id,new.author_id,'post_comment',new.post_id,'post',
      '@'||coalesce((select username from public.profiles where id=new.author_id),'developer')||' commented on your post.'
    from public.posts p
    where p.id=new.post_id and p.author_id<>new.author_id;
  else
    insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
    select c.author_id,new.author_id,'comment_reply',new.id,'comment',
      '@'||coalesce((select username from public.profiles where id=new.author_id),'developer')||' replied to your comment.'
    from public.post_comments c
    where c.id=new.parent_id and c.author_id<>new.author_id;
  end if;
  return new;
end;
$$;

drop trigger if exists comment_notification on public.post_comments;
create trigger comment_notification after insert on public.post_comments
for each row execute function public.notify_post_comment();

create or replace function public.notify_comment_like()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
  select c.author_id,new.user_id,'comment_like',new.comment_id,'comment',
    '@'||coalesce((select username from public.profiles where id=new.user_id),'developer')||' liked your comment.'
  from public.post_comments c
  where c.id=new.comment_id and c.author_id<>new.user_id;
  return new;
end;
$$;

drop trigger if exists comment_like_notification on public.comment_likes;
create trigger comment_like_notification after insert on public.comment_likes
for each row execute function public.notify_comment_like();

-- --------------------------------------------------------------------------
-- 13. COMMUNITY MEMBER COUNT + APPLICATION NOTIFICATION
-- --------------------------------------------------------------------------
create or replace function public.refresh_member_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  cid := coalesce(new.community_id,old.community_id);
  update public.communities
  set member_count=(select count(*) from public.community_members where community_id=cid), updated_at=now()
  where id=cid;
  return coalesce(new,old);
end;
$$;

drop trigger if exists community_member_counter on public.community_members;
create trigger community_member_counter after insert or delete on public.community_members
for each row execute function public.refresh_member_count();

create or replace function public.refresh_community_view_count()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  cid := coalesce(new.community_id,old.community_id);
  update public.communities
  set view_count=(select count(*) from public.community_views where community_id=cid), updated_at=now()
  where id=cid;
  return coalesce(new,old);
end;
$$;

drop trigger if exists community_views_counter on public.community_views;
create trigger community_views_counter after insert or delete on public.community_views
for each row execute function public.refresh_community_view_count();

create or replace function public.notify_community_application()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
  select c.creator_id,new.applicant_id,'community_application',new.id,'community_application',
    '@'||coalesce((select username from public.profiles where id=new.applicant_id),'developer')||' applied to join '||c.name||'.'
  from public.communities c
  where c.id=new.community_id and c.creator_id<>new.applicant_id;
  return new;
end;
$$;

drop trigger if exists community_application_notification on public.community_applications;
create trigger community_application_notification after insert on public.community_applications
for each row execute function public.notify_community_application();

-- --------------------------------------------------------------------------
-- 14. COMMUNITY CREATION — atomic community + creator membership
-- --------------------------------------------------------------------------
create or replace function public.create_community(
  name_input text, description_input text, category_input text default null,
  skills_input text[] default '{}', rules_input text default null,
  remote_mode_input text default 'Remote', recruitment_input boolean default false,
  location_input text default null, logo_url_input text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if length(trim(coalesce(name_input,''))) < 2 then raise exception 'Community name is required'; end if;
  insert into public.communities(creator_id,name,description,category,required_skills,rules,remote_mode,recruitment_enabled,location,logo_url)
  values(auth.uid(),trim(name_input),trim(description_input),nullif(trim(category_input),''),coalesce(skills_input,'{}'),nullif(trim(rules_input),''),coalesce(remote_mode_input,'Remote'),coalesce(recruitment_input,false),nullif(trim(location_input),''),logo_url_input)
  returning id into cid;
  insert into public.community_members(community_id,user_id,role) values(cid,auth.uid(),'creator')
  on conflict (community_id,user_id) do update set role='creator';
  insert into public.community_channels(community_id,name,slug,topic,position) values
    (cid,'general','general','General discussion about ideas, startups and tech',0),
    (cid,'project-updates','project-updates','Share progress, launches and project updates',1),
    (cid,'help-needed','help-needed','Ask for help and solve problems together',2),
    (cid,'resources','resources','Useful resources, links and learning material',3),
    (cid,'off-topic','off-topic','Everything outside the main work',4)
  on conflict (community_id,slug) do nothing;
  return cid;
end;
$$;

-- Repair helper for communities created before creator membership was enforced.
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

create or replace function public.accept_community_application(application_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; applicant uuid;
begin
  select community_id,applicant_id into cid,applicant from public.community_applications where id=application_id_input and status='pending';
  if cid is null then raise exception 'Application not found or already reviewed'; end if;
  if not exists(select 1 from public.communities where id=cid and creator_id=auth.uid()) then raise exception 'Only the community creator can accept applications'; end if;
  update public.community_applications set status='accepted',reviewed_by=auth.uid(),updated_at=now() where id=application_id_input;
  insert into public.community_members(community_id,user_id,role) values(cid,applicant,'member') on conflict (community_id,user_id) do nothing;
end;
$$;

-- --------------------------------------------------------------------------
-- 14. DIRECT MESSAGES — SECURE RPCs
-- --------------------------------------------------------------------------
-- --------------------------------------------------------------------------
-- 14B. DIRECT MESSAGE MEMBERSHIP HELPER
-- --------------------------------------------------------------------------
create or replace function public.is_conversation_member(conversation_id_input uuid, user_id_input uuid default auth.uid())
returns boolean language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.conversation_members
    where conversation_id=conversation_id_input and user_id=user_id_input
  );
$$;

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  if auth.uid() is null or other_user_id is null or other_user_id=auth.uid() then
    raise exception 'Invalid conversation users';
  end if;

  if not exists(select 1 from public.profiles where id=other_user_id) then
    raise exception 'User does not exist';
  end if;

  select c.id into existing_id
  from public.conversations c
  where (select count(*) from public.conversation_members cm where cm.conversation_id=c.id)=2
    and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=auth.uid())
    and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=other_user_id)
  order by c.created_at
  limit 1;

  if existing_id is not null then return existing_id; end if;

  insert into public.conversations(created_by) values(auth.uid()) returning id into new_id;
  insert into public.conversation_members(conversation_id,user_id)
  values(new_id,auth.uid()),(new_id,other_user_id);

  return new_id;
end;
$$;

create or replace function public.send_direct_message(conversation_id_input uuid, content_input text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare message_id uuid;
receiver_id uuid;
begin
  if auth.uid() is null or length(trim(coalesce(content_input,'')))=0 then
    raise exception 'Message cannot be empty';
  end if;

  if not exists(
    select 1 from public.conversation_members
    where conversation_id=conversation_id_input and user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this conversation';
  end if;

  select cm.user_id into receiver_id
  from public.conversation_members cm
  where cm.conversation_id=conversation_id_input and cm.user_id<>auth.uid()
  limit 1;

  insert into public.messages(conversation_id,sender_id,content)
  values(conversation_id_input,auth.uid(),trim(content_input))
  returning id into message_id;

  update public.conversations set updated_at=now() where id=conversation_id_input;

  if receiver_id is not null then
    insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message)
    select receiver_id,auth.uid(),'message',conversation_id_input,'conversation',
      '@'||coalesce((select username from public.profiles where id=auth.uid()),'developer')||' sent you a message.';
  end if;

  return message_id;
end;
$$;

create or replace function public.send_community_message(community_id_input uuid, channel_id_input uuid default null, content_input text default '')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare message_id uuid; target_channel uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if length(trim(coalesce(content_input,'')))=0 then raise exception 'Message cannot be empty'; end if;
  if not exists(select 1 from public.community_members where community_id=community_id_input and user_id=auth.uid()) then
    raise exception 'Join this community before sending messages';
  end if;
  if channel_id_input is not null then
    if not exists(select 1 from public.community_channels where id=channel_id_input and community_id=community_id_input) then
      raise exception 'Channel does not belong to this community';
    end if;
    target_channel:=channel_id_input;
  else
    select id into target_channel from public.community_channels where community_id=community_id_input order by position limit 1;
  end if;
  insert into public.community_messages(community_id,channel_id,sender_id,content)
  values(community_id_input,target_channel,auth.uid(),trim(content_input))
  returning id into message_id;
  return message_id;
end;
$$;

create or replace function public.ensure_default_community_channels(community_id_input uuid)
returns setof public.community_channels
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.community_members where community_id=community_id_input and user_id=auth.uid())
     and not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then
    raise exception 'You are not a member of this community';
  end if;
  insert into public.community_channels(community_id,name,slug,topic,position) values
    (community_id_input,'general','general','General discussion about ideas, startups and tech',0),
    (community_id_input,'project-updates','project-updates','Share progress, launches and project updates',1),
    (community_id_input,'help-needed','help-needed','Ask for help and solve problems together',2),
    (community_id_input,'resources','resources','Useful resources, links and learning material',3),
    (community_id_input,'off-topic','off-topic','Everything outside the main work',4)
  on conflict (community_id,slug) do nothing;
  update public.community_messages m set channel_id=(select ch.id from public.community_channels ch where ch.community_id=m.community_id and ch.slug='general' limit 1)
  where m.community_id=community_id_input and m.channel_id is null;
  return query select * from public.community_channels where community_id=community_id_input order by position;
end;
$$;

create or replace function public.update_community(
  community_id_input uuid, name_input text, description_input text, category_input text default null,
  skills_input text[] default '{}', rules_input text default null, remote_mode_input text default 'Remote',
  recruitment_input boolean default false, location_input text default null, logo_url_input text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then
    raise exception 'Only the community creator can edit this community';
  end if;
  update public.communities set
    name=trim(name_input), description=trim(description_input), category=nullif(trim(category_input),''),
    required_skills=coalesce(skills_input,'{}'), rules=nullif(trim(rules_input),''), remote_mode=coalesce(remote_mode_input,'Remote'),
    recruitment_enabled=coalesce(recruitment_input,false), location=nullif(trim(location_input),''),
    logo_url=coalesce(logo_url_input,logo_url), updated_at=now()
  where id=community_id_input;
end;
$$;

-- --------------------------------------------------------------------------
-- 15. RLS
-- --------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.post_views enable row level security;
alter table public.follows enable row level security;
alter table public.notifications enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_admins enable row level security;
alter table public.community_applications enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_channels enable row level security;
alter table public.community_events enable row level security;
alter table public.community_files enable row level security;
alter table public.community_views enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

do $$
declare r record;
begin
  for r in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename in (
        'profiles','posts','post_likes','post_comments','comment_likes','post_views','follows',
        'notifications','communities','community_members',
        'community_admins','community_applications','community_posts',
        'community_messages','community_channels','community_events','community_files','community_views','projects','conversations','conversation_members','messages'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  end loop;
end $$;

-- Profiles: public read, owner-only write.
create policy profiles_select on public.profiles for select to authenticated using(true);
create policy profiles_insert on public.profiles for insert to authenticated with check(auth.uid()=id);
create policy profiles_update_own on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);

-- Posts.
create policy posts_select on public.posts for select to authenticated using(true);
create policy posts_insert_own on public.posts for insert to authenticated with check(auth.uid()=author_id);
create policy posts_update_own on public.posts for update to authenticated using(auth.uid()=author_id) with check(auth.uid()=author_id);
create policy posts_delete_own on public.posts for delete to authenticated using(auth.uid()=author_id);

-- Post activity.
create policy post_likes_select on public.post_likes for select to authenticated using(true);
create policy post_likes_insert_own on public.post_likes for insert to authenticated with check(auth.uid()=user_id);
create policy post_likes_delete_own on public.post_likes for delete to authenticated using(auth.uid()=user_id);

create policy post_comments_select on public.post_comments for select to authenticated using(true);
create policy post_comments_insert_own on public.post_comments for insert to authenticated with check(auth.uid()=author_id);
create policy post_comments_update_own on public.post_comments for update to authenticated using(auth.uid()=author_id) with check(auth.uid()=author_id);
create policy post_comments_delete_own on public.post_comments for delete to authenticated using(auth.uid()=author_id);

-- Follow graph.
create policy follows_select on public.follows for select to authenticated using(true);
create policy follows_insert_own on public.follows for insert to authenticated with check(auth.uid()=follower_id);
create policy follows_delete_own on public.follows for delete to authenticated using(auth.uid()=follower_id);

-- Content views: owners can inspect viewers; viewers can insert their own row.
create policy post_views_select_owner on public.post_views for select to authenticated using(
  exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid())
);
create policy post_views_insert_own on public.post_views for insert to authenticated with check(auth.uid()=viewer_id);

create policy comment_likes_select on public.comment_likes for select to authenticated using(true);
create policy comment_likes_insert_own on public.comment_likes for insert to authenticated with check(auth.uid()=user_id);
create policy comment_likes_delete_own on public.comment_likes for delete to authenticated using(auth.uid()=user_id);

create policy community_views_select_owner on public.community_views for select to authenticated using(
  exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);
create policy community_views_insert_own on public.community_views for insert to authenticated with check(auth.uid()=viewer_id);

-- Notifications.
create policy notifications_select_own on public.notifications for select to authenticated using(auth.uid()=recipient_id);
create policy notifications_update_own on public.notifications for update to authenticated using(auth.uid()=recipient_id) with check(auth.uid()=recipient_id);

-- Communities.
create policy communities_select on public.communities for select to authenticated using(true);
create policy communities_insert_creator on public.communities for insert to authenticated with check(auth.uid()=creator_id);
create policy communities_update_creator on public.communities for update to authenticated using(auth.uid()=creator_id) with check(auth.uid()=creator_id);
create policy communities_delete_creator on public.communities for delete to authenticated using(auth.uid()=creator_id);

-- Memberships.
create policy community_members_select on public.community_members for select to authenticated using(true);
create policy community_members_insert_creator_or_admin on public.community_members for insert to authenticated with check(
  exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);
create policy community_members_delete_self on public.community_members for delete to authenticated using(
  auth.uid()=user_id or exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);
create policy community_members_update_creator on public.community_members for update to authenticated using(
  exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
) with check(
  exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);

-- Applications: applicant + community creator only.
create policy community_applications_select on public.community_applications for select to authenticated using(
  auth.uid()=applicant_id or exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);
create policy community_applications_insert_self on public.community_applications for insert to authenticated with check(auth.uid()=applicant_id);
create policy community_applications_update on public.community_applications for update to authenticated using(
  auth.uid()=applicant_id or exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
) with check(
  auth.uid()=applicant_id or exists(select 1 from public.communities c where c.id=community_id and c.creator_id=auth.uid())
);

-- Community chat.
create policy community_messages_select_member on public.community_messages for select to authenticated using(
  exists(select 1 from public.community_members cm where cm.community_id=community_messages.community_id and cm.user_id=auth.uid())
);
create policy community_messages_insert_member on public.community_messages for insert to authenticated with check(
  auth.uid()=sender_id and exists(select 1 from public.community_members cm where cm.community_id=community_messages.community_id and cm.user_id=auth.uid())
);

create policy community_channels_select_member on public.community_channels for select to authenticated using(
  exists(select 1 from public.community_members cm where cm.community_id=community_channels.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c where c.id=community_channels.community_id and c.creator_id=auth.uid())
);
create policy community_channels_manage_creator on public.community_channels for all to authenticated using(
  exists(select 1 from public.communities c where c.id=community_channels.community_id and c.creator_id=auth.uid())
) with check(
  exists(select 1 from public.communities c where c.id=community_channels.community_id and c.creator_id=auth.uid())
);

create policy community_events_select_member on public.community_events for select to authenticated using(
  exists(select 1 from public.community_members cm where cm.community_id=community_events.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c where c.id=community_events.community_id and c.creator_id=auth.uid())
);
create policy community_events_insert_creator on public.community_events for insert to authenticated with check(
  auth.uid()=creator_id and exists(select 1 from public.communities c where c.id=community_events.community_id and c.creator_id=auth.uid())
);
create policy community_events_update_creator on public.community_events for update to authenticated using(auth.uid()=creator_id) with check(auth.uid()=creator_id);
create policy community_events_delete_creator on public.community_events for delete to authenticated using(auth.uid()=creator_id);

create policy community_files_select_member on public.community_files for select to authenticated using(
  exists(select 1 from public.community_members cm where cm.community_id=community_files.community_id and cm.user_id=auth.uid())
  or exists(select 1 from public.communities c where c.id=community_files.community_id and c.creator_id=auth.uid())
);
create policy community_files_insert_member on public.community_files for insert to authenticated with check(
  auth.uid()=uploader_id and exists(select 1 from public.community_members cm where cm.community_id=community_files.community_id and cm.user_id=auth.uid())
);

-- Community posts.
create policy community_posts_select_member on public.community_posts for select to authenticated using(
  exists(select 1 from public.community_members cm where cm.community_id=community_posts.community_id and cm.user_id=auth.uid())
);
create policy community_posts_insert_member on public.community_posts for insert to authenticated with check(
  auth.uid()=author_id and exists(select 1 from public.community_members cm where cm.community_id=community_posts.community_id and cm.user_id=auth.uid())
);

-- Projects: everyone can see, only owner can modify; community link must be a
-- community the owner belongs to.
create policy projects_select on public.projects for select to authenticated using(true);
create policy projects_insert_own on public.projects for insert to authenticated with check(
  auth.uid()=owner_id and (
    community_id is null or exists(
      select 1 from public.community_members cm
      where cm.community_id=projects.community_id and cm.user_id=auth.uid()
    )
  )
);
create policy projects_update_own on public.projects for update to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
create policy projects_delete_own on public.projects for delete to authenticated using(auth.uid()=owner_id);

-- Direct messages. The RPCs above perform writes with SECURITY DEFINER;
-- reads are still restricted to participants.
create policy conversations_select_member on public.conversations for select to authenticated using(
  public.is_conversation_member(id,auth.uid())
);
create policy conversation_members_select_member on public.conversation_members for select to authenticated using(
  public.is_conversation_member(conversation_id,auth.uid())
);
create policy conversation_members_update_self on public.conversation_members for update to authenticated using(
  user_id=auth.uid()
) with check(user_id=auth.uid());
create policy messages_select_member on public.messages for select to authenticated using(
  public.is_conversation_member(conversation_id,auth.uid())
);

-- One-time repair for existing V4 databases: restore missing creator/accepted memberships.
insert into public.community_members(community_id,user_id,role)
select c.id,c.creator_id,'creator'
from public.communities c
where c.creator_id is not null
on conflict (community_id,user_id) do update set role='creator';

insert into public.community_members(community_id,user_id,role)
select a.community_id,a.applicant_id,'member'
from public.community_applications a
where a.status='accepted'
on conflict (community_id,user_id) do nothing;

grant execute on function public.create_community(text,text,text,text[],text,text,boolean,text,text) to authenticated;
grant execute on function public.accept_community_application(uuid) to authenticated;
grant execute on function public.ensure_community_creator_membership(uuid) to authenticated;
grant execute on function public.record_post_view(uuid) to authenticated;
grant execute on function public.record_community_view(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid,uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid,text) to authenticated;
grant execute on function public.send_community_message(uuid,uuid,text) to authenticated;
grant execute on function public.ensure_default_community_channels(uuid) to authenticated;
grant execute on function public.update_community(uuid,text,text,text,text[],text,text,boolean,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- 16. STORAGE — AVATARS + COMMUNITY PICTURES
-- --------------------------------------------------------------------------
insert into storage.buckets(id,name,public)
values('avatars','avatars',true)
on conflict(id) do update set public=true;

insert into storage.buckets(id,name,public)
values('community-avatars','community-avatars',true)
on conflict(id) do update set public=true;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects for select using(bucket_id='avatars');

drop policy if exists avatars_owner_upload on storage.objects;
create policy avatars_owner_upload on storage.objects for insert to authenticated
with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects for update to authenticated
using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects for delete to authenticated
using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists community_avatar_public_read on storage.objects;
create policy community_avatar_public_read on storage.objects for select using(bucket_id='community-avatars');

drop policy if exists community_avatar_creator_upload on storage.objects;
create policy community_avatar_creator_upload on storage.objects for insert to authenticated
with check(
  bucket_id='community-avatars'
  and exists(select 1 from public.communities c where c.id=(storage.foldername(name))[1]::uuid and c.creator_id=auth.uid())
);

drop policy if exists community_avatar_creator_update on storage.objects;
create policy community_avatar_creator_update on storage.objects for update to authenticated
using(
  bucket_id='community-avatars'
  and exists(select 1 from public.communities c where c.id=(storage.foldername(name))[1]::uuid and c.creator_id=auth.uid())
)
with check(
  bucket_id='community-avatars'
  and exists(select 1 from public.communities c where c.id=(storage.foldername(name))[1]::uuid and c.creator_id=auth.uid())
);

-- --------------------------------------------------------------------------
-- 17. REALTIME
-- --------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.community_messages;
    alter publication supabase_realtime add table public.community_channels;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- --------------------------------------------------------------------------
-- 18. DATA MAP
-- --------------------------------------------------------------------------
-- profiles                 -> one developer + public profile + avatar + location
-- follows                  -> follower/following relationships
-- post_views              -> one view per user per post
-- community_views         -> one view per user per community
-- posts                   -> public developer posts
-- post_likes               -> one row per user/post like
-- post_comments            -> permanent comments
-- post_views               -> post view history
-- notifications            -> all user activity notifications
-- communities              -> community + recruitment settings + logo
-- community_members        -> joined communities + roles
-- community_applications   -> recruitment/join applications
-- community_messages       -> persistent community chat
-- projects                 -> developer projects linked to joined communities
-- conversations            -> one-to-one conversation
-- conversation_members     -> two participants + read state
-- messages                 -> persistent Instagram-style direct messages
-- ============================================================================
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


-- ================================================================
-- V8 WORKSPACE / CHAT FEATURES
-- ================================================================
-- LIVE CODERS V8 WORKSPACE / CHAT MIGRATION
-- Run after V7. Safe/idempotent for existing V7 databases.

alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists voice_url text;
alter table public.messages add column if not exists voice_duration_seconds integer;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
alter table public.community_messages add column if not exists attachment_url text;
alter table public.community_messages add column if not exists attachment_name text;
alter table public.community_messages add column if not exists attachment_type text;
alter table public.community_messages add column if not exists voice_url text;
alter table public.community_messages add column if not exists voice_duration_seconds integer;
alter table public.community_messages add column if not exists deleted_at timestamptz;
alter table public.community_messages add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_payload_check check(length(trim(coalesce(content,'')))>0 or attachment_url is not null or voice_url is not null);
alter table public.community_messages drop constraint if exists community_messages_content_check;
alter table public.community_messages add constraint community_messages_payload_check check(length(trim(coalesce(content,'')))>0 or attachment_url is not null or voice_url is not null);

create table if not exists public.direct_chat_clears(
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table if not exists public.community_chat_clears(
  community_id uuid not null references public.communities(id) on delete cascade,
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key(community_id,channel_id,user_id)
);

create or replace function public.create_community_channel(community_id_input uuid,name_input text,topic_input text default '')
returns public.community_channels language plpgsql security definer set search_path=public as $$
declare result public.community_channels; slug_value text; clean_name text;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if not exists(select 1 from public.communities where id=community_id_input and creator_id=auth.uid()) then raise exception 'Only the community head can create channels'; end if;
  clean_name=trim(name_input); if clean_name='' then raise exception 'Channel name is required'; end if;
  slug_value=trim(both '-' from regexp_replace(lower(clean_name),'[^a-z0-9]+','-','g'));
  if slug_value='' then raise exception 'Use letters or numbers in the channel name'; end if;
  if exists(select 1 from public.community_channels where community_id=community_id_input and slug=slug_value) then raise exception 'A channel with this name already exists'; end if;
  insert into public.community_channels(community_id,name,slug,topic,position)
  values(community_id_input,clean_name,slug_value,nullif(trim(topic_input),''),(select coalesce(max(position),-1)+1 from public.community_channels where community_id=community_id_input))
  returning * into result;
  return result;
end; $$;

create or replace function public.unsend_direct_message(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.messages set deleted_at=now(),deleted_by=auth.uid(),content='' where id=message_id_input and sender_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'You can only unsend your own message'; end if;
end; $$;
create or replace function public.unsend_community_message(message_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.community_messages set deleted_at=now(),deleted_by=auth.uid(),content='' where id=message_id_input and sender_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'You can only unsend your own message'; end if;
end; $$;

create or replace function public.clear_direct_chat_history(conversation_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_conversation_member(conversation_id_input,auth.uid()) then raise exception 'You are not part of this conversation'; end if;
  insert into public.direct_chat_clears(conversation_id,user_id,cleared_at) values(conversation_id_input,auth.uid(),now()) on conflict(conversation_id,user_id) do update set cleared_at=excluded.cleared_at;
end; $$;
create or replace function public.clear_community_chat_history(community_id_input uuid,channel_id_input uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.community_members where community_id=community_id_input and user_id=auth.uid()) then raise exception 'Join the community first'; end if;
  if not exists(select 1 from public.community_channels where id=channel_id_input and community_id=community_id_input) then raise exception 'Invalid channel'; end if;
  insert into public.community_chat_clears(community_id,channel_id,user_id,cleared_at) values(community_id_input,channel_id_input,auth.uid(),now()) on conflict(community_id,channel_id,user_id) do update set cleared_at=excluded.cleared_at;
end; $$;

create or replace function public.send_direct_message(conversation_id_input uuid,content_input text,attachment_url_input text default null,attachment_name_input text default null,attachment_type_input text default null,voice_url_input text default null,voice_duration_input integer default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare message_id uuid; receiver_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if length(trim(coalesce(content_input,'')))=0 and attachment_url_input is null and voice_url_input is null then raise exception 'Message cannot be empty'; end if;
  if not public.is_conversation_member(conversation_id_input,auth.uid()) then raise exception 'You are not a member of this conversation'; end if;
  select cm.user_id into receiver_id from public.conversation_members cm where cm.conversation_id=conversation_id_input and cm.user_id<>auth.uid() limit 1;
  insert into public.messages(conversation_id,sender_id,content,attachment_url,attachment_name,attachment_type,voice_url,voice_duration_seconds) values(conversation_id_input,auth.uid(),trim(coalesce(content_input,'')),attachment_url_input,attachment_name_input,attachment_type_input,voice_url_input,voice_duration_input) returning id into message_id;
  update public.conversations set updated_at=now() where id=conversation_id_input;
  if receiver_id is not null then insert into public.notifications(recipient_id,actor_id,notification_type,related_entity_id,related_entity_type,message) select receiver_id,auth.uid(),'message',conversation_id_input,'conversation','@'||coalesce((select username from public.profiles where id=auth.uid()),'developer')||' sent you a message.'; end if;
  return message_id;
end; $$;

create or replace function public.send_community_message(community_id_input uuid,channel_id_input uuid default null,content_input text default '',attachment_url_input text default null,attachment_name_input text default null,attachment_type_input text default null,voice_url_input text default null,voice_duration_input integer default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare message_id uuid; target_channel uuid;
begin
  if auth.uid() is null then raise exception 'You must be logged in'; end if;
  if length(trim(coalesce(content_input,'')))=0 and attachment_url_input is null and voice_url_input is null then raise exception 'Message cannot be empty'; end if;
  if not exists(select 1 from public.community_members where community_id=community_id_input and user_id=auth.uid()) then raise exception 'Join this community before sending messages'; end if;
  if channel_id_input is not null then
    if not exists(select 1 from public.community_channels where id=channel_id_input and community_id=community_id_input) then raise exception 'Channel does not belong to this community'; end if;
    target_channel:=channel_id_input;
  else select id into target_channel from public.community_channels where community_id=community_id_input order by position limit 1; end if;
  insert into public.community_messages(community_id,channel_id,sender_id,content,attachment_url,attachment_name,attachment_type,voice_url,voice_duration_seconds) values(community_id_input,target_channel,auth.uid(),trim(coalesce(content_input,'')),attachment_url_input,attachment_name_input,attachment_type_input,voice_url_input,voice_duration_input) returning id into message_id;
  return message_id;
end; $$;

alter table public.direct_chat_clears enable row level security;
alter table public.community_chat_clears enable row level security;
drop policy if exists direct_chat_clears_self on public.direct_chat_clears;
create policy direct_chat_clears_self on public.direct_chat_clears for select to authenticated using(user_id=auth.uid());
drop policy if exists community_chat_clears_self on public.community_chat_clears;
create policy community_chat_clears_self on public.community_chat_clears for select to authenticated using(user_id=auth.uid());

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated using(public.is_conversation_member(conversation_id,auth.uid()) and created_at>coalesce((select cleared_at from public.direct_chat_clears d where d.conversation_id=messages.conversation_id and d.user_id=auth.uid()),'-infinity'::timestamptz));
drop policy if exists community_messages_select_member on public.community_messages;
create policy community_messages_select_member on public.community_messages for select to authenticated using(exists(select 1 from public.community_members cm where cm.community_id=community_messages.community_id and cm.user_id=auth.uid()) and created_at>coalesce((select cleared_at from public.community_chat_clears cc where cc.community_id=community_messages.community_id and cc.channel_id=community_messages.channel_id and cc.user_id=auth.uid()),'-infinity'::timestamptz));

insert into storage.buckets(id,name,public) values('message-media','message-media',true) on conflict(id) do update set public=true;
drop policy if exists message_media_public_read on storage.objects;
create policy message_media_public_read on storage.objects for select using(bucket_id='message-media');
drop policy if exists message_media_owner_upload on storage.objects;
create policy message_media_owner_upload on storage.objects for insert to authenticated with check(bucket_id='message-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists message_media_owner_update on storage.objects;
create policy message_media_owner_update on storage.objects for update to authenticated using(bucket_id='message-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='message-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists message_media_owner_delete on storage.objects;
create policy message_media_owner_delete on storage.objects for delete to authenticated using(bucket_id='message-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- V7 community-avatar path/policy mismatch fix: browser paths start with auth user id.
drop policy if exists community_avatar_creator_upload_v7 on storage.objects;
drop policy if exists community_avatar_creator_update_v7 on storage.objects;
drop policy if exists community_avatar_creator_delete_v7 on storage.objects;
create policy community_avatar_creator_upload_v8 on storage.objects for insert to authenticated with check(bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy community_avatar_creator_update_v8 on storage.objects for update to authenticated using(bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy community_avatar_creator_delete_v8 on storage.objects for delete to authenticated using(bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

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

grant execute on function public.create_community_channel(uuid,text,text) to authenticated;
grant execute on function public.delete_community_channel(uuid,uuid) to authenticated;
grant execute on function public.unsend_direct_message(uuid) to authenticated;
grant execute on function public.unsend_community_message(uuid) to authenticated;
grant execute on function public.clear_direct_chat_history(uuid) to authenticated;
grant execute on function public.clear_community_chat_history(uuid,uuid) to authenticated;
grant execute on function public.send_direct_message(uuid,text,text,text,text,text,integer) to authenticated;
grant execute on function public.send_community_message(uuid,uuid,text,text,text,text,text,integer) to authenticated;

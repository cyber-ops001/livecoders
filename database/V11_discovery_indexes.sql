-- LIVE CODERS V11 — discovery/search performance support
-- No new tables are required for the V10 UI. Existing communities already
-- contain category, member_count and view_count, and community_views tracks views.
-- These indexes make community discovery/search faster as the dataset grows.

create index if not exists communities_member_count_idx
  on public.communities(member_count desc, created_at desc);

create index if not exists communities_category_idx
  on public.communities(category);

create index if not exists communities_created_at_idx
  on public.communities(created_at desc);

create index if not exists profiles_username_idx
  on public.profiles(username);

create index if not exists posts_created_at_idx
  on public.posts(created_at desc);

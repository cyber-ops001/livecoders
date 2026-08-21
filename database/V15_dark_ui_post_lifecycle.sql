-- Live Coders V15
-- Dark-only interface, unified post/blog lifecycle and safe post deletion.
-- Run after V14_social_graph_and_blogs.sql.

-- The existing schema already contains owner-only post deletion in the full schema.
-- Re-assert it here so upgraded databases have the same rule.
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
for delete to authenticated
using (auth.uid() = author_id);

-- Keep updates owner-only as well.
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
for update to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

-- Ensure the post lifecycle can represent the unified feed model.
alter table public.posts
  add column if not exists post_type text not null default 'post';

-- Existing rows remain valid. New application code determines the display type:
-- 1 page => post, 2+ pages => blog, video => reel.

create index if not exists posts_author_created_idx
  on public.posts(author_id, created_at desc);

create index if not exists posts_created_idx
  on public.posts(created_at desc);

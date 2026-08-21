-- Live Coders V12: richer social publishing + media
-- Run once in Supabase SQL Editor after the existing V11 migration.

alter table public.posts
  add column if not exists post_type text not null default 'post' check (post_type in ('post','blog','reel')),
  add column if not exists body_pages jsonb not null default '[]'::jsonb,
  add column if not exists media_url text,
  add column if not exists media_type text;

create index if not exists posts_post_type_idx on public.posts(post_type);
create index if not exists posts_category_idx on public.posts(category);
create index if not exists posts_created_at_idx on public.posts(created_at desc);

insert into storage.buckets(id,name,public)
values('post-media','post-media',true)
on conflict(id) do update set public=true;

drop policy if exists post_media_public_read on storage.objects;
create policy post_media_public_read on storage.objects
for select using (bucket_id='post-media');

drop policy if exists post_media_owner_upload on storage.objects;
create policy post_media_owner_upload on storage.objects
for insert to authenticated
with check (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists post_media_owner_update on storage.objects;
create policy post_media_owner_update on storage.objects
for update to authenticated
using (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists post_media_owner_delete on storage.objects;
create policy post_media_owner_delete on storage.objects
for delete to authenticated
using (bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

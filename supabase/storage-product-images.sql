-- Supabase Storage for product photos.
--
-- Run it once in the Supabase SQL editor (Project > SQL Editor > New query). It is safe to run again: the bucket
-- is created or updated, and the policies are dropped and created again. No photo is deleted.
--
-- HOW THE APP USES THIS BUCKET
--   The server uploads and deletes photos with the service-role key, which bypasses row level security. The browser
--   only reads public URLs. So the only policy the bucket needs is public read.
--
-- SECURITY: NOBODY BUT THE SERVER CAN WRITE
--   There is deliberately no insert, update or delete policy for "authenticated" or "anon". "authenticated" means ANY
--   Supabase Auth user, and this app does not use Supabase Auth for its own logins, so a write policy for that role
--   would let anyone who signs up with the public anon key add or overwrite files. Section 3 removes the two write
--   policies that an earlier version of this script created.

-- 1. The bucket: public read, 150 KB per file, images only.
--    These limits match MAX_IMAGE_BYTES and ALLOWED_IMAGE_TYPES in lib/image-type.ts. The browser shrinks every photo
--    to WebP under 150 KB before it is uploaded (lib/image-compress.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 150000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Public users can read the photos. Row level security on storage.objects is already enabled in Supabase.
drop policy if exists "product-images: public read" on storage.objects;
create policy "product-images: public read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'product-images');

-- 3. Remove the write policies an earlier version of this script created. Nothing replaces them.
drop policy if exists "product-images: authenticated insert" on storage.objects;
drop policy if exists "product-images: authenticated update" on storage.objects;

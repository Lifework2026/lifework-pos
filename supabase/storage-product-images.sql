-- Supabase Storage for product photos.
--
-- Run it once in the Supabase SQL editor (Project > SQL Editor > New query). It is safe to run again: the bucket
-- is created or updated, and each policy is dropped and created again. Nothing is deleted.
--
-- HOW THE APP USES THIS BUCKET
--   The server uploads photos with the service-role key, which bypasses row level security. The browser only reads
--   public URLs. So the app works with or without the two "authenticated" write policies in section 3.
--
-- SECURITY NOTE ABOUT SECTION 3
--   "authenticated" means ANY Supabase Auth user, and this app does not use Supabase Auth for its own logins.
--   If Authentication > Providers > Email > "Allow new users to sign up" is on, anyone who has the public anon key
--   can create an account and then upload or overwrite files in this bucket. Either turn sign-ups off, or remove the
--   two write policies with the statements at the end of this file. The app does not need them.

-- 1. The bucket: public read, 2 MB per file, images only.
--    These limits match MAX_IMAGE_BYTES and ALLOWED_IMAGE_TYPES in lib/image-type.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
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

-- 3. Authenticated users can add and replace photos in this bucket only. See the security note above.
drop policy if exists "product-images: authenticated insert" on storage.objects;
create policy "product-images: authenticated insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "product-images: authenticated update" on storage.objects;
create policy "product-images: authenticated update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

-- To remove the write policies later (the app keeps working, because the server uses the service-role key):
--   drop policy if exists "product-images: authenticated insert" on storage.objects;
--   drop policy if exists "product-images: authenticated update" on storage.objects;

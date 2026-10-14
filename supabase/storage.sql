-- Supabase Storage setup for product photos.
--
-- Optional: the app creates this bucket itself on the first upload (ensureBucket in lib/storage.ts).
-- Run this in the Supabase SQL editor if you prefer to create it up front.
--
-- Access model:
--   * Anyone can READ photos (the till shows them without signing URLs).
--   * Nobody can write with the public or logged-in keys. Uploads go through the server with the
--     service-role key, which bypasses row-level security, after the admin check and the
--     image-signature check in /api/admin/uploads/product-image.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- No insert, update or delete policies are created on purpose: with RLS enabled on storage.objects,
-- that denies writes from the anon and authenticated roles.

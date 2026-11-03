-- Profile identity: display name, faculty, degree and a small avatar.
-- The avatar is resized client-side to a 256×256 JPEG data URL (~20–40 KB), so it
-- needs no storage bucket; the CHECKs bound what a client can write.
-- Apply manually (Supabase SQL editor) — NOT applied by the app. Until applied, the
-- client keeps these fields on the device only (updateProfile failures are tolerated).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS faculty text CHECK (faculty IS NULL OR char_length(faculty) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS degree text CHECK (degree IS NULL OR char_length(degree) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS avatar_data_url text CHECK (
    avatar_data_url IS NULL
    OR (avatar_data_url LIKE 'data:image/jpeg;base64,%' AND char_length(avatar_data_url) <= 200000)
  );

GRANT UPDATE (display_name, faculty, degree, avatar_data_url) ON public.profiles TO authenticated;

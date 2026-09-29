-- 001_profiles.sql — Supabase Auth student profiles + Data API lockdown.
--
-- Apply once in the Supabase SQL editor (or psql against DIRECT_DATABASE_URL).
-- Idempotent: safe to re-run.
--
-- Layers:
--   auth.users            identity (owned by Supabase Auth)
--   public.profiles       the student profile (program, current degree year, role)
--   planner_* tables      planner state/preferences, keyed server-side by owner_hash
--                         (a verified account maps to owner 'auth:<user id>')
--
-- The browser talks to public.profiles directly through the Data API with the
-- publishable key, so RLS + column grants below are the authorization boundary.
-- The API functions connect with DATABASE_URL as the table owner and are not
-- subject to RLS; they authorize by verifying the Supabase JWT themselves.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email               text,
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'developer')),
  program_id          text,
  current_degree_year smallint CHECK (current_degree_year BETWEEN 1 AND 4),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── one profile row per auth user, created by the server, never by a client ─
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill users who signed up before this migration.
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── authorization ───────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Clients may read their own row and edit ONLY the student fields.
-- No INSERT/DELETE, and never `role` or `email` (column-level grants).
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (program_id, current_degree_year) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ── Data API lockdown for every other public table ────────────────────────
-- Shipping the publishable key to the browser makes PostgREST reachable. Every
-- pre-existing public table (planner_*, anonymous_sessions, ai_usage_events,
-- catalog tables, legacy users/user_profiles, ...) had RLS off, i.e. readable
-- and writable by anyone holding that key. RLS with NO policies denies anon and
-- authenticated entirely; the server (table owner) is unaffected.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'profiles'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END;
$$;

COMMIT;

-- Make someone a developer (SQL editor only; clients cannot change `role`):
--   UPDATE public.profiles SET role = 'developer' WHERE id = '<auth user uuid>';

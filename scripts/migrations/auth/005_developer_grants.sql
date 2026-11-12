-- 005_developer_grants.sql — developer accounts granted by VERIFIED email.
--
-- Apply once in the Supabase SQL editor (or psql against DIRECT_DATABASE_URL), after
-- auth/001_profiles.sql and billing/001_credits.sql (it sets profiles.billing_exempt).
-- Idempotent: safe to re-run.
--
-- What a developer account is (everything the site owner's account has):
--   profiles.role = 'developer'      billing console + its API (api/billing/admin.ts), the developer
--                                    badge and admin links, community-note moderation, internal
--                                    credit lots (billing/005), and the paywall bypass in the UI
--   profiles.billing_exempt = true   AI usage is recorded but never charged (apply_credit_transaction)
-- Both live only in public.profiles; there is no env allowlist and no other flag.
--
-- A grant is a row in public.developer_grants. It is applied to the account that owns that address:
--   * immediately, if the account already exists and its email is verified (the UPDATE at the bottom);
--   * otherwise the moment the address is verified — on first sign-in with Google, or when the
--     confirmation link of an email sign-up is opened (the trigger).
-- An unverified sign-up with a granted address gets nothing: only the inbox owner can verify it.
--
-- Add a developer:     INSERT INTO public.developer_grants (email) VALUES ('name@example.com');
--                      then re-run this file (or just the UPDATE at the bottom) if they already signed up.
-- Remove a developer:  DELETE FROM public.developer_grants WHERE email = '...';
--                      UPDATE public.profiles SET role = 'user', billing_exempt = false WHERE email = '...';

BEGIN;

CREATE TABLE IF NOT EXISTS public.developer_grants (
  email      text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  note       text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Server-only: RLS with no policies and no grants, like every non-profile table (see 001).
ALTER TABLE public.developer_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.developer_grants FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_developer_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.developer_grants g WHERE g.email = lower(btrim(NEW.email))) THEN
    -- Upsert: correct whichever of this trigger and on_auth_user_created runs first.
    INSERT INTO public.profiles (id, email, role, billing_exempt)
    VALUES (NEW.id, NEW.email, 'developer', true)
    ON CONFLICT (id) DO UPDATE SET role = 'developer', billing_exempt = true
      WHERE public.profiles.role <> 'developer' OR NOT public.profiles.billing_exempt;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A grant must never be the reason someone cannot sign up or sign in.
  RAISE WARNING 'apply_developer_grant failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_developer_grant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_developer_grant ON auth.users;
CREATE TRIGGER on_auth_user_developer_grant
  AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_developer_grant();

-- ── grants ───────────────────────────────────────────────────────────────────
INSERT INTO public.developer_grants (email, note)
VALUES ('gefen.orenstein@gmail.com', 'Developer account, configured like the site owner''s')
ON CONFLICT (email) DO NOTHING;

-- Accounts that already exist with a verified granted address. Touches no other account.
UPDATE public.profiles p
   SET role = 'developer', billing_exempt = true
  FROM auth.users u
  JOIN public.developer_grants g ON g.email = lower(btrim(u.email))
 WHERE u.id = p.id
   AND u.email_confirmed_at IS NOT NULL
   AND (p.role <> 'developer' OR NOT p.billing_exempt);

COMMIT;

-- 002_delete_account.sql — self-serve account deletion ("מחיקת חשבון").
--
-- Apply once in the Supabase SQL editor, after 001_profiles.sql. Idempotent.
--
-- A signed-in user calls `rpc('delete_my_account')`. It deletes ONLY the caller
-- (auth.uid() — never an argument), their planner state, and their auth user;
-- public.profiles goes with it via ON DELETE CASCADE.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid();
  owner text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- Same key the API stores planner rows under: ownerStorageKey('auth:' || uid).
  owner := 'owner_' || encode(sha256(convert_to('auth:' || uid::text, 'UTF8')), 'hex');

  DELETE FROM public.planner_proposals WHERE owner_hash = owner;   -- candidates cascade
  DELETE FROM public.planner_apply_receipts WHERE owner_hash = owner;
  DELETE FROM public.planner_academic_contexts WHERE owner_hash = owner;
  DELETE FROM public.planner_boards WHERE owner_hash = owner;
  DELETE FROM auth.users WHERE id = uid;                            -- profiles cascade
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMIT;

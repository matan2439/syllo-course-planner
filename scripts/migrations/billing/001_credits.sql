-- billing/001_credits.sql — Syllo Credits ledger (no payment provider yet).
--
-- Apply once in the Supabase SQL editor, after auth/001_profiles.sql. Idempotent.
--
-- Layers:
--   public.credit_transactions   the AUTHORITATIVE, append-only ledger: every balance
--                                change is one row with a kind, a reference and metadata
--   public.credit_accounts       a cached balance per user (fast reads, row lock target);
--                                always equal to SUM(delta) — see credit_balance_drift
--   public.apply_credit_transaction(...)   the ONLY write path. Server-side only:
--                                no client role may execute it.
--
-- Syllo Credits are a product unit, not provider tokens.

BEGIN;

-- ── entitlement: billing exemption (developers/admins) ─────────────────────
-- Server-controlled: the client column grant on profiles is only
-- UPDATE (program_id, current_degree_year), so this is never client-writable.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET billing_exempt = true WHERE role = 'developer' AND NOT billing_exempt;

-- ── ledger ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  delta         integer NOT NULL CHECK (delta <> 0),
  kind          text NOT NULL CHECK (kind IN (
                  'purchase', 'promo_grant', 'subscription_grant',
                  'admin_adjustment', 'refund', 'ai_usage')),
  reference     text,                       -- external/event id; NULL = not deduplicated
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_transactions_sign CHECK (
    (kind = 'ai_usage' AND delta < 0)
    OR (kind IN ('purchase', 'promo_grant', 'subscription_grant') AND delta > 0)
    OR kind IN ('admin_adjustment', 'refund')),
  -- Idempotency: one event id can move credits at most once per kind.
  CONSTRAINT credit_transactions_reference_once UNIQUE (kind, reference)
);
CREATE INDEX IF NOT EXISTS credit_transactions_user_created
  ON public.credit_transactions (user_id, created_at);

-- Append-only: history is never rewritten. (DELETE stays possible only so
-- account deletion can cascade.) Corrections are new rows.
CREATE OR REPLACE FUNCTION public.credit_transactions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'credit_transactions is append-only' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS credit_transactions_no_update ON public.credit_transactions;
CREATE TRIGGER credit_transactions_no_update
  BEFORE UPDATE ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.credit_transactions_immutable();

-- ── cached balance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  balance    bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reconciliation: rows here mean the cache disagrees with the ledger.
-- Repair (ledger wins):
--   UPDATE public.credit_accounts a SET balance = d.ledger_balance, updated_at = now()
--     FROM public.credit_balance_drift d WHERE d.user_id = a.user_id;
CREATE OR REPLACE VIEW public.credit_balance_drift AS
SELECT a.user_id, a.balance AS cached_balance, COALESCE(SUM(t.delta), 0) AS ledger_balance
  FROM public.credit_accounts a
  LEFT JOIN public.credit_transactions t ON t.user_id = a.user_id
 GROUP BY a.user_id, a.balance
HAVING a.balance <> COALESCE(SUM(t.delta), 0);

-- ── the only write path ─────────────────────────────────────────────────────
-- status: 'applied' | 'replayed' (same reference seen before, nothing written)
--       | 'exempt'  (ai_usage for a billing_exempt user, nothing written)
--       | 'insufficient' (would go negative, nothing written)
CREATE OR REPLACE FUNCTION public.apply_credit_transaction(
  p_user uuid, p_delta integer, p_kind text, p_reference text, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (status text, balance bigint, transaction_id bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_balance bigint;
  prior public.credit_transactions%ROWTYPE;
  new_id bigint;
BEGIN
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  -- Per-user row lock: every mutation for this user is serialized from here on,
  -- so concurrent deductions cannot both see the same balance.
  SELECT a.balance INTO current_balance
    FROM public.credit_accounts a WHERE a.user_id = p_user FOR UPDATE;

  -- Idempotency, checked under the lock so concurrent retries apply once.
  IF p_reference IS NOT NULL THEN
    SELECT * INTO prior FROM public.credit_transactions t
     WHERE t.kind = p_kind AND t.reference = p_reference;
    IF FOUND THEN
      IF prior.user_id <> p_user OR prior.delta <> p_delta THEN
        RAISE EXCEPTION 'credit reference % reused with different parameters', p_reference
          USING ERRCODE = '23505';
      END IF;
      RETURN QUERY SELECT 'replayed'::text, current_balance, prior.id;
      RETURN;
    END IF;
  END IF;

  IF p_kind = 'ai_usage' AND EXISTS (
       SELECT 1 FROM public.profiles pr WHERE pr.id = p_user AND pr.billing_exempt) THEN
    RETURN QUERY SELECT 'exempt'::text, current_balance, NULL::bigint;
    RETURN;
  END IF;

  IF current_balance + p_delta < 0 THEN
    RETURN QUERY SELECT 'insufficient'::text, current_balance, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO public.credit_transactions (user_id, delta, kind, reference, metadata, balance_after)
  VALUES (p_user, p_delta, p_kind, p_reference, COALESCE(p_metadata, '{}'::jsonb), current_balance + p_delta)
  RETURNING id INTO new_id;
  UPDATE public.credit_accounts a
     SET balance = current_balance + p_delta, updated_at = now()
   WHERE a.user_id = p_user;
  RETURN QUERY SELECT 'applied'::text, current_balance + p_delta, new_id;
END;
$$;

-- ── authorization ───────────────────────────────────────────────────────────
-- Clients may READ their own cached balance. Nothing else: no ledger access,
-- no writes, and no way to call the mutation function (Supabase would otherwise
-- expose it as an RPC). The API connects as table owner and is unaffected.
REVOKE EXECUTE ON FUNCTION public.apply_credit_transaction(uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_transactions_immutable() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_transactions FROM anon, authenticated;
REVOKE ALL ON public.credit_accounts FROM anon, authenticated;
REVOKE ALL ON public.credit_balance_drift FROM anon, authenticated;
GRANT SELECT ON public.credit_accounts TO authenticated;

DROP POLICY IF EXISTS credit_accounts_select_own ON public.credit_accounts;
CREATE POLICY credit_accounts_select_own ON public.credit_accounts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;

-- Dev/admin grant (SQL editor only — there is no HTTP endpoint that mints credits):
--   SELECT * FROM public.apply_credit_transaction(
--     '<auth user uuid>', 500, 'admin_adjustment', NULL, '{"note": "dev testing", "by": "<you>"}');
-- Exempt someone from billing:
--   UPDATE public.profiles SET billing_exempt = true WHERE id = '<auth user uuid>';

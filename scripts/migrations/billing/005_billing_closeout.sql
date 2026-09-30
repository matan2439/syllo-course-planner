-- billing/005_billing_closeout.sql — customer credit policy, cost evidence, case fields.
--
-- Apply once in the Supabase SQL editor, after billing/004_billing_ops.sql. Idempotent.
--
-- 1. Internal (developer/testing) credits are NEVER spendable by a normal customer.
--    Only a billing_exempt or role='developer' account may draw from its internal
--    lots. Customers spend promotional/subscription (structural only — never
--    auto-granted) and then purchased credits, FIFO. Revocations (refunds, admin
--    corrections) may still touch any lot.
-- 2. No free AI quota for customers: reserve_ai_credits(p_credits = 0) is staff-only.
-- 3. ai_operations records the metering unit version and why an op was released,
--    so provider cost can be computed later from stored tokens (never estimated here).
-- 4. billing_alerts doubles as the case record (status, reason, email, notes, draft).

BEGIN;

-- ── who counts as staff (dev/testing access) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.billing_staff(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.id = p_user AND (pr.billing_exempt OR pr.role = 'developer'))
$$;

-- Credits this user may spend on AI right now (unused, active, eligible lots).
CREATE OR REPLACE FUNCTION public.credit_spendable(p_user uuid)
RETURNS bigint LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(SUM(l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked), 0)
    FROM public.credit_lots l
   WHERE l.user_id = p_user AND l.state = 'active'
     AND (l.source_class <> 'internal' OR public.billing_staff(p_user))
$$;

-- ── lot allocation: internal lots only for staff (except revocations) ───────
CREATE OR REPLACE FUNCTION public.take_from_credit_lots(p_user uuid, p_amount integer, p_mode text)
RETURNS TABLE (lot_id bigint, amount integer)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  remaining integer := p_amount;
  lot record;
  take integer;
  staff boolean := p_mode = 'revoke' OR public.billing_staff(p_user);
BEGIN
  FOR lot IN
    SELECT l.id, l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked AS unused
      FROM public.credit_lots l
     WHERE l.user_id = p_user AND l.state = 'active'
       AND l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked > 0
       AND (l.source_class <> 'internal' OR staff)
     ORDER BY public.credit_lot_rank(l.source_class), l.created_at, l.id
       FOR UPDATE
  LOOP
    EXIT WHEN remaining = 0;
    take := LEAST(remaining, lot.unused);
    UPDATE public.credit_lots l SET
      credits_consumed = l.credits_consumed + CASE WHEN p_mode = 'consume' THEN take ELSE 0 END,
      credits_reserved = l.credits_reserved + CASE WHEN p_mode = 'reserve' THEN take ELSE 0 END,
      credits_revoked  = l.credits_revoked  + CASE WHEN p_mode = 'revoke'  THEN take ELSE 0 END,
      updated_at = now()
     WHERE l.id = lot.id;
    remaining := remaining - take;
    lot_id := lot.id; amount := take;
    RETURN NEXT;
  END LOOP;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'ledger invariant: lots of % short by % credits', p_user, remaining USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ── ledger write path: ai_usage checks SPENDABLE credits, not the raw balance ─
CREATE OR REPLACE FUNCTION public.apply_credit_transaction(
  p_user uuid, p_delta integer, p_kind text, p_reference text, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (status text, balance bigint, transaction_id bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_balance bigint;
  current_reserved bigint;
  prior public.credit_transactions%ROWTYPE;
  new_id bigint;
  new_lot bigint;
BEGIN
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT a.balance, a.reserved INTO current_balance, current_reserved
    FROM public.credit_accounts a WHERE a.user_id = p_user FOR UPDATE;

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

  IF p_delta < 0 AND (
       current_balance - current_reserved + p_delta < 0
       OR (p_kind = 'ai_usage' AND public.credit_spendable(p_user) + p_delta < 0)) THEN
    RETURN QUERY SELECT 'insufficient'::text, current_balance, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO public.credit_transactions (user_id, delta, kind, reference, metadata, balance_after)
  VALUES (p_user, p_delta, p_kind, p_reference, COALESCE(p_metadata, '{}'::jsonb), current_balance + p_delta)
  RETURNING id INTO new_id;

  IF p_delta > 0 THEN
    INSERT INTO public.credit_lots (user_id, source_class, grant_transaction_id, credits_granted)
    VALUES (p_user,
            CASE p_kind WHEN 'purchase' THEN 'purchased' WHEN 'promo_grant' THEN 'promotional'
                        WHEN 'subscription_grant' THEN 'subscription' ELSE 'internal' END,
            new_id, p_delta)
    RETURNING id INTO new_lot;
    INSERT INTO public.credit_allocations (transaction_id, lot_id, amount) VALUES (new_id, new_lot, p_delta);
  ELSE
    INSERT INTO public.credit_allocations (transaction_id, lot_id, amount)
    SELECT new_id, t.lot_id, -t.amount
      FROM public.take_from_credit_lots(p_user, -p_delta,
             CASE WHEN p_kind = 'ai_usage' THEN 'consume' ELSE 'revoke' END) t;
  END IF;

  UPDATE public.credit_accounts a
     SET balance = current_balance + p_delta, updated_at = now()
   WHERE a.user_id = p_user;
  RETURN QUERY SELECT 'applied'::text, current_balance + p_delta, new_id;
END;
$$;

-- ── reserve: spendable credits only; zero-credit (free) ops are staff-only ──
CREATE OR REPLACE FUNCTION public.reserve_ai_credits(
  p_user uuid, p_operation text, p_credits integer, p_endpoint text, p_provider text, p_model text
)
RETURNS TABLE (status text, balance bigint, available bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  acct public.credit_accounts%ROWTYPE;
  prior public.ai_operations%ROWTYPE;
  v_funding text;
  v_spendable bigint;
BEGIN
  IF p_credits IS NULL OR p_credits < 0 THEN RAISE EXCEPTION 'credits must be >= 0'; END IF;
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO acct FROM public.credit_accounts a WHERE a.user_id = p_user FOR UPDATE;
  v_spendable := public.credit_spendable(p_user);

  SELECT * INTO prior FROM public.ai_operations o WHERE o.operation_id = p_operation;
  IF FOUND THEN
    IF prior.user_id <> p_user THEN
      RAISE EXCEPTION 'operation % belongs to another user', p_operation USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT 'replayed'::text, acct.balance, v_spendable;
    RETURN;
  END IF;

  v_funding := CASE
    WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user AND pr.billing_exempt) THEN 'exempt'
    WHEN p_credits = 0 THEN 'free_quota'
    ELSE 'credits' END;
  IF v_funding = 'free_quota' AND NOT public.billing_staff(p_user) THEN
    RAISE EXCEPTION 'free AI operations are not available to customers' USING ERRCODE = '42501';
  END IF;

  IF v_funding = 'credits' AND v_spendable < p_credits THEN
    RETURN QUERY SELECT 'insufficient'::text, acct.balance, v_spendable;
    RETURN;
  END IF;

  INSERT INTO public.ai_operations (operation_id, user_id, endpoint, provider, model, funding, credits)
  VALUES (p_operation, p_user, p_endpoint, p_provider, p_model, v_funding,
          CASE WHEN v_funding = 'credits' THEN p_credits ELSE 0 END);

  IF v_funding = 'credits' THEN
    INSERT INTO public.ai_operation_lots (operation_id, lot_id, amount)
    SELECT p_operation, t.lot_id, t.amount FROM public.take_from_credit_lots(p_user, p_credits, 'reserve') t;
    UPDATE public.credit_accounts a SET reserved = a.reserved + p_credits, updated_at = now()
     WHERE a.user_id = p_user;
    v_spendable := v_spendable - p_credits;
  END IF;

  RETURN QUERY SELECT (CASE WHEN v_funding = 'exempt' THEN 'exempt' ELSE 'applied' END)::text,
                      acct.balance, v_spendable;
END;
$$;

-- ── cost evidence ───────────────────────────────────────────────────────────
-- pricing_version = the metering unit in force (api/ai/metering.ts METERING_VERSION).
-- ponytail: a column default; bump it here together with the TS constant.
ALTER TABLE public.ai_operations ADD COLUMN IF NOT EXISTS pricing_version text DEFAULT 'v1-1credit-per-reply';
ALTER TABLE public.ai_operations ADD COLUMN IF NOT EXISTS release_reason text;

-- ── case fields on the review queue (billing_alerts is the one case object) ─
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS case_status text NOT NULL DEFAULT 'open';
DO $$ BEGIN
  ALTER TABLE public.billing_alerts ADD CONSTRAINT billing_alerts_case_status_check
    CHECK (case_status IN ('open', 'in_progress', 'awaiting_customer', 'resolved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.billing_alerts SET case_status = 'resolved' WHERE status = 'resolved' AND case_status <> 'resolved';
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS draft_reply text;
ALTER TABLE public.billing_alerts ADD COLUMN IF NOT EXISTS draft_template_version text;

REVOKE EXECUTE ON FUNCTION public.billing_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_spendable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.take_from_credit_lots(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_credit_transaction(uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_credits(uuid, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;

COMMIT;

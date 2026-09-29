-- billing/002_credit_lots.sql — credit provenance (lots), allocation, AI metering.
--
-- Apply once in the Supabase SQL editor, after billing/001_credits.sql. Idempotent.
--
-- Every credit now lives in exactly one LOT (a purchase, a promotion, an internal
-- grant). Every ledger row is split across lots in credit_allocations, so for any
-- purchase we can always answer: granted / consumed / reserved / revoked / unused.
--
--   unused    = granted - consumed - reserved - revoked
--   balance   = SUM(ledger delta) = SUM(granted - consumed - revoked) over lots
--   available = balance - reserved
--
-- "Consumed" means DIGITAL SERVICE ALREADY DELIVERED: a credit moves from reserved
-- to consumed only in finalize_ai_credits, which the API calls once the AI result
-- has been persisted for the user (see api/ai/metering.ts). Nothing is ever deleted:
-- a refund revokes the UNUSED part of a lot with a new ledger row; consumed history
-- stays.
--
-- Allocation order (deterministic): internal → promotional → subscription →
-- purchased, FIFO by created_at within a class. Non-paid credits are spent first, so
-- the largest possible share of paid credits stays unused.
-- ponytail: one CASE in credit_lot_rank; change it to change the policy.

BEGIN;

-- ── ledger kinds: add 'chargeback' (revocation after a dispute) ─────────────
ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_kind_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_kind_check CHECK (kind IN (
  'purchase', 'promo_grant', 'subscription_grant',
  'admin_adjustment', 'refund', 'chargeback', 'ai_usage'));
ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_sign;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_sign CHECK (
  (kind IN ('ai_usage', 'chargeback') AND delta < 0)
  OR (kind IN ('purchase', 'promo_grant', 'subscription_grant') AND delta > 0)
  OR kind IN ('admin_adjustment', 'refund'));

ALTER TABLE public.credit_accounts ADD COLUMN IF NOT EXISTS reserved bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.credit_accounts ADD CONSTRAINT credit_accounts_reserved_ok
    CHECK (reserved >= 0 AND reserved <= balance);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── lots ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_lots (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source_class         text NOT NULL CHECK (source_class IN ('purchased', 'promotional', 'subscription', 'internal')),
  grant_transaction_id bigint UNIQUE REFERENCES public.credit_transactions (id),  -- NULL only for the opening-balance backfill
  payment_id           bigint,          -- set for purchased lots (billing/003)
  credits_granted      integer NOT NULL CHECK (credits_granted > 0),
  credits_consumed     integer NOT NULL DEFAULT 0 CHECK (credits_consumed >= 0),
  credits_reserved     integer NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  credits_revoked      integer NOT NULL DEFAULT 0 CHECK (credits_revoked >= 0),
  -- Revocation requested while credits were reserved by an in-flight AI call:
  -- if that call is released, these credits are revoked instead of returned.
  revoke_pending       integer NOT NULL DEFAULT 0 CHECK (revoke_pending >= 0),
  revoke_kind          text CHECK (revoke_kind IN ('refund', 'chargeback', 'admin_adjustment')),
  state                text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_lots_conserved CHECK (
    credits_consumed + credits_reserved + credits_revoked <= credits_granted
    AND revoke_pending <= credits_reserved)
);
CREATE INDEX IF NOT EXISTS credit_lots_user ON public.credit_lots (user_id, created_at);

CREATE OR REPLACE FUNCTION public.credit_lot_rank(p_class text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_class WHEN 'internal' THEN 0 WHEN 'promotional' THEN 1 WHEN 'subscription' THEN 2 ELSE 3 END
$$;

-- Which lots every ledger row touched. Append-only; SUM(amount) per transaction = delta.
CREATE TABLE IF NOT EXISTS public.credit_allocations (
  transaction_id bigint NOT NULL REFERENCES public.credit_transactions (id) ON DELETE CASCADE,
  lot_id         bigint NOT NULL REFERENCES public.credit_lots (id) ON DELETE CASCADE,
  amount         integer NOT NULL CHECK (amount <> 0),
  PRIMARY KEY (transaction_id, lot_id)
);
CREATE INDEX IF NOT EXISTS credit_allocations_lot ON public.credit_allocations (lot_id);

DROP TRIGGER IF EXISTS credit_allocations_no_update ON public.credit_allocations;
CREATE TRIGGER credit_allocations_no_update
  BEFORE UPDATE ON public.credit_allocations
  FOR EACH ROW EXECUTE FUNCTION public.credit_transactions_immutable();

-- Idempotency + audit for lot revocations (refunds, chargebacks).
CREATE TABLE IF NOT EXISTS public.credit_lot_revocations (
  reference      text PRIMARY KEY,
  lot_id         bigint NOT NULL REFERENCES public.credit_lots (id) ON DELETE CASCADE,
  kind           text NOT NULL,
  requested      integer,              -- NULL = everything still revocable
  revoked_now    integer NOT NULL,
  pending_added  integer NOT NULL,
  unrevocable    integer NOT NULL,     -- already consumed: service delivered, never clawed back
  transaction_id bigint REFERENCES public.credit_transactions (id),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── AI operations (service-delivery evidence; no prompt/output content) ─────
CREATE TABLE IF NOT EXISTS public.ai_operations (
  operation_id         text PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint             text NOT NULL,
  provider             text,
  model                text,
  funding              text NOT NULL CHECK (funding IN ('free_quota', 'credits', 'exempt')),
  credits              integer NOT NULL CHECK (credits >= 0),
  state                text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'delivered', 'released')),
  input_tokens         integer,
  output_tokens        integer,
  cached_tokens        integer,
  provider_cost_usd    numeric(12, 6),   -- NULL = unknown; never estimated here
  usage_transaction_id bigint REFERENCES public.credit_transactions (id),
  reserved_at          timestamptz NOT NULL DEFAULT now(),
  finalized_at         timestamptz
);
CREATE INDEX IF NOT EXISTS ai_operations_user ON public.ai_operations (user_id, reserved_at);
CREATE INDEX IF NOT EXISTS ai_operations_open ON public.ai_operations (reserved_at) WHERE state = 'reserved';

CREATE TABLE IF NOT EXISTS public.ai_operation_lots (
  operation_id text NOT NULL REFERENCES public.ai_operations (operation_id) ON DELETE CASCADE,
  lot_id       bigint NOT NULL REFERENCES public.credit_lots (id) ON DELETE CASCADE,
  amount       integer NOT NULL CHECK (amount > 0),
  PRIMARY KEY (operation_id, lot_id)
);

-- ── internal: take credits from a user's lots in allocation order ──────────
-- Caller MUST hold the credit_accounts row lock. p_mode: consume | reserve | revoke.
CREATE OR REPLACE FUNCTION public.take_from_credit_lots(p_user uuid, p_amount integer, p_mode text)
RETURNS TABLE (lot_id bigint, amount integer)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  remaining integer := p_amount;
  lot record;
  take integer;
BEGIN
  FOR lot IN
    SELECT l.id, l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked AS unused
      FROM public.credit_lots l
     WHERE l.user_id = p_user AND l.state = 'active'
       AND l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked > 0
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
    -- The balance said the credits exist but the lots disagree: never guess.
    RAISE EXCEPTION 'ledger invariant: lots of % short by % credits', p_user, remaining USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ── the ledger write path, now lot-aware (same signature and statuses) ─────
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
  -- Per-user row lock: every mutation for this user is serialized from here on.
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

  -- Reserved credits belong to in-flight AI calls and cannot be spent twice.
  IF p_delta < 0 AND current_balance - current_reserved + p_delta < 0 THEN
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

-- ── AI metering: reserve → finalize (delivered) | release ──────────────────
-- p_credits = 0 records a free-quota operation (evidence only, nothing held).
-- status: applied | replayed | exempt | insufficient
CREATE OR REPLACE FUNCTION public.reserve_ai_credits(
  p_user uuid, p_operation text, p_credits integer, p_endpoint text, p_provider text, p_model text
)
RETURNS TABLE (status text, balance bigint, available bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  acct public.credit_accounts%ROWTYPE;
  prior public.ai_operations%ROWTYPE;
  v_funding text;
BEGIN
  IF p_credits IS NULL OR p_credits < 0 THEN RAISE EXCEPTION 'credits must be >= 0'; END IF;
  INSERT INTO public.credit_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO acct FROM public.credit_accounts a WHERE a.user_id = p_user FOR UPDATE;

  SELECT * INTO prior FROM public.ai_operations o WHERE o.operation_id = p_operation;
  IF FOUND THEN
    IF prior.user_id <> p_user THEN
      RAISE EXCEPTION 'operation % belongs to another user', p_operation USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT 'replayed'::text, acct.balance, acct.balance - acct.reserved;
    RETURN;
  END IF;

  v_funding := CASE
    WHEN p_credits = 0 THEN 'free_quota'
    WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user AND pr.billing_exempt) THEN 'exempt'
    ELSE 'credits' END;

  IF v_funding = 'credits' AND acct.balance - acct.reserved < p_credits THEN
    RETURN QUERY SELECT 'insufficient'::text, acct.balance, acct.balance - acct.reserved;
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
    acct.reserved := acct.reserved + p_credits;
  END IF;

  RETURN QUERY SELECT (CASE WHEN v_funding = 'exempt' THEN 'exempt' ELSE 'applied' END)::text,
                      acct.balance, acct.balance - acct.reserved;
END;
$$;

-- Service delivered: reserved → consumed, one ai_usage ledger row.
-- status: applied | replayed (already delivered) | released (too late: nothing charged)
CREATE OR REPLACE FUNCTION public.finalize_ai_credits(p_operation text, p_usage jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (status text, balance bigint, transaction_id bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  op public.ai_operations%ROWTYPE;
  acct public.credit_accounts%ROWTYPE;
  new_id bigint;
  u jsonb := COALESCE(p_usage, '{}'::jsonb);
BEGIN
  SELECT * INTO op FROM public.ai_operations o WHERE o.operation_id = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown operation %', p_operation USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO acct FROM public.credit_accounts a WHERE a.user_id = op.user_id FOR UPDATE;
  SELECT * INTO op FROM public.ai_operations o WHERE o.operation_id = p_operation FOR UPDATE;
  IF op.state <> 'reserved' THEN
    RETURN QUERY SELECT (CASE WHEN op.state = 'delivered' THEN 'replayed' ELSE 'released' END)::text,
                        acct.balance, op.usage_transaction_id;
    RETURN;
  END IF;

  IF op.credits > 0 THEN
    INSERT INTO public.credit_transactions (user_id, delta, kind, reference, metadata, balance_after)
    VALUES (op.user_id, -op.credits, 'ai_usage', op.operation_id,
            jsonb_build_object('endpoint', op.endpoint, 'model', op.model), acct.balance - op.credits)
    RETURNING id INTO new_id;
    INSERT INTO public.credit_allocations (transaction_id, lot_id, amount)
    SELECT new_id, ol.lot_id, -ol.amount FROM public.ai_operation_lots ol WHERE ol.operation_id = op.operation_id;
    -- A revocation waiting on these credits can no longer happen: they were used.
    UPDATE public.credit_lots l SET
      credits_reserved = l.credits_reserved - ol.amount,
      credits_consumed = l.credits_consumed + ol.amount,
      revoke_pending = GREATEST(0, l.revoke_pending - ol.amount),
      updated_at = now()
      FROM public.ai_operation_lots ol
     WHERE ol.operation_id = op.operation_id AND l.id = ol.lot_id;
    UPDATE public.credit_accounts a SET
      balance = a.balance - op.credits, reserved = a.reserved - op.credits, updated_at = now()
     WHERE a.user_id = op.user_id;
  END IF;

  UPDATE public.ai_operations o SET
    state = 'delivered', finalized_at = now(), usage_transaction_id = new_id,
    provider          = COALESCE(u->>'provider', o.provider),
    model             = COALESCE(u->>'model', o.model),
    input_tokens      = (u->>'input_tokens')::integer,
    output_tokens     = (u->>'output_tokens')::integer,
    cached_tokens     = (u->>'cached_tokens')::integer,
    provider_cost_usd = (u->>'provider_cost_usd')::numeric
   WHERE o.operation_id = op.operation_id;
  RETURN QUERY SELECT 'applied'::text, acct.balance - op.credits, new_id;
END;
$$;

-- Not delivered: return the credits — or revoke them if their lot was refunded meanwhile.
-- status: applied | replayed (already finalized or released)
CREATE OR REPLACE FUNCTION public.release_ai_credits(p_operation text)
RETURNS TABLE (status text, balance bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  op public.ai_operations%ROWTYPE;
  acct public.credit_accounts%ROWTYPE;
  r record;
  to_revoke integer;
  new_id bigint;
BEGIN
  SELECT * INTO op FROM public.ai_operations o WHERE o.operation_id = p_operation;
  IF NOT FOUND THEN RETURN QUERY SELECT 'replayed'::text, NULL::bigint; RETURN; END IF;
  SELECT * INTO acct FROM public.credit_accounts a WHERE a.user_id = op.user_id FOR UPDATE;
  SELECT * INTO op FROM public.ai_operations o WHERE o.operation_id = p_operation FOR UPDATE;
  IF op.state <> 'reserved' THEN RETURN QUERY SELECT 'replayed'::text, acct.balance; RETURN; END IF;

  UPDATE public.ai_operations o SET state = 'released', finalized_at = now() WHERE o.operation_id = p_operation;
  FOR r IN
    SELECT ol.lot_id, ol.amount, l.revoke_pending, l.revoke_kind
      FROM public.ai_operation_lots ol JOIN public.credit_lots l ON l.id = ol.lot_id
     WHERE ol.operation_id = p_operation FOR UPDATE OF l
  LOOP
    to_revoke := LEAST(r.amount, r.revoke_pending);
    UPDATE public.credit_lots l SET
      credits_reserved = l.credits_reserved - r.amount,
      credits_revoked = l.credits_revoked + to_revoke,
      revoke_pending = l.revoke_pending - to_revoke,
      updated_at = now()
     WHERE l.id = r.lot_id;
    IF to_revoke > 0 THEN
      acct.balance := acct.balance - to_revoke;
      INSERT INTO public.credit_transactions (user_id, delta, kind, reference, metadata, balance_after)
      VALUES (op.user_id, -to_revoke, r.revoke_kind, 'release:' || p_operation || ':' || r.lot_id,
              jsonb_build_object('lot_id', r.lot_id, 'reason', 'revoked after in-flight release'), acct.balance)
      RETURNING id INTO new_id;
      INSERT INTO public.credit_allocations (transaction_id, lot_id, amount) VALUES (new_id, r.lot_id, -to_revoke);
    END IF;
  END LOOP;
  UPDATE public.credit_accounts a SET
    balance = acct.balance, reserved = a.reserved - op.credits, updated_at = now()
   WHERE a.user_id = op.user_id;
  RETURN QUERY SELECT 'applied'::text, acct.balance;
END;
$$;

-- ── revoke credits of ONE lot (refund / chargeback / admin) ────────────────
-- p_credits NULL = everything still revocable. Revokes unused now; credits reserved
-- by in-flight calls become revoke_pending; consumed credits are NEVER revoked
-- (reported as unrevocable). p_close marks the lot revoked (no future use).
CREATE OR REPLACE FUNCTION public.revoke_lot_credits(
  p_lot bigint, p_credits integer, p_kind text, p_reference text, p_close boolean, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (status text, revoked_now integer, pending_added integer, unrevocable integer, transaction_id bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  lot public.credit_lots%ROWTYPE;
  acct public.credit_accounts%ROWTYPE;
  prior public.credit_lot_revocations%ROWTYPE;
  v_unused integer;
  v_now integer;
  v_pending integer;
  v_left integer;
  new_id bigint;
BEGIN
  IF p_kind NOT IN ('refund', 'chargeback', 'admin_adjustment') THEN RAISE EXCEPTION 'bad revoke kind %', p_kind; END IF;
  IF p_reference IS NULL THEN RAISE EXCEPTION 'revocation reference required'; END IF;
  IF p_credits IS NOT NULL AND p_credits < 0 THEN RAISE EXCEPTION 'credits must be >= 0'; END IF;
  SELECT * INTO lot FROM public.credit_lots l WHERE l.id = p_lot;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown lot %', p_lot USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO acct FROM public.credit_accounts a WHERE a.user_id = lot.user_id FOR UPDATE;
  SELECT * INTO prior FROM public.credit_lot_revocations v WHERE v.reference = p_reference;
  IF FOUND THEN
    IF prior.lot_id <> p_lot THEN RAISE EXCEPTION 'revocation % reused for another lot', p_reference USING ERRCODE = '23505'; END IF;
    RETURN QUERY SELECT 'replayed'::text, prior.revoked_now, prior.pending_added, prior.unrevocable, prior.transaction_id;
    RETURN;
  END IF;
  SELECT * INTO lot FROM public.credit_lots l WHERE l.id = p_lot FOR UPDATE;

  v_unused := lot.credits_granted - lot.credits_consumed - lot.credits_reserved - lot.credits_revoked;
  v_left := COALESCE(p_credits, v_unused + lot.credits_reserved - lot.revoke_pending);
  v_now := LEAST(v_left, v_unused);
  v_left := v_left - v_now;
  v_pending := LEAST(v_left, lot.credits_reserved - lot.revoke_pending);
  v_left := v_left - v_pending;
  -- "Everything": what stays is exactly the service already delivered.
  IF p_credits IS NULL THEN v_left := lot.credits_consumed; END IF;

  IF v_now > 0 THEN
    INSERT INTO public.credit_transactions (user_id, delta, kind, reference, metadata, balance_after)
    VALUES (lot.user_id, -v_now, p_kind, p_reference,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('lot_id', p_lot), acct.balance - v_now)
    RETURNING id INTO new_id;
    INSERT INTO public.credit_allocations (transaction_id, lot_id, amount) VALUES (new_id, p_lot, -v_now);
    UPDATE public.credit_accounts a SET balance = a.balance - v_now, updated_at = now() WHERE a.user_id = lot.user_id;
  END IF;
  UPDATE public.credit_lots l SET
    credits_revoked = l.credits_revoked + v_now,
    revoke_pending = l.revoke_pending + v_pending,
    revoke_kind = CASE WHEN v_pending > 0 OR l.revoke_kind IS NULL THEN p_kind ELSE l.revoke_kind END,
    state = CASE WHEN p_close THEN 'revoked' ELSE l.state END,
    updated_at = now()
   WHERE l.id = p_lot;
  INSERT INTO public.credit_lot_revocations
    (reference, lot_id, kind, requested, revoked_now, pending_added, unrevocable, transaction_id, metadata)
  VALUES (p_reference, p_lot, p_kind, p_credits, v_now, v_pending, v_left, new_id, COALESCE(p_metadata, '{}'::jsonb));
  RETURN QUERY SELECT 'applied'::text, v_now, v_pending, v_left, new_id;
END;
$$;

-- ── backfill: pre-existing balances become one internal opening lot ─────────
INSERT INTO public.credit_lots (user_id, source_class, credits_granted)
SELECT a.user_id, 'internal', a.balance
  FROM public.credit_accounts a
 WHERE a.balance > 0 AND NOT EXISTS (SELECT 1 FROM public.credit_lots l WHERE l.user_id = a.user_id);

-- ── invariant views (empty = healthy; reconciliation alerts on any row) ────
CREATE OR REPLACE VIEW public.credit_lot_drift AS
SELECT l.id AS lot_id, l.user_id, l.credits_granted, l.credits_consumed, l.credits_revoked,
       COALESCE(SUM(al.amount) FILTER (WHERE al.amount > 0), 0)
         + CASE WHEN l.grant_transaction_id IS NULL THEN l.credits_granted ELSE 0 END AS alloc_granted,
       -COALESCE(SUM(al.amount) FILTER (WHERE al.amount < 0 AND t.kind = 'ai_usage'), 0) AS alloc_consumed,
       -COALESCE(SUM(al.amount) FILTER (WHERE al.amount < 0 AND t.kind <> 'ai_usage'), 0) AS alloc_revoked
  FROM public.credit_lots l
  LEFT JOIN public.credit_allocations al ON al.lot_id = l.id
  LEFT JOIN public.credit_transactions t ON t.id = al.transaction_id
 GROUP BY l.id
HAVING l.credits_granted <> COALESCE(SUM(al.amount) FILTER (WHERE al.amount > 0), 0)
                             + CASE WHEN l.grant_transaction_id IS NULL THEN l.credits_granted ELSE 0 END
    OR l.credits_consumed <> -COALESCE(SUM(al.amount) FILTER (WHERE al.amount < 0 AND t.kind = 'ai_usage'), 0)
    OR l.credits_revoked  <> -COALESCE(SUM(al.amount) FILTER (WHERE al.amount < 0 AND t.kind <> 'ai_usage'), 0);

CREATE OR REPLACE VIEW public.credit_account_lot_drift AS
SELECT a.user_id, a.balance, a.reserved,
       COALESCE(SUM(l.credits_granted - l.credits_consumed - l.credits_revoked), 0) AS lot_balance,
       COALESCE(SUM(l.credits_reserved), 0) AS lot_reserved
  FROM public.credit_accounts a
  LEFT JOIN public.credit_lots l ON l.user_id = a.user_id
 GROUP BY a.user_id, a.balance, a.reserved
HAVING a.balance <> COALESCE(SUM(l.credits_granted - l.credits_consumed - l.credits_revoked), 0)
    OR a.reserved <> COALESCE(SUM(l.credits_reserved), 0);

-- ── authorization: server-only, like 001 ───────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.take_from_credit_lots(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_credit_transaction(uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_credits(uuid, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_ai_credits(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ai_credits(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_lot_credits(bigint, integer, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_lot_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_operation_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_lots, public.credit_allocations, public.credit_lot_revocations,
              public.ai_operations, public.ai_operation_lots,
              public.credit_lot_drift, public.credit_account_lot_drift FROM anon, authenticated;

COMMIT;

-- billing/003_payments.sql — Paddle payments, refunds/disputes, policy audit, alerts, risk.
--
-- Apply once in the Supabase SQL editor, after billing/002_credit_lots.sql. Idempotent.
--
-- Paddle (Merchant of Record) is authoritative for FINANCIAL state; the Syllo
-- ledger is authoritative for CREDIT entitlement. Nothing here stores card data:
-- event payloads are reduced to the fields Syllo uses before they are persisted
-- (api/billing/paddle_payload.ts).
--
-- All writes happen server-side (api/billing/*) as the table owner. Clients can
-- only read a safe projection of their own payments.

BEGIN;

-- ── payments: one row per checkout this server created ─────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment            text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  -- SET NULL (not CASCADE): financial evidence outlives an account deletion.
  -- ponytail: retention period is a legal question (docs/billing/ISRAEL_LEGAL_REVIEW_CHECKLIST.md).
  user_id                uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  package_id             text NOT NULL,
  package_version        integer NOT NULL,
  credits_purchased      integer NOT NULL CHECK (credits_purchased > 0),
  paddle_price_id        text NOT NULL,
  paddle_transaction_id  text,
  paddle_customer_id     text,
  currency               text,
  amount_total           bigint,          -- Paddle details.totals.grand_total, minor units
  totals                 jsonb,           -- Paddle's own totals object, verbatim
  -- Transaction dimension. 'completed' is terminal: nothing regresses it.
  checkout_state         text NOT NULL DEFAULT 'checkout_created'
                           CHECK (checkout_state IN ('checkout_created', 'completed', 'failed', 'canceled', 'expired')),
  refunded_amount        bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),  -- Σ approved refund adjustments
  dispute_state          text NOT NULL DEFAULT 'none' CHECK (dispute_state IN ('none', 'warning', 'chargeback', 'reversed')),
  consumed_before_refund boolean NOT NULL DEFAULT false,
  -- Derived, never written: out-of-order events cannot produce an inconsistent status.
  status                 text GENERATED ALWAYS AS (CASE
                           WHEN dispute_state = 'chargeback' THEN 'chargeback'
                           WHEN checkout_state <> 'completed' THEN checkout_state
                           WHEN dispute_state = 'warning' THEN 'disputed'
                           WHEN amount_total IS NOT NULL AND refunded_amount >= amount_total AND refunded_amount > 0 THEN 'refunded'
                           WHEN refunded_amount > 0 THEN 'partially_refunded'
                           ELSE 'completed' END) STORED,
  lot_id                 bigint REFERENCES public.credit_lots (id) ON DELETE SET NULL,
  -- WHAT was accepted: {supplier_terms, refund_policy, privacy_policy, purchase_disclosure,
  -- immediate_service_consent, accepted_at}. Version ids, never a bare boolean.
  terms                  jsonb NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_transaction_once UNIQUE (environment, paddle_transaction_id)
);
CREATE INDEX IF NOT EXISTS payments_user ON public.payments (user_id, created_at);

DO $$ BEGIN
  ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_payment_fk
    FOREIGN KEY (payment_id) REFERENCES public.payments (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── every verified Paddle event, exactly once (event_id = idempotency key) ──
CREATE TABLE IF NOT EXISTS public.paddle_events (
  event_id          text PRIMARY KEY,
  environment       text NOT NULL,
  event_type        text NOT NULL,
  occurred_at       timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'reconciliation')),
  transaction_id    text,
  adjustment_id     text,
  payload           jsonb NOT NULL,    -- minimized (no payment method / address data)
  processing_status text NOT NULL DEFAULT 'received'
                      CHECK (processing_status IN ('received', 'processed', 'deferred', 'ignored', 'failed', 'manual_review')),
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  processed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS paddle_events_txn ON public.paddle_events (transaction_id);
CREATE INDEX IF NOT EXISTS paddle_events_open ON public.paddle_events (received_at)
  WHERE processing_status IN ('received', 'failed', 'deferred');

-- ── refunds / chargebacks / credits as Paddle reports them ──────────────────
CREATE TABLE IF NOT EXISTS public.payment_adjustments (
  paddle_adjustment_id  text PRIMARY KEY,
  environment           text NOT NULL,
  paddle_transaction_id text NOT NULL,
  payment_id            bigint REFERENCES public.payments (id) ON DELETE SET NULL,
  action                text NOT NULL,     -- refund | chargeback | chargeback_warning | chargeback_reverse | credit | credit_reverse | …
  type                  text,              -- full | partial
  status                text NOT NULL,     -- pending_approval | approved | rejected | reversed
  amount                bigint,            -- totals.total, minor units
  currency              text,
  occurred_at           timestamptz NOT NULL,
  -- Syllo's side: has this (adjustment, status) been accounted for?
  accounting_state      text NOT NULL DEFAULT 'pending'
                          CHECK (accounting_state IN ('pending', 'awaiting_purchase', 'applied', 'recorded', 'manual_review')),
  credits_revoked       integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_adjustments_txn ON public.payment_adjustments (environment, paddle_transaction_id);

-- ── every automated decision, with its inputs (append-only) ─────────────────
CREATE TABLE IF NOT EXISTS public.billing_policy_decisions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_key   text NOT NULL UNIQUE,     -- e.g. adj:<id>:<status> — one decision per fact
  policy_version text NOT NULL,
  payment_id     bigint REFERENCES public.payments (id) ON DELETE SET NULL,
  adjustment_id  text,
  event_id       text,
  facts          jsonb NOT NULL,
  decision       text NOT NULL,
  actions        jsonb NOT NULL,
  result         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS billing_policy_decisions_no_update ON public.billing_policy_decisions;
CREATE TRIGGER billing_policy_decisions_no_update
  BEFORE UPDATE ON public.billing_policy_decisions
  FOR EACH ROW EXECUTE FUNCTION public.credit_transactions_immutable();

-- ── alerts = the admin review queue + integration errors ────────────────────
-- manual_review_required for a payment ⇔ an open 'review' alert on it.
CREATE TABLE IF NOT EXISTS public.billing_alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  severity        text NOT NULL CHECK (severity IN ('review', 'critical')),
  code            text NOT NULL,
  dedupe_key      text NOT NULL UNIQUE,
  payment_id      bigint REFERENCES public.payments (id) ON DELETE SET NULL,
  user_id         uuid,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by     uuid,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX IF NOT EXISTS billing_alerts_open ON public.billing_alerts (severity, created_at) WHERE status = 'open';

-- ── account payment-risk state (server-controlled, reversible, audited) ─────
-- Only affects NEW purchases. Never set automatically to 'payment_risk_restricted',
-- and never because someone exercised a refund/cancellation right.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS payment_risk_state text NOT NULL DEFAULT 'normal';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_payment_risk_state_check
    CHECK (payment_risk_state IN ('normal', 'review_required', 'payment_risk_restricted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Objective indicators; a single refund is data, not a verdict.
CREATE OR REPLACE VIEW public.account_risk_indicators AS
SELECT p.user_id,
       COUNT(*) FILTER (WHERE p.checkout_state = 'completed')                            AS completed_purchase_count,
       COUNT(*) FILTER (WHERE p.refunded_amount > 0)                                     AS refunded_purchase_count,
       COUNT(*) FILTER (WHERE p.consumed_before_refund)                                  AS refund_after_consumption_count,
       COALESCE(SUM(l.credits_consumed) FILTER (WHERE p.consumed_before_refund), 0)      AS consumed_before_refund_credits,
       COUNT(*) FILTER (WHERE p.dispute_state = 'chargeback')                            AS chargeback_count
  FROM public.payments p
  LEFT JOIN public.credit_lots l ON l.id = p.lot_id
 WHERE p.user_id IS NOT NULL
 GROUP BY p.user_id;

-- ── authorization ───────────────────────────────────────────────────────────
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paddle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_policy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments, public.paddle_events, public.payment_adjustments,
              public.billing_policy_decisions, public.billing_alerts,
              public.account_risk_indicators FROM anon, authenticated;
-- Own payments, safe columns only (no totals blob, no Paddle customer id).
GRANT SELECT (id, environment, package_id, credits_purchased, currency, amount_total,
              refunded_amount, status, created_at, completed_at) ON public.payments TO authenticated;
DROP POLICY IF EXISTS payments_select_own ON public.payments;
CREATE POLICY payments_select_own ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;

-- billing/004_billing_ops.sql — admin audit trail, reconciliation runs, invariant checks.
--
-- Apply once in the Supabase SQL editor, after billing/003_payments.sql. Idempotent.

BEGIN;

-- Every admin mutation (alert resolution, risk-state change, manual adjustment,
-- manual reconciliation) — who, what, why, when. Append-only.
CREATE TABLE IF NOT EXISTS public.billing_admin_actions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid NOT NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  reason     text NOT NULL CHECK (length(btrim(reason)) >= 3),
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS billing_admin_actions_no_update ON public.billing_admin_actions;
CREATE TRIGGER billing_admin_actions_no_update
  BEFORE UPDATE ON public.billing_admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.credit_transactions_immutable();

CREATE TABLE IF NOT EXISTS public.billing_reconciliation_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'admin')),
  actor_id    uuid,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'issues', 'failed')),
  checked     integer NOT NULL DEFAULT 0,
  repaired    integer NOT NULL DEFAULT 0,
  escalated   integer NOT NULL DEFAULT 0,
  findings    jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Local invariants. Every row is a finding; the reconciler alerts on each.
CREATE OR REPLACE VIEW public.billing_invariant_violations AS
  SELECT 'lot_allocation_drift' AS code, 'lot:' || d.lot_id AS subject, d.user_id, NULL::bigint AS payment_id
    FROM public.credit_lot_drift d
  UNION ALL
  SELECT 'account_lot_drift', 'user:' || d.user_id, d.user_id, NULL FROM public.credit_account_lot_drift d
  UNION ALL
  SELECT 'balance_drift', 'user:' || d.user_id, d.user_id, NULL FROM public.credit_balance_drift d
  UNION ALL
  -- A purchased lot must belong to a completed payment.
  SELECT 'grant_without_completed_payment', 'lot:' || l.id, l.user_id, l.payment_id
    FROM public.credit_lots l LEFT JOIN public.payments p ON p.id = l.payment_id
   WHERE l.source_class = 'purchased' AND (p.id IS NULL OR p.checkout_state <> 'completed')
  UNION ALL
  SELECT 'completed_payment_without_grant', 'payment:' || p.id, p.user_id, p.id
    FROM public.payments p WHERE p.checkout_state = 'completed' AND p.lot_id IS NULL AND p.user_id IS NOT NULL
  UNION ALL
  -- Fully refunded or charged back, but the lot still has spendable credits.
  SELECT 'refunded_payment_with_active_credits', 'payment:' || p.id, p.user_id, p.id
    FROM public.payments p JOIN public.credit_lots l ON l.id = p.lot_id
   WHERE p.status IN ('refunded', 'chargeback')
     AND l.credits_granted - l.credits_consumed - l.credits_reserved - l.credits_revoked > 0
  UNION ALL
  SELECT 'duplicate_purchase_grant', 'payment:' || l.payment_id, MIN(l.user_id::text)::uuid, l.payment_id
    FROM public.credit_lots l WHERE l.payment_id IS NOT NULL GROUP BY l.payment_id HAVING COUNT(*) > 1;

ALTER TABLE public.billing_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_admin_actions, public.billing_reconciliation_runs,
              public.billing_invariant_violations FROM anon, authenticated;

COMMIT;

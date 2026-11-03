# Syllo billing architecture — Paddle, prepaid credits, refunds, disputes

> **TECHNICAL POLICY ≠ LEGAL POLICY.** This system records exactly what was bought, what was delivered, and what Paddle refunded. It accounts for Paddle's decisions automatically. It does **not** decide whether a refund is owed, or how large it should be. Those rules need Israeli legal review and Paddle confirmation (see `ISRAEL_LEGAL_REVIEW_CHECKLIST.md` and `PADDLE_QUESTIONS.md`) and are configured separately in `LEGAL_POLICY`.

## 1. Principles
- Credits are usable **immediately** after Paddle confirms payment. There is no cooling-off lock, no gradual unlocking, no daily cap, and no feature reduction.
- Protection against refund abuse comes from **accounting and evidence**, not restrictions: purchase-level lots, allocation of consumption to lots, records of delivered service, and idempotent, audited handling of Paddle events.
- **Paddle** (Merchant of Record) is authoritative for financial state. The **Syllo ledger** is authoritative for credit entitlement. The browser is authoritative for nothing.

## 2. Flow
```
signed-in user ─ POST /api/billing/checkout {package_id, disclosure_version, accepted}
   server: catalog lookup → payments row (terms versions) → Paddle POST /transactions
           items=[{price_id}], custom_data={syllo_user_id, syllo_payment_id}
   browser: Paddle.Checkout.open({transactionId})   (card data only ever inside Paddle)
Paddle ─ POST /api/billing/webhook (Paddle-Signature) ─▶ verify → paddle_events (durable)
   → one DB transaction under the user's credit_accounts lock:
     validate env / price→package / custom_data == checkout row
     → payments.completed → apply_credit_transaction(+credits,'purchase','paddle:<env>:<txn>')
     → credit lot (purchased) linked to the payment → pending adjustments applied
browser polls GET /api/billing/status → balance refreshed only when credited
```
Code: `api/billing.ts` (one Vercel function, routed by path), `api/billing/{catalog,paddle,process_event,refund_policy,reconcile,admin,evidence}.ts`, `shared/billing/legal_versions.ts`, `web/features/billing/*`, `web/app/admin/billing`.

## 3. Credit-lot model (`billing/002_credit_lots.sql`)
- `credit_transactions`: append-only ledger (unchanged). `balance = SUM(delta)`.
- `credit_lots`: one lot per grant. `source_class` is `purchased` / `promotional` / `subscription` / `internal` (admin and dev grants). The lot tracks `granted`, `consumed`, `reserved`, `revoked` and `revoke_pending`. **unused = granted − consumed − reserved − revoked**.
- `credit_allocations`: the lot(s) each ledger row came from. This is how "Purchase A: 500 / consumed 120 / unused 380" is always answerable.
- Invariant views: `credit_lot_drift`, `credit_account_lot_drift`, `credit_balance_drift`, and `billing_invariant_violations` (004).
- Nothing is ever deleted to represent a refund. Revocations are new negative rows of kind `refund`, `chargeback` or `admin_adjustment`.

## 4. Allocation policy
The order is deterministic: **internal → promotional → subscription → purchased**, FIFO by `created_at` within each class. Non-paid credits are used first, which keeps as much paid value unused (and therefore cleanly refundable) as possible. The order is one `CASE` in `credit_lot_rank`. A refund of purchase A only ever touches A's lot.

## 5. What "consumed" means (service delivered)
Metering lives in `api/ai/metering.ts`, which wraps the pre-existing free quota (unchanged, spent first).
- **reserve** (`reserve_ai_credits`): at admission, once the free quota is exhausted, 1 credit is held and allocated to lots. If the credits are insufficient, the user gets the same 429 as before. Free-quota operations are recorded too (0 credits), for evidence.
- **finalize** (`finalize_ai_credits`), which means *delivered*:
  - **Copilot** (`/api/ai/conversation`): when the proposal is persisted and retrievable (the point where usage was always counted). Chat-only turns are not charged.
  - **Course chat** (`/api/ai/course-planner`, streaming): when the whole answer has been streamed **and** the run completed.
- **release**: every other outcome (error, empty run, conflict, timeout). A reservation left open more than 60 minutes is released by reconciliation.
- Recorded per operation (`ai_operations`): id, user, endpoint, provider, model, input/output/cached tokens, credits, funding (free_quota / credits / exempt), and the timestamps. Provider cost stays NULL; it is never estimated. **No prompt or output content is recorded.**
- Screenshots, copy and download are never signals. Anything displayed may be kept, which is why the credit is consumed at delivery.
- `billing_exempt` developers are recorded as `exempt`, and nothing is deducted. No fake payments are ever created.

## 6. Refund accounting (RefundPolicyEngine, `refund_policy.ts`)
The engine is pure, deterministic and versioned (`POLICY_VERSION`). Every decision is written to `billing_policy_decisions` with the facts it saw, the actions and the analysis, under a unique key (`adj:<id>:<status>`).

| Paddle fact | Accounting (automatic) |
|---|---|
| refund `pending_approval` (customer asked) | Recorded only. Nothing changes: no revocation, no restriction. |
| refund approved, full | Revoke all unused credits of that lot and close it. |
| refund approved, partial | Revoke ⌈granted × refunded_total ÷ paid⌉ − already revoked, capped at what is still unused. |
| refund covers service already delivered | `consumed_before_refund`, a review alert on the payment, and consumption kept as history. No debt, no clawback, no replacement credits. |
| 2nd refund-after-consumption on an account | The account is flagged `review_required`. It is **never** restricted automatically. |
| chargeback | Revoke unused credits and close the lot. `dispute_state = chargeback`, critical alert, account `review_required`. |
| chargeback_warning | Dispute state `warning`, review alert. |
| chargeback_reverse, credit, currency or amount inconsistency, unknown action | **MANUAL_REVIEW_REQUIRED**. The engine never guesses. |

**Unused package:** the full refund revokes all 500 credits. **Partially consumed (500 / 120 / 380):** the full refund revokes 380, and the 120 stay consumed as evidence. A partial refund of the unused value (e.g. 38 of 50) revokes exactly 380. **Fully consumed:** nothing can be revoked; the refund is recorded and flagged.

Refund during an in-flight AI call: unused credits are revoked now, and held credits become `revoke_pending`. If the call is delivered, they are consumed; if it is released, they are revoked.

## 7. Proportional-refund capability
Every decision stores `consumption_ratio = consumed / granted`, `unused_ratio`, and a candidate split of the amount paid (`candidate_consumed_value`, `candidate_unused_value`, minor units), labelled `analysis_only`. Example: 500 credits for ₪50 with 120 consumed gives ₪12 consumed and ₪38 unused. `recommendRefundRequest()` is the slot for an approved policy. While `LEGAL_POLICY.status = 'unreviewed'` it always returns `MANUAL_REVIEW`. Refunds are always issued in Paddle, through Paddle's MoR workflow; Syllo never moves money.

## 8. Webhook security and idempotency
- The signature is HMAC-SHA256 over `ts:rawBody` (the exact raw bytes), compared timing-safe, with ±5 min tolerance and every `h1` accepted during secret rotation. Invalid → 401, nothing stored, and an hourly-deduplicated critical alert.
- Events are durable **before** processing (`paddle_events`, PK `event_id`). Processing happens in one transaction. On failure the event is marked `failed`, attempts are counted, and the endpoint returns HTTP 500 so that Paddle retries. It never acknowledges without persisting.
- Two-level idempotency: `event_id`, plus the ledger's `UNIQUE(kind, reference)` with `paddle:<env>:<txn>`. A webhook racing reconciliation still grants once.
- Ordering: payment `status` is a **generated column** derived from the facts; `completed` never regresses; adjustment statuses only move forward (`pending_approval` < `approved`/`rejected` < `reversed`). Refund-before-purchase is stored as `awaiting_purchase` and applied atomically with the grant.
- Payment → user mapping: a stable Supabase user id, set **server-side** as `custom_data` on a server-created transaction, and cross-checked against the checkout row. Email is never used as identity. A mismatch means no grant and a critical alert.
- Payloads are minimized before storage: no card brand/last4, no cardholder name, no address, no checkout URL.

## 9. Reconciliation (`reconcile.ts`, daily Vercel Cron + admin button)
For each checkout that can still change (open ≤ 30 days, completed ≤ 180 days), reconciliation fetches `GET /transactions/{id}` and `GET /adjustments?transaction_id=` from Paddle and feeds them through **the same processor** as synthetic events.
- **Repaired automatically and recorded in `billing_reconciliation_runs`:** a missing grant, a missing refund or chargeback, a stale checkout (expired after 7 days), and an AI reservation left open by a dead request (released).
- **Escalated:** invariant violations (grant without a completed payment, completed payment without a grant, refunded with active credits, duplicate grant, drift), adjustments with no purchase after 24h, webhook events stuck in `failed`, and Paddle API failures.

There is no public trigger: the cron call needs `Authorization: Bearer CRON_SECRET`, and the admin trigger needs a developer session plus a reason.

## 10. Dispute evidence (`evidence.ts`)
`GET /api/billing/admin/evidence?id=<payment>[&format=text]` returns a JSON package or a human-readable summary. It covers: user id, Paddle transaction/customer ids, purchase time, package, amount, the **accepted terms versions**, every delivered AI operation (id, time, endpoint, model, tokens, credits from this purchase), the Paddle event timeline, adjustments, and automated decisions. It contains no conversation content. Nothing is sent to Paddle automatically.

## 11. Risk state and alerts
- `profiles.payment_risk_state` is `normal`, `review_required` or `payment_risk_restricted`. It is server-only, reversible and audited (`billing_admin_actions`). It is set automatically only up to `review_required`, and only on objective signals (a chargeback, or ≥2 refunds after consumption). `payment_risk_restricted` is admin-only and only blocks **new purchases**; AI usage of credits already held is unaffected. A refund request or a lawful cancellation never restricts anything.
- `billing_alerts` (severity `review` | `critical`, deduplicated) is both the review queue and the integration-error list. The console shows NORMAL / REVIEW REQUIRED / CRITICAL INTEGRATION ERROR.
- Admin adjustments go through the ledger as `admin_adjustment` rows (internal lots), require a reason, and record the actor. History is never edited.
  `POST /api/billing/admin/adjust` is deliberately **API-only** (no console control): developer role required, positive grants only to staff/exempt accounts; use it from a signed-in developer session for support corrections.

## 12. Environments
Each Vercel environment carries its own `PADDLE_ENV`, `PADDLE_API_KEY` (the prefix must match: `pdl_sdbx_` / `pdl_live_`), `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_CREDITS_*`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` and `NEXT_PUBLIC_PADDLE_ENV`. Payments are stored with their environment and are unique per `(environment, transaction)`. A sandbox transaction or price can never be granted by the production deployment. Automated tests use fake secrets only. See `SANDBOX_TO_PRODUCTION.md`.

## 13. What is fully automated vs manual review
**Fully automated:** purchase grants; duplicate and out-of-order events; failed/canceled checkouts; refund requests (recorded only); approved full and partial refund accounting and revocation of unused credits; refunds during in-flight AI calls; refunds before the purchase event; full refunds after consumption (recorded and flagged); chargeback accounting and evidence; risk indicators; reconciliation of missed grants, refunds and chargebacks; stale checkouts and reservations; evidence packages.

**Manual review:** chargeback reversals; Paddle `credit` / `credit_reverse` adjustments; currency or amount inconsistencies; unknown prices or user-mapping failures (critical); ledger invariant failures; adjustments whose purchase never arrived; conflicting adjustment statuses; accounts showing a repeated refund-after-consumption pattern (review only); and any refund *sizing* decision until `LEGAL_POLICY` is approved.

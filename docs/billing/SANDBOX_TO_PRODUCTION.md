# Paddle: Sandbox → Production

## 0. Database (Supabase SQL editor, in order; each file is idempotent)
1. `scripts/migrations/billing/002_credit_lots.sql`
2. `scripts/migrations/billing/003_payments.sql`
3. `scripts/migrations/billing/004_billing_ops.sql`
4. `scripts/migrations/billing/005_billing_closeout.sql` (customer credit policy, cost evidence, case fields)

## 1. Paddle Sandbox (sandbox-vendors.paddle.com)
1. **Catalog:** create one product "Syllo Credits" and one one-time price per package: `credits_small`, `credits_medium`, `credits_large`. The credit amounts are in `api/billing/catalog.ts` and are placeholders marked *REQUIRES PRODUCT DECISION*. Set the price in Paddle; Syllo never stores prices.
2. **Checkout settings:**
   - Add the site domain (Preview/Production URL) as an approved domain.
   - Set a default payment link, e.g. `https://<domain>/` (Paddle requires one).
3. **Developer tools → Authentication:**
   - Create a server API key (`pdl_sdbx_apikey_…`) with transactions read/write and adjustments read.
   - Create a client-side token (`test_…`).
4. **Developer tools → Notifications:** add a destination `https://<preview-domain>/api/billing/webhook` subscribed to:
   - `transaction.completed`
   - `transaction.payment_failed`
   - `transaction.canceled`
   - `adjustment.created`
   - `adjustment.updated`

   Copy its secret key. (Confirm the event list with Paddle; see `PADDLE_QUESTIONS.md` #10.)
5. **Vercel env, Preview scope only:**
   ```
   PADDLE_ENV=sandbox
   PADDLE_API_KEY=pdl_sdbx_apikey_…
   PADDLE_WEBHOOK_SECRET=…
   PADDLE_PRICE_CREDITS_SMALL=pri_…
   PADDLE_PRICE_CREDITS_MEDIUM=pri_…
   PADDLE_PRICE_CREDITS_LARGE=pri_…
   NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_…
   NEXT_PUBLIC_PADDLE_ENV=sandbox
   CRON_SECRET=<random 32+ chars>
   ```
   Never put a secret in a `NEXT_PUBLIC_` variable.
6. **Protected Preview?** Vercel Deployment Protection blocks Paddle's webhook. Either use a protection-bypass for automation or an unprotected branch alias.

## 2. Sandbox E2E checklist (all must pass before production)
Use Paddle's test cards (sandbox only). Check each result in `/admin/billing` (developer account).

| # | Scenario | Expected |
|---|---|---|
| 1 | Buy `credits_small` | The status poll turns to credited; balance +N; the purchase shows `completed`; a lot is linked |
| 2 | **Raw-body check:** the webhook returns 200 (not 401) | Confirms `@vercel/node` replays the exact signed bytes |
| 3 | Resend the same event from Paddle's notification log | `duplicate`; balance unchanged |
| 4 | Use AI past the free quota | 1 credit per delivered proposal or answer; `ai_operations` rows show tokens |
| 5 | Full refund (dashboard or `POST /adjustments`) of an **unused** package | Balance −N; lot `revoked`; purchase `refunded` |
| 6 | Buy, consume some credits, then refund in full | Unused revoked, consumed kept; `consumed_before_refund`; review alert |
| 7 | Buy, consume all, then refund | Refund recorded, 0 revoked, no negative balance; review alert |
| 8 | Partial refund | Proportional revocation; purchase `partially_refunded` |
| 9 | Temporarily set a wrong webhook secret, buy, restore the secret, then run "הרצת התאמה עכשיו" | The grant is repaired by reconciliation (the webhook is also retried by Paddle) |
| 10 | Two browser tabs spend the last credit together | One succeeds, one gets 429 |
| 11 | Evidence export (JSON + text) for #6 | Shows purchase, terms versions, and operations; no conversation content |

For local testing without Paddle, see `scripts/paddle_fixture_webhook.ts` (signed fixtures against `npm run dev:api`).

## 3. Production
Go live only after the **production gate**:
- **Technical:** every sandbox check above passes.
- **Paddle:** account and Syllo product approved, the AI-credit model approved, production prices configured, refund behaviour confirmed (`PADDLE_QUESTIONS.md`).
- **Legal:** Israeli consumer-law review complete; Refund Policy, immediate-service disclosure, proportional-service treatment, Terms and Privacy approved (`ISRAEL_LEGAL_REVIEW_CHECKLIST.md`). Then:
  - replace the placeholders in `shared/billing/legal_versions.ts` and bump the version ids;
  - set `IMMEDIATE_SERVICE_CONSENT_VERSION` if counsel requires explicit consent;
  - set `LEGAL_POLICY` only for rules counsel approved.

Then repeat steps 1–4 in the **live** Paddle dashboard:
- `pdl_live_apikey_…`, a live client token, and a live notification destination pointing at the production domain;
- set them in the Vercel **Production** scope with `PADDLE_ENV=production` and `NEXT_PUBLIC_PADDLE_ENV=production`;
- the server refuses a sandbox key under `PADDLE_ENV=production`.

Keep the Preview scope on sandbox forever.

The Vercel Cron (`/api/billing/reconcile`, daily 03:17 UTC) runs on production deployments only. Check `/admin/billing` after the first live purchase.

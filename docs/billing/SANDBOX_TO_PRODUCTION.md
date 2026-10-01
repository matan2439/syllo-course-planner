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

### Sandbox catalog (created 2026-09-29, SANDBOX placeholders — not final pricing)
| Package (`catalog.ts`) | Credits | Paddle product | Paddle price (one-time, qty 1) | Env var |
|---|---|---|---|---|
| `credits_small` | 50 | `pro_01m3qasa6wbj8qvm4wdsqztn1s` Syllo Credits Small | `pri_01m3qasab7exbpj6dv3k70tjn9` USD 5.00 | `PADDLE_PRICE_CREDITS_SMALL` |
| `credits_medium` | 150 | `pro_01m3qasahbx2e56m179z4kn58f` Syllo Credits Medium | `pri_01m3qasant31p8d69jr7r90ky5` USD 12.00 | `PADDLE_PRICE_CREDITS_MEDIUM` |
| `credits_large` | 400 | `pro_01m3qasaw3v1y3rcnk0bc7dnw4` Syllo Credits Large | `pri_01m3qasb0c3gcb343ccx7vat03` USD 25.00 | `PADDLE_PRICE_CREDITS_LARGE` |

Credits come only from `catalog.ts` via the price id; Paddle `custom_data` on the product is informational.

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
- **Auth email:** every item in section 4 is done and the launch status there reads YES.

Then repeat steps 1–4 in the **live** Paddle dashboard:
- `pdl_live_apikey_…`, a live client token, and a live notification destination pointing at the production domain;
- set them in the Vercel **Production** scope with `PADDLE_ENV=production` and `NEXT_PUBLIC_PADDLE_ENV=production`;
- the server refuses a sandbox key under `PADDLE_ENV=production`.

Billing fails closed (503 `BILLING_NOT_CONFIGURED`) on a mixed configuration: `PADDLE_ENV=production` only on `VERCEL_ENV=production` and vice versa, `NEXT_PUBLIC_PADDLE_ENV` must equal `PADDLE_ENV`, and the client token must be `test_` (sandbox) / `live_` (production).

**Separate databases.** Credit lots carry no environment, so isolation is by database:

| Vercel scope | Supabase project (DB + Auth) | Paddle |
|---|---|---|
| Production | `lxwtycowmqosuyfumcbo` | Live (`PADDLE_ENV=production`) |
| Preview | `syllo-preview` (separate project) | Sandbox (`PADDLE_ENV=sandbox`) |

`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` each have one Production entry and one Preview entry. Never scope one of them to both. `api/db_env.ts` enforces this and fails closed: only `VERCEL_ENV=production` may use the production project ref, and production may use nothing else. A refused or missing URL counts as "not configured" (billing 503, metering unavailable, auth off), never as a fallback. Together with the Paddle guard above, Preview keeps its Sandbox billing enabled for development.

Preview schema: apply alembic up to the production revision (`alembic upgrade <rev> --sql`), then `scripts/migrations/auth/*`, `planner/001`, `billing/001…005`. Use test accounts only; never copy production data.

The Vercel Cron (`/api/billing/reconcile`, daily 03:17 UTC) runs on production deployments only. Check `/admin/billing` after the first live purchase.

## 4. Auth email delivery (required for Production launch)
Production signup, email verification and password reset must not rely on Supabase's built-in development SMTP (it is rate-limited and not meant for real users).

**Architecture:** Supabase Auth → Resend custom SMTP → a Syllo-owned verified sending domain/subdomain. Paddle sends payment receipts and billing emails itself as Merchant of Record, so Syllo SMTP must not duplicate Paddle receipts.

**Cost:** stay at zero fixed monthly cost while usage is low. Use the Resend free tier unless a concrete technical reason makes it unsuitable.

Before Production launch:
1. Verify a Syllo-owned sending domain/subdomain in Resend.
2. Configure the SPF and DKIM DNS records.
3. Set the Resend SMTP credentials in the Supabase **Production** project: Authentication → Emails → SMTP Settings.
4. Sender: `Syllo <no-reply@mail.<syllo-domain>>` (or similar).
5. SMTP credentials live only in Supabase; never in frontend code or `NEXT_PUBLIC_*` variables.
6. Set an appropriate Supabase auth email rate limit once custom SMTP is on.
7. Brand and verify the templates: signup confirmation, password reset, email-change confirmation (where applicable).
8. Disable email link tracking if the provider enables it; rewritten links break Supabase auth links.
9. Test with fresh Gmail, Outlook and another mailbox where practical.
10. Check delivery speed and Spam/Junk placement.
11. Add CAPTCHA/abuse protection to the signup and password-reset flows.
12. Preview (`syllo-preview`) keeps its own development email setup; Production SMTP credentials are never used in Preview.

Future enhancement: Google Sign-In through Supabase Auth to reduce email-confirmation friction.

**Launch status**

| Item | Status |
|---|---|
| PRODUCTION SMTP CONFIGURED | NO |
| SENDING DOMAIN VERIFIED | NO |
| AUTH EMAILS TESTED | NO |
| CAPTCHA ENABLED | NO |
| GOOGLE SIGN-IN | OPTIONAL / NOT REQUIRED FOR INITIAL LAUNCH |

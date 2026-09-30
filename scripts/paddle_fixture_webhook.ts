/**
 * Send a signed Paddle-shaped webhook to a LOCAL billing endpoint — for testing
 * the full pipeline without Paddle (offline E2E). Refuses production settings.
 *
 *   PADDLE_WEBHOOK_SECRET=... npx tsx scripts/paddle_fixture_webhook.ts complete <txn_id> <user_uuid> <payment_id> <price_id> [amount]
 *   PADDLE_WEBHOOK_SECRET=... npx tsx scripts/paddle_fixture_webhook.ts refund <txn_id> <adj_id> <full|partial> <amount> [pending_approval|approved]
 *   PADDLE_WEBHOOK_SECRET=... npx tsx scripts/paddle_fixture_webhook.ts chargeback <txn_id> <adj_id> <amount>
 *
 * Target: BILLING_WEBHOOK_URL (default http://localhost:3002/api/billing/webhook).
 * For the real sandbox, use Paddle's own "simulate webhook" tool instead.
 */
import { randomUUID } from 'crypto';
import { signPaddleBody } from '../api/billing/paddle';

try { process.loadEnvFile('.env.local'); } catch { /* optional */ }

const url = process.env.BILLING_WEBHOOK_URL ?? 'http://localhost:3002/api/billing/webhook';
const secret = process.env.PADDLE_WEBHOOK_SECRET ?? '';
if (process.env.PADDLE_ENV === 'production' || !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Refusing: fixtures are for a local endpoint with non-production settings only.');
  process.exit(1);
}
if (!secret) { console.error('PADDLE_WEBHOOK_SECRET is required (the same value the local server uses).'); process.exit(1); }

const [kind, ...args] = process.argv.slice(2);
const now = new Date().toISOString();
const eventId = `evt_fixture_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

function build(): object {
  if (kind === 'complete') {
    const [txn, user, paymentId, priceId, amount = '5000'] = args;
    return { event_id: eventId, event_type: 'transaction.completed', occurred_at: now, data: {
      id: txn, status: 'completed', customer_id: 'ctm_fixture', currency_code: 'ILS',
      custom_data: { syllo_user_id: user, syllo_payment_id: paymentId },
      items: [{ price: { id: priceId }, quantity: 1 }],
      details: { totals: { grand_total: amount, total: amount, currency_code: 'ILS' } }, updated_at: now,
    } };
  }
  if (kind === 'refund' || kind === 'chargeback') {
    const [txn, adj, type = 'full', amount = '5000', status = 'approved'] = kind === 'refund' ? args : [args[0], args[1], 'full', args[2] ?? '5000'];
    return { event_id: eventId, event_type: 'adjustment.created', occurred_at: now, data: {
      id: adj, action: kind, type, status, transaction_id: txn, currency_code: 'ILS', totals: { total: amount, currency_code: 'ILS' },
      created_at: now, updated_at: now,
    } };
  }
  console.error('Usage: complete | refund | chargeback — see the header of this file.');
  process.exit(1);
}

const raw = JSON.stringify(build());
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': signPaddleBody(raw, secret) }, body: raw })
  .then(async (res) => console.log(res.status, await res.text()))
  .catch((error) => { console.error(error); process.exit(1); });

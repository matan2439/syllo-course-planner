import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BillingAdminPage from './page'

const OVERVIEW = {
  ok: true, health: 'review', invariant_violations: 0, last_reconciliation: null,
  payments: { purchases: 3, refunds: 1, partial_refunds: 0, disputes: 0, refunds_after_consumption: 1, credits_sold: 150 },
  money_by_currency: [{ currency: 'ILS', gross: 15000, refunded: 5000 }],
  purchased_credits: { consumed: 40, unused: 60, revoked: 50 },
  open_alerts: { review: 1, critical: 0 },
}
const EVIDENCE = {
  statement: 'Authenticated Syllo account u purchased 50 Syllo Credits',
  purchase: { payment_id: '7', syllo_user_id: 'u', paddle_transaction_id: 'txn_1', package_id: 'credits_small', amount_total: 5000, currency: 'ILS', status: 'refunded', refunded_amount: 5000, dispute_state: 'none', purchased_at: '2026-09-29T10:00:00.000Z', terms_accepted: { purchase_disclosure: 'v1' } },
  credits: { purchased: 50, consumed: 10, unused: 0, revoked: 40 },
  service_delivery: { operations: [{ operation_id: 'op_1', delivered_at: '2026-09-29T10:05:00.000Z', endpoint: 'conversation', model: 'm', credits_from_this_purchase: 1, input_tokens: 1, output_tokens: 2 }] },
  policy_decisions: [{ policy_version: 'syllo-technical-2026-09-v1' }],
}

function mockFetch(status = 200) {
  global.fetch = jest.fn(async (url: string) => {
    const path = url.replace('/api/billing/admin/', '')
    const body = status !== 200 ? { ok: false, code: 'FORBIDDEN' }
      : path.startsWith('overview') ? OVERVIEW
      : path.startsWith('alerts') ? { ok: true, alerts: [{ id: 1, severity: 'review', code: 'refund_after_consumption', payment_id: 7, details: {} }] }
      : path.startsWith('payments') ? { ok: true, payments: [{ id: 7, status: 'refunded', package_id: 'credits_small', amount_total: 5000, currency: 'ILS', refunded_amount: 5000, credits_purchased: 50, credits_consumed: 10, credits_revoked: 40, paddle_transaction_id: 'txn_1', manual_review_required: true }] }
      : { ok: true, evidence: EVIDENCE, timeline: [{ at: '2026-09-29T10:00:00.000Z', kind: 'grant', label: '50 credits granted' }], alerts: [], risk: { payment_risk_state: 'normal' } }
    return { ok: status === 200, status, json: async () => body } as Response
  }) as never
}

test('shows health, metrics, review queue, and a purchase with timeline and evidence', async () => {
  mockFetch()
  render(<BillingAdminPage />)
  expect(await screen.findByTestId('health')).toHaveTextContent('REVIEW REQUIRED')
  expect(screen.getByText('קרדיטים בתשלום שלא נוצלו').nextSibling).toHaveTextContent('60')
  expect(screen.getByText('refund_after_consumption')).toBeInTheDocument()
  fireEvent.click(screen.getByText('txn_1'))
  const detail = await screen.findByTestId('payment-detail')
  expect(detail).toHaveTextContent('50 credits granted')
  fireEvent.click(screen.getByRole('button', { name: 'ראיות' }))
  expect(detail).toHaveTextContent('op_1')
  expect(screen.getByRole('link', { name: 'JSON ↓' })).toHaveAttribute('href', '/api/billing/admin/evidence?id=7')
})

test('non-developers see only a refusal', async () => {
  mockFetch(403)
  render(<BillingAdminPage />)
  await waitFor(() => expect(screen.getByText('אין הרשאה.')).toBeInTheDocument())
})

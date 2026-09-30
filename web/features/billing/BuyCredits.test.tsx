import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BuyCredits from './BuyCredits'

const PKG = { id: 'credits_small', name_he: 'חבילה קטנה', credits: 50, paddle_price_id: 'pri_small' }

function installPaddle() {
  let callback: (e: unknown) => void = () => {}
  const paddle = {
    Environment: { set: jest.fn() },
    Initialize: jest.fn((o: { eventCallback: (e: unknown) => void }) => { callback = o.eventCallback }),
    Checkout: { open: jest.fn() },
    PricePreview: jest.fn(async () => ({ data: { details: { lineItems: [{ price: { id: 'pri_small' }, formattedTotals: { total: '₪19.90' } }] } } })),
  }
  window.Paddle = paddle as never
  return { paddle, emit: (e: unknown) => callback(e) }
}

function mockApi(statuses: Array<Record<string, unknown>>) {
  const calls: Array<{ url: string; body?: unknown }> = []
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const json = url.startsWith('/api/billing/packages') ? { ok: true, packages: [PKG] }
      : url.startsWith('/api/billing/me') ? { ok: true, purchases: [{ payment_id: '1', status: 'completed', completed_at: null, credits: { purchased: 50, consumed: 12, in_use: 0, unused: 38, revoked: 0 } }] }
      : url.startsWith('/api/billing/checkout') ? { ok: true, transaction_id: 'txn_1', payment_id: '9' }
      : statuses.shift() ?? { ok: true, credited: false }
    return { ok: true, json: async () => json } as Response
  }) as never
  return calls
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = 'test_token'
  jest.useRealTimers()
})

test('hidden entirely when Paddle is not configured', () => {
  delete process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  const { container } = render(<BuyCredits onBalanceChanged={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})

test('purchase flow: disclosure required, server-created checkout, balance only after server confirmation', async () => {
  const { paddle, emit } = installPaddle()
  const calls = mockApi([{ ok: true, credited: false }, { ok: true, credited: true, credits: 50 }])
  const onBalanceChanged = jest.fn()
  render(<BuyCredits onBalanceChanged={onBalanceChanged} />)
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))

  const buy = await screen.findByRole('button', { name: /חבילה קטנה · 50 קרדיטים/ })
  await waitFor(() => expect(buy).toHaveTextContent('₪19.90'))
  expect(screen.getByTestId('purchase-disclosure')).toBeInTheDocument()
  expect(screen.getByTestId('purchase-history')).toHaveTextContent('50 נרכשו · 12 נוצלו · 38 זמינים')
  expect(buy).toBeDisabled() // disclosure not accepted yet
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(buy)

  await waitFor(() => expect(paddle.Checkout.open).toHaveBeenCalledWith({ transactionId: 'txn_1' }))
  // The browser sends a package id and the disclosure version — never credits, prices or a user id.
  expect(calls.find((c) => c.url === '/api/billing/checkout')!.body).toEqual({
    package_id: 'credits_small', disclosure_version: expect.stringContaining('purchase-disclosure'), accepted: true,
  })

  jest.useFakeTimers()
  act(() => emit({ name: 'checkout.completed', data: { transaction_id: 'txn_1' } }))
  expect(screen.getByRole('status')).toHaveTextContent('מאמתים מול Paddle')
  expect(onBalanceChanged).not.toHaveBeenCalled() // no optimistic balance
  await act(async () => { jest.advanceTimersByTime(2_000) })
  expect(onBalanceChanged).not.toHaveBeenCalled()
  await act(async () => { jest.advanceTimersByTime(2_000) })
  await act(async () => {})
  expect(onBalanceChanged).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('50 קרדיטים נוספו לחשבון')
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BuyCredits from './BuyCredits'

const PKG = { id: 'credits_small', name_he: 'חבילה קטנה', credits: 50, paddle_price_id: 'pri_small' }

function installPaddle() {
  let callback: (e: unknown) => void = () => {}
  const paddle = {
    Environment: { set: jest.fn() },
    Initialize: jest.fn((o: { eventCallback: (e: unknown) => void }) => { callback = o.eventCallback }),
    Checkout: { open: jest.fn() },
    PricePreview: jest.fn(async () => ({ data: { details: { lineItems: [{ price: { id: 'pri_small' }, product: { name: 'Syllo Credits Small' }, formattedTotals: { total: '$5.00' } }] } } })),
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

  const buy = await screen.findByRole('button', { name: /50 AI credits/ })
  // Name and localized price both come from Paddle, not from Syllo code.
  await waitFor(() => expect(buy).toHaveTextContent('Syllo Credits Small'))
  expect(buy).toHaveTextContent('$5.00')
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
  expect(screen.getByTestId('purchase-progress')).toHaveTextContent('אימות מאובטח של התשלום')
  expect(onBalanceChanged).not.toHaveBeenCalled() // no optimistic balance
  await act(async () => { jest.advanceTimersByTime(2_000) })
  expect(onBalanceChanged).not.toHaveBeenCalled()
  await act(async () => { jest.advanceTimersByTime(2_000) })
  await act(async () => {})
  expect(onBalanceChanged).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('purchase-success')).toHaveTextContent('+50 קרדיטים')
})

test('refund request per purchase: sends payment id + reason only, then shows the case status', async () => {
  installPaddle()
  const calls = mockApi([])
  const fetchMock = global.fetch as jest.Mock
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/billing/refund-request') {
      calls.push({ url, body: JSON.parse(String(init!.body)) })
      return { ok: true, json: async () => ({ ok: true, case_id: '7', case_status: 'open' }) } as Response
    }
    return base(url, init)
  })
  render(<BuyCredits onBalanceChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))
  await screen.findByTestId('purchase-history')
  expect(screen.getByRole('link', { name: 'מדיניות החזרים' })).toHaveAttribute('href', '/refund-policy')

  fireEvent.click(screen.getByRole('button', { name: 'בקשת החזר' }))
  const send = screen.getByRole('button', { name: 'שליחת בקשה' })
  expect(send).toBeDisabled() // a reason is required
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  לא השתמשתי  ' } })
  fireEvent.click(send)

  await screen.findByText('בקשת החזר התקבלה')
  expect(screen.getByText(/הבקשה נשלחה/)).toBeInTheDocument()
  // Nothing about amounts, credits or users — the server decides what the case contains.
  expect(calls.find((c) => c.url === '/api/billing/refund-request')!.body).toEqual({ payment_id: '1', reason: 'לא השתמשתי' })
  expect(screen.queryByRole('button', { name: 'בקשת החזר' })).not.toBeInTheDocument() // one open request per purchase
})

test('no refund button for a purchase that is already refunded', async () => {
  installPaddle()
  mockApi([])
  const fetchMock = global.fetch as jest.Mock
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.startsWith('/api/billing/me')
    ? ({ ok: true, json: async () => ({ ok: true, purchases: [{ payment_id: '1', status: 'refunded', completed_at: null, refund_request: null,
      credits: { purchased: 50, consumed: 0, in_use: 0, unused: 0, revoked: 50 } }] }) } as Response)
    : base(url, init))
  render(<BuyCredits onBalanceChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))
  expect(await screen.findByTestId('purchase-history')).toHaveTextContent('הוחזרה')
  expect(screen.queryByRole('button', { name: 'בקשת החזר' })).not.toBeInTheDocument()
})

test('a case awaiting the customer keeps a way to answer', async () => {
  installPaddle()
  mockApi([])
  const fetchMock = global.fetch as jest.Mock
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.startsWith('/api/billing/me')
    ? ({ ok: true, json: async () => ({ ok: true, purchases: [{ payment_id: '1', status: 'completed', completed_at: null,
      refund_request: { case_status: 'awaiting_customer', requested_at: '2026-10-01T00:00:00Z' },
      credits: { purchased: 50, consumed: 0, in_use: 0, unused: 50, revoked: 0 } }] }) } as Response)
    : base(url, init))
  render(<BuyCredits onBalanceChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))
  expect(await screen.findByText('בקשת החזר ממתינה לתשובתך')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'הוספת פרטים לבקשה' }))
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

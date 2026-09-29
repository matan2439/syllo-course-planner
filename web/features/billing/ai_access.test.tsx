import { act, fireEvent, render, screen } from '@testing-library/react'
import CourseAiChat from '../courses/components/CourseAiChat'
import BuyCredits from './BuyCredits'
import CreditsChip from './CreditsChip'
import { BUY_CREDITS_EVENT, OPEN_ACCOUNT_EVENT, openBuyCredits } from './ai_access'

let mockAuth: Record<string, unknown>
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => mockAuth }))

const base = { enabled: true, loading: false, refreshCreditBalance: jest.fn() }
const course = { id: '0542-4241', name: 'בקרה מודרנית', weeklyHours: 3, credits: 3, category: null, offered: ['A'], prerequisites: [], syllabusUrl: null } as never

function chat() {
  const askFn = jest.fn(async () => {})
  render(<CourseAiChat programId="p" course={course} suggestions={['שאלה מוכנה']} askFn={askFn} />)
  return askFn
}

test('signed out: the AI chat is blurred behind a paywall that offers sign-in', () => {
  mockAuth = { ...base, user: null, profile: null, creditBalance: null, hasPurchased: null }
  const askFn = chat()
  const opened = jest.fn()
  window.addEventListener(OPEN_ACCOUNT_EVENT, opened)
  expect(screen.getByTestId('ai-paywall')).toHaveTextContent('התחברו כדי להתחיל')
  expect(screen.queryByRole('textbox')).toBeNull() // the blurred panel is inert and hidden from assistive tech
  fireEvent.click(screen.getByRole('button', { name: 'התחברות' }))
  expect(opened).toHaveBeenCalled()
  expect(askFn).not.toHaveBeenCalled()
  window.removeEventListener(OPEN_ACCOUNT_EVENT, opened)
})

test('first-time customer (never purchased): full paywall that opens the purchase dialog', () => {
  mockAuth = { ...base, user: { id: 'u' }, profile: { role: 'user', billing_exempt: false }, creditBalance: 0, hasPurchased: false }
  chat()
  const buy = jest.fn()
  window.addEventListener(BUY_CREDITS_EVENT, buy)
  expect(screen.getByTestId('ai-paywall')).toHaveTextContent('בלי מנוי')
  expect(screen.queryByTestId('ai-access-notice')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))
  expect(buy).toHaveBeenCalled()
  window.removeEventListener(BUY_CREDITS_EVENT, buy)
})

test('returning customer who ran out: the panel stays visible, locked, with a top-up notice', () => {
  mockAuth = { ...base, user: { id: 'u' }, profile: { role: 'user', billing_exempt: false }, creditBalance: 0, hasPurchased: true }
  chat()
  expect(screen.queryByTestId('ai-paywall')).toBeNull()
  expect(screen.getByTestId('ai-access-notice')).toHaveTextContent('נגמרו הקרדיטים')
  expect(screen.getByRole('textbox')).toBeDisabled()
  const buy = jest.fn()
  window.addEventListener(BUY_CREDITS_EVENT, buy)
  fireEvent.click(screen.getByRole('button', { name: 'קניית קרדיטים' }))
  expect(buy).toHaveBeenCalled()
  window.removeEventListener(BUY_CREDITS_EVENT, buy)
})

test('credits available, or a billing-exempt developer: the chat is open and refreshes the balance after a reply', async () => {
  mockAuth = { ...base, user: { id: 'u' }, profile: { role: 'user', billing_exempt: false }, creditBalance: 3, hasPurchased: true }
  const askFn = chat()
  expect(screen.queryByTestId('ai-access-notice')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /שאלה מוכנה/ })) })
  expect(askFn).toHaveBeenCalled()
  expect(base.refreshCreditBalance).toHaveBeenCalled()

  mockAuth = { ...base, user: { id: 'd' }, profile: { role: 'developer', billing_exempt: true }, creditBalance: 0 }
  render(<CourseAiChat programId="p" course={course} suggestions={null} />)
  expect(screen.getAllByRole('textbox').at(-1)).not.toBeDisabled()
})

test('the purchase flow opens as its own dialog when asked (not inside the account menu)', async () => {
  process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = 'test_token'
  window.Paddle = { Environment: { set: jest.fn() }, Initialize: jest.fn(), Checkout: { open: jest.fn() },
    PricePreview: jest.fn(async () => ({ data: { details: { lineItems: [] } } })) } as never
  global.fetch = jest.fn(async (url: string) => ({
    ok: true, json: async () => (url.includes('packages') ? { ok: true, packages: [{ id: 'credits_small', name_he: 'חבילה קטנה', credits: 50, paddle_price_id: 'pri_s' }] } : { ok: true, purchases: [] }),
  })) as never
  render(<BuyCredits onBalanceChanged={() => {}} trigger={false} />)
  expect(screen.queryByRole('button', { name: 'קניית קרדיטים' })).toBeNull()
  await act(async () => { openBuyCredits() })
  const dialog = await screen.findByRole('dialog', { name: 'קניית קרדיטים' })
  expect(dialog.parentElement?.parentElement).toBe(document.body)
  fireEvent.click(screen.getByRole('button', { name: 'סגירה' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('header credits chip shows the exact remaining balance and opens the purchase dialog', () => {
  mockAuth = { ...base, user: { id: 'u' }, profile: { role: 'user', billing_exempt: false }, creditBalance: 48, hasPurchased: true }
  render(<CreditsChip />)
  const chip = screen.getByTestId('credits-chip')
  expect(chip).toHaveTextContent('48')
  const buy = jest.fn()
  window.addEventListener(BUY_CREDITS_EVENT, buy)
  fireEvent.click(chip)
  expect(buy).toHaveBeenCalled()
  window.removeEventListener(BUY_CREDITS_EVENT, buy)
})

test('header credits chip is hidden for exempt developers and signed-out visitors', () => {
  mockAuth = { ...base, user: { id: 'd' }, profile: { role: 'developer', billing_exempt: true }, creditBalance: 0, hasPurchased: false }
  const { container } = render(<CreditsChip />)
  expect(container).toBeEmptyDOMElement()
  mockAuth = { ...base, user: null, profile: null, creditBalance: null, hasPurchased: null }
  const second = render(<CreditsChip />)
  expect(second.container).toBeEmptyDOMElement()
})

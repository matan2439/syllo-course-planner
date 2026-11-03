import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleProvider, LOCALE_STORAGE_KEY, useLocale, useLocaleSyncStatus } from './LocaleProvider'
import LanguageSwitcher from './LanguageSwitcher'
import AccountButton from '../auth/AccountButton'

let mockAuth = { loading: false, enabled: false, user: null as { id: string; email: string } | null }
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => mockAuth }))
jest.mock('../billing/BuyCredits', () => ({ __esModule: true, default: () => null }))

function Probe() {
  const { locale, dir, t } = useLocale()
  const status = useLocaleSyncStatus()
  return <span data-testid="locale">{locale}|{dir}|{t('תכנון', 'Planning')}|{status}</span>
}

function response(locale: 'he' | 'en', revision = 1) {
  return { ok: true, status: 200, json: async () => ({ ok: true, revision, data: { locale } }) } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const originalFetch = global.fetch
beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = 'he'
  document.documentElement.dir = 'rtl'
  mockAuth = { loading: false, enabled: false, user: null }
  global.fetch = jest.fn(async () => response('he'))
})
afterAll(() => { global.fetch = originalFetch })

test('consumers without a provider retain Hebrew defaults', () => {
  render(<Probe />)
  expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|device')
})

test('stored English choice updates content and the document direction', () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning|device')
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  expect(document.documentElement).toHaveAttribute('dir', 'ltr')
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
})

test('switching language persists immediately and survives a provider remount', () => {
  const app = render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning')
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  app.unmount()
  render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning')
  fireEvent.click(screen.getByRole('button', { name: 'עברית' }))
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
})

test('profile language buttons remain reachable when authentication is unconfigured', () => {
  render(<LocaleProvider><AccountButton /><Probe /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'הפרופיל שלי' }))
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('dialog', { name: 'My profile' })).toBeInTheDocument()
  expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning')
})

test('account hydration takes the account preference without uploading a guest cache', async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  const requests: Array<RequestInit | undefined> = []
  global.fetch = jest.fn(async (_url, options) => { requests.push(options); return response('he', 4) })
  render(<LocaleProvider><Probe /></LocaleProvider>)
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|synced'))
  expect(requests.filter((request) => request?.method === 'POST')).toEqual([])
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
})

test('an explicit choice made during hydration wins and uses the loaded revision', async () => {
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  const load = deferred<Response>()
  const writes: unknown[] = []
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return response('en', 8) }
    return load.promise
  })
  render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning')
  await act(async () => { load.resolve(response('he', 7)) })
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning|synced'))
  expect(writes).toEqual([{ scope: 'preferences', expected_revision: 7, data: { locale: 'en' } }])
})

test('a delayed previous-account load cannot overwrite the next account or upload its cached locale', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  const writes: unknown[] = []
  let reads = 0
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return response('en', 2) }
    return ++reads === 1 ? first.promise : second.promise
  })
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  const app = render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  mockAuth = { ...mockAuth, user: { id: 'owner-b', email: 'b@example.com' } }
  app.rerender(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  await act(async () => { second.resolve(response('he', 6)); first.resolve(response('en', 4)) })
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|synced'))
  expect(writes).toEqual([])
  expect(document.documentElement).toHaveAttribute('lang', 'he')
})

test('a previous-account save completion cannot change the next account preference', async () => {
  const save = deferred<Response>()
  let reads = 0
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'POST') return save.promise
    return ++reads === 1 ? response('he', 1) : response('he', 9)
  })
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  const app = render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('synced'))
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  mockAuth = { ...mockAuth, user: { id: 'owner-b', email: 'b@example.com' } }
  app.rerender(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  await act(async () => { save.resolve(response('en', 2)) })
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|synced'))
})

test('a language callback retained by the previous account cannot alter the next account', async () => {
  let previousChoice: ReturnType<typeof useLocale>['setLocale'] | undefined
  function Capture() {
    const { setLocale } = useLocale()
    previousChoice ??= setLocale
    return <Probe />
  }
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  const app = render(<LocaleProvider><Capture /></LocaleProvider>)
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('synced'))
  mockAuth = { ...mockAuth, user: { id: 'owner-b', email: 'b@example.com' } }
  app.rerender(<LocaleProvider><Capture /></LocaleProvider>)
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|synced'))
  act(() => previousChoice!('en'))
  expect(screen.getByTestId('locale')).toHaveTextContent('he|rtl|תכנון|synced')
})

test('an unavailable preferences API keeps the chosen language and reports device-only storage', async () => {
  mockAuth = { loading: false, enabled: true, user: { id: 'owner-a', email: 'a@example.com' } }
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as Response)
  render(<LocaleProvider><Probe /><LanguageSwitcher /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en|ltr|Planning|error'))
  expect(screen.getByRole('status')).toHaveTextContent('saved on this device')
  expect(screen.getByRole('status')).not.toHaveTextContent('Saved to your account')
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthProvider } from './AuthProvider'
import AccountButton from './AccountButton'
import { reconcileProfile, type Profile } from './profile-repository'
import { CURRENT_DEGREE_YEAR_KEY, useCurrentDegreeYear } from '../planner/hooks/use-current-degree-year'
import { LAST_PROGRAM_KEY } from '../shell/last-program'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'student@tau.ac.il' }
const baseProfile = (over: Partial<Profile> = {}): Profile => ({
  id: USER.id, email: USER.email, role: 'user', billing_exempt: false, program_id: null, current_degree_year: null,
  created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z', ...over,
})

/** A fake Supabase: cookie session + a `profiles` table that only ever serves the queried id (RLS stand-in). */
function fakeSupabase({
  session = null as null | { user: typeof USER }, profile = null as Profile | null, balance = null as number | null,
} = {}) {
  let listener: (event: string, s: unknown) => void = () => {}
  const db = { profile, balance }
  const updates: Array<Record<string, unknown>> = []
  const client = {
    auth: {
      getSession: jest.fn(async () => ({ data: { session } })),
      onAuthStateChange: jest.fn((cb: typeof listener) => {
        listener = cb
        return { data: { subscription: { unsubscribe: jest.fn() } } }
      }),
      signInWithPassword: jest.fn(async ({ password }: { password: string }) => {
        if (password !== 'correct-horse') return { error: { message: 'Invalid login credentials' } }
        listener('SIGNED_IN', { user: USER })
        return { error: null }
      }),
      signUp: jest.fn(async () => ({ data: { session: null }, error: null })),
      signInWithOAuth: jest.fn(async () => ({ error: null })),
      signOut: jest.fn(async () => { listener('SIGNED_OUT', null); return { error: null } }),
    },
    rpc: jest.fn(async (fn: string) => {
      if (fn !== 'delete_my_account') return { error: { message: 'unknown function' } }
      db.profile = null
      return { error: null }
    }),
    from: jest.fn((table: string) => {
      let id: string | undefined
      let patch: Record<string, unknown> = {}
      const q = {
        select: () => q,
        eq: (_column: string, value: string) => { id = value; return q },
        update: (p: Record<string, unknown>) => { patch = p; return q },
        maybeSingle: async () => table === 'credit_accounts'
          ? { data: id === USER.id && db.balance != null ? { balance: db.balance } : null, error: null }
          : { data: db.profile?.id === id ? db.profile : null, error: null },
        single: async () => {
          updates.push(patch)
          db.profile = { ...db.profile!, ...patch } as Profile
          return { data: db.profile, error: null }
        },
      }
      return q
    }),
  }
  return { client: client as unknown as SupabaseClient, raw: client, db, updates }
}

function YearProbe() {
  const [year, setYear] = useCurrentDegreeYear()
  return (
    <div>
      <span data-testid="year">{year ?? 'none'}</span>
      <button type="button" onClick={() => setYear(4)}>year-4</button>
    </div>
  )
}

const renderApp = (client: SupabaseClient | null) =>
  render(<AuthProvider client={client}><AccountButton /><YearProbe /></AuthProvider>)

beforeEach(() => localStorage.clear())

describe('signed out', () => {
  test('auth not configured: no account UI, degree year stays device-local', async () => {
    localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, '2')
    renderApp(null)
    expect(screen.queryByRole('button', { name: 'התחברות' })).toBeNull()
    expect(await screen.findByTestId('year')).toHaveTextContent('2')
    fireEvent.click(screen.getByText('year-4'))
    expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('4')
  })

  test('configured but no session: sign-in entry point, nothing written to the server', async () => {
    const { client, raw } = fakeSupabase()
    localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, '1')
    renderApp(client)
    expect(await screen.findByRole('button', { name: 'התחברות' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('year-4'))
    expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('4')
    expect(raw.from).not.toHaveBeenCalled()
  })

  test('wrong password shows a Hebrew error; correct password signs in', async () => {
    const { client } = fakeSupabase({ profile: baseProfile() })
    renderApp(client)
    fireEvent.click(await screen.findByRole('button', { name: 'התחברות' }))
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: USER.email } })
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong-pass' } })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(await screen.findByRole('status')).toHaveTextContent('אימייל או סיסמה שגויים')
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'correct-horse' } })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(await screen.findByRole('button', { name: 'החשבון שלי' })).toBeInTheDocument()
  })
})

describe('signed in', () => {
  test('session restoration: an existing session is picked up on load', async () => {
    const { client } = fakeSupabase({ session: { user: USER }, profile: baseProfile() })
    renderApp(client)
    fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
    expect(screen.getByText(USER.email)).toBeInTheDocument()
  })

  test('authenticated profile loading: the account value wins and refreshes the device cache', async () => {
    localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, '1')
    localStorage.setItem(LAST_PROGRAM_KEY, 'device_program')
    const { client, updates } = fakeSupabase({
      session: { user: USER }, profile: baseProfile({ current_degree_year: 3, program_id: 'account_program' }),
    })
    renderApp(client)
    await waitFor(() => expect(screen.getByTestId('year')).toHaveTextContent('3'))
    expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('3')
    expect(localStorage.getItem(LAST_PROGRAM_KEY)).toBe('account_program')
    expect(updates).toEqual([])
  })

  test('local → server migration: an empty account adopts this device\'s values', async () => {
    localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, '2')
    localStorage.setItem(LAST_PROGRAM_KEY, 'device_program')
    const { client, db, updates } = fakeSupabase({ session: { user: USER }, profile: baseProfile() })
    renderApp(client)
    await waitFor(() => expect(updates).toEqual([{ program_id: 'device_program', current_degree_year: 2 }]))
    expect(db.profile).toEqual(expect.objectContaining({ program_id: 'device_program', current_degree_year: 2 }))
    expect(screen.getByTestId('year')).toHaveTextContent('2')
  })

  test('currentDegreeYear persistence: a change is saved to the account', async () => {
    const { client, db, updates } = fakeSupabase({ session: { user: USER }, profile: baseProfile({ current_degree_year: 3 }) })
    renderApp(client)
    await waitFor(() => expect(screen.getByTestId('year')).toHaveTextContent('3'))
    await act(async () => { fireEvent.click(screen.getByText('year-4')) })
    expect(updates).toContainEqual({ current_degree_year: 4 })
    expect(db.profile?.current_degree_year).toBe(4)
    expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('4')
  })

  test('role comes from the server profile row, not from the email', async () => {
    const { client } = fakeSupabase({ session: { user: USER }, profile: baseProfile({ role: 'developer' }) })
    renderApp(client)
    fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
    expect(await screen.findByText('מפתח')).toBeInTheDocument()
  })

  test('shows the Syllo Credits balance; exempt accounts show no charge', async () => {
    const { client, db } = fakeSupabase({ session: { user: USER }, profile: baseProfile(), balance: 42 })
    const { unmount } = renderApp(client)
    fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
    await waitFor(() => expect(screen.getByTestId('credit-balance')).toHaveTextContent(/קרדיטים של Syllo\s*42$/))
    // Credits change on the server (admin grant, another device) → reopening shows the new value.
    fireEvent.click(screen.getByRole('button', { name: 'החשבון שלי' }))
    db.balance = 542
    fireEvent.click(screen.getByRole('button', { name: 'החשבון שלי' }))
    await waitFor(() => expect(screen.getByTestId('credit-balance')).toHaveTextContent(/Syllo\s*542$/))
    unmount()

    const exempt = fakeSupabase({ session: { user: USER }, profile: baseProfile({ role: 'developer', billing_exempt: true }), balance: 0 })
    renderApp(exempt.client)
    fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
    await waitFor(() => expect(screen.getByTestId('credit-balance')).toHaveTextContent('ללא חיוב'))
  })

  test('sign-out returns to the signed-out UI and keeps the device cache', async () => {
    const { client, raw } = fakeSupabase({ session: { user: USER }, profile: baseProfile({ current_degree_year: 3 }) })
    renderApp(client)
    fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
    await waitFor(() => expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('3'))
    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }))
    expect(await screen.findByRole('button', { name: 'התחברות' })).toBeInTheDocument()
    expect(raw.auth.signOut).toHaveBeenCalled()
    expect(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY)).toBe('3')
  })
})

test('account deletion asks for confirmation, calls delete_my_account, then signs out', async () => {
  const { client, raw, db } = fakeSupabase({ session: { user: USER }, profile: baseProfile() })
  renderApp(client)
  fireEvent.click(await screen.findByRole('button', { name: 'החשבון שלי' }))
  fireEvent.click(screen.getByRole('button', { name: 'מחיקת חשבון' }))
  expect(raw.rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'מחיקה לצמיתות' }))
  expect(await screen.findByRole('button', { name: 'התחברות' })).toBeInTheDocument()
  expect(raw.rpc).toHaveBeenCalledWith('delete_my_account')
  expect(db.profile).toBeNull()
})

test('reconcileProfile is per field and deterministic', () => {
  expect(reconcileProfile(baseProfile({ current_degree_year: 3 }), { program_id: 'p', current_degree_year: 1 }))
    .toEqual({ upload: { program_id: 'p' }, cache: { program_id: 'p', current_degree_year: 3 } })
  expect(reconcileProfile(baseProfile({ program_id: 'a' }), { program_id: null, current_degree_year: null }))
    .toEqual({ upload: {}, cache: { program_id: 'a', current_degree_year: null } })
})

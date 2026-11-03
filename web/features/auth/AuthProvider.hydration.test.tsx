import { act } from '@testing-library/react'
import { useEffect } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'
import { getBrowserSupabase } from './supabase-client'

// Select Node's server renderer explicitly; jsdom otherwise resolves the browser
// streaming renderer, whose TextEncoder dependency is absent in this test runtime.
const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server')

jest.mock('./supabase-client', () => ({ getBrowserSupabase: jest.fn() }))
jest.mock('./profile-repository', () => ({
  fetchCreditBalance: jest.fn(async () => null), fetchHasPurchased: jest.fn(async () => false),
  fetchProfile: jest.fn(async () => null), readLocalProfile: jest.fn(),
}))

const browserClient = jest.mocked(getBrowserSupabase)
const owner = { id: 'owner-a', email: 'student@example.test' }

function deferredClient() {
  let resolveSession!: (value: { data: { session: { user: typeof owner } | null } }) => void
  const session = new Promise<{ data: { session: { user: typeof owner } | null } }>((resolve) => { resolveSession = resolve })
  const unsubscribe = jest.fn()
  const getSession = jest.fn(() => session)
  const client = { auth: {
    getSession,
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe } } })),
  } } as unknown as SupabaseClient
  return { client, getSession, resolveSession, unsubscribe }
}

let mountedOwners: string[]
function OwnerTools({ id }: { id: string }) {
  useEffect(() => { mountedOwners.push(id) }, [id])
  return <section data-testid="owner-tools">{id}</section>
}

// The real workspace gates its saved-plan controls on !loading before the board.
function WorkspaceGate() {
  const { loading, user } = useAuth()
  return <main data-auth={loading ? 'pending' : 'ready'}>
    {!loading && <OwnerTools id={user?.id ?? 'guest'} />}
    <div data-testid="board">Semester board</div>
  </main>
}

let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  browserClient.mockReset()
  mountedOwners = []
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container.remove()
})

test('hydrates the configured default client without a guest tools render before session restoration', async () => {
  const deferred = deferredClient()
  let server = true
  browserClient.mockImplementation(() => server ? null : deferred.client)
  const app = <AuthProvider><WorkspaceGate /></AuthProvider>
  container.innerHTML = renderToString(app)
  expect(container.querySelector('main')).toHaveAttribute('data-auth', 'pending')
  expect(browserClient).not.toHaveBeenCalled()
  server = false
  const recoverable = jest.fn()
  await act(async () => { root = hydrateRoot(container, app, { onRecoverableError: recoverable }) })
  expect(deferred.getSession).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[data-testid="owner-tools"]')).toBeNull()
  expect(mountedOwners).toEqual([])
  await act(async () => { deferred.resolveSession({ data: { session: { user: owner } } }) })
  expect(container.querySelector('[data-testid="owner-tools"]')).toHaveTextContent(owner.id)
  expect(mountedOwners).toEqual([owner.id])
  expect(recoverable).not.toHaveBeenCalled()
})

test('hydrates the unconfigured default client and then releases the guest workspace', async () => {
  browserClient.mockReturnValue(null)
  const app = <AuthProvider><WorkspaceGate /></AuthProvider>
  container.innerHTML = renderToString(app)
  expect(container.querySelector('main')).toHaveAttribute('data-auth', 'pending')
  const recoverable = jest.fn()
  await act(async () => { root = hydrateRoot(container, app, { onRecoverableError: recoverable }) })
  expect(container.querySelector('[data-testid="owner-tools"]')).toHaveTextContent('guest')
  expect(mountedOwners).toEqual(['guest'])
  expect(recoverable).not.toHaveBeenCalled()
})

test('uses explicit injected clients without resolving the default browser client', async () => {
  const app = <AuthProvider client={null}><WorkspaceGate /></AuthProvider>
  container.innerHTML = renderToString(app)
  expect(container.querySelector('main')).toHaveAttribute('data-auth', 'ready')
  const recoverable = jest.fn()
  await act(async () => { root = hydrateRoot(container, app, { onRecoverableError: recoverable }) })
  expect(browserClient).not.toHaveBeenCalled()
  expect(container.querySelector('[data-testid="owner-tools"]')).toHaveTextContent('guest')
  expect(recoverable).not.toHaveBeenCalled()
})

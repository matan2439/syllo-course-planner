'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBrowserSupabase } from './supabase-client'
import {
  fetchProfile, readLocalProfile, reconcileProfile, saveProfile, writeLocalProfile,
  type Profile, type ProfilePatch,
} from './profile-repository'

export interface AuthUser { id: string; email: string | null }
/** `null` = success; otherwise a Hebrew message safe to show. */
type AuthResult = Promise<string | null>

export interface AuthState {
  /** False when Supabase is not configured: no account UI, the planner works as before. */
  enabled: boolean
  loading: boolean
  user: AuthUser | null
  /** The signed-in student's profile, once loaded and reconciled with this device. */
  profile: Profile | null
  signIn(email: string, password: string): AuthResult
  signUp(email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }>
  signInWithGoogle(): AuthResult
  signOut(): Promise<void>
  /** Signed in: persists to the account. Signed out: no-op (callers keep their local cache). */
  updateProfile(patch: ProfilePatch): Promise<void>
}

const signedOut: AuthState = {
  enabled: false, loading: false, user: null, profile: null,
  signIn: async () => null,
  signUp: async () => ({ error: null, needsConfirmation: false }),
  signInWithGoogle: async () => null,
  signOut: async () => {},
  updateProfile: async () => {},
}

const AuthContext = createContext<AuthState>(signedOut)
export const useAuth = () => useContext(AuthContext)

function hebrewAuthError(error: { message?: string } | null | undefined): string | null {
  if (!error) return null
  const message = error.message ?? ''
  if (/invalid login credentials/i.test(message)) return 'אימייל או סיסמה שגויים.'
  if (/email not confirmed/i.test(message)) return 'יש לאשר את כתובת האימייל (בדקו את תיבת הדואר).'
  if (/already registered/i.test(message)) return 'כתובת האימייל כבר רשומה. נסו להתחבר.'
  if (/password/i.test(message)) return 'הסיסמה חייבת להכיל לפחות 6 תווים.'
  return 'הפעולה נכשלה. נסו שוב.'
}

export function AuthProvider({ children, client = getBrowserSupabase() }: {
  children: ReactNode
  /** Injected in tests; defaults to the configured browser client (or null → auth off). */
  client?: SupabaseClient | null
}) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(client != null)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Session restoration (cookie) + live sign-in/out events.
  useEffect(() => {
    if (!client) return
    let live = true
    const toUser = (u: { id: string; email?: string } | null | undefined): AuthUser | null =>
      u ? { id: u.id, email: u.email ?? null } : null
    client.auth.getSession().then(({ data }) => {
      if (!live) return
      setUser(toUser(data.session?.user))
      setLoading(false)
    }, () => live && setLoading(false))
    const { data } = client.auth.onAuthStateChange((_event, session) => setUser(toUser(session?.user)))
    return () => { live = false; data.subscription.unsubscribe() }
  }, [client])

  // Load the account profile and reconcile it with this device (see reconcileProfile).
  const userId = user?.id ?? null
  useEffect(() => {
    setProfile(null)
    if (!client || !userId) return
    let live = true
    ;(async () => {
      const server = await fetchProfile(client, userId)
      if (!server || !live) return
      const { upload, cache } = reconcileProfile(server, readLocalProfile())
      writeLocalProfile(cache)
      const next = Object.keys(upload).length > 0 ? await saveProfile(client, userId, upload) : server
      if (live) setProfile(next)
    })().catch(() => console.error('[auth] profile sync failed; keeping the device copy'))
    return () => { live = false }
  }, [client, userId])

  const updateProfile = useCallback(async (patch: ProfilePatch) => {
    if (!client || !userId) return
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
    try {
      setProfile(await saveProfile(client, userId, patch))
    } catch {
      console.error('[auth] profile update failed; kept on this device')
    }
  }, [client, userId])

  const value = useMemo<AuthState>(() => {
    if (!client) return signedOut
    return {
      enabled: true, loading, user, profile, updateProfile,
      signIn: async (email, password) =>
        hebrewAuthError((await client.auth.signInWithPassword({ email, password })).error),
      signUp: async (email, password) => {
        const { data, error } = await client.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname },
        })
        return { error: hebrewAuthError(error), needsConfirmation: !error && !data.session }
      },
      signInWithGoogle: async () =>
        hebrewAuthError((await client.auth.signInWithOAuth({
          provider: 'google', options: { redirectTo: window.location.href },
        })).error),
      signOut: async () => { await client.auth.signOut() },
    }
  }, [client, loading, user, profile, updateProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

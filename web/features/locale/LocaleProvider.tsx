'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'

export type Locale = 'he' | 'en'
export type LocaleSyncStatus = 'device' | 'loading' | 'saving' | 'synced' | 'error'
export const LOCALE_STORAGE_KEY = 'tau_locale'
const PREFERENCES_URL = '/api/ai/student-workspace?scope=preferences'

interface LocaleContextValue {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale(locale: Locale): void
  t(he: string, en: string): string
}

const LocaleContext = createContext<LocaleContextValue>({ locale: 'he', dir: 'rtl', setLocale: () => {}, t: (he) => he })
const SyncContext = createContext<LocaleSyncStatus>('device')
export const useLocale = () => useContext(LocaleContext)
export const useLocaleSyncStatus = () => useContext(SyncContext)

function cacheKey(owner: string | null) {
  return owner ? `${LOCALE_STORAGE_KEY}:account:${encodeURIComponent(owner)}` : LOCALE_STORAGE_KEY
}

function readLocale(owner: string | null): Locale {
  try { return localStorage.getItem(cacheKey(owner)) === 'en' ? 'en' : 'he' } catch { return 'he' }
}

function cacheLocale(owner: string | null, locale: Locale) {
  try { localStorage.setItem(cacheKey(owner), locale) } catch { /* Storage may be unavailable in private browsing. */ }
}

async function parsePreferences(response: Response): Promise<{ revision: number; locale: Locale }> {
  if (!response.ok) throw new Error('preferences unavailable')
  const body = await response.json()
  if (body?.ok !== true || !Number.isSafeInteger(body.revision) || body.revision < 0 || !['he', 'en'].includes(body.data?.locale)) {
    throw new Error('invalid preferences response')
  }
  return { revision: body.revision, locale: body.data.locale }
}

type Session = { owner: string; change(locale: Locale): void }

/** Local choices apply immediately; only explicit changes are uploaded to the current account. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const owner = user?.id ?? null
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const sessionRef = useRef<Session | null>(null)
  const [locale, setCurrentLocale] = useState<Locale>('he')
  const [status, setStatus] = useState<LocaleSyncStatus>('device')

  useEffect(() => {
    // Account caches are deliberately separate from the guest choice and from each other.
    setCurrentLocale(readLocale(owner))
    sessionRef.current = null
    if (!owner || loading) {
      setStatus('device')
      return
    }
    let live = true
    let revision: number | null = null
    let pending: Locale | null = null
    let version = 0
    let saving = false
    const abort = new AbortController()
    const current = () => live && ownerRef.current === owner && sessionRef.current === session
    const flush = async () => {
      if (!current() || saving || revision == null || pending == null) return
      saving = true
      try {
        while (current() && pending != null) {
          const next: Locale = pending
          const sentVersion = version
          pending = null
          setStatus('saving')
          const saved = await parsePreferences(await fetch(PREFERENCES_URL, {
            method: 'POST', credentials: 'same-origin', signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: 'preferences', expected_revision: revision, data: { locale: next } }),
          }))
          if (!current()) return
          if (saved.locale !== next) throw new Error('preference was not saved')
          revision = saved.revision
          // A response to an earlier click must not undo a newer choice.
          if (sentVersion === version) setStatus('synced')
        }
      } catch {
        if (current()) setStatus('error')
      } finally { saving = false }
    }
    const session: Session = {
      owner,
      change(next) {
        pending = next
        version += 1
        if (revision != null) void flush()
      },
    }
    sessionRef.current = session
    setStatus('loading')
    void (async () => {
      try {
        const loaded = await parsePreferences(await fetch(PREFERENCES_URL, { credentials: 'same-origin', signal: abort.signal }))
        if (!current()) return
        revision = loaded.revision
        if (pending == null) {
          setCurrentLocale(loaded.locale)
          cacheLocale(owner, loaded.locale)
          setStatus('synced')
        } else {
          await flush()
        }
      } catch {
        if (current()) setStatus('error')
      }
    })()
    return () => {
      live = false
      abort.abort()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [owner, loading])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr'
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (ownerRef.current !== owner || (next !== 'he' && next !== 'en')) return
    setCurrentLocale(next)
    cacheLocale(owner, next)
    const session = sessionRef.current
    if (owner && session?.owner === owner) session.change(next)
  }, [owner])
  const value = useMemo<LocaleContextValue>(() => ({
    locale, dir: locale === 'he' ? 'rtl' : 'ltr', setLocale, t: (he, en) => locale === 'he' ? he : en,
  }), [locale, setLocale])

  return <LocaleContext.Provider value={value}><SyncContext.Provider value={status}>{children}</SyncContext.Provider></LocaleContext.Provider>
}

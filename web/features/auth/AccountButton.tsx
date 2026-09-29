'use client'

import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'

const CHIP =
  'rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]'
const FIELD =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]'
const PRIMARY =
  'flex-1 rounded-lg bg-[var(--purple-strong)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--purple)] disabled:opacity-60'
const SECONDARY =
  'flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:border-[var(--purple)]/50 disabled:opacity-60'

/**
 * Header account entry point. Accounts are for persistence only: the planner works
 * signed out exactly as before, and this renders nothing when auth is not configured.
 */
export default function AccountButton() {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!auth.enabled || auth.loading) return null

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setMessage(null)
    const error = await action()
    setBusy(false)
    if (error) setMessage(error)
    else setOpen(false)
  }
  const signIn = (event: FormEvent) => {
    event.preventDefault()
    void run(() => auth.signIn(email, password))
  }
  const signUp = async () => {
    setBusy(true)
    setMessage(null)
    const { error, needsConfirmation } = await auth.signUp(email, password)
    setBusy(false)
    if (error) setMessage(error)
    else if (needsConfirmation) setMessage('שלחנו אליך מייל לאישור החשבון.')
    else setOpen(false)
  }

  const user = auth.user
  return (
    <div className="relative">
      <button type="button" className={CHIP} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {user ? 'החשבון שלי' : 'התחברות'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={user ? 'החשבון שלי' : 'התחברות לחשבון'}
          className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm shadow-[var(--shadow-premium)]"
        >
          {user ? (
            <div className="space-y-3">
              <p className="break-all text-[var(--text)]">{user.email}</p>
              {auth.profile?.role === 'developer' && (
                <span className="inline-block rounded-full bg-[var(--purple)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--purple)]">מפתח</span>
              )}
              <p className="text-xs text-[var(--text-muted)]">הפרופיל והתוכנית שלך נשמרים בחשבון.</p>
              <button type="button" className={SECONDARY + ' w-full'} onClick={() => { void auth.signOut(); setOpen(false) }}>
                התנתקות
              </button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={signIn}>
              <p className="text-xs text-[var(--text-muted)]">התחברו כדי לשמור את הפרופיל והתוכנית בין מכשירים.</p>
              <label className="block space-y-1">
                <span className="text-xs text-[var(--text-muted)]">אימייל</span>
                <input className={FIELD} type="email" autoComplete="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-[var(--text-muted)]">סיסמה</span>
                <input className={FIELD} type="password" autoComplete="current-password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className={PRIMARY} disabled={busy}>התחברות</button>
                <button type="button" className={SECONDARY} disabled={busy || !email || password.length < 6} onClick={() => void signUp()}>הרשמה</button>
              </div>
              <button type="button" className={SECONDARY + ' w-full'} disabled={busy} onClick={() => void run(auth.signInWithGoogle)}>
                המשך עם Google
              </button>
              {message && <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  )
}

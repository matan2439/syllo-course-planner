'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import BuyCredits from '../billing/BuyCredits'

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
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      {user ? (
        <button
          type="button"
          className={CHIP + ' flex h-[30px] w-[30px] items-center justify-center !px-0 !py-0'}
          aria-expanded={open}
          aria-label="החשבון שלי"
          title={user.email ?? 'החשבון שלי'}
          onClick={() => { if (!open) auth.refreshCreditBalance(); setOpen((v) => !v) }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </svg>
        </button>
      ) : (
        <button type="button" className={CHIP} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          התחברות
        </button>
      )}
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
              {(auth.profile?.billing_exempt || auth.creditBalance != null) && (
                <div
                  data-testid="credit-balance"
                  className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--purple)_45%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--purple)_22%,transparent),color-mix(in_srgb,var(--purple)_6%,transparent))] p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--purple-strong)] text-white shadow-sm" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z" />
                      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-muted)]">קרדיטים של <bdi>Syllo</bdi></p>
                    <p className="text-xl font-bold leading-tight text-[var(--text)]">
                      {auth.profile?.billing_exempt ? 'ללא חיוב' : auth.creditBalance?.toLocaleString('he-IL')}
                    </p>
                  </div>
                </div>
              )}
              {!auth.profile?.billing_exempt && <BuyCredits onBalanceChanged={auth.refreshCreditBalance} />}
              <p className="text-xs text-[var(--text-muted)]">הפרופיל והתוכנית שלך נשמרים בחשבון.</p>
              <button type="button" className={SECONDARY + ' w-full'} onClick={() => { void auth.signOut(); setOpen(false) }}>
                התנתקות
              </button>
              {confirmDelete ? (
                <div className="space-y-2 rounded-lg border border-red-500/40 p-3">
                  <p className="text-xs text-[var(--text)]">למחוק את החשבון ואת כל נתוני התכנון שלו? אי אפשר לבטל את זה.</p>
                  <div className="flex gap-2">
                    <button type="button" className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" disabled={busy}
                      onClick={() => void run(async () => { const error = await auth.deleteAccount(); if (!error) setConfirmDelete(false); return error })}>
                      מחיקה לצמיתות
                    </button>
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirmDelete(false)}>ביטול</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="w-full text-xs text-[var(--text-muted)] underline hover:text-red-500" onClick={() => setConfirmDelete(true)}>
                  מחיקת חשבון
                </button>
              )}
              {message && <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>}
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
              <Link href="/privacy" className="block text-center text-xs text-[var(--text-muted)] underline hover:text-[var(--purple)]">מדיניות פרטיות</Link>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

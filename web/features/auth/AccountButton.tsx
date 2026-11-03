'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import BuyCredits from '../billing/BuyCredits'
import { OPEN_ACCOUNT_EVENT, openBuyCredits } from '../billing/ai_access'
import { useLocale } from '../locale/LocaleProvider'
import LanguageSwitcher from '../locale/LanguageSwitcher'
import { startTour } from '../tour/SiteTour'
import { Avatar } from './ProfileIdentityCard'
import { useProfileIdentity } from './profile-identity'

const CHIP =
  'rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:border-[var(--purple)]/50 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]'
const FIELD =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]'
const PRIMARY =
  'flex-1 rounded-lg bg-[var(--purple-strong)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--purple)] disabled:opacity-60'
const SECONDARY =
  'flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:border-[var(--purple)]/50 disabled:opacity-60'
const AUTH_ERRORS_EN: Record<string, string> = {
  'אימייל או סיסמה שגויים.': 'Incorrect email or password.',
  'יש לאשר את כתובת האימייל (בדקו את תיבת הדואר).': 'Confirm your email address by opening the link in your inbox.',
  'כתובת האימייל כבר רשומה. נסו להתחבר.': 'This email is already registered. Try signing in.',
  'הסיסמה חייבת להכיל לפחות 6 תווים.': 'Your password must contain at least 6 characters.',
  'מחיקת החשבון נכשלה. נסו שוב.': 'Could not delete the account. Try again.',
  'כבר שלחנו מייל אישור לכתובת הזו. אשרו את החשבון דרך הקישור במייל (בדקו גם בספאם) ואז התחברו. שליחה חוזרת אפשרית בעוד כדקה.': 'We already sent a confirmation email. Open its link (check spam too), then sign in. You can request another email in about a minute.',
  'אם קיים חשבון לכתובת הזו, נשלח אליה קישור לאיפוס הסיסמה. בדקו גם בתיקיית הספאם.': 'If an account exists for this email, we sent it a password reset link. Check spam too.',
}

/** Fired by the header entry point; a page with its own profile panel (the planner) handles it by
 *  calling preventDefault() and opening that panel, so there is exactly one profile surface per page. */
export const OPEN_PROFILE_EVENT = 'syllo:open-profile'
/** True when a page panel took over (no header popover needed). */
export function requestProfilePanel(): boolean {
  return typeof window !== 'undefined' && !window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT, { cancelable: true }))
}

/** Account, credits, language and sign-in — the one account surface, rendered in the header popover or the planner's profile panel. */
export function AccountPanel({ onDone = () => undefined, showTour = false }: { onDone?: () => void; showTour?: boolean }) {
  const auth = useAuth()
  const { locale, dir, t } = useLocale()
  const accountAvailable = auth.enabled && !auth.loading
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null)

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setMessage(null)
    const error = await action()
    setBusy(false)
    if (error) setMessage(error)
    else onDone()
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
    else if (needsConfirmation) setConfirmSentTo(email)
    else onDone()
  }
  const requestPasswordReset = async () => {
    setBusy(true)
    setMessage(null)
    const error = await auth.requestPasswordReset(email)
    setBusy(false)
    setMessage(error ?? 'אם קיים חשבון לכתובת הזו, נשלח אליה קישור לאיפוס הסיסמה. בדקו גם בתיקיית הספאם.')
  }

  const user = auth.user
  const messageText = message ? t(message, AUTH_ERRORS_EN[message] ?? 'The action failed. Try again.') : null
  return (
    <div dir={dir}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><LanguageSwitcher />
      {showTour && <button type="button" className="text-xs text-[var(--text-muted)] underline hover:text-[var(--purple)]" onClick={() => { onDone(); startTour() }}>{t('סיור באתר', 'Site tour')}</button>}
    </div>
    {!accountAvailable ? <p className="text-xs text-[var(--text-muted)]">{t('אפשר לתכנן ולבחור שפה גם בלי להתחבר.', 'You can plan and choose a language without signing in.')}</p> : user ? (
      <div className="space-y-3">
        <p className="break-all text-[var(--text)]">{user.email}</p>
        {auth.profile?.role === 'developer' && (
          <span className="inline-block rounded-full bg-[var(--purple)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--purple)]">{t('מפתח', 'Developer')}</span>
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
              <p className="text-xs text-[var(--text-muted)]">{t('קרדיטים של ', '')}<bdi>Syllo</bdi>{t('', ' Credits')}</p>
              <p className="text-xl font-bold leading-tight text-[var(--text)]">
                {auth.profile?.billing_exempt ? t('ללא חיוב', 'No charge') : auth.creditBalance?.toLocaleString(locale === 'he' ? 'he-IL' : 'en-US')}
              </p>
            </div>
          </div>
        )}
        {!auth.profile?.billing_exempt && (
          <>
            <button type="button" className={PRIMARY + ' w-full'} onClick={() => { onDone(); openBuyCredits() }}>{t('קניית קרדיטים', 'Buy credits')}</button>
            <Link href="/refund-policy" className="block text-center text-xs text-[var(--text-muted)] underline hover:text-[var(--purple)]">{t('מדיניות החזרים ובקשת החזר', 'Refund policy and requests')}</Link>
          </>
        )}
        {/* Navigation only: the console's API re-checks role = 'developer' server-side. */}
        {auth.profile?.role === 'developer' && (
          <Link href="/admin/billing" className={SECONDARY + ' block w-full text-center'} onClick={() => onDone()}>{t('ניהול חיובים', 'Billing console')}</Link>
        )}
            <button type="button" className={SECONDARY + ' w-full'} onClick={() => { void auth.signOut(); onDone() }}>
          {t('התנתקות', 'Sign out')}
        </button>
        {confirmDelete ? (
          <div className="space-y-2 rounded-lg border border-red-500/40 p-3">
            <p className="text-xs text-[var(--text)]">{t('למחוק את החשבון ואת כל נתוני התכנון שלו? אי אפשר לבטל את זה.', 'Delete your account and all its planning data? This cannot be undone.')}</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" disabled={busy}
                onClick={() => void run(async () => { const error = await auth.deleteAccount(); if (!error) setConfirmDelete(false); return error })}>
                {t('מחיקה לצמיתות', 'Delete permanently')}
              </button>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirmDelete(false)}>{t('ביטול', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="w-full text-xs text-[var(--text-muted)] underline hover:text-red-500" onClick={() => setConfirmDelete(true)}>
            {t('מחיקת חשבון', 'Delete account')}
          </button>
        )}
        {messageText && <p role="status" className="text-xs text-[var(--text-muted)]">{messageText}</p>}
      </div>
    ) : confirmSentTo ? (
      <div data-testid="confirm-email-sent" className="space-y-3">
        <p className="text-base font-bold text-[var(--text)]">{t('בדקו את תיבת הדואר ✉️', 'Check your email ✉️')}</p>
        <p className="text-sm text-[var(--text)]">
          {t('שלחנו קישור לאישור החשבון אל ', 'We sent an account confirmation link to ')}<bdi className="font-semibold" dir="ltr">{confirmSentTo}</bdi>.
          {' '}{t('לחצו על הקישור במייל, ואז חזרו לכאן והתחברו.', 'Open the link in your email, then return here and sign in.')}
        </p>
        <p className="text-xs text-[var(--text-muted)]">{t('לא הגיע תוך כמה דקות? בדקו גם בספאם. אין צורך להירשם שוב.', 'No email after a few minutes? Check spam too. You do not need to sign up again.')}</p>
        <button type="button" className={PRIMARY + ' w-full'} onClick={() => { setConfirmSentTo(null); setMessage(null) }}>
          {t('אישרתי — להתחברות', 'Confirmed — sign in')}
        </button>
      </div>
    ) : (
      <form className="space-y-3" onSubmit={signIn}>
        <p className="text-xs text-[var(--text-muted)]">{t('התחברו כדי לשמור את הפרופיל והתוכנית בין מכשירים.', 'Sign in to keep your profile and plan across devices.')}</p>
        <label className="block space-y-1">
          <span className="text-xs text-[var(--text-muted)]">{t('אימייל', 'Email')}</span>
          <input className={FIELD} type="email" autoComplete="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-[var(--text-muted)]">{t('סיסמה', 'Password')}</span>
          <input className={FIELD} type="password" autoComplete="current-password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY} disabled={busy}>{t('התחברות', 'Sign in')}</button>
          <button type="button" className={SECONDARY} disabled={busy || !email || password.length < 6} onClick={() => void signUp()}>{t('הרשמה', 'Sign up')}</button>
        </div>
        <button type="button" className="w-full text-xs text-[var(--text-muted)] underline hover:text-[var(--purple)] disabled:opacity-60"
          disabled={busy || !email} onClick={() => void requestPasswordReset()}>{t('שכחתי סיסמה', 'Forgot password')}</button>
        <button type="button" className={SECONDARY + ' w-full'} disabled={busy} onClick={() => void run(auth.signInWithGoogle)}>
          {t('המשך עם Google', 'Continue with Google')}
        </button>
        {messageText && <p role="status" className="text-xs text-[var(--text-muted)]">{messageText}</p>}
        <Link href="/privacy" className="block text-center text-xs text-[var(--text-muted)] underline hover:text-[var(--purple)]">{t('מדיניות פרטיות', 'Privacy policy')}</Link>
      </form>
    )}
    </div>
  )
}

/**
 * Header account entry point. Accounts are for persistence only: the planner works
 * signed out. The profile entry also keeps language controls available without auth.
 */
export default function AccountButton() {
  const auth = useAuth()
  const { t, dir } = useLocale()
  const [open, setOpen] = useState(false)
  const user = auth.user
  const { identity } = useProfileIdentity()
  // AI panels ask the account menu to open (sign in to use paid AI).
  useEffect(() => {
    const onOpen = () => { if (!requestProfilePanel()) setOpen(true) }
    window.addEventListener(OPEN_ACCOUNT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_ACCOUNT_EVENT, onOpen)
  }, [])
  const accountAvailable = auth.enabled && !auth.loading
  const toggle = () => {
    if (open) { setOpen(false); return }
    if (auth.user) auth.refreshCreditBalance()
    if (!requestProfilePanel()) setOpen(true)
  }
  return (
    <div className="relative" data-tour="profile-button">
      {user ? (
        <button
          type="button"
          className={CHIP + ' flex h-[30px] w-[30px] items-center justify-center !px-0 !py-0'}
          aria-expanded={open}
          aria-label={t('החשבון שלי', 'My account')}
          title={user.email ?? t('החשבון שלי', 'My account')}
          onClick={toggle}
        >
          <Avatar src={identity.avatar_data_url} name={identity.display_name} size={28} />
        </button>
      ) : (
        <button type="button" className={CHIP} aria-expanded={open} onClick={toggle}>
          {accountAvailable ? t('התחברות', 'Sign in') : t('הפרופיל שלי', 'My profile')}
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label={user ? t('החשבון שלי', 'My account') : accountAvailable ? t('התחברות לחשבון', 'Sign in to your account') : t('הפרופיל שלי', 'My profile')}
          dir={dir}
          className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface-panel)] p-4 text-sm shadow-[var(--shadow-premium)]"
        >
          <AccountPanel onDone={() => setOpen(false)} />
        </div>
      )}
      {/* The purchase dialog lives outside the popover: closing the menu never kills a checkout. */}
      {user && !auth.profile?.billing_exempt && <BuyCredits onBalanceChanged={auth.refreshCreditBalance} trigger={false} />}
    </div>
  )
}

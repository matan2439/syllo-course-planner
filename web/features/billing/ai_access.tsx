'use client'

import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { CREDITS_PER_REPLY } from '../../../shared/billing/pricing'

/**
 * Client-side gate for paid AI panels. The server (api/ai/metering.ts) is the
 * authority and refuses anyway (401/402); this only stops the UI from offering
 * what it would refuse. Unknown state (auth off, loading, balance not loaded)
 * lets the request through so the server decides.
 */
export const BUY_CREDITS_EVENT = 'syllo:buy-credits'
export const OPEN_ACCOUNT_EVENT = 'syllo:open-account'
/** Open panels (course details, tools drawer) close so the account menu / purchase dialog is visible. */
export const CLOSE_PANELS_EVENT = 'syllo:close-panels'
const reveal = (event: string) => {
  window.dispatchEvent(new Event(CLOSE_PANELS_EVENT))
  window.dispatchEvent(new Event(event))
}
export const openBuyCredits = () => reveal(BUY_CREDITS_EVENT)
export const openAccount = () => reveal(OPEN_ACCOUNT_EVENT)

/** signed_out / never_purchased: first-time users → full paywall; no_credits: ran out → inline notice. */
export type AiAccess = 'ok' | 'signed_out' | 'never_purchased' | 'no_credits'

export function useAiAccess(): AiAccess {
  const auth = useAuth()
  if (!auth.enabled || auth.loading) return 'ok'
  if (!auth.user) return 'signed_out'
  if (auth.profile?.billing_exempt || auth.profile?.role === 'developer') return 'ok'
  if (auth.creditBalance !== 0) return 'ok'
  return auth.hasPurchased === false ? 'never_purchased' : 'no_credits'
}

const perReply = CREDITS_PER_REPLY === 1 ? 'קרדיט אחד' : `${CREDITS_PER_REPLY} קרדיטים`

const PAYWALL: Record<'signed_out' | 'never_purchased', { title: string; text: string; action: string; onClick: () => void }> = {
  signed_out: {
    title: 'העוזר החכם של Syllo',
    text: `תכנון תואר, בדיקת כללים ושאלות על קורסים בעזרת AI. התחברו כדי להתחיל. כל תשובה עולה ${perReply}.`,
    action: 'התחברות',
    onClick: openAccount,
  },
  never_purchased: {
    title: 'העוזר החכם של Syllo',
    text: `העוזר עובד עם קרדיטים: כל תשובה עולה ${perReply}. רוכשים חבילה פעם אחת, בלי מנוי, והקרדיטים זמינים מיד.`,
    action: 'קניית קרדיטים',
    onClick: openBuyCredits,
  },
}

/** First-time users see the panel blurred behind a short explanation; everyone else sees it as is. */
export function AiPaywall({ access, children }: { access: AiAccess; children: ReactNode }) {
  if (access !== 'signed_out' && access !== 'never_purchased') return <>{children}</>
  const copy = PAYWALL[access]
  return (
    // One grid cell for both layers: the area is at least as tall as the card, so the
    // card never overflows a short host (e.g. the chat at the bottom of a course panel).
    <div className="grid h-full min-h-0">
      <div aria-hidden="true" inert className="pointer-events-none min-h-0 select-none overflow-hidden blur-[3px] opacity-60 [grid-area:1/1]">{children}</div>
      <div className="flex items-center justify-center p-4 [grid-area:1/1]">
        <div data-testid="ai-paywall" role="region" aria-label={copy.title}
          className="w-full max-w-xs space-y-3 rounded-2xl border border-[var(--purple)]/40 bg-[var(--surface-panel)] p-5 text-center shadow-[var(--shadow-premium)]">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--purple-strong)] text-white" aria-hidden="true">✦</span>
          <p className="text-base font-bold text-[var(--text)]">{copy.title}</p>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{copy.text}</p>
          <button type="button" onClick={copy.onClick}
            className="w-full rounded-lg bg-[var(--purple-strong)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--purple)]">
            {copy.action}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Returning users who ran out of credits: the panel stays visible, with a top-up prompt. */
export function AiAccessNotice({ access }: { access: AiAccess }) {
  if (access !== 'no_credits') return null
  return (
    <div data-testid="ai-access-notice" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--purple)]/40 bg-[var(--purple)]/10 px-3 py-2 text-xs text-[var(--text)]">
      <span>{`נגמרו הקרדיטים. כל תשובה של העוזר החכם עולה ${perReply}.`}</span>
      <button type="button" onClick={openBuyCredits} className="rounded-full bg-[var(--purple-strong)] px-3 py-1 font-semibold text-white hover:bg-[var(--purple)]">
        קניית קרדיטים
      </button>
    </div>
  )
}

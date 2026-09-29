'use client'

import { useAuth } from '../auth/AuthProvider'

/**
 * Client-side gate for paid AI panels. The server (api/ai/metering.ts) is the
 * authority and refuses anyway (401/402); this only stops the UI from offering
 * what it would refuse. Unknown state (auth off, loading, balance not loaded)
 * lets the request through so the server decides.
 */
export const BUY_CREDITS_EVENT = 'syllo:buy-credits'
export const OPEN_ACCOUNT_EVENT = 'syllo:open-account'
export const openBuyCredits = () => window.dispatchEvent(new Event(BUY_CREDITS_EVENT))
export const openAccount = () => window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT))

export type AiAccess = 'ok' | 'signed_out' | 'no_credits'

export function useAiAccess(): AiAccess {
  const auth = useAuth()
  if (!auth.enabled || auth.loading) return 'ok'
  if (!auth.user) return 'signed_out'
  if (auth.profile?.billing_exempt || auth.profile?.role === 'developer') return 'ok'
  return auth.creditBalance === 0 ? 'no_credits' : 'ok'
}

const COPY: Record<Exclude<AiAccess, 'ok'>, { text: string; action: string; onClick: () => void }> = {
  signed_out: { text: 'העוזר החכם זמין למשתמשים מחוברים. כל תשובה עולה קרדיט אחד.', action: 'התחברות', onClick: openAccount },
  no_credits: { text: 'נגמרו הקרדיטים. כל תשובה של העוזר החכם עולה קרדיט אחד.', action: 'קניית קרדיטים', onClick: openBuyCredits },
}

export function AiAccessNotice({ access }: { access: AiAccess }) {
  if (access === 'ok') return null
  const copy = COPY[access]
  return (
    <div data-testid="ai-access-notice" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--purple)]/40 bg-[var(--purple)]/10 px-3 py-2 text-xs text-[var(--text)]">
      <span>{copy.text}</span>
      <button type="button" onClick={copy.onClick} className="rounded-full bg-[var(--purple-strong)] px-3 py-1 font-semibold text-white hover:bg-[var(--purple)]">
        {copy.action}
      </button>
    </div>
  )
}

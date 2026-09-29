'use client'

import { useAuth } from '../auth/AuthProvider'
import { openBuyCredits } from './ai_access'

/** Header chip with the remaining Syllo Credits; opens the purchase dialog. */
export default function CreditsChip() {
  const auth = useAuth()
  if (!auth.enabled || !auth.user || auth.profile?.billing_exempt || auth.creditBalance == null) return null
  const balance = auth.creditBalance
  return (
    <button
      type="button"
      data-testid="credits-chip"
      onClick={openBuyCredits}
      aria-label={`קרדיטים שנותרו: ${balance}. קניית קרדיטים`}
      title="קרדיטים שנותרו"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
        balance > 0
          ? 'border-[var(--purple)]/40 bg-[var(--purple)]/10 text-[var(--text)] hover:border-[var(--purple)]'
          : 'border-amber-500/50 bg-amber-500/10 text-amber-700 hover:border-amber-500 dark:text-amber-300'}`}
    >
      <span aria-hidden="true" className="text-[var(--purple)]">✦</span>
      {balance.toLocaleString('he-IL')}
    </button>
  )
}

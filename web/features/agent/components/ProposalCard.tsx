'use client'

/**
 * Reusable proposal card rendered inside the conversation after the agent submits a plan.
 * Displays the agent's structured summary (summary_he), unmet-request callout (tradeoffs_he),
 * and an action button to open the full proposal panel.
 */
import ChatText from './ChatText'
import type { ConversationProposal } from '../../../../shared/planner/conversation-wire'

export default function ProposalCard({
  proposal,
  onShowProposal,
}: {
  proposal: ConversationProposal
  onShowProposal?: () => void
}) {
  const altCount = proposal.alternatives.length
  const hasMultiple = altCount > 1
  const hasSummary = Boolean(proposal.summary_he?.trim())
  const tradeoffs = proposal.tradeoffs_he ?? []

  return (
    <section
      aria-label="הצעת תוכנית מוכנה"
      className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-emerald-800 dark:text-emerald-200">
          ✓ ההצעה מוכנה — הלוח מציג תצוגה מקדימה
        </p>
        {hasMultiple && (
          <span className="shrink-0 rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            {altCount} חלופות
          </span>
        )}
      </div>

      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        עברו עליה ואשרו כדי להחיל — הלוח לא משתנה בלי אישורכם.
      </p>

      {/* Structured summary from the agent */}
      {hasSummary && (
        <div className="mt-2.5 border-t border-emerald-500/20 pt-2.5">
          <ChatText text={proposal.summary_he!} className="text-xs text-[var(--text)]" />
        </div>
      )}

      {/* Unmet requests */}
      {tradeoffs.length > 0 && (
        <div
          className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-xs"
          role="note"
          aria-label="בקשות שלא כובדו במלואן"
        >
          <p className="font-semibold text-amber-800 dark:text-amber-200">לא כובד במלואו:</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[var(--text-muted)]">
            {tradeoffs.map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action */}
      {onShowProposal && (
        <button
          type="button"
          onClick={onShowProposal}
          className="mt-2.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          לפרטי ההצעה
        </button>
      )}
    </section>
  )
}

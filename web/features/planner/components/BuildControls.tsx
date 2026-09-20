import type { GenPhase } from '../types'

/** The Build / Rebuild button (standard path), its progress text, and the failure message. */
export default function BuildControls({ useAcademicDecisionAgent, genPhase, hasProposal, errKind, onBuild }: {
  useAcademicDecisionAgent: boolean
  genPhase: GenPhase
  hasProposal: boolean
  errKind: 'network' | 'contract' | null
  onBuild: () => void
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        {/* Flag-off: the standalone Build. Flag-on: the mounted conversation's
            Build is the single generation trigger (sends the typed profile). */}
        {!useAcademicDecisionAgent && (
          <button
            type="button"
            onClick={onBuild}
            disabled={genPhase === 'generating'}
            className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--purple)] disabled:opacity-60"
          >
            {hasProposal || genPhase === 'error' ? 'בנה מחדש' : 'בנה תוכנית'}
          </button>
        )}
        {genPhase === 'generating' && (
          <span role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">בונה תוכנית…</span>
        )}
      </div>

      {genPhase === 'error' && (
        <div role="alert" className="rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {errKind === 'contract'
            ? 'תשובת השרת לא תקינה — לא ניתן להציג טיוטה.'
            : 'בקשת הבנייה נכשלה (שגיאת רשת). אפשר לנסות שוב.'}
        </div>
      )}
    </>
  )
}

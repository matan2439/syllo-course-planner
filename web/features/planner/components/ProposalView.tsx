import type { GeneratedPlanModel } from '../../../../shared/planner/model'
import { Badge } from '../../../components/ui'
import type { buildDraftVM } from '../../../lib/planner/draft-vm'
import AgentOutcomeDetails from '../../agent/components/AgentOutcomeDetails'
import GroundedExplanation from '../../agent/components/GroundedExplanation'
import { AGENT_OUTCOME_LABEL_HE, STALE_MESSAGE_HE } from '../constants'
import type { StaleReason } from '../types'
import DraftSemester from './DraftSemester'

export default function ProposalView({
  draft, intentOutcome, removed, stale, staleReason, canApply, applying, applyError, onApply, onReject,
}: {
  draft: ReturnType<typeof buildDraftVM>
  intentOutcome?: GeneratedPlanModel['intentOutcome']
  removed: Array<{ id: string; nameHe: string | null }>
  stale: boolean
  staleReason: StaleReason | null
  canApply: boolean
  /** S5 — a real round-trip is in flight. */
  applying?: boolean
  /** S5 — the server's typed refusal, in its own words. */
  applyError?: string | null
  onApply: () => void
  onReject: () => void
}) {
  return (
    <section aria-label="טיוטת תוכנית" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-tight">הצעת תוכנית</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onReject} className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-medium">
            דחה
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            aria-busy={applying || undefined}
            title={canApply ? undefined : 'לא ניתן להחיל הצעה חסומה, שגויה או מיושנת'}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* The label stays STABLE while a request is in flight: a control
                that renames itself loses its identity for assistive tech, and
                the live region above already announces the progress. `disabled`
                + `aria-busy` carry the state. */}
            החל תוכנית
          </button>
        </div>
      </div>

      {applying && (
        <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">
          מחיל את התוכנית…
        </p>
      )}
      {/* The server refused, in its own words. The committed board is unchanged
          and the draft below is still inspectable, so the student can see
          exactly what was not applied. */}
      {applyError && (
        <p role="alert" className="rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {applyError}
        </p>
      )}
      {draft.blocked && <div><Badge variant="warn">הצעה חסומה — לא ניתן להחיל</Badge></div>}
      {draft.agentOutcome && draft.agentOutcome !== 'proposal' && !draft.blocked && (
        <div><Badge variant="warn">{AGENT_OUTCOME_LABEL_HE[draft.agentOutcome]}</Badge></div>
      )}
      {draft.agentOutcome && (
        <AgentOutcomeDetails
          outcome={draft.agentOutcome}
          clarificationItems={draft.agentClarificationItems}
          validationFindings={draft.agentValidationFindings}
          errors={draft.errors}
        />
      )}
      {draft.groundedExplanationHe && (
        <GroundedExplanation
          explanationHe={draft.groundedExplanationHe}
          sources={draft.groundedSources ?? []}
          {...(draft.groundedCoverage ? { coverage: draft.groundedCoverage } : {})}
          objectiveKind={draft.groundedObjective === 'prefer_topic_alignment' ? 'topic' : 'delivery'}
        />
      )}
      {staleReason && (
        <p role="note" className="text-sm text-amber-700 dark:text-amber-300">
          {STALE_MESSAGE_HE[staleReason]}
        </p>
      )}
      {draft.errors.length > 0 && (
        <ul aria-label="שגיאות" className="flex flex-col gap-1 text-sm text-red-700 dark:text-red-300">
          {draft.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {draft.warningsHe.length > 0 && (
        <ul aria-label="אזהרות" className="flex flex-col gap-1 text-sm text-[var(--text-muted)]">
          {draft.warningsHe.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {intentOutcome &&
        (intentOutcome.honored.length > 0 || intentOutcome.partiallyHonored.length > 0 || intentOutcome.unmet.length > 0 || intentOutcome.notesHe.length > 0) && (
          <section aria-label="מה נלקח מהבקשה" className="rounded-lg border border-[var(--border)] px-3.5 py-3 text-sm">
            <h3 className="mb-1.5 text-sm font-bold tracking-tight">מה נלקח מהבקשה שלך</h3>
            {intentOutcome.honored.map((t, i) => (
              <p key={`h${i}`} className="text-emerald-700 dark:text-emerald-300">✓ {t}</p>
            ))}
            {intentOutcome.partiallyHonored.map((t, i) => (
              <p key={`p${i}`} className="text-amber-700 dark:text-amber-300">◐ {t}</p>
            ))}
            {intentOutcome.unmet.map((t, i) => (
              <p key={`u${i}`} className="text-red-700 dark:text-red-300">✕ {t}</p>
            ))}
            {intentOutcome.notesHe.map((t, i) => (
              <p key={`n${i}`} className="text-[var(--text-muted)]">• {t}</p>
            ))}
          </section>
        )}

      {removed.length > 0 && (
        <div aria-label="קורסים שהוסרו" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
          <span className="font-semibold">הוסרו: </span>
          {removed.map((c, i) => (
            <span key={c.id}>{i > 0 ? ', ' : ''}{c.nameHe ?? c.id}</span>
          ))}
        </div>
      )}

      <div role="list" aria-label="טיוטה — סמסטרים" className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {draft.semesters.map((s) => (
          <div role="listitem" key={s.id} className="min-w-0"><DraftSemester semester={s} /></div>
        ))}
      </div>
    </section>
  )
}

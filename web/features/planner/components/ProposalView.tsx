import { useState, type ReactNode } from 'react'
import type { GeneratedPlanModel } from '../../../../shared/planner/model'
import { Badge } from '../../../components/ui'
import type { buildDraftVM } from '../../../lib/planner/draft-vm'
import AgentOutcomeDetails from '../../agent/components/AgentOutcomeDetails'
import GroundedExplanation from '../../agent/components/GroundedExplanation'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import { AGENT_OUTCOME_LABEL_HE, STALE_MESSAGE_HE } from '../constants'
import type { StaleReason } from '../types'

type Alternatives = NonNullable<GeneratedPlanModel['alternatives']>

/**
 * The proposal, reviewed where it was asked for: in the assistant panel. The board above only
 * previews it. Removing a course the student placed always needs a second, explicit confirmation.
 */
export default function ProposalView({
  draft, intentOutcome, semesterLoads, removed, stale, staleReason, canApply, applying, applyError, onApply, onReject,
  alternatives, selectedAlternativeId, onSelectAlternative, courseNameById,
}: {
  draft: ReturnType<typeof buildDraftVM>
  intentOutcome?: GeneratedPlanModel['intentOutcome']
  /** Weekly hours per semester with the server's cap verdicts (agent proposals). */
  semesterLoads?: NonNullable<Alternatives[number]['semesterLoads']>
  removed: Array<{ id: string; nameHe: string | null }>
  stale: boolean
  staleReason: StaleReason | null
  canApply: boolean
  /** S5 — a real round-trip is in flight. */
  applying?: boolean
  /** S5 — the server's typed refusal, in its own words. */
  applyError?: string | null
  /** `confirmRemovals` is passed only from the explicit removal confirmation below. */
  onApply: (opts?: { confirmRemovals?: boolean }) => void
  onReject: () => void
  alternatives?: Alternatives
  selectedAlternativeId?: string | null
  onSelectAlternative?: (candidateId: string) => void
  courseNameById?: Readonly<Record<string, string | null | undefined>>
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const bySemester = draft.semesters
    .map((semester) => ({ ...semester, changed: semester.courses.filter((course) => course.marker !== 'unchanged') }))
    .filter((semester) => semester.changed.length > 0)
  const added = bySemester.reduce((n, semester) => n + semester.changed.filter((c) => c.marker === 'new').length, 0)
  const loadOf = (semesterId: string) => semesterLoads?.find((load) => load.semesterId === semesterId)
  const totalHours = semesterLoads?.reduce((sum, load) => sum + load.hours, 0)
  const explanation = intentOutcome && (intentOutcome.honored.length + intentOutcome.partiallyHonored.length + intentOutcome.unmet.length + intentOutcome.notesHe.length) > 0

  return (
    <section id="plan-proposal" data-highlight-id="proposal" aria-label="טיוטת תוכנית" className="flex scroll-mt-24 flex-col gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-sm font-bold tracking-tight">הצעת תוכנית</h2>
        <div aria-label="סיכום ההצעה" className="flex flex-wrap gap-1.5 text-xs">
          <Chip tone="good">+{added} נוספו</Chip>
          {removed.length > 0 && <Chip tone="bad">−{removed.length} הוסרו</Chip>}
          {typeof totalHours === 'number' && totalHours > 0 && <Chip>{totalHours} ש״ש בהצעה</Chip>}
        </div>
      </header>

      {(alternatives?.length ?? 0) >= 2 && onSelectAlternative && (
        <AlternativeBoardSwitcher alternatives={alternatives!} selectedId={selectedAlternativeId ?? ''}
          onSelect={onSelectAlternative} courseNameById={courseNameById} disabled={stale} />
      )}

      {draft.blocked && <div><Badge variant="warn">הצעה חסומה — לא ניתן להחיל</Badge></div>}
      {draft.agentOutcome && draft.agentOutcome !== 'proposal' && !draft.blocked && (
        <div><Badge variant="warn">{AGENT_OUTCOME_LABEL_HE[draft.agentOutcome]}</Badge></div>
      )}
      {draft.agentOutcome && (
        <AgentOutcomeDetails outcome={draft.agentOutcome} clarificationItems={draft.agentClarificationItems}
          validationFindings={draft.agentValidationFindings} errors={draft.errors} />
      )}
      {staleReason && <p role="note" className="text-amber-700 dark:text-amber-300">{STALE_MESSAGE_HE[staleReason]}</p>}
      {draft.errors.length > 0 && (
        <ul aria-label="שגיאות" className="flex flex-col gap-1 text-red-700 dark:text-red-300">
          {draft.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      {/* What changes, semester by semester (the board above shows the same preview). */}
      <div aria-label="שינויים בהצעה" className="flex flex-col gap-2">
        {bySemester.length === 0 && removed.length === 0
          ? <p className="text-[var(--text-muted)]">ההצעה זהה לתוכנית הנוכחית.</p>
          : bySemester.map((semester) => {
            const load = loadOf(semester.id)
            return (
              <div key={semester.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-bold">{semester.title}</h3>
                  {load && <span className={`text-xs ${load.overHardCap ? 'text-red-600 dark:text-red-300' : load.overUserCap ? 'text-amber-600 dark:text-amber-300' : 'text-[var(--text-muted)]'}`}>
                    {load.hours} ש״ש{load.overHardCap ? ' · מעל התקרה המוחלטת' : load.overUserCap ? ' · מעל התקרה שהגדרת' : ''}</span>}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {semester.changed.map((course) => (
                    <li key={course.id} className="flex gap-1.5">
                      <span aria-hidden="true" className={course.marker === 'new' ? 'text-emerald-600' : 'text-amber-600'}>{course.marker === 'new' ? '+' : '↔'}</span>
                      <span>{course.nameHe ?? course.id}</span>
                      <span className="sr-only">{course.marker === 'new' ? '(חדש)' : '(הועבר)'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        {removed.length > 0 && (
          <div aria-label="קורסים שהוסרו" className="rounded-xl border border-red-500/40 bg-red-500/5 px-3 py-2">
            <h3 className="text-xs font-bold text-red-700 dark:text-red-300">יוסרו מהלוח שלך</h3>
            <ul className="mt-1 flex flex-col gap-0.5">
              {removed.map((course) => <li key={course.id} className="flex gap-1.5"><span aria-hidden="true" className="text-red-600">−</span>{course.nameHe ?? course.id}</li>)}
            </ul>
          </div>
        )}
      </div>

      {(explanation || draft.groundedExplanationHe || draft.warningsHe.length > 0) && (
        <details className="rounded-xl border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold">למה התוכנית הזו</summary>
          <div className="mt-2 flex flex-col gap-2">
            {explanation && (
              <section aria-label="מה נלקח מהבקשה" className="flex flex-col gap-0.5">
                {intentOutcome!.honored.map((t, i) => <p key={`h${i}`} className="text-emerald-700 dark:text-emerald-300">✓ {t}</p>)}
                {intentOutcome!.partiallyHonored.map((t, i) => <p key={`p${i}`} className="text-amber-700 dark:text-amber-300">◐ {t}</p>)}
                {intentOutcome!.unmet.map((t, i) => <p key={`u${i}`} className="text-red-700 dark:text-red-300">✕ {t}</p>)}
                {intentOutcome!.notesHe.map((t, i) => <p key={`n${i}`} className="text-[var(--text-muted)]">• {t}</p>)}
              </section>
            )}
            {draft.groundedExplanationHe && (
              <GroundedExplanation explanationHe={draft.groundedExplanationHe} sources={draft.groundedSources ?? []}
                {...(draft.groundedCoverage ? { coverage: draft.groundedCoverage } : {})}
                objectiveKind={draft.groundedObjective === 'prefer_topic_alignment' ? 'topic' : 'delivery'} />
            )}
            {draft.warningsHe.length > 0 && (
              <ul aria-label="אזהרות" className="flex flex-col gap-1 text-[var(--text-muted)]">{draft.warningsHe.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        </details>
      )}

      {applying && <p role="status" aria-live="polite" className="text-[var(--text-muted)]">מחיל את התוכנית…</p>}
      {/* The server refused, in its own words; the committed board is unchanged. */}
      {applyError && <p role="alert" className="rounded-lg border border-red-500/40 px-3 py-2 text-red-700 dark:text-red-300">{applyError}</p>}

      {confirmingRemoval ? (
        <div role="group" aria-label="אישור הסרת קורסים" className="flex flex-col gap-2 rounded-xl border border-red-500/40 p-3">
          <p>ההחלה תסיר {removed.length} קורסים מהלוח שלך. להמשיך?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setConfirmingRemoval(false); onApply({ confirmRemovals: true }) }} disabled={!canApply}
              className="rounded-full bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">כן, להסיר ולהחיל</button>
            <button type="button" onClick={() => setConfirmingRemoval(false)} className="rounded-full border border-[var(--border)] px-4 py-2">ביטול</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* The label stays STABLE while a request is in flight; `disabled` + `aria-busy` carry the state. */}
          <button type="button" onClick={() => (removed.length > 0 ? setConfirmingRemoval(true) : onApply())} disabled={!canApply} aria-busy={applying || undefined}
            title={canApply ? undefined : 'לא ניתן להחיל הצעה חסומה, שגויה או מיושנת'}
            className="flex-1 rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            החל תוכנית
          </button>
          <button type="button" onClick={onReject} className="rounded-full border border-[var(--border)] px-5 py-2 font-medium">דחה</button>
        </div>
      )}
    </section>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
    : tone === 'bad' ? 'border-red-500/40 text-red-700 dark:text-red-300' : 'border-[var(--border)] text-[var(--text-muted)]'
  return <span className={`rounded-full border bg-[var(--surface)] px-2 py-0.5 font-semibold ${color}`}>{children}</span>
}

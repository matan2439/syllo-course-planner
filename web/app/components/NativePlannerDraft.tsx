'use client'

/**
 * Slice 2 — ephemeral native generation → draft view (tests-only; not routed).
 * Generation is an INJECTED function typed from the shared client; the draft is
 * derived through the canonical shared adapters + draft-vm. The component owns
 * only ephemeral proposal state + a locally captured proposalBaseRevision.
 *
 * A monotonic request token supersedes older in-flight generations so a late
 * older response can never overwrite a newer proposal. No persistence, apply,
 * reject, edit, move, retry, or polling. No motion (status is textual).
 */
import { useCallback, useRef, useState } from 'react'
import type { BoardModel, GeneratedPlanModel, ProposalBaseRevision } from '../../../shared/planner/model'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import { ContractError, isCatalogStale, proposalBaseRevision } from '../../../shared/planner/model'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { buildDraftVM, type DraftCourseVM, type DraftSemesterVM, type DraftVM } from '../../lib/planner/draft-vm'
import NativePlannerBoard from './NativePlannerBoard'
import { Badge, Card, EmptyState } from './ui'

type Phase = 'idle' | 'generating' | 'done' | 'error'
type ErrKind = 'network' | 'contract'

const MARKER_LABEL: Record<DraftCourseVM['marker'], string | null> = {
  new: 'חדש',
  moved: 'הוזז',
  unchanged: null,
}

export default function NativePlannerDraft({
  base,
  request,
  generate,
}: {
  base: BoardModel
  request: GeneratePlanRequest
  generate: (req: GeneratePlanRequest) => Promise<GeneratedPlanModel>
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [proposal, setProposal] = useState<GeneratedPlanModel | null>(null)
  const [capturedRev, setCapturedRev] = useState<ProposalBaseRevision | null>(null)
  const [errKind, setErrKind] = useState<ErrKind | null>(null)
  const tokenRef = useRef(0)

  const run = useCallback(() => {
    const token = ++tokenRef.current // a newer trigger supersedes any older in-flight one
    const revAtRequest = base.catalogRevision
    setPhase('generating')
    setErrKind(null)
    generate(request).then(
      (result) => {
        if (token !== tokenRef.current) return // superseded — older result must not win
        setProposal(result)
        setCapturedRev(proposalBaseRevision(revAtRequest as unknown as string))
        setPhase('done')
      },
      (e) => {
        if (token !== tokenRef.current) return
        setErrKind(e instanceof ContractError ? 'contract' : 'network')
        setPhase('error')
      },
    )
  }, [base, request, generate])

  const stale = phase === 'done' && capturedRev != null && isCatalogStale(capturedRev, base.catalogRevision)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
        >
          {phase === 'done' || phase === 'error' ? 'בנה מחדש' : 'בנה תוכנית'}
        </button>
        {phase === 'generating' && (
          <span role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">
            בונה תוכנית…
          </span>
        )}
      </div>

      {phase === 'error' && (
        <div role="alert" className="rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {errKind === 'contract'
            ? 'תשובת השרת לא תקינה — לא ניתן להציג טיוטה.'
            : 'בקשת הבנייה נכשלה (שגיאת רשת). אפשר לנסות שוב.'}
        </div>
      )}

      {phase === 'done' && proposal ? (
        <DraftView draft={buildDraftVM(proposal, base)} stale={!!stale} />
      ) : (
        <section aria-label="לוח נוכחי">
          <NativePlannerBoard board={boardModelToVM(base)} />
        </section>
      )}
    </div>
  )
}

function DraftView({ draft, stale }: { draft: DraftVM; stale: boolean }) {
  return (
    <section aria-label="טיוטת תוכנית" className="flex flex-col gap-3">
      {draft.blocked && (
        <div>
          <Badge variant="warn">הצעה חסומה — לא ניתן להחיל</Badge>
        </div>
      )}
      {stale && (
        <p role="note" className="text-sm text-amber-700 dark:text-amber-300">
          הקטלוג השתנה מאז הבנייה — מומלץ לבנות מחדש.
        </p>
      )}
      {draft.warningsHe.length > 0 && (
        <ul aria-label="אזהרות" className="flex flex-col gap-1 text-sm text-[var(--text-muted)]">
          {draft.warningsHe.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {draft.errors.length > 0 && (
        <ul aria-label="שגיאות" className="flex flex-col gap-1 text-sm text-red-700 dark:text-red-300">
          {draft.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div role="list" aria-label="טיוטה — סמסטרים" className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {draft.semesters.map((s) => (
          <div role="listitem" key={s.id} className="min-w-0">
            <DraftSemester semester={s} />
          </div>
        ))}
      </div>
    </section>
  )
}

function DraftSemester({ semester }: { semester: DraftSemesterVM }) {
  return (
    <section aria-label={semester.title} className="flex min-w-0 flex-col gap-2.5">
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h3 className="text-sm font-bold tracking-tight">{semester.title}</h3>
        {semester.totalComplete ? (
          <Badge>{semester.totalWeeklyHours} ש״ש</Badge>
        ) : (
          <Badge variant="warn">סכום חלקי</Badge>
        )}
      </header>
      {semester.courses.length === 0 ? (
        <EmptyState>אין קורסים בטיוטה</EmptyState>
      ) : (
        semester.courses.map((c) => <DraftCourse key={c.id} course={c} />)
      )}
    </section>
  )
}

function DraftCourse({ course }: { course: DraftCourseVM }) {
  const markerLabel = MARKER_LABEL[course.marker]
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug">
          {course.nameHe ? course.nameHe : <span className="text-[var(--text-muted)]">פרטי הקורס אינם זמינים</span>}
        </h4>
        {markerLabel && <Badge variant="purple">{markerLabel}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {course.isMandatory != null && (
          <Badge variant={course.isMandatory ? 'purple' : 'neutral'}>{course.isMandatory ? 'חובה' : 'בחירה'}</Badge>
        )}
        {course.weeklyHours != null && <Badge>{course.weeklyHours} ש״ש</Badge>}
      </div>
      <div className="mt-2 text-[11px] text-[var(--text-muted)]">
        <span dir="ltr" className="font-mono tracking-tight">
          {course.id}
        </span>
      </div>
    </Card>
  )
}

'use client'

/**
 * MVP vertical slice — the smallest COMPLETE native planner journey, composed
 * over the existing shared infra (Slices 0–2), nothing rebuilt:
 *
 *   load current board (GET /api/board → shared adapters → BoardModel)
 *   → chat + preferences (recorded locally; NEVER auto-generate)
 *   → explicit "Build/Rebuild" → real POST /api/ai/generate-plan
 *   → proposal on the board with added/removed/moved diff + warnings/errors
 *   → reject, or safely apply (blocked / stale / errored proposals can't apply)
 *   → the applied plan becomes the visible current board.
 *
 * Apply is client-side only (the accepted proposal replaces the visible current
 * plan — the wire.ts `workspace.applied` model). No server write, no persistence
 * beyond the anonymous quota session token. Transport is injected so this is
 * fully testable without a live backend; browser defaults hit the real routes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../shared/planner/model'
import { ContractError, isCatalogStale, normalizeCourseId, proposalBaseRevision } from '../../../shared/planner/model'
import type { ProposalBaseRevision } from '../../../shared/planner/model'
import { generatePlan, getBoard, type GeneratePlanRequest } from '../../../shared/planner/api-client'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { buildDraftVM, type DraftCourseVM, type DraftSemesterVM } from '../../lib/planner/draft-vm'
import { applyGeneratedToBoard, removedCourseIds } from '../../lib/planner/apply-plan'
import NativePlannerBoard from './NativePlannerBoard'
import { Badge, Card, EmptyState } from './ui'

type BoardPhase = 'loading' | 'ready' | 'error'
type GenPhase = 'idle' | 'generating' | 'done' | 'error'
type ChatMsg = { role: 'user' | 'system'; text: string }

const MARKER_LABEL: Record<DraftCourseVM['marker'], string | null> = {
  new: 'חדש', moved: 'הוזז', unchanged: null,
}

// Wrap fetch so calling it as `deps.fetchImpl(...)` doesn't rebind `this` to the
// deps object — a bare `fetch` reference throws "Illegal invocation" in browsers.
const browserFetch = ((url: string, init?: unknown) => fetch(url, init as RequestInit)) as never
const defaultGetBoard = (programId: string) =>
  getBoard({ fetchImpl: browserFetch, baseUrl: '' }, programId)
const defaultGenerate = (req: GeneratePlanRequest) =>
  generatePlan({ fetchImpl: browserFetch, baseUrl: '' }, req)

/** RFC-4122 v4 UUID with graceful fallback (older/embedded runtimes lack crypto.randomUUID). */
function uuidv4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h.slice(10).join('')}`
}

/** Anonymous quota session token (UUID), persisted like the legacy planner. */
function sessionToken(): string {
  const KEY = 'tau_ai_session'
  try {
    let t = localStorage.getItem(KEY)
    if (!t) { t = uuidv4(); localStorage.setItem(KEY, t) }
    return t
  } catch {
    return uuidv4()
  }
}

function splitIds(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export default function NativePlannerJourney({
  programId,
  getBoardFn = defaultGetBoard,
  generateFn = defaultGenerate,
}: {
  programId: string
  getBoardFn?: (programId: string) => Promise<BoardModel>
  generateFn?: (req: GeneratePlanRequest) => Promise<GeneratedPlanModel>
}) {
  // ── current plan ──────────────────────────────────────────────────────────
  const [boardPhase, setBoardPhase] = useState<BoardPhase>('loading')
  const [current, setCurrent] = useState<BoardModel | null>(null)

  useEffect(() => {
    let live = true
    setBoardPhase('loading')
    getBoardFn(programId).then(
      (b) => { if (live) { setCurrent(b); setBoardPhase('ready') } },
      (e) => { if (live) { console.error('[NativePlannerJourney] board load failed:', e); setBoardPhase('error') } },
    )
    return () => { live = false }
  }, [programId, getBoardFn])

  // ── conversation + preferences (recorded; never auto-generate) ─────────────
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draftText, setDraftText] = useState('')
  const [maxHours, setMaxHours] = useState('')
  const [priorHours, setPriorHours] = useState('')
  const [wantIds, setWantIds] = useState('')
  const [excludeIds, setExcludeIds] = useState('')

  const sendMessage = () => {
    const text = draftText.trim()
    if (!text) return
    setMessages((m) => [
      ...m,
      { role: 'user', text },
      { role: 'system', text: 'ההודעה נשמרה. לחצו "בנה תוכנית" כדי לייצר הצעה מהשיחה וההעדפות.' },
    ])
    setDraftText('')
  }

  // ── generation ─────────────────────────────────────────────────────────────
  const [genPhase, setGenPhase] = useState<GenPhase>('idle')
  const [proposal, setProposal] = useState<GeneratedPlanModel | null>(null)
  const [capturedRev, setCapturedRev] = useState<ProposalBaseRevision | null>(null)
  const [errKind, setErrKind] = useState<'network' | 'contract' | null>(null)
  const tokenRef = useRef(0)

  const buildRequest = useCallback((base: BoardModel): GeneratePlanRequest => {
    const conversation = messages.filter((m) => m.role === 'user').map((m) => m.text)
    if (draftText.trim()) conversation.push(draftText.trim())
    const extra = conversation.join('\n').slice(0, 1000)
    const preferences: Record<string, unknown> = {}
    const hrs = Number(maxHours)
    if (maxHours.trim() && Number.isFinite(hrs)) preferences.max_weekly_hours = hrs
    if (splitIds(wantIds).length) preferences.wanted_course_ids = splitIds(wantIds)
    if (splitIds(excludeIds).length) preferences.disallowed_course_ids = splitIds(excludeIds)
    if (extra) preferences.extra_request_he = extra
    const planContext: Record<string, unknown> = {
      semesters: base.semesters.map((s) => ({
        id: s.semesterId,
        courses: s.courses.map((c) => ({ course_id: c.courseId })),
      })),
      personal_status: { completed: [], currently_taking: [], planned: [] },
    }
    const prior = Number(priorHours)
    if (priorHours.trim() && Number.isFinite(prior)) {
      planContext.total_hours_progress = { known_completed_hours: prior }
    }
    return {
      program_id: programId,
      plan_context: planContext,
      preferences,
      session_token: sessionToken(),
    }
  }, [messages, draftText, maxHours, priorHours, wantIds, excludeIds, programId])

  const build = useCallback(() => {
    if (!current) return
    const token = ++tokenRef.current // a newer Build supersedes any older in-flight one
    const revAtRequest = current.catalogRevision
    setGenPhase('generating')
    setErrKind(null)
    generateFn(buildRequest(current)).then(
      (result) => {
        if (token !== tokenRef.current) return
        setProposal(result)
        setCapturedRev(proposalBaseRevision(revAtRequest as unknown as string))
        setGenPhase('done')
      },
      (e) => {
        if (token !== tokenRef.current) return
        setErrKind(e instanceof ContractError ? 'contract' : 'network')
        setGenPhase('error')
      },
    )
  }, [current, buildRequest, generateFn])

  const stale =
    genPhase === 'done' && capturedRev != null && current != null &&
    isCatalogStale(capturedRev, current.catalogRevision)

  const clearProposal = () => {
    tokenRef.current++ // supersede any in-flight generation so it can't re-open the draft
    setProposal(null)
    setGenPhase('idle')
    setErrKind(null)
  }

  const canApply = !!proposal && !proposal.blocked && proposal.errors.length === 0 && !stale

  const apply = () => {
    if (!current || !proposal || !canApply) return // hard guard: blocked/stale/errored never apply
    setCurrent(applyGeneratedToBoard(proposal, current))
    setMessages((m) => [...m, { role: 'system', text: 'התוכנית הוחלה והיא כעת התוכנית הנוכחית.' }])
    clearProposal()
  }

  if (boardPhase === 'loading') {
    return <div role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">טוען את התוכנית הנוכחית…</div>
  }
  if (boardPhase === 'error' || !current) {
    return (
      <div role="alert" className="rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
        טעינת התוכנית הנוכחית נכשלה. נא לרענן או לנסות שוב מאוחר יותר.
      </div>
    )
  }

  const removed = proposal ? removedCourseIds(current, proposal) : []

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── board / proposal ──────────────────────────────────────────────── */}
      <div className="order-2 flex flex-col gap-4 lg:order-1">
        {genPhase !== 'done' || !proposal ? (
          <section aria-label="התוכנית הנוכחית">
            <h2 className="mb-3 text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
            <NativePlannerBoard board={boardModelToVM(current)} />
          </section>
        ) : (
          <ProposalView
            draft={buildDraftVM(proposal, current)}
            removed={removed}
            stale={stale}
            canApply={canApply}
            onApply={apply}
            onReject={clearProposal}
          />
        )}
      </div>

      {/* ── assistant + preferences + build ───────────────────────────────── */}
      <aside className="order-1 flex flex-col gap-4 lg:order-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-bold tracking-tight">עוזר התכנון</h2>
          <div aria-label="שיחה" className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">כתבו העדפות או בקשות. שליחת הודעה לא מייצרת תוכנית — לחצו "בנה תוכנית".</p>
            ) : (
              messages.map((m, i) => (
                <p key={i} className={m.role === 'user' ? 'text-sm' : 'text-xs text-[var(--text-muted)]'}>
                  <span aria-hidden="true">{m.role === 'user' ? '🧑 ' : 'ℹ️ '}</span>
                  <span>{m.text}</span>
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              aria-label="הודעה / בקשה / העדפה"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage() } }}
              placeholder="כתבו העדפה או בקשה…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <button type="button" onClick={sendMessage} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium">
              שלח
            </button>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-bold tracking-tight">העדפות</h2>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            מגבלת שעות שבועיות לסמסטר
            <input aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            שעות שהושלמו (שנים א׳–ב׳, מחוץ ללוח)
            <input aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours}
              onChange={(e) => setPriorHours(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            קורסים להוספה (מזהים, מופרדים בפסיק)
            <input aria-label="קורסים להוספה" value={wantIds}
              onChange={(e) => setWantIds(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            קורסים להחריג (לא יופיעו בתוכנית)
            <input aria-label="קורסים להחריג" value={excludeIds}
              onChange={(e) => setExcludeIds(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
        </Card>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={build}
            disabled={genPhase === 'generating'}
            className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--purple)] disabled:opacity-60"
          >
            {proposal || genPhase === 'error' ? 'בנה מחדש' : 'בנה תוכנית'}
          </button>
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
      </aside>
    </div>
  )
}

function ProposalView({
  draft, removed, stale, canApply, onApply, onReject,
}: {
  draft: ReturnType<typeof buildDraftVM>
  removed: Array<{ id: string; nameHe: string | null }>
  stale: boolean
  canApply: boolean
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
            title={canApply ? undefined : 'לא ניתן להחיל הצעה חסומה, שגויה או מיושנת'}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            החל תוכנית
          </button>
        </div>
      </div>

      {draft.blocked && <div><Badge variant="warn">הצעה חסומה — לא ניתן להחיל</Badge></div>}
      {stale && (
        <p role="note" className="text-sm text-amber-700 dark:text-amber-300">
          הקטלוג השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.
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

function DraftSemester({ semester }: { semester: DraftSemesterVM }) {
  return (
    <section aria-label={semester.title} className="flex min-w-0 flex-col gap-2.5">
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h3 className="text-sm font-bold tracking-tight">{semester.title}</h3>
        {semester.totalComplete
          ? <Badge>{semester.totalWeeklyHours} ש״ש</Badge>
          : <Badge variant="warn">סכום חלקי</Badge>}
      </header>
      {semester.courses.length === 0
        ? <EmptyState>אין קורסים בטיוטה</EmptyState>
        : semester.courses.map((c) => <DraftCourse key={c.id} course={c} />)}
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
        <span dir="ltr" className="font-mono tracking-tight">{course.id}</span>
      </div>
    </Card>
  )
}

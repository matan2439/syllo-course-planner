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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../shared/planner/model'
import { ContractError, fromHalfHours, isCatalogStale, normalizeCourseId, proposalBaseRevision } from '../../../shared/planner/model'
import type { ProposalBaseRevision } from '../../../shared/planner/model'
import { generatePlan, getBoard, type GeneratePlanRequest } from '../../../shared/planner/api-client'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { buildDraftVM, type DraftCourseVM, type DraftSemesterVM } from '../../lib/planner/draft-vm'
import { applyGeneratedToBoard, removedCourseIds } from '../../lib/planner/apply-plan'
import { isProposalApplyable } from '../../lib/planner/apply-eligibility'
import AgentOutcomeDetails from './AgentOutcomeDetails'
import GroundedExplanation from './GroundedExplanation'
import PreferenceConversation from './PreferenceConversation'
import CompletedCoursesPanel, {
  EMPTY_ACADEMIC_STATUS,
  completedCourseIdsOf,
  type AcademicStatusDraft,
} from './CompletedCoursesPanel'
import type { PreferenceProfile } from '../../../api/ai/preference_model'
import NativePlannerBoard from './NativePlannerBoard'
import CourseNamePicker from './CourseNamePicker'
import { Badge, Card, EmptyState } from './ui'

/** Hebrew labels for the non-'proposal' structured agent outcomes (opt-in path). */
const AGENT_OUTCOME_LABEL_HE: Record<string, string> = {
  clarification_required: 'נדרש מידע נוסף לפני החלה',
  validation_failed: 'נמצאה סתירה בנתונים — נדרשת בדיקה לפני החלה',
  // Slice 18A — a HARD constraint cannot be satisfied at all (a contradiction
  // between selections, or an impossibility against an authoritative fact).
  infeasible: 'לא קיימת תוכנית חוקית שעונה על הדרישות שסימנת — לא ניתן להחיל',
  blocked: 'הצעה חסומה — לא ניתן להחיל',
  error: 'אירעה שגיאה פנימית — לא ניתן להחיל',
}

/** WHY a proposal is stale — the note must name the real cause, never guess. */
type StaleReason = 'catalog' | 'status' | 'preferences'
const STALE_MESSAGE_HE: Record<StaleReason, string> = {
  catalog: 'הקטלוג השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  status: 'סטטוס הקורסים שהשלמת השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  preferences: 'ההעדפות שלך השתנו מאז הבנייה — יש לבנות מחדש לפני החלה.',
}

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


export default function NativePlannerJourney({
  programId,
  getBoardFn = defaultGetBoard,
  generateFn = defaultGenerate,
  useAcademicDecisionAgent = false,
}: {
  programId: string
  getBoardFn?: (programId: string) => Promise<BoardModel>
  generateFn?: (req: GeneratePlanRequest) => Promise<GeneratedPlanModel>
  /**
   * Development/diagnostic-only: when true, Build sends
   * `use_academic_decision_agent: true`. Injectable via prop (not a Production UI
   * toggle) so the default-off feature never leaks into the ordinary Production
   * journey — the native page never sets it. Default false/absent.
   */
  useAcademicDecisionAgent?: boolean
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
  const [wantIds, setWantIds] = useState<string[]>([])
  const [excludeIds, setExcludeIds] = useState<string[]>([])

  // Course universe for the approximate-name pickers (fuzzy search by Hebrew name).
  const pickerCourses = useMemo(
    () => (current ? Object.values(current.courseCatalog).map((c) => ({ id: c.courseId, nameHe: c.nameHe || null })) : []),
    [current],
  )
  /** Authoritative catalog hours — the only credit source for completed electives. */
  const catalogHoursById = useMemo(() => {
    const out: Record<string, number | null | undefined> = {}
    if (current) {
      for (const c of Object.values(current.courseCatalog)) {
        out[c.courseId] = c.halfHours == null ? null : fromHalfHours(c.halfHours)
      }
    }
    return out
  }, [current])

  // ── the student's own academic status (flagged path) ───────────────────────
  // Draft state only: editing never touches the committed board and never
  // generates. `confirmed` is what makes the completed set KNOWN — an empty list
  // is otherwise UNKNOWN, never an implicit "none" (academic_status_knowledge.ts).
  const [academicStatus, setAcademicStatus] = useState<AcademicStatusDraft>(EMPTY_ACADEMIC_STATUS)
  const [statusVersion, setStatusVersion] = useState(0)
  const updateAcademicStatus = useCallback((next: AcademicStatusDraft) => {
    setAcademicStatus(next)
    setStatusVersion((v) => v + 1) // any edit invalidates a proposal built from the old status
  }, [])
  // Exclusions: a non-empty selection is inherently explicit; an empty one is
  // only an answer once the student says so. Untouched stays UNKNOWN.
  const [exclusionsNoneConfirmed, setExclusionsNoneConfirmed] = useState(false)
  const exclusionsKnown = excludeIds.length > 0 || exclusionsNoneConfirmed

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
  const [capturedStatusVersion, setCapturedStatusVersion] = useState<number | null>(null)
  const [errKind, setErrKind] = useState<'network' | 'contract' | null>(null)
  const tokenRef = useRef(0)

  // ── mounted preference conversation (flagged path only) ────────────────────
  // The PreferenceConversation component owns the single authoritative typed
  // ConversationState; here we mirror only the current profile VERSION (a scalar,
  // not a second profile representation) for staleness comparison, and hold the
  // latest profile in a ref so an explicit Build sends the exact typed profile.
  const [convProfileVersion, setConvProfileVersion] = useState<number | undefined>(undefined)
  const convProfileRef = useRef<PreferenceProfile | null>(null)

  const buildRequest = useCallback((base: BoardModel, profile?: PreferenceProfile): GeneratePlanRequest => {
    const conversation = messages.filter((m) => m.role === 'user').map((m) => m.text)
    if (draftText.trim()) conversation.push(draftText.trim())
    const extra = conversation.join('\n').slice(0, 1000)
    const preferences: Record<string, unknown> = {}
    const hrs = Number(maxHours)
    if (maxHours.trim() && Number.isFinite(hrs)) preferences.max_weekly_hours = hrs
    if (wantIds.length) preferences.wanted_course_ids = wantIds
    if (excludeIds.length) preferences.disallowed_course_ids = excludeIds
    // Flagged path only: an explicit "no courses to avoid" is a real answer, so
    // send the key as [] to distinguish it from "never asked" (absent). Flag-off
    // keeps the exact legacy payload (key present only when non-empty).
    else if (useAcademicDecisionAgent && exclusionsNoneConfirmed) preferences.disallowed_course_ids = []
    if (extra) preferences.extra_request_he = extra
    // Completed courses are ACADEMIC STATE (never a preference). Ids come only
    // from what the student explicitly reported — never derived from an hours
    // total — and the knowledge marker is attached only once they confirmed.
    const completedIds = useAcademicDecisionAgent ? completedCourseIdsOf(academicStatus) : []
    const personalStatus: Record<string, unknown> = {
      completed: completedIds.map((course_id) => ({ course_id })),
      currently_taking: [],
      planned: [],
    }
    if (useAcademicDecisionAgent && academicStatus.confirmed) {
      personalStatus.completed_knowledge = { status: 'known', provenance: 'explicit_user' }
    }
    const planContext: Record<string, unknown> = {
      semesters: base.semesters.map((s) => ({
        id: s.semesterId,
        courses: s.courses.map((c) => ({ course_id: c.courseId })),
      })),
      personal_status: personalStatus,
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
      // Interpret the free-text conversation into structured planner intent so
      // it measurably affects the plan (not just the LLM prompt). Additive.
      interpret_free_text: true,
      // Dev/diagnostic-only opt-in (default off) — never set by the Production page.
      ...(useAcademicDecisionAgent ? { use_academic_decision_agent: true } : {}),
      // Slice 14 — the typed preference profile (source of truth). Only on the
      // flagged path, and only the typed profile (never the transcript). The
      // server eligibility filter decides which preferences may reach planning.
      ...(useAcademicDecisionAgent && profile
        ? {
            preference_profile: {
              version: profile.version,
              preferences: profile.preferences.map((p) => ({
                id: p.id, category: p.category, normalized: p.normalized, value: p.value,
                classification: p.classification, confidence: p.confidence, source: p.source,
                confirmationStatus: p.confirmationStatus, affects: p.affects,
                mayAffectPlanningBeforeConfirmation: p.mayAffectPlanningBeforeConfirmation,
              })),
            },
          }
        : {}),
    }
  }, [messages, draftText, maxHours, priorHours, wantIds, excludeIds, programId, useAcademicDecisionAgent,
      academicStatus, exclusionsNoneConfirmed])

  const build = useCallback((profile?: PreferenceProfile) => {
    if (!current) return
    const token = ++tokenRef.current // a newer Build supersedes any older in-flight one
    const revAtRequest = current.catalogRevision
    const statusAtRequest = statusVersion
    setGenPhase('generating')
    setErrKind(null)
    generateFn(buildRequest(current, profile)).then(
      (result) => {
        if (token !== tokenRef.current) return
        setProposal(result)
        setCapturedRev(proposalBaseRevision(revAtRequest as unknown as string))
        setCapturedStatusVersion(statusAtRequest)
        setGenPhase('done')
      },
      (e) => {
        if (token !== tokenRef.current) return
        setErrKind(e instanceof ContractError ? 'contract' : 'network')
        setGenPhase('error')
      },
    )
  }, [current, buildRequest, generateFn, statusVersion])

  // WHY the proposal is stale, not merely THAT it is — the note must name the
  // real cause. Browser acceptance (check 4B) found the profile-version case
  // silently disabling Apply, and then found a single shared message wrongly
  // blaming the catalog for a preference edit.
  const staleReason: StaleReason | null =
    genPhase !== 'done'
      ? null
      : capturedRev != null && current != null && isCatalogStale(capturedRev, current.catalogRevision)
        ? 'catalog'
        // The academic status (completed courses / electives) changed since this
        // proposal was generated — it was planned from facts that no longer hold.
        : capturedStatusVersion != null && capturedStatusVersion !== statusVersion
          ? 'status'
          // The typed preference profile advanced. `isProposalApplyable` already
          // REFUSED to apply in this case, but that guard is silent — it only
          // greys the button out. Surfacing it here can only make MORE proposals
          // stale, never fewer, so no guard is loosened.
          : useAcademicDecisionAgent && proposal?.profileVersion != null &&
            proposal.profileVersion !== convProfileVersion
            ? 'preferences'
            : null
  const stale = staleReason !== null



  const clearProposal = () => {
    tokenRef.current++ // supersede any in-flight generation so it can't re-open the draft
    setProposal(null)
    setGenPhase('idle')
    setErrKind(null)
  }

  const canApply = !!proposal && isProposalApplyable(proposal, stale, {
    // On the flagged path, the proposal must match the CURRENT conversation
    // profile version — an edit after Generate stales it. Legacy path: undefined.
    currentProfileVersion: useAcademicDecisionAgent ? convProfileVersion : undefined,
  })

  const apply = () => {
    if (!current || !proposal || !canApply) return // hard guard: blocked/stale/errored/version-mismatch never apply
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
            intentOutcome={proposal.intentOutcome}
            removed={removed}
            stale={stale}
            staleReason={staleReason}
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

        {useAcademicDecisionAgent && (
          <CompletedCoursesPanel
            programId={programId}
            catalogCourses={pickerCourses}
            catalogHoursById={catalogHoursById}
            value={academicStatus}
            onChange={updateAcademicStatus}
          />
        )}

        {useAcademicDecisionAgent && (
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-bold tracking-tight">שיחת העדפות</h2>
            <p className="text-xs text-[var(--text-muted)]">
              כמה שאלות קצרות שיעזרו לבנות תוכנית מתאימה יותר. התשובות משפיעות רק על טיוטה — לא על הלוח הנוכחי — ורק לחיצה על "בנה תוכנית" מייצרת הצעה.
            </p>
            <PreferenceConversation
              onBuild={(profile) => build(profile)}
              onProfileChange={(profile) => { convProfileRef.current = profile; setConvProfileVersion(profile.version) }}
              // Impact-driven: after a Generate whose candidates showed no material
              // balanced/compact difference, don't ask the semester_balance question
              // (it can't change the selected plan). Before any Generate, or when
              // alternatives are material, it stays askable.
              elicitationContext={{
                ...(proposal && proposal.balanceAlternativesMaterial === false
                  ? { irrelevantTopicIds: ['semester_balance'] }
                  : {}),
                // K9C — the grounded course-feature question is gated on the
                // server's impact probe over the ONE prepared evidence snapshot,
                // so it is asked only when answering it could really change the
                // selected plan. Absent before the first Build ⇒ never asked.
                ...(proposal?.groundedQuestionImpact
                  ? { groundedFeatureImpact: proposal.groundedQuestionImpact }
                  : {}),
              }}
            />
          </Card>
        )}

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
          <CourseNamePicker label="קורסים להוספה (חיפוש לפי שם)" placeholder="הקלידו שם קורס להוספה…"
            courses={pickerCourses} selectedIds={wantIds} onChange={setWantIds} />
          <CourseNamePicker label="קורסים להחריג (לא יופיעו בתוכנית)" placeholder="הקלידו שם קורס להחרגה…"
            courses={pickerCourses} selectedIds={excludeIds}
            onChange={(ids) => { setExcludeIds(ids); setStatusVersion((v) => v + 1) }} />
          {/* An empty selection is only an ANSWER once the student says so —
              untouched stays unknown, so it is never silently read as "none". */}
          {useAcademicDecisionAgent && excludeIds.length === 0 && (
            <button
              type="button"
              aria-pressed={exclusionsNoneConfirmed}
              onClick={() => { setExclusionsNoneConfirmed((v) => !v); setStatusVersion((v) => v + 1) }}
              className={`self-start rounded-full border px-4 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                exclusionsNoneConfirmed
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-dashed border-[var(--border)] text-[var(--text-muted)]'
              }`}
            >
              אין קורסים שאני רוצה להימנע מהם
            </button>
          )}
        </Card>

        <div className="flex items-center gap-3">
          {/* Flag-off: the standalone Build. Flag-on: the mounted conversation's
              Build is the single generation trigger (sends the typed profile). */}
          {!useAcademicDecisionAgent && (
            <button
              type="button"
              onClick={() => build()}
              disabled={genPhase === 'generating'}
              className="rounded-full bg-[var(--purple-strong)] px-6 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--purple)] disabled:opacity-60"
            >
              {proposal || genPhase === 'error' ? 'בנה מחדש' : 'בנה תוכנית'}
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
      </aside>
    </div>
  )
}

function ProposalView({
  draft, intentOutcome, removed, stale, staleReason, canApply, onApply, onReject,
}: {
  draft: ReturnType<typeof buildDraftVM>
  intentOutcome?: GeneratedPlanModel['intentOutcome']
  removed: Array<{ id: string; nameHe: string | null }>
  stale: boolean
  staleReason: StaleReason | null
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

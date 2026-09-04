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
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { BoardModel, GeneratedPlanModel } from '../../../shared/planner/model'
import type { ConversationProposal } from '../../../shared/planner/conversation-wire'
import { ContractError, fromHalfHours, isCatalogStale, normalizeCourseId, proposalBaseRevision } from '../../../shared/planner/model'
import type { ProposalBaseRevision } from '../../../shared/planner/model'
import {
  applyPlan, editBoard, establishPlanningContext, generatePlan, getBoard, getCommittedBoard, getPlanningContext,
  sendConversation,
  type ApplyPlanResult, type CommittedBoardState, type GeneratePlanRequest, type LoadedPlanningContext,
  type ManualBoardEditResult,
} from '../../../shared/planner/api-client'
import { boardModelToVM, semesterTitleHe } from '../../lib/planner/board-vm'
import { buildDraftVM, type DraftCourseVM, type DraftSemesterVM } from '../../lib/planner/draft-vm'
import { applyGeneratedToBoard, removedCourseIds } from '../../lib/planner/apply-plan'
import { isProposalApplyable } from '../../lib/planner/apply-eligibility'
import AgentOutcomeDetails from './AgentOutcomeDetails'
import GroundedExplanation from './GroundedExplanation'
import PreferenceConversation from './PreferenceConversation'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import CompletedCoursesPanel, {
  EMPTY_ACADEMIC_STATUS,
  academicStatusDraftFromPersonalStatus,
  completedCourseIdsOf,
  type AcademicStatusDraft,
} from './CompletedCoursesPanel'
import { emptyProfile, type PreferenceProfile } from '../../../api/ai/preference_model'
import { earlyYearHoursById } from '../../../shared/planner/early_year_courses'
import NativePlannerBoard from './NativePlannerBoard'
import CourseNamePicker from './CourseNamePicker'
import AcademicAgentConversation from './AcademicAgentConversation'
import { Badge, Card, EmptyState } from './ui'
import type { PlannerDragPayload } from '../../lib/planner/drag-payload'

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
type StaleReason = 'catalog' | 'status' | 'preferences' | 'manual'
const STALE_MESSAGE_HE: Record<StaleReason, string> = {
  catalog: 'הקטלוג השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  status: 'סטטוס הקורסים שהשלמת השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  preferences: 'ההעדפות שלך השתנו מאז הבנייה — יש לבנות מחדש לפני החלה.',
  manual: 'הלוח השתנה בעריכה ידנית — יש לבנות מחדש לפני החלה.',
}

type BoardPhase = 'loading' | 'ready' | 'error'
type GenPhase = 'idle' | 'generating' | 'done' | 'error'
type ChatMsg = { role: 'user' | 'system'; text: string }

function conversationProposalToModel(input: ConversationProposal): GeneratedPlanModel {
  const alternatives = input.alternatives.map((alternative) => ({
    candidateId: alternative.candidate_id,
    normalizedIdentity: alternative.normalized_identity,
    recommended: alternative.recommended,
    applyable: alternative.applyable,
    semesters: alternative.semesters.map((semester) => ({
      semesterId: semester.semester_id,
      courseIds: [...semester.course_ids],
    })),
    constraintFingerprint: alternative.constraint_fingerprint,
    profileVersion: alternative.profile_version,
    snapshotId: alternative.snapshot_id,
    nonDominated: alternative.non_dominated,
    composedUtility: alternative.composed_utility,
    objectiveScores: alternative.objective_scores.map((score) => ({
      objectiveId: score.objective_id,
      normalized: score.normalized,
    })),
    labelHe: alternative.label_he,
    differencesHe: [...alternative.differences_he],
    workload: {
      peakHours: alternative.workload.peak_hours,
      totalHours: alternative.workload.total_hours,
      activePeriods: alternative.workload.active_periods,
    },
  }))
  const selected = alternatives.find((alternative) => alternative.recommended) ?? alternatives[0]
  return {
    semesters: selected.semesters.map((semester) => ({
      semesterId: semester.semesterId,
      courseIds: [...semester.courseIds],
    })),
    moves: [],
    warningsHe: [],
    errors: [],
    blocked: false,
    agentOutcome: 'proposal',
    applyEligible: selected.applyable,
    profileVersion: input.profile_version,
    proposal: {
      proposalId: input.proposal_id,
      candidateIds: [...input.candidate_ids],
      recommendedCandidateId: input.recommended_candidate_id,
      baseBoardVersion: input.base_board_version,
      profileVersion: input.profile_version,
      academicStatusDigest: input.academic_status_digest,
      expiresAt: input.expires_at,
    },
    alternatives,
  }
}

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
const defaultApply = (req: Parameters<typeof applyPlan>[1]) =>
  applyPlan({ fetchImpl: browserFetch, baseUrl: '' }, req)
const defaultCommittedBoard = (programId: string) =>
  getCommittedBoard({ fetchImpl: browserFetch, baseUrl: '' }, programId)
const defaultEditBoard = (req: Parameters<typeof editBoard>[1]) =>
  editBoard({ fetchImpl: browserFetch, baseUrl: '' }, req)
const defaultEstablishPlanningContext = (req: Parameters<typeof establishPlanningContext>[1]) =>
  establishPlanningContext({ fetchImpl: browserFetch, baseUrl: '' }, req)
const defaultPlanningContext = (programId: string) =>
  getPlanningContext({ fetchImpl: browserFetch, baseUrl: '' }, programId)
const defaultSendConversation = (req: Parameters<typeof sendConversation>[1]) =>
  sendConversation({ fetchImpl: browserFetch, baseUrl: '' }, req)

export interface ManualAddIntent {
  courseId: string
  semesterIds: string[]
}

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
  applyFn = defaultApply,
  committedBoardFn = defaultCommittedBoard,
  useAcademicDecisionAgent = false,
  serverApply = useAcademicDecisionAgent,
  manualAddIntent = null,
  editBoardFn = defaultEditBoard,
  establishPlanningContextFn = defaultEstablishPlanningContext,
  planningContextFn = defaultPlanningContext,
  sendConversationFn = defaultSendConversation,
  initializePlanningContext = false,
  onManualAddSettled,
  onManualAddCancelled = () => undefined,
  onCommittedCourseIdsChange,
  onCloseAgent,
  agentCloseRef,
  agentOpen,
  activeDrag,
  onDragStateChange,
}: {
  programId: string
  getBoardFn?: (programId: string) => Promise<BoardModel>
  generateFn?: (req: GeneratePlanRequest) => Promise<GeneratedPlanModel>
  /** S5 — the authoritative server Apply. Injected so tests need no backend. */
  applyFn?: (req: Parameters<typeof applyPlan>[1]) => Promise<ApplyPlanResult>
  /** S5 — the session's committed board, read on mount and after Apply. */
  committedBoardFn?: (programId: string) => Promise<CommittedBoardState | null>
  manualAddIntent?: ManualAddIntent | null
  editBoardFn?: (req: Parameters<typeof editBoard>[1]) => Promise<ManualBoardEditResult>
  establishPlanningContextFn?: typeof defaultEstablishPlanningContext
  planningContextFn?: (programId: string) => Promise<LoadedPlanningContext | null>
  sendConversationFn?: typeof defaultSendConversation
  /** The production workspace may establish an explicitly-unknown context on first load. */
  initializePlanningContext?: boolean
  onManualAddSettled?: () => void
  onManualAddCancelled?: () => void
  onCommittedCourseIdsChange?: (courseIds: string[]) => void
  onCloseAgent?: () => void
  agentCloseRef?: RefObject<HTMLButtonElement | null>
  agentOpen?: boolean
  activeDrag?: PlannerDragPayload | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
  /**
   * Development/diagnostic-only: when true, Build sends
   * `use_academic_decision_agent: true`. Injectable via prop (not a Production UI
   * toggle) so the default-off feature never leaks into the ordinary Production
   * journey — the native page never sets it. Default false/absent.
   */
  useAcademicDecisionAgent?: boolean
  /** Enable server-authoritative Apply independently of the conversation UI. */
  serverApply?: boolean
}) {
  // ── current plan ──────────────────────────────────────────────────────────
  const [boardPhase, setBoardPhase] = useState<BoardPhase>('loading')
  const [current, setCurrent] = useState<BoardModel | null>(null)
  /**
   * S5 — the server's version of the committed board. `null` means this session
   * has never applied one, which is a legitimate expected value for a first
   * Apply rather than a missing field.
   */
  const [boardVersion, setBoardVersion] = useState<string | null>(null)
  const [manualRevision, setManualRevision] = useState(0)
  const [capturedManualRevision, setCapturedManualRevision] = useState<number | null>(null)
  const [manualEditPhase, setManualEditPhase] = useState<'idle' | 'saving'>('idle')
  const [manualEditError, setManualEditError] = useState<string | null>(null)
  // A server refusal happens after the browser's local drag preview has
  // disappeared. Keep the rejected target highlighted briefly so the user can
  // connect the written explanation with the semester they attempted.
  const [rejectedDrop, setRejectedDrop] = useState<{ semesterId: string; key: number } | null>(null)
  const rejectedDropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualEditKeyRef = useRef<string | null>(null)

  const showRejectedDrop = useCallback((semesterId: string) => {
    if (rejectedDropTimerRef.current) clearTimeout(rejectedDropTimerRef.current)
    const key = Date.now()
    setRejectedDrop({ semesterId, key })
    rejectedDropTimerRef.current = setTimeout(() => {
      setRejectedDrop((current) => current?.key === key ? null : current)
      rejectedDropTimerRef.current = null
    }, 1100)
  }, [])

  useEffect(() => () => {
    if (rejectedDropTimerRef.current) clearTimeout(rejectedDropTimerRef.current)
  }, [])

  useEffect(() => {
    let live = true
    setBoardPhase('loading')
    // The CATALOG is program data (course universe, names, hours); the
    // COMMITTED board is this session's own state. Both are needed, and only
    // the second is user data — so a failure to read it must not hide the
    // catalog, but it must also never be replaced by a silent default.
    const committed = serverApply ? committedBoardFn(programId).catch((e) => {
      console.error('[NativePlannerJourney] committed board load failed:', e)
      return null
    }) : Promise.resolve(null)

    Promise.all([getBoardFn(programId), committed]).then(
      ([catalog, saved]) => {
        if (!live) return
        setCurrent(saved ? applyGeneratedToBoard({ semesters: saved.semesters } as GeneratedPlanModel, catalog) : catalog)
        setBoardVersion(saved?.version ?? null)
        setBoardPhase('ready')
      },
      (e) => { if (live) { console.error('[NativePlannerJourney] board load failed:', e); setBoardPhase('error') } },
    )
    return () => { live = false }
  }, [programId, getBoardFn, committedBoardFn, serverApply])

  useEffect(() => {
    if (!current) return
    onCommittedCourseIdsChange?.([...new Set(current.semesters.flatMap((semester) =>
      semester.courses.map((course) => course.courseId)))])
  }, [current, onCommittedCourseIdsChange])

  // ── conversation + preferences (recorded; never auto-generate) ─────────────
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draftText, setDraftText] = useState('')
  const [maxHours, setMaxHours] = useState('')
  const [priorHours, setPriorHours] = useState('')
  const [wantIds, setWantIds] = useState<string[]>([])
  const [excludeIds, setExcludeIds] = useState<string[]>([])
  const [preferenceVersion, setPreferenceVersion] = useState(0)

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
  const [academicContextPhase, setAcademicContextPhase] = useState<'loading' | 'ready' | 'error'>(
    useAcademicDecisionAgent ? 'loading' : 'ready',
  )
  const [loadedAcademicContext, setLoadedAcademicContext] = useState<LoadedPlanningContext | null>(null)
  const [statusVersion, setStatusVersion] = useState(0)
  const updateAcademicStatus = useCallback((next: AcademicStatusDraft) => {
    setAcademicStatus(next)
    setStatusVersion((v) => v + 1) // any edit invalidates a proposal built from the old status
  }, [])
  const updatePreferenceVersion = useCallback(() => {
    setPreferenceVersion((v) => v + 1) // preference edits invalidate old proposals
  }, [])
  useEffect(() => {
    if (!useAcademicDecisionAgent) return
    let live = true
    setAcademicContextPhase('loading')
    planningContextFn(programId).then(
      (stored) => {
        if (!live) return
        if (stored) {
          setAcademicStatus(academicStatusDraftFromPersonalStatus(stored.personalStatus, programId))
          setLoadedAcademicContext(stored)
        }
        setAcademicContextPhase('ready')
      },
      (error) => {
        if (!live) return
        console.error('[NativePlannerJourney] academic context load failed:', error)
        setAcademicContextPhase('error')
      },
    )
    return () => { live = false }
  }, [programId, planningContextFn, useAcademicDecisionAgent])
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
  /**
   * C3 — which validated alternative the student is currently looking at.
   * Reset on every new response, so a selection can never survive a Rebuild and
   * silently point at a candidate from a superseded set.
   */
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | null>(null)
  const [capturedRev, setCapturedRev] = useState<ProposalBaseRevision | null>(null)
  const [capturedStatusVersion, setCapturedStatusVersion] = useState<number | null>(null)
  const [capturedPreferenceVersion, setCapturedPreferenceVersion] = useState<number | null>(null)
  const [errKind, setErrKind] = useState<'network' | 'contract' | null>(null)
  const tokenRef = useRef(0)
  /** S5 — Apply is a real round-trip now, so it has a pending state. */
  const [applyPhase, setApplyPhase] = useState<'idle' | 'applying'>('idle')
  /** The server's typed refusal, rendered as-is. Never a stack trace. */
  const [applyError, setApplyError] = useState<string | null>(null)
  /**
   * Held across retries of ONE apply attempt so a repeat is recognised as the
   * same work. Cleared on success and whenever the proposal changes.
   */
  const applyKeyRef = useRef<string | null>(null)

  // ── mounted preference conversation (flagged path only) ────────────────────
  // The PreferenceConversation component owns the single authoritative typed
  // ConversationState; here we mirror only the current profile VERSION (a scalar,
  // not a second profile representation) for staleness comparison, and hold the
  // latest profile in a ref so an explicit Build sends the exact typed profile.
  const [convProfileVersion, setConvProfileVersion] = useState<number | undefined>(undefined)
  const convProfileRef = useRef<PreferenceProfile>(emptyProfile())

  /**
   * The ACADEMIC STATUS both Generate and Apply describe.
   *
   * Apply echoes it so the server can confirm the plan's assumptions still
   * hold — a plan built before the student edited their completed courses must
   * not be committed afterwards. It is one function so the two can never
   * describe the same state differently and produce a spurious mismatch.
   */
  const applyAcademicStatus = useCallback((): Record<string, unknown> => {
    const completedIds = useAcademicDecisionAgent ? completedCourseIdsOf(academicStatus) : []
    const status: Record<string, unknown> = {
      completed: completedIds.map((course_id) => ({ course_id })),
      currently_taking: [],
    }
    if (useAcademicDecisionAgent && academicStatus.confirmed) {
      status.completed_knowledge = { status: 'known', provenance: 'explicit_user' }
    }
    return status
  }, [useAcademicDecisionAgent, academicStatus])

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
    const personalStatus: Record<string, unknown> = { ...applyAcademicStatus(), planned: [] }
    const planContext: Record<string, unknown> = {
      semesters: base.semesters.map((s) => ({
        id: s.semesterId,
        courses: s.courses.map((c) => ({ course_id: c.courseId })),
      })),
      personal_status: personalStatus,
    }
    const completedIds = completedCourseIdsOf(academicStatus)
    const earlyYearHours = earlyYearHoursById(programId)
    const identifiedCompletedHours = completedIds.reduce((sum, id) => {
      const hours = earlyYearHours[id] ?? catalogHoursById[id]
      return sum + (typeof hours === 'number' && Number.isFinite(hours) ? hours : 0)
    }, 0)
    const enteredPriorHours = Number(priorHours)
    if (completedIds.length > 0 || (priorHours.trim() && Number.isFinite(enteredPriorHours))) {
      planContext.total_hours_progress = {
        known_completed_hours: Math.max(
          identifiedCompletedHours,
          priorHours.trim() && Number.isFinite(enteredPriorHours) ? enteredPriorHours : 0,
        ),
      }
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
    academicStatus, catalogHoursById,
      applyAcademicStatus, exclusionsNoneConfirmed])

  const refreshAcademicContext = useCallback(() => {
    if (!useAcademicDecisionAgent) return
    planningContextFn(programId).then((stored) => {
      if (stored) setLoadedAcademicContext(stored)
    }).catch((error) => {
      console.error('[NativePlannerJourney] academic context refresh failed:', error)
    })
  }, [planningContextFn, programId, useAcademicDecisionAgent])

  const initializedPlanningContextRef = useRef(false)
  useEffect(() => {
    if (!initializePlanningContext || !useAcademicDecisionAgent || !current
      || academicContextPhase !== 'ready' || loadedAcademicContext || initializedPlanningContextRef.current) return
    initializedPlanningContextRef.current = true
    const contextRequest = buildRequest(current, convProfileRef.current ?? undefined)
    establishPlanningContextFn({
      program_id: programId,
      plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContext>[1]['plan_context'],
      preferences: contextRequest.preferences as Parameters<typeof establishPlanningContext>[1]['preferences'],
    }).then(() => refreshAcademicContext()).catch((error) => {
      console.error('[NativePlannerJourney] initial academic context setup failed:', error)
    })
  }, [academicContextPhase, buildRequest, current, establishPlanningContextFn, initializePlanningContext,
    loadedAcademicContext, programId, refreshAcademicContext, useAcademicDecisionAgent])

  const build = useCallback((profile?: PreferenceProfile) => {
    if (!current) return
    const token = ++tokenRef.current // a newer Build supersedes any older in-flight one
    const revAtRequest = current.catalogRevision
    const statusAtRequest = statusVersion
    const preferenceAtRequest = preferenceVersion
    setGenPhase('generating')
    setErrKind(null)
    generateFn(buildRequest(current, profile)).then(
      (result) => {
        if (token !== tokenRef.current) return
        setProposal(result)
        // A new proposal retires any previous apply attempt: reusing its key
        // would make this different work look like a retry of the old one.
        applyKeyRef.current = null
        setApplyError(null)
        // The recommended alternative is the initial selection, and it is the
        // same plan the handler already put in `semesters`.
        setSelectedAlternativeId(result.alternatives?.find((a) => a.recommended)?.candidateId ?? null)
        setCapturedRev(proposalBaseRevision(revAtRequest as unknown as string))
        setCapturedStatusVersion(statusAtRequest)
        setCapturedPreferenceVersion(preferenceAtRequest)
        setCapturedManualRevision(manualRevision)
        setGenPhase('done')
        refreshAcademicContext()
      },
      (e) => {
        if (token !== tokenRef.current) return
        setErrKind(e instanceof ContractError ? 'contract' : 'network')
        setGenPhase('error')
      },
    )
  }, [current, buildRequest, generateFn, preferenceVersion, statusVersion, manualRevision])

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
          : capturedPreferenceVersion != null && capturedPreferenceVersion !== preferenceVersion
            ? 'preferences'
          // The typed preference profile advanced. `isProposalApplyable` already
          // REFUSED to apply in this case, but that guard is silent — it only
          // greys the button out. Surfacing it here can only make MORE proposals
          // stale, never fewer, so no guard is loosened.
          : useAcademicDecisionAgent && proposal?.profileVersion != null && convProfileVersion != null &&
            proposal.profileVersion !== convProfileVersion
            ? 'preferences'
            : capturedManualRevision != null && capturedManualRevision !== manualRevision
              ? 'manual'
            : null
  const stale = staleReason !== null



  const clearProposal = () => {
    tokenRef.current++ // supersede any in-flight generation so it can't re-open the draft
    setProposal(null)
    setSelectedAlternativeId(null)
    setGenPhase('idle')
    setErrKind(null)
    setApplyError(null)
    applyKeyRef.current = null
  }

  const acceptConversationProposal = useCallback((incoming: ConversationProposal) => {
    if (!current) return
    const nextProposal = conversationProposalToModel(incoming)
    setProposal(nextProposal)
    setSelectedAlternativeId(incoming.recommended_candidate_id)
    setCapturedRev(proposalBaseRevision(current.catalogRevision as unknown as string))
    setCapturedStatusVersion(statusVersion)
    setCapturedPreferenceVersion(preferenceVersion)
    setCapturedManualRevision(manualRevision)
    setGenPhase('done')
    setApplyError(null)
    applyKeyRef.current = null
  }, [current, manualRevision, preferenceVersion, statusVersion])

  const canApply = !!proposal && isProposalApplyable(proposal, stale, {
    // On the flagged path, the proposal must match the CURRENT conversation
    // profile version — an edit after Generate stales it. Legacy path: undefined.
    currentProfileVersion: useAcademicDecisionAgent ? convProfileVersion : undefined,
  })

  /** The exact validated plan Apply will commit — never a UI label or an index. */
  const applyTargetProposal = (): GeneratedPlanModel | null => {
    if (!proposal) return null
    const alt = proposal.alternatives?.find((a) => a.candidateId === selectedAlternativeId)
    if (!alt) return proposal
    // The candidate must still describe the plan it claims to.
    if (!alt.applyable) return null
    return { ...proposal, semesters: alt.semesters.map((sem) => ({ semesterId: sem.semesterId, courseIds: sem.courseIds })) }
  }

  /**
   * S5 — Apply is now a SERVER action on the flagged path.
   *
   * The request names the proposal and the chosen candidate; it carries no
   * plan, because the server holds the validated ones. The committed board is
   * replaced only with what the server returns, and only after it succeeds —
   * an optimistic update here would be the client asserting an outcome it does
   * not own, which is the exact defect this epic exists to remove.
   *
   * Flag-off keeps the previous client-side behaviour, unchanged.
   */
  const apply = async () => {
    if (!current || !proposal || !canApply || applyPhase === 'applying') return

    if (!serverApply) {
      // Legacy path, byte-identical to before.
      const applyTarget = applyTargetProposal()
      if (!applyTarget) return
      setCurrent(applyGeneratedToBoard(applyTarget, current))
      setMessages((m) => [...m, { role: 'system', text: 'התוכנית הוחלה והיא כעת התוכנית הנוכחית.' }])
      clearProposal()
      return
    }

    const receipt = proposal.proposal
    const candidateId = selectedAlternativeId ?? receipt?.recommendedCandidateId ?? null
    if (!receipt || !candidateId) {
      setApplyError('לא ניתן להחיל — יש לבנות תוכנית מחדש.')
      return
    }

    // One key per (proposal, candidate) attempt, so a retry of THIS apply is
    // recognised as the same work rather than a second mutation.
    const key = applyKeyRef.current ?? `${receipt.proposalId}:${candidateId}`
    applyKeyRef.current = key

    setApplyPhase('applying')
    setApplyError(null)
    let result: ApplyPlanResult
    try {
      result = await applyFn({
        program_id: programId,
        proposal_id: receipt.proposalId,
        candidate_id: candidateId,
        expected_board_version: boardVersion,
        expected_profile_version: receipt.profileVersion,
        idempotency_key: key,
        academic_status: applyAcademicStatus(),
      })
    } catch {
      // The call never happened: the committed board is untouched and the draft
      // stays inspectable, so the student can simply try again.
      setApplyPhase('idle')
      setApplyError('שליחת ההחלה נכשלה (שגיאת רשת). התוכנית הנוכחית לא השתנתה.')
      return
    }

    if (!result.ok) {
      setApplyPhase('idle')
      setApplyError(result.messageHe)
      // A conflict means the server moved on; adopting its version lets a
      // Rebuild resync instead of retrying against a version that cannot win.
      if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
      return
    }

    setCurrent(applyGeneratedToBoard({ semesters: result.board.semesters } as GeneratedPlanModel, current))
    setBoardVersion(result.board.version)
    setApplyPhase('idle')
    applyKeyRef.current = null
    setMessages((m) => [...m, { role: 'system', text: 'התוכנית הוחלה והיא כעת התוכנית הנוכחית.' }])
    clearProposal()
  }

  if (boardPhase === 'loading') {
    return (
      <section aria-label="התוכנית הנוכחית" className="planner-board-region flex flex-col gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-bold tracking-tight">לוח הסמסטרים</h2>
          <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--text-muted)]">
            טוען את התוכנית הנוכחית…
          </p>
          <div aria-hidden="true" className="mt-4 grid min-h-40 grid-flow-col auto-cols-[minmax(12rem,1fr)] gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
            {[
              { id: 'year-3-a', label: 'שנה ג׳ — סמסטר א׳' },
              { id: 'year-3-b', label: 'שנה ג׳ — סמסטר ב׳' },
              { id: 'year-4-a', label: 'שנה ד׳ — סמסטר א׳' },
              { id: 'year-4-b', label: 'שנה ד׳ — סמסטר ב׳' },
            ].map((semester) => (
              <div key={semester.id} className="animate-pulse bg-[var(--surface)] p-3">
                <div className="h-4 w-20 rounded bg-black/[.06] dark:bg-white/[.08]" />
                <div className="mt-5 h-20 rounded-lg bg-black/[.04] dark:bg-white/[.05]" />
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }
  if (boardPhase === 'error' || !current) {
    return (
      <section aria-label="התוכנית הנוכחית" className="planner-board-region flex flex-col gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-bold tracking-tight">לוח הסמסטרים</h2>
          <p role="alert" className="mt-2 rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            טעינת התוכנית הנוכחית נכשלה. נא לרענן או לנסות שוב מאוחר יותר.
          </p>
        </div>
      </section>
    )
  }

  /**
   * C3/C4 — the draft actually shown and applied. Selecting an alternative does
   * NOT regenerate: it swaps in the exact plan the handler returned for that
   * candidate. The candidate must belong to the CURRENT response, so a stale or
   * fabricated id can never become the Apply target.
   */
  const selectedAlternative =
    proposal?.alternatives?.find((a) => a.candidateId === selectedAlternativeId) ?? null
  const effectiveProposal: GeneratedPlanModel | null = proposal
    ? (selectedAlternative
        ? { ...proposal, semesters: selectedAlternative.semesters.map((sem) => ({
            semesterId: sem.semesterId, courseIds: sem.courseIds,
          })) }
        : proposal)
    : null

  const removed = effectiveProposal ? removedCourseIds(current, effectiveProposal) : []
  const alternativeBoard = selectedAlternative
    ? applyGeneratedToBoard({ semesters: selectedAlternative.semesters } as GeneratedPlanModel, current)
    : null

  const commitManualAdd = async (semesterId: string, requestedCourseId?: string) => {
    const courseId = requestedCourseId ?? manualAddIntent?.courseId
    if (!courseId || manualEditPhase === 'saving') return
    const operationId = manualEditKeyRef.current ?? `edit_${uuidv4()}`
    manualEditKeyRef.current = operationId
    setManualEditPhase('saving')
    setManualEditError(null)
    let result: ManualBoardEditResult
    try {
      let academicStatusDigest = proposal?.proposal?.academicStatusDigest
      if (!academicStatusDigest) {
        const contextRequest = buildRequest(current, convProfileRef.current ?? undefined)
        const synced = await establishPlanningContextFn({
          program_id: programId,
          plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContext>[1]['plan_context'],
          preferences: contextRequest.preferences as Parameters<typeof establishPlanningContext>[1]['preferences'],
        })
        academicStatusDigest = synced.academicStatusDigest
      }
      result = await editBoardFn({
        operation: 'add_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, semester_id: semesterId,
        academic_status_digest: academicStatusDigest,
      })
    } catch {
      setManualEditPhase('idle')
      setManualEditError('שמירת העריכה נכשלה. הלוח הנוכחי לא השתנה.')
      return
    }
    setManualEditPhase('idle')
    if (!result.ok) {
      setManualEditError(result.messageHe)
      showRejectedDrop(semesterId)
      if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
      return
    }
    setCurrent(applyGeneratedToBoard({ semesters: result.board.semesters } as GeneratedPlanModel, current))
    setBoardVersion(result.board.version)
    setManualRevision((value) => value + 1)
    manualEditKeyRef.current = null
    setMessages((items) => [...items, { role: 'system', text: 'הקורס נוסף ללוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.' }])
    onCommittedCourseIdsChange?.(result.board.semesters.flatMap((semester) => semester.courseIds))
    onManualAddSettled?.()
  }

  const commitManualRemove = async (courseId: string) => {
    if (manualEditPhase === 'saving') return
    const operationId = manualEditKeyRef.current ?? `edit_${uuidv4()}`
    manualEditKeyRef.current = operationId
    setManualEditPhase('saving')
    setManualEditError(null)
    try {
      let academicStatusDigest = proposal?.proposal?.academicStatusDigest
      if (!academicStatusDigest) {
        const contextRequest = buildRequest(current, convProfileRef.current ?? undefined)
        academicStatusDigest = (await establishPlanningContextFn({
          program_id: programId,
          plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContext>[1]['plan_context'],
          preferences: contextRequest.preferences as Parameters<typeof establishPlanningContext>[1]['preferences'],
        })).academicStatusDigest
      }
      const result = await editBoardFn({
        operation: 'remove_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, academic_status_digest: academicStatusDigest,
      })
      setManualEditPhase('idle')
      if (!result.ok) {
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      setCurrent(applyGeneratedToBoard({ semesters: result.board.semesters } as GeneratedPlanModel, current))
      setBoardVersion(result.board.version)
      setManualRevision((value) => value + 1)
      manualEditKeyRef.current = null
      setMessages((items) => [...items, { role: 'system', text: 'הקורס הוסר מהלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.' }])
      onCommittedCourseIdsChange?.(result.board.semesters.flatMap((semester) => semester.courseIds))
    } catch {
      setManualEditPhase('idle')
      setManualEditError('שמירת העריכה נכשלה. הלוח הנוכחי לא השתנה.')
    }
  }

  const commitManualMove = async (courseId: string, semesterId: string) => {
    if (manualEditPhase === 'saving') return
    const operationId = manualEditKeyRef.current ?? `edit_${uuidv4()}`
    manualEditKeyRef.current = operationId
    setManualEditPhase('saving')
    setManualEditError(null)
    try {
      let academicStatusDigest = proposal?.proposal?.academicStatusDigest
      if (!academicStatusDigest) {
        const contextRequest = buildRequest(current, convProfileRef.current ?? undefined)
        academicStatusDigest = (await establishPlanningContextFn({
          program_id: programId,
          plan_context: contextRequest.plan_context as Parameters<typeof establishPlanningContext>[1]['plan_context'],
          preferences: contextRequest.preferences as Parameters<typeof establishPlanningContext>[1]['preferences'],
        })).academicStatusDigest
      }
      const result = await editBoardFn({
        operation: 'move_course', program_id: programId,
        expected_board_version: boardVersion, operation_id: operationId,
        course_id: courseId, semester_id: semesterId,
        academic_status_digest: academicStatusDigest,
      })
      setManualEditPhase('idle')
      if (!result.ok) {
        setManualEditError(result.messageHe)
        if (result.currentBoardVersion !== undefined) setBoardVersion(result.currentBoardVersion ?? null)
        return
      }
      setCurrent(applyGeneratedToBoard({ semesters: result.board.semesters } as GeneratedPlanModel, current))
      setBoardVersion(result.board.version)
      setManualRevision((value) => value + 1)
      manualEditKeyRef.current = null
      setMessages((items) => [...items, { role: 'system', text: 'הקורס הועבר בלוח לאחר אימות השרת. יש לבנות מחדש כדי לעדכן את הצעת העוזר.' }])
      onCommittedCourseIdsChange?.(result.board.semesters.flatMap((semester) => semester.courseIds))
    } catch {
      setManualEditPhase('idle')
      setManualEditError('שמירת העריכה נכשלה. הלוח הנוכחי לא השתנה.')
    }
  }

  const preferenceContent = useAcademicDecisionAgent ? (
    <div className="flex flex-col gap-3">
      <details open>
        <summary className="cursor-pointer text-sm font-semibold">מה חשוב לעוזר לדעת? (אופציונלי)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-[var(--text-muted)]">אפשר להשלים כאן פרטים שיעזרו לשיחה. הסוכן יאשר אותם מולכם — ואין כאן בנייה אוטומטית.</p>
          <CompletedCoursesPanel
            programId={programId}
            catalogCourses={pickerCourses}
            catalogHoursById={catalogHoursById}
            value={academicStatus}
            onChange={updateAcademicStatus}
          />
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            מגבלת שעות שבועיות (אם יש לך העדפה ברורה)
            <input id="max-weekly-hours-control" name="max-weekly-hours" aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours}
              onChange={(e) => { setMaxHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            שעות שכבר הושלמו (רק אם אינן מופיעות ברשימה)
            <input name="known-completed-hours" aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours}
              onChange={(e) => { setPriorHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <CourseNamePicker inputName="wanted-course-search" label="קורסים שחשוב לך לשלב" placeholder="חיפוש לפי שם קורס…"
            courses={pickerCourses} selectedIds={wantIds}
            onChange={(ids) => { setWantIds(ids); updatePreferenceVersion() }} />
          <div id="excluded-courses-control">
            <CourseNamePicker inputName="excluded-course-search" label="קורסים שתרצה להימנע מהם" placeholder="חיפוש לפי שם קורס…"
              courses={pickerCourses} selectedIds={excludeIds}
              onChange={(ids) => { setExcludeIds(ids); updatePreferenceVersion() }} />
            {excludeIds.length === 0 && (
              <button
                type="button"
                aria-pressed={exclusionsNoneConfirmed}
                onClick={() => { setExclusionsNoneConfirmed((v) => !v); updatePreferenceVersion() }}
                className={`mt-2 self-start rounded-full border px-4 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                  exclusionsNoneConfirmed
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-dashed border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                אין קורסים שאני רוצה להימנע מהם
              </button>
            )}
          </div>
          <PreferenceConversation
            onBuild={() => undefined}
            onProfileChange={(profile) => { convProfileRef.current = profile; setConvProfileVersion(profile.version) }}
            showBuild={false}
            showInitialQuestion={false}
            // Server-provided impact signals only refine which question is useful.
            elicitationContext={{
              ...(proposal && proposal.balanceAlternativesMaterial === false ? { irrelevantTopicIds: ['semester_balance'] } : {}),
              ...(proposal?.groundedQuestionImpact ? { groundedFeatureImpact: proposal.groundedQuestionImpact } : {}),
              ...(proposal?.topicQuestionImpact ? { topicInterestImpact: proposal.topicQuestionImpact } : {}),
              ...(proposal?.priorityQuestionImpact && !stale ? {
                objectivePriorityImpact: {
                  eligible: proposal.priorityQuestionImpact.eligible,
                  options: proposal.priorityQuestionImpact.options.map((o) => ({ value: o.value, labelHe: o.labelHe })),
                },
              } : {}),
            }}
          />
        </div>
      </details>
    </div>
  ) : null

  return (
    <div className="planner-journey grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── board / proposal ──────────────────────────────────────────────── */}
      <div className="planner-board-region order-2 flex flex-col gap-4 lg:order-1">
        {manualEditError && (
          <p
            role="alert"
            aria-live="assertive"
            className="planner-board-feedback rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {manualEditError}
          </p>
        )}
        {manualAddIntent && (
          <Card className="flex flex-col gap-3 p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold">הוספת {current.courseCatalog[manualAddIntent.courseId]?.nameHe ?? manualAddIntent.courseId}</h2>
              <button
                type="button"
                aria-label="ביטול הוספת קורס"
                onClick={onManualAddCancelled}
                disabled={manualEditPhase === 'saving'}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:opacity-50"
              >
                ביטול
              </button>
            </div>
            {manualAddIntent.semesterIds.length ? (
              <div className="flex flex-wrap gap-2">
                {manualAddIntent.semesterIds.map((semesterId) => (
                  <button key={semesterId} type="button" disabled={manualEditPhase === 'saving'}
                    onClick={() => commitManualAdd(semesterId)}
                    className="rounded-full border border-[var(--border)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">
                    הוסף אל {semesterTitleHe(semesterId)}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-[var(--text-muted)]">לא נמצא סמסטר מוצע סמכותי לקורס זה.</p>}
          </Card>
        )}
        <section aria-label="התוכנית הנוכחית">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
            {alternativeBoard && <span className="text-xs text-[var(--text-muted)]">לא נשמר עד לאישור מפורש</span>}
          </div>
          {(proposal?.alternatives?.length ?? 0) >= 2 && (
            <AlternativeBoardSwitcher
              alternatives={proposal!.alternatives!}
              selectedId={selectedAlternativeId ?? ''}
              onSelect={setSelectedAlternativeId}
              courseNameById={Object.fromEntries(
                Object.entries(current.courseCatalog).map(([id, course]) => [id, course.nameHe || null]),
              )}
              disabled={stale}
            />
          )}
          <NativePlannerBoard
            board={boardModelToVM(alternativeBoard ?? current)}
            onRemoveCourse={alternativeBoard ? undefined : commitManualRemove}
            onAddCourse={alternativeBoard ? undefined : (courseId, semesterId) => commitManualAdd(semesterId, courseId)}
            onMoveCourse={alternativeBoard ? undefined : commitManualMove}
            mutationPending={alternativeBoard || manualEditPhase === 'saving' ? true : false}
            activeDrag={alternativeBoard ? null : activeDrag}
            rejectedSemesterId={alternativeBoard ? null : rejectedDrop?.semesterId}
            rejectedDropKey={alternativeBoard ? null : rejectedDrop?.key}
            onDragStateChange={alternativeBoard ? undefined : onDragStateChange}
            readOnly={Boolean(alternativeBoard)}
          />
        </section>
        {manualEditPhase === 'saving' && <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">שומר ומאמת…</p>}
        {genPhase === 'done' && proposal && (
          <>
          <ProposalView
            draft={buildDraftVM(effectiveProposal ?? proposal, current)}
            intentOutcome={proposal.intentOutcome}
            removed={removed}
            stale={stale}
            staleReason={staleReason}
            canApply={canApply && applyPhase === 'idle'}
            applying={applyPhase === 'applying'}
            applyError={applyError}
            onApply={apply}
            onReject={clearProposal}
          />
          </>
        )}
      </div>

      {/* ── assistant + preferences + build ───────────────────────────────── */}
      <aside aria-label="עוזר אקדמי" data-open={agentOpen ?? true} className="planner-agent-region order-1 flex flex-col gap-4 lg:order-2">
        {onCloseAgent && (
          <button
            ref={agentCloseRef}
            type="button"
            aria-label="סגור סרגל עוזר AI"
            onClick={onCloseAgent}
            className="planner-drawer-close self-start"
          >
            × <span>סגור עוזר</span>
          </button>
        )}
        {!useAcademicDecisionAgent && <Card className="flex flex-col gap-3 p-4">
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
              name="planner-message"
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
        </Card>}

        {useAcademicDecisionAgent && (
          <AcademicAgentConversation
            programId={programId}
            sessionToken={sessionToken()}
            boardVersion={boardVersion}
            academicStatusDigest={loadedAcademicContext?.academicStatusDigest ?? 'academic_context_loading'}
            preferenceDigest={loadedAcademicContext?.preferenceDigest ?? 'preference_context_loading'}
            preferenceProfile={convProfileRef.current}
            conversationReady={academicContextPhase === 'ready' && Boolean(loadedAcademicContext || !initializePlanningContext)}
            sendConversationFn={sendConversationFn}
            onProposalReady={acceptConversationProposal}
            courseNameById={Object.fromEntries(
              Object.entries(current?.courseCatalog ?? {}).map(([id, course]) => [id, course.nameHe ?? null]),
            )}
            preferenceContent={preferenceContent}
          />
        )}

        {useAcademicDecisionAgent && messages.filter((message) => message.role === 'system').slice(-1).map((message) => (
          <p key={message.text} role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
            {message.text}
          </p>
        ))}

        {useAcademicDecisionAgent && academicContextPhase === 'loading' && (
          <p role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
            טוען את הסטטוס האקדמי השמור…
          </p>
        )}
        {useAcademicDecisionAgent && academicContextPhase === 'error' && (
          <p role="alert" className="text-xs text-red-600">
            לא ניתן לטעון את הסטטוס האקדמי השמור. הבנייה חסומה כדי לא לדרוס אותו.
          </p>
        )}

        {!useAcademicDecisionAgent && <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-bold tracking-tight">העדפות</h2>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            מגבלת שעות שבועיות לסמסטר
            <input id="max-weekly-hours-control" name="max-weekly-hours" aria-label="מגבלת שעות שבועיות" inputMode="numeric" value={maxHours}
              onChange={(e) => { setMaxHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            שעות שהושלמו (שנים א׳–ב׳, מחוץ ללוח)
            <input name="known-completed-hours" aria-label="שעות שהושלמו" inputMode="numeric" value={priorHours}
              onChange={(e) => { setPriorHours(e.target.value); updatePreferenceVersion() }}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <CourseNamePicker inputName="wanted-course-search" label="קורסים להוספה (חיפוש לפי שם)" placeholder="הקלידו שם קורס להוספה…"
            courses={pickerCourses} selectedIds={wantIds}
            onChange={(ids) => { setWantIds(ids); updatePreferenceVersion() }} />
          <div id="excluded-courses-control">
            <CourseNamePicker inputName="excluded-course-search" label="קורסים להחריג (לא יופיעו בתוכנית)" placeholder="הקלידו שם קורס להחרגה…"
              courses={pickerCourses} selectedIds={excludeIds}
              onChange={(ids) => { setExcludeIds(ids); updatePreferenceVersion() }} />
            {/* An empty selection is only an ANSWER once the student says so —
                untouched stays unknown, so it is never silently read as "none". */}
            {useAcademicDecisionAgent && excludeIds.length === 0 && (
              <button
                type="button"
                aria-pressed={exclusionsNoneConfirmed}
                onClick={() => { setExclusionsNoneConfirmed((v) => !v); updatePreferenceVersion() }}
                className={`self-start rounded-full border px-4 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] ${
                  exclusionsNoneConfirmed
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-dashed border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                אין קורסים שאני רוצה להימנע מהם
              </button>
            )}
          </div>
        </Card>}

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

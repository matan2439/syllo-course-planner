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
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import type { ConversationProposal } from '../../../../shared/planner/conversation-wire'
import { ContractError, fromHalfHours, proposalBaseRevision } from '../../../../shared/planner/model'
import type { ProposalBaseRevision } from '../../../../shared/planner/model'
import {
  applyPlan, editBoard, establishPlanningContext,
  type ApplyPlanResult, type CommittedBoardState, type GeneratePlanRequest, type LoadedPlanningContext,
  type ManualBoardEditResult,
} from '../../../../shared/planner/api-client'
import { boardModelToVM } from '../../../lib/planner/board-vm'
import type { CourseVM } from '../../../lib/board'
import { buildCourseDetails, type CourseDetailsVM } from '../../../lib/course-details'
import CourseDetailsPanel from '../../courses/components/CourseDetailsPanel'
import { buildDraftVM } from '../../../lib/planner/draft-vm'
import { applyGeneratedToBoard, removedCourseIds } from '../../../lib/planner/apply-plan'
import { isProposalApplyable } from '../../../lib/planner/apply-eligibility'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'
import {
  EMPTY_ACADEMIC_STATUS,
  academicStatusDraftFromPersonalStatus,
  completedCourseIdsOf,
  type AcademicStatusDraft,
} from '../../courses/components/CompletedCoursesPanel'
import { emptyProfile, type PreferenceProfile } from '../../../../api/ai/preference_model'
import { earlyYearCoursesFor } from '../../../../shared/planner/early_year_courses'
import NativePlannerBoard from './NativePlannerBoard'
import ProgressBadge from './ProgressBadge'
import { adaptRequirementsFromModel } from '../../../lib/requirements'
import AcademicAgentConversation from '../../agent/components/AcademicAgentConversation'
import ProposalView from './ProposalView'
import { BoardError, BoardLoading } from './BoardStatus'
import ManualAddPrompt from './ManualAddPrompt'
import PlannerChatCard from './PlannerChatCard'
import PlannerPreferencesCard from './PlannerPreferencesCard'
import AgentPreferencePanel from './AgentPreferencePanel'
import { buildGeneratePlanRequest } from '../lib/build-plan-request'
import { computeStaleReason } from '../lib/stale-reason'
import { useCommittedBoard } from '../hooks/use-committed-board'
import { useDropHighlights } from '../hooks/use-drop-highlights'
import { useManualBoardEdits } from '../hooks/use-manual-board-edits'
import { conversationProposalToModel } from '../lib/conversation-proposal'
import {
  defaultApply, defaultCommittedBoard, defaultEditBoard, defaultEstablishPlanningContext, defaultGenerate,
  defaultGetBoard, defaultPlanningContext, defaultSendConversation,
} from '../lib/api-defaults'
import type { ChatMsg, GenPhase, ManualAddIntent } from '../types'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { getAiSessionToken } from '../../../lib/ai-session-token'

export type { ManualAddIntent } from '../types'

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
  onSemestersChange,
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
  onSemestersChange?: (semesters: Array<{ semesterId: string; courseIds: string[] }>) => void
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
  const { boardPhase, current, setCurrent, boardVersion, setBoardVersion } = useCommittedBoard({
    programId, getBoardFn, committedBoardFn, serverApply, onCommittedCourseIdsChange, onSemestersChange,
  })
  const [capturedManualRevision, setCapturedManualRevision] = useState<number | null>(null)
  const { rejectedDrop, justPlaced, showRejectedDrop, showJustPlaced } = useDropHighlights()
  // Read-only details panel (with the per-course AI chat) for a course already on the board.
  const [selectedBoardCourse, setSelectedBoardCourse] = useState<CourseDetailsVM | null>(null)
  const selectBoardCourse = (course: CourseVM) =>
    setSelectedBoardCourse(buildCourseDetails({ ...course, offered: course.offeredSemesters ?? [] }))

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
  const academicContextReadVersionRef = useRef(0)
  const [statusVersion, setStatusVersion] = useState(0)
  const acceptedStatusVersionRef = useRef(0)
  const statusVersionRef = useRef(0)
  const updateAcademicStatus = useCallback((next: AcademicStatusDraft) => {
    setAcademicStatus(next)
    statusVersionRef.current += 1
    setStatusVersion((v) => v + 1) // any edit invalidates a proposal built from the old status
  }, [])
  const updatePreferenceVersion = useCallback(() => {
    setPreferenceVersion((v) => v + 1) // preference edits invalidate old proposals
  }, [])
  const sendConversationWithPanelStatus: typeof defaultSendConversation = async (request) => {
    const panelChanged = statusVersion > acceptedStatusVersionRef.current && academicStatus.confirmed
    const answers = new Map((request.clarification_answers ?? []).map((answer) => [answer.question_id, answer]))
    if (panelChanged && !answers.has('completed_courses')) {
      answers.set('completed_courses', { question_id: 'completed_courses', value: completedCourseIdsOf(academicStatus) })
    }
    const response = await sendConversationFn({
      ...request,
      ...(answers.size ? { clarification_answers: [...answers.values()] } : {}),
    })
    if (panelChanged && response.outcome !== 'assistant_unavailable') acceptedStatusVersionRef.current = statusVersion
    return response
  }
  useEffect(() => {
    if (!useAcademicDecisionAgent) return
    let live = true
    setAcademicContextPhase('loading')
    planningContextFn(programId).then(
      (stored) => {
        if (!live) return
        if (stored) {
          if (statusVersionRef.current === acceptedStatusVersionRef.current) {
            setAcademicStatus(academicStatusDraftFromPersonalStatus(stored.personalStatus, programId))
          }
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

  const buildRequest = useCallback((base: BoardModel, profile?: PreferenceProfile): GeneratePlanRequest =>
    buildGeneratePlanRequest(base, profile, {
      messages, draftText, maxHours, priorHours, wantIds, excludeIds, exclusionsNoneConfirmed, programId,
      useAcademicDecisionAgent, academicStatus, catalogHoursById, applyAcademicStatus,
    }),
  [messages, draftText, maxHours, priorHours, wantIds, excludeIds, programId, useAcademicDecisionAgent,
    academicStatus, catalogHoursById,
      applyAcademicStatus, exclusionsNoneConfirmed])

  const {
    manualRevision, manualEditPhase, manualEditError, commitManualAdd, commitManualRemove, commitManualMove,
  } = useManualBoardEdits({
    programId, current, setCurrent, boardVersion, setBoardVersion, manualAddIntent,
    loadedAcademicContext, proposal, buildRequest, convProfileRef, establishPlanningContextFn, editBoardFn,
    showRejectedDrop, showJustPlaced, setMessages, onCommittedCourseIdsChange, onManualAddSettled,
  })

  const refreshAcademicContext = useCallback(() => {
    if (!useAcademicDecisionAgent) return
    const readVersion = ++academicContextReadVersionRef.current
    planningContextFn(programId).then((stored) => {
      // A slower read from an earlier turn must not rewind accepted answers or digests.
      if (readVersion !== academicContextReadVersionRef.current) return
      if (stored) {
        setLoadedAcademicContext(stored)
        if (statusVersionRef.current === acceptedStatusVersionRef.current) {
          setAcademicStatus(academicStatusDraftFromPersonalStatus(stored.personalStatus, programId))
        }
      }
    }).catch((error) => {
      console.error('[NativePlannerJourney] academic context refresh failed:', error)
    })
  }, [planningContextFn, programId, useAcademicDecisionAgent])

  const handleAcademicContextUpdated = useCallback((update: {
    academic_status_digest: string
    preference_digest: string
  }) => {
    setLoadedAcademicContext((current) => current
      ? {
          ...current,
          academicStatusDigest: update.academic_status_digest,
          preferenceDigest: update.preference_digest,
        }
      : current)
    refreshAcademicContext()
  }, [refreshAcademicContext])

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

  // WHY the proposal is stale (see computeStaleReason) — the note names the real cause.
  const staleReason = computeStaleReason({
    genPhase, capturedRev, current, capturedStatusVersion, statusVersion, capturedPreferenceVersion,
    preferenceVersion, useAcademicDecisionAgent, proposal, convProfileVersion, capturedManualRevision, manualRevision,
  })
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

  if (boardPhase === 'loading') return <BoardLoading />
  if (boardPhase === 'error' || !current) return <BoardError />

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

  const preferenceContent = useAcademicDecisionAgent ? (
    <AgentPreferencePanel
      programId={programId}
      pickerCourses={pickerCourses}
      catalogHoursById={catalogHoursById}
      academicStatus={academicStatus}
      updateAcademicStatus={updateAcademicStatus}
      maxHours={maxHours} setMaxHours={setMaxHours}
      priorHours={priorHours} setPriorHours={setPriorHours}
      wantIds={wantIds} setWantIds={setWantIds}
      excludeIds={excludeIds} setExcludeIds={setExcludeIds}
      exclusionsNoneConfirmed={exclusionsNoneConfirmed} setExclusionsNoneConfirmed={setExclusionsNoneConfirmed}
      updatePreferenceVersion={updatePreferenceVersion}
      onProfileChange={(profile) => { convProfileRef.current = profile; setConvProfileVersion(profile.version) }}
      proposal={proposal}
      stale={stale}
    />
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
          <ManualAddPrompt
            intent={manualAddIntent}
            courseName={current.courseCatalog[manualAddIntent.courseId]?.nameHe ?? manualAddIntent.courseId}
            saving={manualEditPhase === 'saving'}
            onCancel={onManualAddCancelled}
            onPick={commitManualAdd}
          />
        )}
        <section aria-label="התוכנית הנוכחית">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">התוכנית הנוכחית</h2>
              <ProgressBadge requirements={adaptRequirementsFromModel(current)} />
            </div>
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
            onSelectCourse={selectBoardCourse}
            mutationPending={alternativeBoard || manualEditPhase === 'saving' ? true : false}
            activeDrag={alternativeBoard ? null : activeDrag}
            rejectedSemesterId={alternativeBoard ? null : rejectedDrop?.semesterId}
            rejectedDropKey={alternativeBoard ? null : rejectedDrop?.key}
            justPlacedSemesterId={alternativeBoard ? null : justPlaced?.semesterId}
            justPlacedKey={alternativeBoard ? null : justPlaced?.key}
            onDragStateChange={alternativeBoard ? undefined : onDragStateChange}
            readOnly={Boolean(alternativeBoard)}
          />
        </section>
        <CourseDetailsPanel course={selectedBoardCourse} onClose={() => setSelectedBoardCourse(null)} programId={programId} />
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
      <aside
        id="workspace-agent-drawer"
        aria-label="עוזר אקדמי"
        aria-hidden={agentOpen === false}
        inert={agentOpen === false}
        data-open={agentOpen ?? true}
        className="planner-agent-region order-1 flex flex-col gap-4 lg:order-2"
      >
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
        {!useAcademicDecisionAgent && (
          <PlannerChatCard messages={messages} draftText={draftText} setDraftText={setDraftText} sendMessage={sendMessage} />
        )}

        {useAcademicDecisionAgent && (
          <AcademicAgentConversation
            programId={programId}
            sessionToken={getAiSessionToken()}
            boardVersion={boardVersion}
            academicStatusDigest={loadedAcademicContext?.academicStatusDigest ?? 'academic_context_loading'}
            preferenceDigest={loadedAcademicContext?.preferenceDigest ?? 'preference_context_loading'}
            preferenceProfile={convProfileRef.current}
            conversationReady={academicContextPhase === 'ready' && Boolean(loadedAcademicContext || !initializePlanningContext)}
            sendConversationFn={sendConversationWithPanelStatus}
            localContextVersion={statusVersion + preferenceVersion}
            courseScopes={[
              { id: 'early-years', label: 'קורסי שנים א׳–ב׳', courseIds: earlyYearCoursesFor(programId).map((course) => course.courseId) },
              { id: 'board', label: 'הקורסים בלוח הנוכחי', courseIds: [...new Set(current.semesters.flatMap((semester) => semester.courses.map((course) => course.courseId)))] },
            ].filter((scope) => scope.courseIds.length > 0)}
            onAcademicContextUpdated={handleAcademicContextUpdated}
            onProposalReady={acceptConversationProposal}
            courseNameById={Object.fromEntries([
              ...earlyYearCoursesFor(programId).map((course) => [course.courseId, course.nameHe]),
              ...Object.entries(current?.courseCatalog ?? {}).map(([id, course]) => [id, course.nameHe ?? null]),
            ])}
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

        {!useAcademicDecisionAgent && (
          <PlannerPreferencesCard
            maxHours={maxHours} setMaxHours={setMaxHours}
            priorHours={priorHours} setPriorHours={setPriorHours}
            wantIds={wantIds} setWantIds={setWantIds}
            excludeIds={excludeIds} setExcludeIds={setExcludeIds}
            pickerCourses={pickerCourses}
            updatePreferenceVersion={updatePreferenceVersion}
          />
        )}

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


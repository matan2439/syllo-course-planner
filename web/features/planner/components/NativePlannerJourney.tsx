'use client'

/**
 * The planner journey: the one owner of planning state, composed over the shared client
 * (shared/planner) with every rule enforced server-side.
 *
 *   load the base board + the session's committed board
 *   → the student edits by hand (add / move / remove, each validated and committed by the server)
 *     and/or talks to the Academic Decision Agent (conversation, preferences, completed courses)
 *   → a proposal is previewed ON the board with added/moved markers and the progress it would leave
 *   → reject, or Apply: the SERVER commits the exact candidate (blocked / stale / errored proposals
 *     cannot apply) and its committed board, with recomputed requirements, becomes the current one.
 *
 * The assistant and profile panels can render into slots owned by the workspace rail (agentPortalTarget /
 * profilePortalTarget) while their state stays here. Transport is injected so the journey is fully
 * testable without a backend; browser defaults hit the real routes.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { BoardModel, GeneratedPlanModel } from '../../../../shared/planner/model'
import {
  applyPlan, editBoard,
  type ApplyPlanResult, type CommittedBoardState, type GeneratePlanRequest, type LoadedPlanningContext,
  type ManualBoardEditResult,
} from '../../../../shared/planner/api-client'
import type { CourseVM } from '../../../lib/board'
import { buildCourseDetails, type CourseDetailsVM } from '../../../lib/course-details'
import CourseDetailsPanel from '../../courses/components/CourseDetailsPanel'
import { buildDraftVM } from '../../../lib/planner/draft-vm'
import { applyGeneratedToBoard, removedCourseIds } from '../../../lib/planner/apply-plan'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { earlyYearCoursesFor, earlyYearHoursById } from '../../../../shared/planner/early_year_courses'
import { completedCourseIdsOf } from '../../courses/components/CompletedCoursesPanel'
import AcademicAgentConversation from '../../agent/components/AcademicAgentConversation'
import ProposalView from './ProposalView'
import AgentContextStatus from './AgentContextStatus'
import CurrentPlanSection from './CurrentPlanSection'
import { BoardError, BoardLoading } from './BoardStatus'
import ManualAddPrompt from './ManualAddPrompt'
import AgentPreferencePanel from './AgentPreferencePanel'
import { buildGeneratePlanRequest } from '../lib/build-plan-request'
import { useCommittedBoard } from '../hooks/use-committed-board'
import { useDropHighlights } from '../hooks/use-drop-highlights'
import { useManualBoardEdits } from '../hooks/use-manual-board-edits'
import { useAcademicContext } from '../hooks/use-academic-context'
import { useCatalogLookups } from '../hooks/use-catalog-lookups'
import { useConversationProfile } from '../hooks/use-conversation-profile'
import { useInitialPlanningContext } from '../hooks/use-initial-planning-context'
import { usePlanProposal } from '../hooks/use-plan-proposal'
import { usePlannerInputs } from '../hooks/use-planner-inputs'
import {
  defaultApply, defaultCommittedBoard, defaultEditBoard, defaultEstablishPlanningContext,
  defaultGetBoard, defaultPlanningContext, defaultSendConversation,
} from '../lib/api-defaults'
import type { ManualAddIntent } from '../types'
import type { PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { getAiSessionToken } from '../../../lib/ai-session-token'

export type { ManualAddIntent } from '../types'

export default function NativePlannerJourney({
  programId,
  getBoardFn = defaultGetBoard,
  applyFn = defaultApply,
  committedBoardFn = defaultCommittedBoard,
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
  agentPortalTarget,
  profilePortalTarget,
  activeDrag,
  onDragStateChange,
}: {
  programId: string
  getBoardFn?: (programId: string) => Promise<BoardModel>
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
  /** When set, the assistant panel renders into this element (the workspace rail) instead of beside the board. */
  agentPortalTarget?: HTMLElement | null
  /** When set, the profile/preferences panel renders into this element (the workspace profile tab), always open. */
  profilePortalTarget?: HTMLElement | null
  activeDrag?: PlannerDragPayload | null
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
}) {
  // ── the board ─────────────────────────────────────────────────────────────
  const { boardPhase, current, setCurrent, boardVersion, setBoardVersion } = useCommittedBoard({
    programId, getBoardFn, committedBoardFn, onCommittedCourseIdsChange, onSemestersChange,
  })
  const { rejectedDrop, justPlaced, showRejectedDrop, showJustPlaced } = useDropHighlights()
  // Read-only details panel (with the per-course AI chat) for a course already on the board.
  const [selectedBoardCourse, setSelectedBoardCourse] = useState<CourseDetailsVM | null>(null)
  const selectBoardCourse = (course: CourseVM) =>
    setSelectedBoardCourse(buildCourseDetails({ ...course, offered: course.offeredSemesters ?? [] }))

  // ── what the student entered (recorded; never auto-generate) ───────────────
  const {
    messages, setMessages, maxHours, setMaxHours, priorHours, setPriorHours,
    wantIds, setWantIds, excludeIds, setExcludeIds, exclusionsNoneConfirmed, setExclusionsNoneConfirmed,
    preferenceVersion, updatePreferenceVersion,
  } = usePlannerInputs()
  const { pickerCourses, catalogHoursById } = useCatalogLookups(current)

  // ── the student's academic status and the assistant's preference profile ───
  const {
    academicStatus, updateAcademicStatus, academicContextPhase, loadedAcademicContext, statusVersion,
    applyAcademicStatus, refreshAcademicContext, handleAcademicContextUpdated, sendConversationWithPanelStatus,
    markAcademicStatusChangedByAssistant,
  } = useAcademicContext({ programId, planningContextFn, sendConversationFn })
  const { convProfileVersion, convProfileRef, onProfileChange } = useConversationProfile()

  // ── one source of truth for the profile panel and the assistant ───────────
  // Panel edits reach the assistant as answers on the next turn (so it never asks
  // again), and what the assistant stored is shown back in the panel.
  const acceptedPreferenceVersionRef = useRef(0)
  const sendConversationWithPanel: typeof defaultSendConversation = async (request, onProgress) => {
    const changed = preferenceVersion > acceptedPreferenceVersionRef.current
    const answers = new Map((request.clarification_answers ?? []).map((answer) => [answer.question_id, answer]))
    if (changed) {
      const hours = Number(maxHours)
      if (maxHours.trim() && Number.isFinite(hours) && !answers.has('max_weekly_hours')) {
        answers.set('max_weekly_hours', { question_id: 'max_weekly_hours', value: hours })
      }
      if ((excludeIds.length > 0 || exclusionsNoneConfirmed) && !answers.has('excluded_courses')) {
        answers.set('excluded_courses', { question_id: 'excluded_courses', value: excludeIds })
      }
      if (!answers.has('wanted_courses')) answers.set('wanted_courses', { question_id: 'wanted_courses', value: wantIds })
    }
    const response = await sendConversationWithPanelStatus({
      ...request,
      ...(answers.size ? { clarification_answers: [...answers.values()] } : {}),
    }, onProgress)
    if (changed && response.outcome !== 'assistant_unavailable') acceptedPreferenceVersionRef.current = preferenceVersion
    return response
  }
  const storedPreferences = loadedAcademicContext?.preferences
  useEffect(() => {
    // Never overwrite panel edits the assistant has not received yet.
    if (!storedPreferences || preferenceVersion !== acceptedPreferenceVersionRef.current) return
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    if (typeof storedPreferences.max_weekly_hours === 'number') setMaxHours(String(storedPreferences.max_weekly_hours))
    if (Array.isArray(storedPreferences.wanted_course_ids)) setWantIds(ids(storedPreferences.wanted_course_ids))
    if (Array.isArray(storedPreferences.disallowed_course_ids)) {
      const excluded = ids(storedPreferences.disallowed_course_ids)
      setExcludeIds(excluded)
      setExclusionsNoneConfirmed(excluded.length === 0)
    }
  }, [storedPreferences]) // eslint-disable-line react-hooks/exhaustive-deps -- hydrate only when the stored copy changes

  const buildRequest = useCallback((base: BoardModel, profile?: PreferenceProfile): GeneratePlanRequest =>
    buildGeneratePlanRequest(base, profile, {
      maxHours, priorHours, wantIds, excludeIds, exclusionsNoneConfirmed, programId,
      academicStatus, catalogHoursById, applyAcademicStatus,
    }),
  [maxHours, priorHours, wantIds, excludeIds, programId, academicStatus, catalogHoursById,
    applyAcademicStatus, exclusionsNoneConfirmed])

  // ── proposals, and manual edits that make them stale ──────────────────────
  // The revision counter lives here because both hooks need it: a manual edit moves it,
  // and a proposal built before that move is stale.
  const [manualRevision, setManualRevision] = useState(0)
  const {
    genPhase, proposal, selectedAlternativeId, setSelectedAlternativeId, applyPhase, applyError,
    staleReason, stale, clearProposal, acceptConversationProposal, canApply, apply,
  } = usePlanProposal({
    programId, current, setCurrent, boardVersion, setBoardVersion, applyFn,
    statusVersion, preferenceVersion, manualRevision, convProfileVersion,
    applyAcademicStatus, setMessages,
  })
  const {
    manualEditPhase, manualEditError, commitManualAdd, commitManualRemove, commitManualMove,
  } = useManualBoardEdits({
    programId, current, setCurrent, boardVersion, setBoardVersion, manualAddIntent,
    loadedAcademicContext, proposal, buildRequest, convProfileRef, establishPlanningContextFn, editBoardFn,
    showRejectedDrop, showJustPlaced, setMessages, onCommittedCourseIdsChange, onManualAddSettled,
    onEditCommitted: () => setManualRevision((value) => value + 1),
  })
  useInitialPlanningContext({
    enabled: initializePlanningContext, current, academicContextPhase,
    loadedAcademicContext, buildRequest, convProfileRef, establishPlanningContextFn, programId,
    refreshAcademicContext,
  })

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
  const draft = effectiveProposal ? buildDraftVM(effectiveProposal, current) : null
  // The proposal is previewed on the board itself (read-only, changed cards marked) while it is still
  // valid to apply. A stale or blocked proposal leaves the committed board editable and untouched.
  // A selected alternative stays previewed (that is how the switcher shows it), even when stale.
  const previewBoard = selectedAlternative
    ? {
        ...applyGeneratedToBoard({ semesters: selectedAlternative.semesters } as GeneratedPlanModel, current),
        // Progress the student would have AFTER applying this alternative (server-recomputed).
        ...(selectedAlternative.requirementsValidation ? { requirementsValidation: selectedAlternative.requirementsValidation } : {}),
      }
    : effectiveProposal && draft && !stale && !draft.blocked
        && effectiveProposal.semesters.some((semester) => semester.courseIds.length > 0)
      ? applyGeneratedToBoard(effectiveProposal, current)
      : null
  const diffMarkers: Record<string, 'new' | 'moved'> = {}
  for (const semester of draft?.semesters ?? []) {
    for (const course of semester.courses) {
      if (course.marker !== 'unchanged') diffMarkers[`${semester.id}|${course.id}`] = course.marker
    }
  }

  const preferenceContent = (
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
      onProfileChange={onProfileChange}
      proposal={proposal}
      stale={stale}
      alwaysOpen={profilePortalTarget !== undefined}
    />
  )

  const wrapAgent = (aside: ReactElement) =>
    agentPortalTarget === undefined ? aside : agentPortalTarget ? createPortal(aside, agentPortalTarget) : null

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
        <CurrentPlanSection
          current={current}
          previewBoard={previewBoard}
          diffMarkers={diffMarkers}
          alternatives={proposal?.alternatives}
          selectedAlternativeId={selectedAlternativeId}
          onSelectAlternative={setSelectedAlternativeId}
          stale={stale}
          commitManualRemove={commitManualRemove}
          commitManualAdd={commitManualAdd}
          commitManualMove={commitManualMove}
          selectBoardCourse={selectBoardCourse}
          manualEditPhase={manualEditPhase}
          activeDrag={activeDrag}
          rejectedDrop={rejectedDrop}
          justPlaced={justPlaced}
          onDragStateChange={onDragStateChange}
          completedCredit={academicStatus.confirmed ? Object.fromEntries(completedCourseIdsOf(academicStatus).flatMap((id) => {
            // Same credit rule as the profile panel and the server: Years 1–2 table, else catalog hours.
            const hours = earlyYearHoursById(programId)[id] ?? catalogHoursById[id]
            return typeof hours === 'number' && Number.isFinite(hours) ? [[id, hours]] : []
          })) : undefined}
        />
        <CourseDetailsPanel course={selectedBoardCourse} onClose={() => setSelectedBoardCourse(null)} programId={programId} />
        {manualEditPhase === 'saving' && <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">שומר ומאמת…</p>}
        {genPhase === 'done' && proposal && (
          <>
          <ProposalView
            draft={draft ?? buildDraftVM(proposal, current)}
            intentOutcome={proposal.intentOutcome}
            semesterLoads={selectedAlternative?.semesterLoads}
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

      {profilePortalTarget && preferenceContent ? createPortal(preferenceContent, profilePortalTarget) : null}

      {/* ── assistant + preferences + build ───────────────────────────────── */}
      {wrapAgent(<aside
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
        <AcademicAgentConversation
          programId={programId}
          sessionToken={getAiSessionToken()}
          boardVersion={boardVersion}
          academicStatusDigest={loadedAcademicContext?.academicStatusDigest ?? 'academic_context_loading'}
          preferenceDigest={loadedAcademicContext?.preferenceDigest ?? 'preference_context_loading'}
          preferenceProfile={convProfileRef.current}
          conversationReady={academicContextPhase === 'ready' && Boolean(loadedAcademicContext || !initializePlanningContext)}
          sendConversationFn={sendConversationWithPanel}
          localContextVersion={statusVersion + preferenceVersion}
          courseScopes={[
            { id: 'early-years', label: 'קורסי שנים א׳–ב׳', courseIds: earlyYearCoursesFor(programId).map((course) => course.courseId) },
            { id: 'board', label: 'הקורסים בלוח הנוכחי', courseIds: [...new Set(current.semesters.flatMap((semester) => semester.courses.map((course) => course.courseId)))] },
          ].filter((scope) => scope.courseIds.length > 0)}
          onAcademicContextUpdated={(update, info) => {
            // The assistant changed stored preferences or status without delivering a new
            // proposal: a proposal already on the board was built with the old ones.
            if (!info?.withProposal && proposal) {
              // Stale for the right reason: preferences and academic status are separate revisions.
              if (update.preference_digest !== loadedAcademicContext?.preferenceDigest) {
                const panelClean = preferenceVersion === acceptedPreferenceVersionRef.current
                updatePreferenceVersion()
                // Not a panel edit: keep hydration from the stored copy working.
                if (panelClean) acceptedPreferenceVersionRef.current += 1
              }
              if (update.academic_status_digest !== loadedAcademicContext?.academicStatusDigest) {
                markAcademicStatusChangedByAssistant()
              }
            }
            handleAcademicContextUpdated(update)
          }}
          onProposalReady={acceptConversationProposal}
          onShowProposal={() => {
            // The rail floats over the board below 1280px; get it out of the way first.
            if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1279px)').matches) onCloseAgent?.()
            document.getElementById('plan-proposal')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          courseNameById={Object.fromEntries([
            ...earlyYearCoursesFor(programId).map((course) => [course.courseId, course.nameHe]),
            ...Object.entries(current?.courseCatalog ?? {}).map(([id, course]) => [id, course.nameHe ?? null]),
          ])}
          preferenceContent={profilePortalTarget === undefined ? preferenceContent : undefined}
        />

        <AgentContextStatus messages={messages} academicContextPhase={academicContextPhase} />
      </aside>)}
    </div>
  )
}


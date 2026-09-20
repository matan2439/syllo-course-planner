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
import { useCallback, useState, type ReactElement, type RefObject } from 'react'
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
import { earlyYearCoursesFor } from '../../../../shared/planner/early_year_courses'
import AcademicAgentConversation from '../../agent/components/AcademicAgentConversation'
import ProposalView from './ProposalView'
import AgentContextStatus from './AgentContextStatus'
import BuildControls from './BuildControls'
import CurrentPlanSection from './CurrentPlanSection'
import { BoardError, BoardLoading } from './BoardStatus'
import ManualAddPrompt from './ManualAddPrompt'
import PlannerChatCard from './PlannerChatCard'
import PlannerPreferencesCard from './PlannerPreferencesCard'
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
  defaultApply, defaultCommittedBoard, defaultEditBoard, defaultEstablishPlanningContext, defaultGenerate,
  defaultGetBoard, defaultPlanningContext, defaultSendConversation,
} from '../lib/api-defaults'
import type { ManualAddIntent } from '../types'
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
  agentPortalTarget,
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
  /** When set, the assistant panel renders into this element (the workspace rail) instead of beside the board. */
  agentPortalTarget?: HTMLElement | null
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
  // ── the board ─────────────────────────────────────────────────────────────
  const { boardPhase, current, setCurrent, boardVersion, setBoardVersion } = useCommittedBoard({
    programId, getBoardFn, committedBoardFn, serverApply, onCommittedCourseIdsChange, onSemestersChange,
  })
  const { rejectedDrop, justPlaced, showRejectedDrop, showJustPlaced } = useDropHighlights()
  // Read-only details panel (with the per-course AI chat) for a course already on the board.
  const [selectedBoardCourse, setSelectedBoardCourse] = useState<CourseDetailsVM | null>(null)
  const selectBoardCourse = (course: CourseVM) =>
    setSelectedBoardCourse(buildCourseDetails({ ...course, offered: course.offeredSemesters ?? [] }))

  // ── what the student entered (recorded; never auto-generate) ───────────────
  const {
    messages, setMessages, draftText, setDraftText, sendMessage, maxHours, setMaxHours, priorHours, setPriorHours,
    wantIds, setWantIds, excludeIds, setExcludeIds, exclusionsNoneConfirmed, setExclusionsNoneConfirmed,
    preferenceVersion, updatePreferenceVersion,
  } = usePlannerInputs()
  const { pickerCourses, catalogHoursById } = useCatalogLookups(current)

  // ── the student's academic status and the assistant's preference profile ───
  const {
    academicStatus, updateAcademicStatus, academicContextPhase, loadedAcademicContext, statusVersion,
    applyAcademicStatus, refreshAcademicContext, handleAcademicContextUpdated, sendConversationWithPanelStatus,
  } = useAcademicContext({ programId, useAcademicDecisionAgent, planningContextFn, sendConversationFn })
  const { convProfileVersion, convProfileRef, onProfileChange } = useConversationProfile()

  const buildRequest = useCallback((base: BoardModel, profile?: PreferenceProfile): GeneratePlanRequest =>
    buildGeneratePlanRequest(base, profile, {
      messages, draftText, maxHours, priorHours, wantIds, excludeIds, exclusionsNoneConfirmed, programId,
      useAcademicDecisionAgent, academicStatus, catalogHoursById, applyAcademicStatus,
    }),
  [messages, draftText, maxHours, priorHours, wantIds, excludeIds, programId, useAcademicDecisionAgent,
    academicStatus, catalogHoursById,
      applyAcademicStatus, exclusionsNoneConfirmed])

  // ── proposals, and manual edits that make them stale ──────────────────────
  // The revision counter lives here because both hooks need it: a manual edit moves it,
  // and a proposal built before that move is stale.
  const [manualRevision, setManualRevision] = useState(0)
  const {
    genPhase, proposal, selectedAlternativeId, setSelectedAlternativeId, errKind, applyPhase, applyError,
    build, staleReason, stale, clearProposal, acceptConversationProposal, canApply, apply,
  } = usePlanProposal({
    programId, current, setCurrent, boardVersion, setBoardVersion, buildRequest, generateFn, applyFn,
    serverApply, useAcademicDecisionAgent, statusVersion, preferenceVersion, manualRevision, convProfileVersion,
    applyAcademicStatus, refreshAcademicContext, setMessages,
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
    enabled: initializePlanningContext, useAcademicDecisionAgent, current, academicContextPhase,
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
      onProfileChange={onProfileChange}
      proposal={proposal}
      stale={stale}
    />
  ) : null

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
          alternativeBoard={alternativeBoard}
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
        />
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

        {useAcademicDecisionAgent && <AgentContextStatus messages={messages} academicContextPhase={academicContextPhase} />}

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

        <BuildControls
          useAcademicDecisionAgent={useAcademicDecisionAgent}
          genPhase={genPhase}
          hasProposal={Boolean(proposal)}
          errKind={errKind}
          onBuild={() => build()}
        />
      </aside>)}
    </div>
  )
}


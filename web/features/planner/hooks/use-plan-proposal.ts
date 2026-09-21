import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { BoardModel, GeneratedPlanModel, ProposalBaseRevision } from '../../../../shared/planner/model'
import type { ConversationProposal } from '../../../../shared/planner/conversation-wire'
import { ContractError, proposalBaseRevision } from '../../../../shared/planner/model'
import type { applyPlan, ApplyPlanResult, GeneratePlanRequest } from '../../../../shared/planner/api-client'
import type { PreferenceProfile } from '../../../../api/ai/preference_model'
import { applyCommittedBoard, applyGeneratedToBoard } from '../../../lib/planner/apply-plan'
import { isProposalApplyable } from '../../../lib/planner/apply-eligibility'
import { conversationProposalToModel } from '../lib/conversation-proposal'
import { computeStaleReason } from '../lib/stale-reason'
import type { ChatMsg, GenPhase } from '../types'

/**
 * Generating a plan proposal, judging whether it is still valid, and applying it.
 *
 * Generation is always explicit (Build / Rebuild); apply is refused for
 * blocked, stale or errored proposals. The `captured*` values remember the
 * inputs a proposal was built from, so any later change marks it stale.
 */
export function usePlanProposal({
  programId, current, setCurrent, boardVersion, setBoardVersion, buildRequest, generateFn, applyFn,
  serverApply, useAcademicDecisionAgent, statusVersion, preferenceVersion, manualRevision, convProfileVersion,
  applyAcademicStatus, refreshAcademicContext, setMessages,
}: {
  programId: string
  current: BoardModel | null
  setCurrent: Dispatch<SetStateAction<BoardModel | null>>
  boardVersion: string | null
  setBoardVersion: Dispatch<SetStateAction<string | null>>
  buildRequest: (base: BoardModel, profile?: PreferenceProfile) => GeneratePlanRequest
  generateFn: (req: GeneratePlanRequest) => Promise<GeneratedPlanModel>
  /** S5 — the authoritative server Apply. Injected so tests need no backend. */
  applyFn: (req: Parameters<typeof applyPlan>[1]) => Promise<ApplyPlanResult>
  serverApply: boolean
  useAcademicDecisionAgent: boolean
  statusVersion: number
  preferenceVersion: number
  manualRevision: number
  convProfileVersion: number | undefined
  applyAcademicStatus: () => Record<string, unknown>
  refreshAcademicContext: () => void
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>
}) {
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
  const [capturedManualRevision, setCapturedManualRevision] = useState<number | null>(null)
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

    setCurrent(applyCommittedBoard(result.board, current))
    setBoardVersion(result.board.version)
    setApplyPhase('idle')
    applyKeyRef.current = null
    setMessages((m) => [...m, { role: 'system', text: 'התוכנית הוחלה והיא כעת התוכנית הנוכחית.' }])
    clearProposal()
  }

  return {
    genPhase, proposal, selectedAlternativeId, setSelectedAlternativeId, errKind, applyPhase, applyError,
    build, staleReason, stale, clearProposal, acceptConversationProposal, canApply, apply,
  }
}

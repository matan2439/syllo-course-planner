import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { BoardModel, GeneratedPlanModel, ProposalBaseRevision } from '../../../../shared/planner/model'
import type { ConversationProposal } from '../../../../shared/planner/conversation-wire'
import { proposalBaseRevision } from '../../../../shared/planner/model'
import type { applyPlan, ApplyPlanResult } from '../../../../shared/planner/api-client'
import { applyCommittedBoard } from '../../../lib/planner/apply-plan'
import { isProposalApplyable } from '../../../lib/planner/apply-eligibility'
import { conversationProposalToModel } from '../lib/conversation-proposal'
import { computeStaleReason } from '../lib/stale-reason'
import type { ChatMsg, GenPhase } from '../types'

/**
 * A proposal from the assistant conversation, judging whether it is still valid, and applying it.
 *
 * Apply is refused for blocked, stale or errored proposals. The `captured*` values remember the
 * inputs a proposal was built from, so any later change marks it stale.
 */
export function usePlanProposal({
  programId, current, setCurrent, boardVersion, setBoardVersion, applyFn,
  statusVersion, preferenceVersion, manualRevision, convProfileVersion,
  applyAcademicStatus, setMessages,
}: {
  programId: string
  current: BoardModel | null
  setCurrent: Dispatch<SetStateAction<BoardModel | null>>
  boardVersion: string | null
  setBoardVersion: Dispatch<SetStateAction<string | null>>
  /** The authoritative server Apply. Injected so tests need no backend. */
  applyFn: (req: Parameters<typeof applyPlan>[1]) => Promise<ApplyPlanResult>
  statusVersion: number
  preferenceVersion: number
  manualRevision: number
  convProfileVersion: number | undefined
  applyAcademicStatus: () => Record<string, unknown>
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>
}) {
  const [genPhase, setGenPhase] = useState<GenPhase>('idle')
  const [proposal, setProposal] = useState<GeneratedPlanModel | null>(null)
  /**
   * Which validated alternative the student is currently looking at.
   * Reset on every new response, so a selection can never survive a new proposal and
   * silently point at a candidate from a superseded set.
   */
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | null>(null)
  const [capturedRev, setCapturedRev] = useState<ProposalBaseRevision | null>(null)
  const [capturedStatusVersion, setCapturedStatusVersion] = useState<number | null>(null)
  const [capturedPreferenceVersion, setCapturedPreferenceVersion] = useState<number | null>(null)
  const [capturedManualRevision, setCapturedManualRevision] = useState<number | null>(null)
  /** Apply is a real round-trip, so it has a pending state. */
  const [applyPhase, setApplyPhase] = useState<'idle' | 'applying'>('idle')
  /** The server's typed refusal, rendered as-is. Never a stack trace. */
  const [applyError, setApplyError] = useState<string | null>(null)
  /**
   * Held across retries of ONE apply attempt so a repeat is recognised as the
   * same work. Cleared on success and whenever the proposal changes.
   */
  const applyKeyRef = useRef<string | null>(null)

  // WHY the proposal is stale (see computeStaleReason) — the note names the real cause.
  const staleReason = computeStaleReason({
    genPhase, capturedRev, current, capturedStatusVersion, statusVersion, capturedPreferenceVersion,
    preferenceVersion, proposal, convProfileVersion, capturedManualRevision, manualRevision,
  })
  const stale = staleReason !== null

  const clearProposal = () => {
    setProposal(null)
    setSelectedAlternativeId(null)
    setGenPhase('idle')
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

  // The proposal must match the CURRENT conversation profile version — an edit after it was made stales it.
  const canApply = !!proposal && isProposalApplyable(proposal, stale, { currentProfileVersion: convProfileVersion })

  /**
   * Apply is a SERVER action.
   *
   * The request names the proposal and the chosen candidate; it carries no
   * plan, because the server holds the validated ones. The committed board is
   * replaced only with what the server returns, and only after it succeeds —
   * an optimistic update here would be the client asserting an outcome it does
   * not own.
   */
  const apply = async () => {
    if (!current || !proposal || !canApply || applyPhase === 'applying') return

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
      // new proposal resync instead of retrying against a version that cannot win.
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
    genPhase, proposal, selectedAlternativeId, setSelectedAlternativeId, applyPhase, applyError,
    staleReason, stale, clearProposal, acceptConversationProposal, canApply, apply,
  }
}

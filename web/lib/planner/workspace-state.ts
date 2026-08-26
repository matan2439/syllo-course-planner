export type ProposalStaleReason =
  | 'manual_board_change'
  | 'academic_status_change'
  | 'preferences_change'

export type PlannerWorkspaceProposal = {
  proposalId: string
  baseBoardVersion: string
  selectedCandidateId: string
  candidateIds: readonly string[]
  staleReason: ProposalStaleReason | null
}

export type PlannerWorkspaceState = {
  boardVersion: string
  academicStatusDigest: string | null
  proposal: PlannerWorkspaceProposal | null
  manualRevision: number
}

export type PlannerWorkspaceEvent =
  | {
      type: 'proposal_received'
      proposalId: string
      baseBoardVersion: string
      selectedCandidateId: string
      candidateIds: readonly string[]
    }
  | { type: 'alternative_selected'; candidateId: string }
  | { type: 'manual_board_committed'; boardVersion: string }
  | { type: 'academic_status_changed'; academicStatusDigest?: string | null }
  | { type: 'preferences_changed' }
  | { type: 'proposal_cleared' }
  | { type: 'agent_apply_committed'; boardVersion: string; proposalId: string }

export function createPlannerWorkspaceState(input: {
  boardVersion: string
  academicStatusDigest?: string | null
}): PlannerWorkspaceState {
  return {
    boardVersion: input.boardVersion,
    academicStatusDigest: input.academicStatusDigest ?? null,
    proposal: null,
    manualRevision: 0,
  }
}

function staleProposal(
  proposal: PlannerWorkspaceProposal | null,
  reason: ProposalStaleReason,
): PlannerWorkspaceProposal | null {
  if (!proposal || proposal.staleReason) return proposal
  return { ...proposal, staleReason: reason }
}

export function reducePlannerWorkspace(
  state: PlannerWorkspaceState,
  event: PlannerWorkspaceEvent,
): PlannerWorkspaceState {
  switch (event.type) {
    case 'proposal_received': {
      if (
        event.candidateIds.length === 0 ||
        !event.candidateIds.includes(event.selectedCandidateId)
      ) return state
      return {
        ...state,
        proposal: {
          proposalId: event.proposalId,
          baseBoardVersion: event.baseBoardVersion,
          candidateIds: [...event.candidateIds],
          selectedCandidateId: event.selectedCandidateId,
          staleReason: null,
        },
      }
    }
    case 'alternative_selected': {
      if (!state.proposal || !state.proposal.candidateIds.includes(event.candidateId)) {
        return state
      }
      if (state.proposal.selectedCandidateId === event.candidateId) return state
      return {
        ...state,
        proposal: { ...state.proposal, selectedCandidateId: event.candidateId },
      }
    }
    case 'manual_board_committed':
      return {
        ...state,
        boardVersion: event.boardVersion,
        manualRevision: state.manualRevision + 1,
        proposal: staleProposal(state.proposal, 'manual_board_change'),
      }
    case 'academic_status_changed':
      return {
        ...state,
        academicStatusDigest:
          event.academicStatusDigest === undefined
            ? state.academicStatusDigest
            : event.academicStatusDigest,
        proposal: staleProposal(state.proposal, 'academic_status_change'),
      }
    case 'preferences_changed':
      return {
        ...state,
        proposal: staleProposal(state.proposal, 'preferences_change'),
      }
    case 'proposal_cleared':
      return state.proposal ? { ...state, proposal: null } : state
    case 'agent_apply_committed':
      if (!state.proposal || state.proposal.proposalId !== event.proposalId) return state
      return { ...state, boardVersion: event.boardVersion, proposal: null }
  }
}

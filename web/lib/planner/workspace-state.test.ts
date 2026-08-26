import {
  createPlannerWorkspaceState,
  reducePlannerWorkspace,
} from './workspace-state'

const initial = () => createPlannerWorkspaceState({
  boardVersion: 'bv_1',
  academicStatusDigest: 'as_1',
})

const withProposal = () => reducePlannerWorkspace(initial(), {
  type: 'proposal_received',
  proposalId: 'proposal_1',
  baseBoardVersion: 'bv_1',
  candidateIds: ['candidate_a', 'candidate_b'],
  selectedCandidateId: 'candidate_a',
})

describe('canonical planner workspace state', () => {
  test('records an authoritative proposal receipt without changing the board', () => {
    const state = withProposal()

    expect(state.boardVersion).toBe('bv_1')
    expect(state.manualRevision).toBe(0)
    expect(state.proposal).toEqual({
      proposalId: 'proposal_1',
      baseBoardVersion: 'bv_1',
      candidateIds: ['candidate_a', 'candidate_b'],
      selectedCandidateId: 'candidate_a',
      staleReason: null,
    })
  })

  test('selecting a proposal member is draft-local and never changes the board', () => {
    const state = reducePlannerWorkspace(withProposal(), {
      type: 'alternative_selected',
      candidateId: 'candidate_b',
    })

    expect(state.boardVersion).toBe('bv_1')
    expect(state.proposal?.selectedCandidateId).toBe('candidate_b')
  })

  test('rejects a fabricated candidate id without changing state', () => {
    const before = withProposal()
    const after = reducePlannerWorkspace(before, {
      type: 'alternative_selected',
      candidateId: 'fabricated',
    })

    expect(after).toBe(before)
  })

  test('a committed manual edit advances the board and stales the whole proposal', () => {
    const state = reducePlannerWorkspace(withProposal(), {
      type: 'manual_board_committed',
      boardVersion: 'bv_2',
    })

    expect(state.boardVersion).toBe('bv_2')
    expect(state.manualRevision).toBe(1)
    expect(state.proposal?.staleReason).toBe('manual_board_change')
  })

  test('switching alternatives in a stale proposal cannot restore applyability', () => {
    const stale = reducePlannerWorkspace(withProposal(), {
      type: 'manual_board_committed',
      boardVersion: 'bv_2',
    })
    const switched = reducePlannerWorkspace(stale, {
      type: 'alternative_selected',
      candidateId: 'candidate_b',
    })

    expect(switched.proposal?.selectedCandidateId).toBe('candidate_b')
    expect(switched.proposal?.staleReason).toBe('manual_board_change')
  })

  test.each([
    ['academic_status_changed', 'academic_status_change'],
    ['preferences_changed', 'preferences_change'],
  ] as const)('%s records its truthful stale reason', (type, staleReason) => {
    const state = reducePlannerWorkspace(withProposal(), { type })
    expect(state.proposal?.staleReason).toBe(staleReason)
  })

  test('an academic-status change advances the digest independently of board version', () => {
    const state = reducePlannerWorkspace(withProposal(), {
      type: 'academic_status_changed',
      academicStatusDigest: 'as_2',
    })

    expect(state.academicStatusDigest).toBe('as_2')
    expect(state.boardVersion).toBe('bv_1')
  })

  test('authoritative Agent Apply replaces the board version and clears once', () => {
    const applied = reducePlannerWorkspace(withProposal(), {
      type: 'agent_apply_committed',
      boardVersion: 'bv_2',
      proposalId: 'proposal_1',
    })
    const duplicate = reducePlannerWorkspace(applied, {
      type: 'agent_apply_committed',
      boardVersion: 'bv_2',
      proposalId: 'proposal_1',
    })

    expect(applied).toEqual({
      boardVersion: 'bv_2',
      academicStatusDigest: 'as_1',
      proposal: null,
      manualRevision: 0,
    })
    expect(duplicate).toBe(applied)
  })

  test('an Apply event for another proposal cannot mutate this workspace', () => {
    const before = withProposal()
    const after = reducePlannerWorkspace(before, {
      type: 'agent_apply_committed',
      boardVersion: 'bv_2',
      proposalId: 'proposal_other',
    })

    expect(after).toBe(before)
  })

  test('event order is deterministic and preserves the first stale cause', () => {
    const manualThenPreferences = reducePlannerWorkspace(
      reducePlannerWorkspace(withProposal(), {
        type: 'manual_board_committed',
        boardVersion: 'bv_2',
      }),
      { type: 'preferences_changed' },
    )

    expect(manualThenPreferences.proposal?.staleReason).toBe('manual_board_change')
  })

  test('proposal-only events are inert when there is no current proposal', () => {
    const before = initial()
    expect(reducePlannerWorkspace(before, {
      type: 'alternative_selected',
      candidateId: 'candidate_a',
    })).toBe(before)
    expect(reducePlannerWorkspace(before, { type: 'proposal_cleared' })).toBe(before)
  })
})

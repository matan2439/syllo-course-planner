import { DeterministicCandidateDecisionCapability } from '../../api/ai/candidate_decision';

test('records the existing recommendation without reordering candidate evidence', () => {
  const decision = new DeterministicCandidateDecisionCapability().decide({
    candidates: [
      { candidateId: 'cand_2', recommended: false },
      { candidateId: 'cand_1', recommended: true },
    ],
  });

  expect(decision).toEqual({
    outcome: 'selected',
    selectedCandidateId: 'cand_1',
    evaluatedCandidateIds: ['cand_2', 'cand_1'],
    alternativesNotSelectedIds: ['cand_2'],
    selectionBasis: 'existing_deterministic_ranking',
  });
})

test('returns a discriminated infeasible result when no candidate survived validation', () => {
  const decision = new DeterministicCandidateDecisionCapability().decide({ candidates: [] });

  expect(decision).toEqual({
    outcome: 'infeasible',
    evaluatedCandidateIds: [],
    selectionBasis: 'no_eligible_candidate',
  });
})

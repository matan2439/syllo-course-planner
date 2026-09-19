/**
 * Decision receipt over candidates that an upstream planner has already ranked
 * and validated. It deliberately does not score, simulate, or mutate a plan.
 */

export interface RankedDecisionCandidate {
  candidateId: string;
  /** Set by the existing deterministic candidate ranking. */
  recommended: boolean;
}

export interface CandidateDecisionInput {
  candidates: readonly RankedDecisionCandidate[];
}

export type CandidateDecisionResult =
  | {
      outcome: 'selected';
      selectedCandidateId: string;
      evaluatedCandidateIds: string[];
      alternativesNotSelectedIds: string[];
      selectionBasis: 'existing_deterministic_ranking';
    }
  | {
      outcome: 'infeasible';
      evaluatedCandidateIds: [];
      selectionBasis: 'no_eligible_candidate';
    };

export interface CandidateDecisionCapability {
  decide(input: CandidateDecisionInput): CandidateDecisionResult;
}

export class DeterministicCandidateDecisionCapability implements CandidateDecisionCapability {
  decide({ candidates }: CandidateDecisionInput): CandidateDecisionResult {
    if (candidates.length === 0) {
      return {
        outcome: 'infeasible',
        evaluatedCandidateIds: [],
        selectionBasis: 'no_eligible_candidate',
      };
    }

    const selected = candidates.find((candidate) => candidate.recommended) ?? candidates[0];
    const evaluatedCandidateIds = candidates.map((candidate) => candidate.candidateId);
    return {
      outcome: 'selected',
      selectedCandidateId: selected.candidateId,
      evaluatedCandidateIds,
      alternativesNotSelectedIds: evaluatedCandidateIds.filter((candidateId) => candidateId !== selected.candidateId),
      selectionBasis: 'existing_deterministic_ranking',
    };
  }
}

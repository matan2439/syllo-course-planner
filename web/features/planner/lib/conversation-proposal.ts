import type { GeneratedPlanModel } from '../../../../shared/planner/model'
import type { ConversationProposal } from '../../../../shared/planner/conversation-wire'

/** Converts the conversation endpoint's wire proposal into the planner's model. */
export function conversationProposalToModel(input: ConversationProposal): GeneratedPlanModel {
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

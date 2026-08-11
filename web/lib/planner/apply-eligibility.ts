/**
 * isProposalApplyable — the single native Apply gate for a generated proposal.
 *
 * Preserves the existing invariants (blocked / errored / stale proposals can
 * never be applied) AND honors the opt-in structured agent outcome: when the
 * AcademicDecisionAgent path marks a draft ineligible (applyEligible === false —
 * clarification_required, validation_failed, or a safe internal error), Apply is
 * blocked even if the plan itself carries no blocking gate error. Absent agent
 * fields (the legacy/default-off response) fall back to blocked/errors/stale
 * alone, so the default path behaves exactly as before.
 */
import type { GeneratedPlanModel } from '../../../shared/planner/model'

export function isProposalApplyable(proposal: GeneratedPlanModel, stale: boolean): boolean {
  if (stale) return false
  if (proposal.blocked) return false
  if (proposal.errors.length > 0) return false
  if (proposal.applyEligible === false) return false
  return true
}

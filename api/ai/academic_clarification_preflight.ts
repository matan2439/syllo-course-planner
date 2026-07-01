/**
 * runClarificationPreflight — pure, no-I/O helper that runs the existing
 * deterministic clarification check (clarifyRequest,
 * academic_clarification_loop.ts, itself wrapping
 * DeterministicClarificationCapability, academic_clarification.ts) against an
 * AcademicDecisionRequest and packages the result together with a UI-ready
 * view model (buildClarificationViewModel, academic_clarification_view_model.ts).
 *
 * Does not decide what's missing itself — delegates entirely to the existing
 * clarification contract. `blocked` mirrors the exact same "any critical
 * missing input" rule AcademicDecisionAgent.run() already uses
 * (academic_decision_agent.ts), so a caller can gate planning consistently
 * without reimplementing that rule.
 *
 * No React/DOM/Supabase/LLM imports. Not wired into AcademicDecisionAgent, the
 * factory, PlannerAgent, planner_orchestration.ts, planner-run.ts, or
 * PlannerWorker. The only intended runtime caller is generate-plan.ts, gated
 * behind AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT (default disabled).
 */

import { clarifyRequest } from './academic_clarification_loop';
import { buildClarificationViewModel, type ClarificationViewModel } from './academic_clarification_view_model';
import type { AcademicDecisionRequest } from './academic_decision_agent';
import type { ClarificationResult } from './academic_decision_types';

export interface ClarificationPreflightResult {
  needsClarification: boolean;
  /** True when a critical missing input means planning should not be delegated. */
  blocked: boolean;
  clarification: ClarificationResult;
  viewModel: ClarificationViewModel;
}

export async function runClarificationPreflight(
  req: AcademicDecisionRequest,
): Promise<ClarificationPreflightResult> {
  const clarification = await clarifyRequest(req);
  const blocked = clarification.missingInputs.some((missingInput) => missingInput.critical);
  const viewModel = buildClarificationViewModel(clarification, { blocking: blocked });

  return {
    needsClarification: clarification.needsClarification,
    blocked,
    clarification,
    viewModel,
  };
}

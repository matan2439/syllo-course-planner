/**
 * POST /api/ai/generate-plan
 *
 * Generates a personalized semester-plan proposal. Supports two code paths:
 *
 * DEFAULT (AI_USE_AGENTIC_PLANNER unset):
 *   PlannerWorker + GreedyOrchestrator / LlmOrchestrator (unchanged).
 *
 * AGENTIC (AI_USE_AGENTIC_PLANNER=true):
 *   PlannerAgent + BeamSearchStrategy. LlmExplainer is injected as an
 *   ExplanationCapability in production; omitted in dev mode so no LLM
 *   step-selection or explanation calls happen.
 *
 * Both paths produce the SAME PlanProposal response contract (semesters, moves,
 * warnings_he, rationale_he, requirements_status, errors, blocked) plus the
 * additive optional `trace`. The apply/reject UI flow is unaffected.
 *
 * CLARIFICATION PREFLIGHT (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT=true, default disabled):
 *   Opt-in only — when unset/false, behavior is identical to the above (any
 *   clarification_answers in the request body are ignored). When enabled,
 *   runs the deterministic clarification check (resumeClarificationPreflight,
 *   academic_clarification_preflight.ts) before either planner path, applying
 *   any optional clarification_answers first. If a critical input is still
 *   missing, returns { needsClarification: true, clarification, viewModel }
 *   instead of a PlanProposal — neither planner path runs, no board/model is
 *   loaded. Once all critical inputs are present (whether from the original
 *   request or from clarification_answers), execution falls through to the
 *   existing planning path below unchanged.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseProgramVersionId, queryBoardJson } from '../board';
import { buildConstraintModel, planContextToState } from './planner_model';
import { loadLocalBoardJson } from './board_loader';
import { PlannerWorker } from './planner_worker';
import { LlmOrchestrator } from './planner_orchestrator';
import { PlannerAgent } from './planner_agent';
import { BeamSearchStrategy } from './planner_search_beam';
import { LlmExplainer } from './llm_explainer';
import {
  validateCandidate,
  validatePlanState,
  disallowedPlacedCourseIds,
  DISALLOWED_PLACED_ERROR_PREFIX,
  ANNUAL_INCOMPLETE_ERROR_PREFIX,
  STEP_LIMIT_ERROR,
  LEGALITY_VIOLATION_ERROR_PREFIX,
  MISSING_MANDATORY_ERROR_PREFIX,
  DEGREE_HOURS_SHORTFALL_ERROR_PREFIX,
  MUST_INCLUDE_ERROR_PREFIX,
} from './planner_validate';
import { OVERLOAD_ERROR_MARKER, ANNUAL_PARTIAL_PLACEMENT_MARKER, CURRENTLY_TAKING_REUSE_ERROR_MARKER } from './plan_validation';
import {
  incompleteAnnualCourseIds,
  missingMustIncludeCourseIds,
  applyMutation,
  isFullyPlaced,
  degreeHours as computeDegreeHours,
  scorePlan,
  compareScore,
  assessCompleteness,
} from './planner_goals';
import { enumerateActions, isExcluded, addCourseActionsFor, isMovable, legalSemestersFor } from './planner_actions';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import { resolveModel, isDevMode, isBypassQuota, isTestModeBypass, sendError } from './course-planner';
import { getSemesterLoad, getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';
import { HARD_LOAD_CAP, ABSOLUTE_MAX_REASONABLE } from './load_constants';
import type { SearchCapability } from './planner_capabilities';
import type { ConstraintModel, PlanState, PlannerMutation, DistributionPolicy } from './planner_types';
import { placedCourseIds, semesterOf, emptyState } from './planner_types';
import { resumeClarificationPreflight } from './academic_clarification_preflight';
import { mergeClarificationAnswersIntoGeneratePlanInputs } from './academic_clarification_plan_inputs';
import { normalizeAcademicInterestProfile, type RawAcademicInterestProfile } from './academic_interest_profile';
import { buildGeneratePlanInterestEvaluation } from './generate_plan_interest_evaluation';
import {
  extractClarificationContext,
  clarifyForAcademicDecision,
  buildAcademicDecision,
  resolveHardExcludedCourseIds,
  hasCriticalMissingInput,
} from './academic_decision_runtime';
import { runAcademicDecisionAgent, classifyAgentOutcome, isApplyEligible } from './academic_decision_integration';
import { effectivePlannerPreferences, type EffectivePlannerPreferences } from './preference_eligibility';
import { resolveDistributionPolicy } from './distribution_policy';
import { generateCandidateSet, selectCandidate, selectionReason, candidateCourseIds } from './candidate_set';
import { analyzeHardConstraints, hardWantedConstraintsEnabled } from './hard_constraints';
import { resolveGroundedObjective } from './grounded_preference';
import { prepareEvidence, RECENT_OFFICIAL_SYLLABUS_POLICY } from './evidence_provider';
import { TOPIC_IDS } from './course_topics';
import { groundedTopicsForFocusAreas, mergeExplicitFocusObjective, mergeStructuredAvoidObjective } from './focus_topic_objective';
import { TOPIC_INTEREST_LABELS_HE } from './preference_elicitation';
import { explainGroundedRanking, explainGroundedComposition, scoreCandidateOnObjective, type ObjectiveContribution } from './grounded_objectives';
import { buildPlanAlternatives, constraintFingerprint } from './plan_alternatives';
import { computePriorityQuestionImpact } from './priority_impact';
import { describeAcademicProgress } from './academic_progress';
import { resolveOwner } from './session_owner';
import { academicStatusDigest, getBoardRepository, getProposalStore } from './apply_runtime';
import { PROPOSAL_TTL_MS, newProposalId, toReceipt, type ProposalRecord } from './proposal_store';
import { loadPreparedEvidenceDocuments } from './evidence_loader';
import type { ClarificationResult } from './academic_decision_types';
import {
  extractCatalog,
  interpretPlanningIntent,
  mergeIntentIntoPreferences,
  buildIntentOutcome,
  type PlanningIntent,
} from './planning_intent';
import { type CourseCapabilityEvidence } from './course_capability_evidence';
import { getExternalContextEvidence } from './external_context_evidence';
import { buildSyllabusSnapshot } from './syllabus_snapshot';
import { loadEnrichedProfileCache, lookupProfile } from './course_profile_cache';

export const preferencesSchema = z.object({
  max_weekly_hours:        z.number().nullish(),
  balance_load:            z.boolean().optional(),
  avoid_multiple_labs:     z.boolean().optional(),
  avoid_multiple_projects: z.boolean().optional(),
  preferred_categories:    z.array(z.string()).optional(),
  wanted_course_ids:       z.array(z.string()).optional(),
  unwanted_course_ids:     z.array(z.string()).optional(),
  // Hard exclusions (additive, optional — older clients omit these).
  disallowed_course_ids:        z.array(z.string()).optional(),
  strongly_avoided_course_ids:  z.array(z.string()).optional(),
  extra_request_he:        z.string().max(1000).optional(),
  action_type:             z.enum(['full_plan', 'balance_load', 'add_electives', 'fix_prerequisites', 'minimal_changes']).optional(),
  pinned_course_ids:       z.array(z.string()).optional(),
  overload_accepted:       z.boolean().optional(),
  overload_confirmed_at:   z.number().nullish(),
});

const clarificationAnswerSchema = z.object({
  questionId: z.string(),
  value: z.union([z.array(z.string()), z.string(), z.number()]),
});

const requestSchema = z.object({
  program_id:    z.string().min(1, 'program_id is required'),
  plan_context:  z.any(),
  course_context: z.string().max(8000).optional(),
  preferences:   preferencesSchema,
  session_token: z.string().uuid('session_token must be a valid UUID'),
  // Additive, optional — only consumed when AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT is enabled.
  clarification_answers: z.array(clarificationAnswerSchema).optional(),
  // Additive, optional, request-level opt-in — when true, an interestEvaluation
  // is attached to the plan response (see buildGeneratePlanInterestEvaluation).
  // Absent/false => byte-identical response to before this epic.
  include_interest_evaluation: z.boolean().optional(),
  academic_interest_profile: z.any().optional(),
  // Additive, optional, request-level opt-in — when true, the response gains an
  // additive `academicDecision` object orchestrating clarification, validation,
  // evaluation, decision, and a Hebrew-ready explanation around the (unchanged)
  // generated plan. Absent/false => byte-identical response to before.
  use_academic_decision_agent: z.boolean().optional(),
  // Additive, opt-in — when true, preferences.extra_request_he (free-text
  // Hebrew) is interpreted at the planning-intent boundary (planning_intent.ts)
  // into the SAME structured planner fields (disallowed / wanted / max hours /
  // balance) the greedy planner already honors, and an additive `intentOutcome`
  // (honored / partiallyHonored / unmet, derived from the ACTUAL plan) is
  // attached. Absent/false => free text reaches only the LLM context, as before.
  interpret_free_text: z.boolean().optional(),
  // Additive, optional — the typed elicited-preference profile (Slice 14). Only
  // consumed on the flagged agent path; the typed PreferenceProfile (NOT the
  // chat transcript) is the source of truth. Absent => byte-identical to before.
  preference_profile: z
    .object({
      version: z.number().int().nonnegative(),
      preferences: z.array(
        z.object({
          id: z.string().min(1),
          category: z.string().optional(),
          normalized: z.string(),
          value: z.unknown().optional(),
          classification: z.enum(['hard_constraint', 'soft_preference', 'goal', 'indifferent', 'uncertain']),
          confidence: z.number().optional(),
          source: z.enum(['explicit_answer', 'confirmed_interpretation', 'existing_profile', 'safe_default']).optional(),
          confirmationStatus: z.enum(['unconfirmed', 'pending', 'confirmed', 'rejected']).optional(),
          affects: z.string(),
          mayAffectPlanningBeforeConfirmation: z.boolean().optional(),
        }),
      ),
    })
    .optional(),
});

type Preferences = z.infer<typeof preferencesSchema>;

async function runQuotaCheck(session_token: string, dbUrl: string, res: VercelResponse): Promise<boolean> {
  let quota;
  try {
    quota = await checkAndEnsureSession(session_token, dbUrl);
  } catch (err) {
    console.error('[ai/generate-plan] quota DB error:', err instanceof Error ? err.message : String(err));
    sendError(res, 503, 'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.', 'DB_ERROR', { phase: 'quota_check' });
    return false;
  }
  if (!quota.allowed) {
    if (isTestModeBypass()) { res.setHeader('X-AI-Quota-Bypass', 'true'); return true; }
    sendError(res, 429, 'מכסת שאלות ה-AI החינמית נוצלה.', 'QUOTA_EXCEEDED', {
      credits_used: quota.credits_used, free_limit: quota.free_limit, credits_paid: quota.credits_paid, remaining: 0,
    });
    return false;
  }
  return true;
}

export function priorHoursFromContext(ctx: any): number {
  const thp = ctx?.total_hours_progress ?? {};
  // currently_planned_hours is excluded: board-placed courses are already seeded
  // into initialState by planContextToState — counting them here too would
  // inflate degreeHours and make the planner stop early.
  return thp.manual_completed_degree_hours ?? (thp.known_completed_hours ?? 0);
}

export interface CourseFitResult {
  /** Planner-facing per-course soft fit weight (evidence strength × requested weight). */
  fitById: Map<string, number>;
  /** The strongest official-syllabus evidence per fit-carrying course (for the explanation). */
  evidenceById: Map<string, CourseCapabilityEvidence>;
}

/**
 * Resolve interpreted focus-area preferences into a per-course general user-fit
 * score, sourced ONLY from the VALIDATED, VERSIONED enrichment cache (semantic
 * extraction → grounding validation → versioned profile). Generate performs no
 * semantic extraction: it builds each course's syllabus snapshot (content hash) and
 * reads the committed cache (course_profile_cache.ts). A course contributes fit only
 * on a cache HIT for the requested capability; stale/refresh-required/insufficient →
 * no fit (honest — we only trust reviewed, validated evidence, never title inference).
 * Empty/undefined when no focus is expressed or no cache exists (planner unchanged).
 */
export function buildCourseFitById(board: any, focusAreas: PlanningIntent['focusAreas'], programOrCatalog?: string): CourseFitResult | undefined {
  if (!focusAreas?.length || !programOrCatalog) return undefined;
  const cache = loadEnrichedProfileCache(programOrCatalog);
  if (!cache) return undefined; // no validated evidence available → no fit

  const courses: any[] = [];
  for (const s of board?.semesters ?? []) for (const c of s?.courses ?? []) courses.push(c);
  for (const c of board?.metadata?.program_repository_courses ?? []) courses.push(c);

  const fitById = new Map<string, number>();
  const evidenceById = new Map<string, CourseCapabilityEvidence>();
  for (const c of courses) {
    const id = c?.course_id;
    if (typeof id !== 'string' || fitById.has(id)) continue;
    const snapshot = buildSyllabusSnapshot(c, programOrCatalog);
    let sum = 0;
    let best: CourseCapabilityEvidence | undefined;
    for (const fa of focusAreas) {
      const look = lookupProfile(cache, snapshot, fa.area);
      if (look.status !== 'hit' || !look.evidence) continue;
      sum += look.evidence.strength * fa.weight;
      if (!best || look.evidence.strength > best.strength) best = look.evidence;
    }
    if (sum > 0) {
      fitById.set(id, sum);
      if (best) evidenceById.set(id, best);
    }
  }
  return fitById.size ? { fitById, evidenceById } : undefined;
}

/** Build the model from board_json (full universe). board is always non-null here. */
export function buildModel(board: any, ctx: any, prefs: Preferences, program_id?: string, currentlyPlannedCourseIds?: string[], courseFitById?: Map<string, number>, distributionPolicy?: DistributionPolicy): ConstraintModel {
  // Phase 0 — identity metadata only; parseProgramVersionId is the same parser
  // already used above to route the board_json lookup, reused here for the
  // model's programId/catalogYear. No institutionId source exists yet.
  const pv = program_id ? parseProgramVersionId(program_id) : null;
  return buildConstraintModel(board, {
    completedCourseIds: (ctx?.personal_status?.completed ?? []).map((c: any) => c.course_id),
    currentlyPlannedCourseIds,
    // Slice 18A — current product policy: the user-facing "wanted" picker is a
    // HARD `must_include` constraint, and the "avoided" picker a HARD
    // `must_exclude` one (already resolveHardExcludedCourseIds, below). The two
    // channels are mutually exclusive by construction so a hard selection can
    // never also be scored as a soft, tradeable g5 preference. Flag-off
    // (AI_HARD_WANTED_CONSTRAINTS=false) restores the legacy soft-only mapping
    // byte-identically — see hard_constraints.ts for that contract.
    ...(hardWantedConstraintsEnabled()
      ? { mustIncludeCourseIds: prefs.wanted_course_ids }
      : { wantedCourseIds: prefs.wanted_course_ids }),
    unwantedCourseIds: prefs.unwanted_course_ids,
    courseFitById,
    disallowedCourseIds: resolveHardExcludedCourseIds(prefs),
    pinnedCourseIds: ctx?.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours: priorHoursFromContext(ctx),
    overloadAccepted: prefs.overload_accepted,
    overloadConfirmedAt: prefs.overload_confirmed_at,
    programId: pv?.base,
    catalogYear: pv?.year,
    ...(distributionPolicy ? { distributionPolicy } : {}),
  });
}

/** Same overload gate as before: block above the hard cap / absolute max. */
function overloadGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
  prefs: Preferences,
): string[] {
  const courseHours: Record<string, { hours?: number | null }> = {};
  for (const [id, p] of model.profiles) courseHours[id] = { hours: p.hours };
  const userConfirmed = prefs.overload_accepted === true && !!prefs.overload_confirmed_at;
  const errors: string[] = [];
  for (const sem of semesters) {
    const hrs = getSemesterLoad(sem, courseHours);
    if (hrs > ABSOLUTE_MAX_REASONABLE) {
      errors.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — חריגה לא סבירה מעל ${ABSOLUTE_MAX_REASONABLE}. לא ניתן להחיל את התוכנית.`);
    } else if (hrs > HARD_LOAD_CAP && !userConfirmed) {
      errors.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — חריגה מהמגבלה הקשיחה (${HARD_LOAD_CAP}). נדרש אישור חריגה מפורש לפני החלת התוכנית.`);
    }
  }
  return errors;
}

/**
 * issue #25 Finding #3: preferences.max_weekly_hours is a real user-stated
 * soft cap (used only as a search tiebreaker in planner_goals.ts), but
 * exceeding it was never disclosed anywhere in the default (no-flag) path's
 * warnings_he — only inside the opt-in use_academic_decision_agent path's
 * academicDecision.evaluation.workloadNotes (academic_decision_runtime.ts's
 * computeWorkloadNotes), which was unreachable for anyone still gated by
 * Finding #2. This is the single source of truth now: it feeds warnings_he
 * below, which both paths share (the agent path's explanation.risksAndTradeoffs
 * reads proposal.warnings_he directly) — computeWorkloadNotes' equivalent
 * per-semester check was removed to avoid showing the same message twice.
 * Only warns when the user actually set the preference (undefined/null is
 * "no preference stated," not "cap of 0") — never invents a cap.
 */
function maxWeeklyHoursWarnings(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
  prefs: Preferences,
): string[] {
  const maxWeeklyHours = prefs.max_weekly_hours;
  if (maxWeeklyHours === undefined || maxWeeklyHours === null) return [];
  const courseHours: Record<string, { hours?: number | null }> = {};
  for (const [id, p] of model.profiles) courseHours[id] = { hours: p.hours };
  const warnings: string[] = [];
  for (const sem of semesters) {
    const hrs = getSemesterLoad(sem, courseHours);
    if (hrs > maxWeeklyHours) {
      warnings.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — מעל המגבלה שביקשת (${maxWeeklyHours}).`);
    }
  }
  return warnings;
}

/**
 * A course the user has hard-excluded (disallowed_course_ids /
 * strongly_avoided_course_ids, or a catalog-level exclusion) must never
 * survive in the final plan silently — e.g. it was already on the board
 * before the exclusion was added, and the planner only ever adds/moves
 * courses, never removes a previously-placed one on its own. validateCandidate
 * (planner_validate.ts) already detects this (disallowedPlaced), but that
 * report is internal to toProposal — this mirrors the same check against the
 * final placed set so the handler can turn it into a real blocking error
 * instead of a plan that silently reports blocked:false, errors:[].
 */
function disallowedGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
): string[] {
  const placed = new Set(semesters.flatMap(s => s.course_ids));
  return disallowedPlacedCourseIds(placed, model).map(
    id => `${DISALLOWED_PLACED_ERROR_PREFIX} ${model.profiles.get(id)?.name_he ?? id}.`,
  );
}

/**
 * Slice 18A — the mirror image of disallowedGate for HARD INCLUSION. A course the
 * user explicitly asked for (`must_include`, the wanted picker) that the final
 * plan does not satisfy — not completed, not currently taking, not scheduled —
 * must surface as a BLOCKING error, never as a silently-dropped preference.
 * validateCandidate already computes this (missingMustInclude), but that report
 * is internal to the candidate machinery; this re-derives it against the FINAL
 * placed set so the handler turns it into a real blocking error rather than a
 * plan that reports blocked:false with the requested course quietly absent.
 */
function mustIncludeGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
): string[] {
  const state: PlanState = { semesters: Object.fromEntries(model.knownSemesterIds.map(id => [id, [] as string[]])) };
  for (const s of semesters) if (state.semesters[s.semester_id]) state.semesters[s.semester_id] = [...s.course_ids];
  return missingMustIncludeCourseIds(state, model).map(
    id => `${MUST_INCLUDE_ERROR_PREFIX} ${model.profiles.get(id)?.name_he ?? id}.`,
  );
}

/**
 * An `is_annual` (year-long) course must occupy EVERY one of its effective
 * spans in the FINAL plan. planner_worker.ts's step()/run() repairs this
 * whenever a legal repair exists, but when every remaining span would breach
 * the hard cap (or any other legal obstruction blocks the repair), the loop
 * falls through to the normal scored search and can stop with the course
 * still split across only some of its semesters — validateCandidate
 * (via plan_validation.ts's own annual-completeness check) already detects
 * this, but that report is internal to toProposal and never reaches
 * blockingErrors. Mirrors disallowedGate's pattern: re-derive the same
 * signal against the FINAL placed set so an unrepaired split is reported as
 * a real blocking error instead of a plan silently reporting blocked:false.
 */
function annualCompletenessGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
): string[] {
  const state: PlanState = { semesters: Object.fromEntries(semesters.map(s => [s.semester_id, s.course_ids])) };
  return incompleteAnnualCourseIds(state, model).map(
    id => `${ANNUAL_INCOMPLETE_ERROR_PREFIX}${model.profiles.get(id)?.name_he ?? id}) לא הושלם בכל הסמסטרים הנדרשים ולכן התוכנית אינה תקפה.`,
  );
}

/**
 * validatePlanState (planner_validate.ts's "single source of truth for hard
 * legality") already enforces prerequisite strict-timing, duplicate
 * placement, completed/currently-taking course reuse, pinned-course "don't
 * move," and illegal offering-semester placement against the FINAL state —
 * toProposal() above calls it (via validateCandidate's `report`) but only
 * ever reads report.warnings from that result, never report.errors/
 * report.legal, so a violation of any of these could report blocked:false,
 * errors:[] while academicDecision.validation.valid renders a green "passed
 * legality" checkmark next to explanation text (whyThisPlan) admitting the
 * very same violation — a reproduced, rendered, in-product self-contradiction
 * (Agent Diagnosis Loop finding). Mirrors disallowedGate's/
 * annualCompletenessGate's established pattern: re-derive against the FINAL
 * placed set via the same validator so detection can never drift from the
 * actual check.
 *
 * Excludes overload and annual-incompleteness: validatePlanState happens to
 * check both of those too (its own items 5 and 5b), but they already have
 * their own independently-worded, longer-standing gates above (overloadGate,
 * annualCompletenessGate) — including them here too would report the exact
 * same real violation twice under two differently-worded blockingErrors
 * entries for the same underlying fact.
 *
 * Also excludes the "currently_taking/planned course must not be
 * (re-)proposed" check (item 2a): unlike every other check here, that one
 * fires on entirely normal, expected client state — the real board
 * legitimately keeps a currently-taking course visible in its placed
 * semester slot while also reporting it in personal_status.currently_taking
 * (buildPlanContext in semester_board_viewer.html filters completed courses
 * out before sending, but deliberately keeps currently-taking ones so they
 * still render). Treating that combination as a blocking legality violation
 * would false-positive-block an applicable plan for essentially any
 * actively-enrolled student (Codex review finding on this PR).
 *
 * Each surfaced message is prefixed with LEGALITY_VIOLATION_ERROR_PREFIX so
 * academic_decision_runtime.ts's cause-attribution can tell this bucket apart
 * from a genuine overload block (see that file's own hasOverloadError
 * comment, which already anticipated a "fifth" cause needing this).
 *
 * Like every other gate here, this only ever fires for pre-existing/fixed
 * placements carried over from client-supplied plan_context: the search
 * itself validates every mutation before accepting it (planner_worker.ts's
 * step()), so it can never introduce any of these violations on its own.
 */
/**
 * planner_goals.ts's assessCompleteness already computes missingMandatory
 * against the FINAL state (excluding completed/currently-taking courses —
 * see generate_plan_currently_taking_mandatory.test.ts), and
 * validateCandidate's report.errors already includes a "קורס חובה חסר"
 * message for it — but toProposal() above only ever turned it into a soft
 * warnings_he entry, never a blockingErrors entry, so a plan could report
 * success (blocked:false, and on the use_academic_decision_agent path,
 * academicDecision.validation.valid:true) while a required course was
 * silently absent. Same "computed-but-discarded validation signal" bug class
 * as disallowedGate/annualCompletenessGate/legalityGate above.
 *
 * Unlike those three gates, this one is NOT limited to a pre-existing/
 * client-supplied illegal state: the search itself can end up short a
 * mandatory course, e.g. a permanent prerequisite-ordering deadlock (a
 * mandatory course only legal in an earlier semester than its own
 * prerequisite's only legal semester — no algorithm can resolve that), or a
 * bounded beam-search budget converging on an incomplete state a different
 * strategy would have avoided (the concrete Agent Diagnosis Loop finding
 * that motivated this gate: on an identical real board fixture, the
 * AI_USE_AGENTIC_PLANNER path failed to place 4 mandatory courses the
 * default greedy path successfully placed, and both silently reported
 * blocked:false). Either way, this routine's own product policy is explicit:
 * "no successful plan may violate mandatory requirements" — so this is
 * disclosed as a blocking error regardless of root cause, mirroring the
 * established gate pattern: re-derive against the FINAL placed set so
 * detection can never drift from the actual check.
 */
function missingMandatoryGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
): string[] {
  const state: PlanState = { semesters: Object.fromEntries(semesters.map(s => [s.semester_id, s.course_ids])) };
  const { missingMandatory } = assessCompleteness(state, model);
  return missingMandatory.map(
    id => `${MISSING_MANDATORY_ERROR_PREFIX} ${model.profiles.get(id)?.name_he ?? id}.`,
  );
}

/**
 * See DEGREE_HOURS_SHORTFALL_ERROR_PREFIX's own doc comment (planner_validate.ts)
 * for the Agent Diagnosis Loop finding this closes.
 *
 * Deliberately re-derives the exact same unrecoverability condition
 * toProposal's own "מיצית את כל הקורסים הזמינים" warnings_he branch already
 * computes (same guard clauses, same canRecoverViaUnwantedElective/
 * canRecoverMoreHours calls) — mirrors every other gate in this file
 * (independent re-derivation from the FINAL placed set so detection can
 * never drift from the actual check), rather than threading a boolean out of
 * toProposal's return value, which would either leak an internal-only field
 * into the public PlanProposal response contract (toProposal's result is
 * spread directly into responseBody below) or require a second, easily
 * forgotten call-site change every time toProposal's shape evolves.
 *
 * Codex review finding (PR #62): report.legal (validateCandidate's raw
 * legality check) also flags the benign, expected "currently-taking course
 * still present on the client-supplied board" marker (item 2a,
 * CURRENTLY_TAKING_REUSE_ERROR_MARKER, plan_validation.ts) as illegal —
 * legalityGate above already excludes this exact marker as normal client
 * state, not a real violation (the real frontend deliberately keeps a
 * currently-taking course visible in its placed slot; see legalityGate's own
 * comment). Using report.legal unfiltered here silently suppressed this gate
 * for any actively-enrolled student whose currently-taking course is visible
 * on the board — the single most common real client state, not an edge case.
 * Uses isLegalIgnoringCurrentlyTakingReuse (defined below, shared with
 * canRecoverMoreHours/canRecoverViaUnwantedElective's own round-3 fix for the
 * identical marker) instead of report.legal: every OTHER real legality
 * violation (overload, incomplete annual course, prerequisite timing, ...)
 * must still suppress this gate, to avoid double-counting or misattributing
 * an already-differently-gated blocker.
 *
 * Codex review finding (PR #62, round 2): when that same benign
 * currently-taking course is kept visible in its placed board slot (as the
 * comment above says the real frontend deliberately does), report.degreeHours
 * (model.priorHours + placedHours(state)) ALREADY counts its hours once, via
 * placement — crediting it a second time from model.currentlyPlannedCourseIds
 * below would double-count it and could push creditedHours to (falsely) meet
 * or exceed model.degreeRequiredHours, silently suppressing this gate for a
 * plan that is genuinely still short. Only credits a currently-taking id's
 * hours here when it is NOT already placed in state — the off-board case
 * (test 8/8b in generate_plan_structural_degree_gap_warning.test.ts) this
 * credit exists for in the first place.
 */
function degreeHoursGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
  currentlyTakingHoursFromContext?: Map<string, number>,
  plannedHoursFromContext?: Map<string, number>,
  impliedUnknownOffBoardHours = 0,
): string[] {
  // Codex review finding (PR #62, round 4): unlike every other gate above
  // (which only ever READ the reconstructed state — assessCompleteness,
  // validatePlanState), canRecoverViaUnwantedElective/canRecoverMoreHours
  // below call applyMutation, whose ADD_COURSE case (planner_goals.ts)
  // returns null when the target semester key is missing from
  // state.semesters entirely. toProposal() (the caller of this whole file)
  // drops empty semesters from its own `semesters` output, so naively
  // reconstructing state the same sparse way missingMandatoryGate/
  // legalityGate do above would make every recovery candidate targeting a
  // currently-empty (but legal) semester silently fail — falsely reporting
  // "not recoverable" and blocking a plan whose catalog genuinely isn't
  // exhausted. Seeds every model.knownSemesterIds key first (via emptyState,
  // the same convention planner_worker.ts's own initial state construction
  // uses) so every legal semester — placed or still empty — is a real
  // ADD_COURSE target.
  const state: PlanState = emptyState(model.knownSemesterIds);
  for (const s of semesters) state.semesters[s.semester_id] = s.course_ids;
  const report = validateCandidate(state, model, pinnedHome);
  const placedNow = new Set(placedCourseIds(state));
  const currentlyPlannedHours = [...(model.currentlyPlannedCourseIds ?? [])]
    .filter(id => !placedNow.has(id))
    .reduce((sum, id) => sum + (model.profiles.get(id)?.hours ?? currentlyTakingHoursFromContext?.get(id) ?? 0), 0);
  // Codex review finding (PR #62, round 10): personal_status.planned courses
  // that predate this board's catalog window (off-board — model.profiles has
  // no entry) are real, uncounted credit, symmetric to currentlyPlannedHours'
  // own off-board currently_taking case above. Guarded on !model.profiles.has
  // (never credit an ON-board planned course — the search can and should
  // place it itself, see this function's own doc comment for why crediting
  // that would double-count or mask a real search gap) and !placedNow.has
  // (defensive; an off-board id can never actually be placed, but mirrors
  // currentlyPlannedHours' own guard for consistency).
  const offBoardPlannedHours = [...(plannedHoursFromContext ?? [])]
    .filter(([id]) => !model.profiles.has(id) && !placedNow.has(id))
    .reduce((sum, [, hours]) => sum + hours, 0);
  // Codex review finding (PR #62, round 12): round 11's fix disabled this
  // whole gate whenever ANY off-board course lacked per-course hours and an
  // aggregate was present — even a trivially small aggregate (e.g. 4h)
  // against a massive, genuinely unrecoverable gap (e.g. 169h short) wrongly
  // reported blocked:false, the exact "incomplete presented as complete" bug
  // this whole gate exists to prevent. impliedUnknownOffBoardHours (computed
  // by the caller — see its own doc comment) is a BOUNDED credit: it can
  // never exceed what total_hours_progress.currently_planned_hours itself
  // proves, after subtracting every hour already accounted for elsewhere, so
  // adding it here can only ever close a gap the aggregate genuinely
  // justifies — never an unconditional escape hatch.
  const creditedHours = report.degreeHours + currentlyPlannedHours + offBoardPlannedHours + impliedUnknownOffBoardHours;
  // The computeDegreeHours() value a recovery candidate must actually reach
  // to close the gap — currentlyPlannedHours/offBoardPlannedHours/
  // impliedUnknownOffBoardHours are constant credits no recovery mutation can
  // change (recoveryCandidateActions never touches a currently-taking
  // course's placement, and an off-board course can never be placed at all),
  // so they carry over unchanged from creditedHours' own derivation (Codex
  // review finding, PR #62, round 7, extended rounds 10/12).
  const recoveryTargetHours =
    model.degreeRequiredHours - currentlyPlannedHours - offBoardPlannedHours - impliedUnknownOffBoardHours;
  // Codex review finding (PR #62, round 9): a single unified rollout
  // (includeUnwantedElectives:true) that can mix soft-avoided and ordinary
  // courses in the same search subsumes the separate canRecoverViaUnwanted
  // Elective probe — that probe only ever chained is_unwanted ADDs alone, so
  // a recovery requiring both an approved soft-avoided course AND a regular
  // one (e.g. a soft-avoided course that is itself an unmet prerequisite for
  // a regular elective) was invisible to both probes independently. See
  // canRecoverMoreHours'/recoveryCandidateActions' own doc comments.
  const structurallyShort =
    !report.degreeMet &&
    creditedHours < model.degreeRequiredHours &&
    report.missingMandatory.length === 0 &&
    report.unsatisfiedCategories.length === 0 &&
    isLegalIgnoringCurrentlyTakingReuse(state, model, pinnedHome) &&
    report.disallowedPlaced.length === 0 &&
    !canRecoverMoreHours(state, model, pinnedHome, recoveryTargetHours, true);
  return structurallyShort
    ? [`${DEGREE_HOURS_SHORTFALL_ERROR_PREFIX} ${creditedHours}/${model.degreeRequiredHours} ש"ש.`]
    : [];
}

function legalityGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
): string[] {
  const state: PlanState = { semesters: Object.fromEntries(semesters.map(s => [s.semester_id, s.course_ids])) };
  const { errors } = validatePlanState(state, model, pinnedHome);
  return errors
    .filter(e =>
      !e.includes(OVERLOAD_ERROR_MARKER) &&
      !e.includes(ANNUAL_PARTIAL_PLACEMENT_MARKER) &&
      !e.includes(CURRENTLY_TAKING_REUSE_ERROR_MARKER),
    )
    .map(e => `${LEGALITY_VIOLATION_ERROR_PREFIX} ${e}`);
}

/**
 * Deterministic Hebrew rationale — used when ExplanationCapability is absent or
 * throws (dev mode / LLM failure fallback).
 */
function deterministicRationale(finalState: PlanState, model: ConstraintModel): string {
  const placed = Object.values(finalState.semesters).flat();
  const totalHours = model.priorHours + placed.reduce((s, id) => s + (model.profiles.get(id)?.hours ?? 0), 0);
  return placed.length === 0
    ? 'תוכנית אוטומטית — לא שובצו קורסים חדשים.'
    : `תוכנית אוטומטית — ${placed.length} קורסים, ${totalHours} ש"ש לקראת השלמת התואר.`;
}

/**
 * Same "benign rule-2a reuse, not a real violation" exception legalityGate/
 * degreeHoursGate already apply to a currently-taking course kept visible in
 * its placed slot (see degreeHoursGate's own doc comment). Every candidate
 * mutation the recovery rollouts below generate PRESERVES that pre-existing
 * placement — mutations only add/move/replace a DIFFERENT course, never
 * remove an unrelated already-placed one — so the benign reuse marker
 * persists identically in every candidate's own validatePlanState result.
 * Without this exception, any visible currently-taking course would make
 * EVERY recovery candidate register as "illegal," permanently reporting "not
 * recoverable" regardless of whether a real recovery exists (Codex review
 * finding, PR #62, round 3).
 */
function isLegalIgnoringCurrentlyTakingReuse(
  state: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
): boolean {
  return validatePlanState(state, model, pinnedHome).errors
    .filter(e => !e.includes(CURRENTLY_TAKING_REUSE_ERROR_MARKER)).length === 0;
}

/**
 * Structural-gap recoverability — whether ANY further legal action (or bounded
 * sequence of them) from `finalState` could still add degree hours without
 * un-satisfying mandatory/category completeness.
 *
 * History: PR #41's structural-gap warning (see toProposal below) went
 * through 21 rounds of Codex review, each adding a new narrowly-scoped
 * hand-rolled scan (a raw-ADD check, then a wider-search ADD scan, then a
 * REPLACE scan, then a MOVE-then-ADD scan — see git history on this file for
 * the full round-by-round account) — because each was its own bespoke
 * approximation of "is there a reachable, legal, still-complete state with
 * more hours," and each new combination (a replace that breaks a category, a
 * move that frees capacity for an annual course's atomic bundle, ...) needed
 * its own bespoke fix. That is exactly the reachability search
 * planner_worker.ts's PlannerWorker already performs correctly — building
 * every real plan by repeatedly calling enumerateActions/applyMutation/
 * validatePlanState (its Observe→Reason→Act→Validate loop, see step()) — so
 * round 22 replaces all four hand-rolled scans with a single bounded rollout
 * over those exact same primitives instead of hand-approximating them again.
 *
 * Caveat this rollout must not paper over (issue #25 Finding #4, see
 * .remember/current.md): GOAL_STACK ranks raw degree hours (scorePlan's g1)
 * strictly ABOVE mandatory/category completeness (g2a/g2b) — so the single
 * best-scoring legal action at any state can legitimately trade away
 * completeness for hours. A rollout that only ever followed PlannerWorker's
 * own single greedy path could walk straight past a real recovering state
 * without recognizing it (if the greedy pick at some step sacrifices
 * completeness). This function instead treats every legal action out of
 * every visited state as its own branch (a bounded best-first search, using
 * scorePlan/compareScore only to decide which branch to expand first within
 * the budget — never to prune branches), and independently re-checks
 * completeness (validateCandidate, exactly like rounds 19/20 already
 * required by hand) at EVERY state visited, not just a single followed path's
 * end.
 *
 * Codex review finding (PR #62, round 7): degreeHoursGate's completion check
 * used to fire on ANY hours-increasing, still-complete candidate — e.g. a
 * plan short by 5h with only one further-legal 4h elective would be reported
 * "recoverable" even though placing it can never actually close the gap.
 * `targetHours`, when supplied, is the computeDegreeHours() value a candidate
 * must actually reach before a state counts as a genuine recovery rather than
 * mere partial progress — used only by degreeHoursGate (the new blocking
 * gate Codex's finding names), which must never suppress a blocking error
 * over a partial-only recovery. Left undefined (falls back to the pre-
 * existing "any legal, still-complete improvement" check) by the pre-existing
 * toProposal "מיצית את כל הקורסים הזמינים" warning call site below — that
 * warning's own, already Codex-hardened (21+ rounds, PR #41) semantics are
 * deliberately about whether the visible catalog has ANY untried option left
 * at all, not about full closure, and changing that here would risk an
 * unrelated regression to already-shipped warning behavior outside this PR's
 * scope.
 *
 * Codex review finding (PR #62, round 9): `includeUnwantedElectives`, when
 * true, lets this rollout's own recoveryCandidateActions also propose
 * `is_unwanted` courses — needed so a recovery that MIXES an approved
 * soft-avoided course with an ordinary one (e.g. a soft-avoided course that
 * is itself the unmet prerequisite blocking a regular elective) is
 * discoverable by this SAME multi-step search, not just each action class in
 * isolation. degreeHoursGate passes true and, since this rollout now
 * subsumes it, no longer also calls canRecoverViaUnwantedElective. The
 * pre-existing toProposal warning call site passes neither this nor
 * targetHours, keeping its exact prior behavior.
 */
function canRecoverMoreHours(
  finalState: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
  targetHours?: number,
  includeUnwantedElectives = false,
): boolean {
  const baselineHours = computeDegreeHours(finalState, model);
  const seen = new Set<string>([recoveryStateKey(finalState, model)]);
  let frontier: Array<{ state: PlanState; score: number[] }> = [
    { state: finalState, score: scorePlan(finalState, model) },
  ];
  let visited = 0;

  while (frontier.length && visited < RECOVERY_ROLLOUT_BUDGET) {
    // Best-first: expand the highest-scoring frontier state next (same
    // ranking PlannerWorker.step() uses to choose an action) — a best-effort
    // ordering so a bounded budget spends itself on the most promising
    // branches first on a large real catalog. Every other frontier state
    // stays queued and still gets its turn as long as budget remains, so
    // this doesn't skip branches on the small, exhaustively-explorable cases
    // this warning actually fires for.
    frontier.sort((a, b) => compareScore(b.score, a.score));
    const { state } = frontier.shift()!;
    const spawned: typeof frontier = [];

    // Codex review finding (PR #62, round 14): recoveryCandidateActions'
    // own return order is plain enumeration order (model.profiles iteration
    // order for ADD, placement order for REPLACE/REMOVE) — NOT prioritized
    // by how much each candidate actually helps close the hours gap. With
    // many small, individually-insufficient legal candidates (e.g. 200+ 1h
    // soft-avoided electives) ahead of the one course that alone closes the
    // gap, the budget could be exhausted discarding the small ones before
    // ever reaching a genuine single-step recovery — a bounded-search miss
    // masquerading as "the catalog is exhausted." Sorting by each mutation's
    // OWN hours delta (descending) before spending any budget means the
    // candidate most likely to close the gap outright is always tried
    // first — a cheap, static computation (no applyMutation/validate call
    // needed per candidate), so it doesn't cost any of the budget itself.
    // Doesn't change WHAT the search can find, only the order — every
    // candidate within budget is still tried exactly as before.
    const byHoursDeltaDesc = [...recoveryCandidateActions(state, model, includeUnwantedElectives)]
      .sort((a, b) => mutationHoursDelta(b, model) - mutationHoursDelta(a, model));
    for (const mut of byHoursDeltaDesc) {
      if (visited >= RECOVERY_ROLLOUT_BUDGET) break;
      const candidate = applyMutation(state, mut);
      if (!candidate) continue;
      const key = recoveryStateKey(candidate, model);
      if (seen.has(key)) continue;
      seen.add(key);

      // Codex review (round 22) caught that visited was incremented for
      // EVERY candidate, legal or not — a semester already at/over the hard
      // cap can have far more than RECOVERY_ROLLOUT_BUDGET individually
      // illegal ADD candidates (e.g. hundreds of unplaced electives all
      // illegal in that one over-cap semester), so the whole budget could be
      // spent discarding those before a legal MOVE (freeing capacity, tried
      // later in recoveryCandidateActions' own ordering) is ever reached.
      // Mirrors PlannerWorker.step() itself: only a LEGAL resulting state is
      // ever a real candidate to build further plan on top of — an illegal
      // one is a cheap, immediate dead end, not a genuine search state, so
      // it shouldn't count against a budget defined (see this function's own
      // docstring) as "the number of NEW states the search may generate."
      if (!isLegalIgnoringCurrentlyTakingReuse(candidate, model, pinnedHome)) continue;
      visited++;

      if (targetHours != null ? computeDegreeHours(candidate, model) >= targetHours : computeDegreeHours(candidate, model) > baselineHours) {
        // Legality (ignoring the benign reuse marker) is already guaranteed
        // by the `continue` above — only completeness needs re-checking here.
        const rep = validateCandidate(candidate, model, pinnedHome);
        if (
          rep.missingMandatory.length === 0 &&
          rep.unsatisfiedCategories.length === 0 &&
          rep.disallowedPlaced.length === 0
        ) {
          return true;
        }
      }
      spawned.push({ state: candidate, score: scorePlan(candidate, model) });
    }
    frontier.push(...spawned);
  }
  return false;
}

/**
 * Bounded rollout budget for canRecoverMoreHours — the total number of NEW
 * states the search may generate across the whole branching rollout (not a
 * single-path depth). Reuses the same magnitude as the rest of this codebase's
 * bounded-rollout convention (WorkerOptions.rolloutSteps' default and
 * greedyComplete/estimateFinalScore's default maxSteps, all 200 —
 * planner_worker.ts / planner_lookahead.ts) rather than inventing a new bound.
 */
const RECOVERY_ROLLOUT_BUDGET = 200;

/** Canonical key for a PlanState — dedupes the rollout's visited-state set. */
function recoveryStateKey(state: PlanState, model: ConstraintModel): string {
  return model.knownSemesterIds.map(sem => [...(state.semesters[sem] ?? [])].sort().join(',')).join('|');
}

/**
 * Static (no applyMutation needed) estimate of a recoveryCandidateActions
 * mutation's own effect on computeDegreeHours — used only to ORDER
 * canRecoverMoreHours' bounded rollout so a decisive candidate is tried
 * before a budget-exhausting run of small, individually-insufficient ones
 * (Codex review finding, PR #62, round 14). MOVE_COURSE never changes
 * placed hours by itself (0) but can still be a genuine multi-step enabler
 * (e.g. round 20's MOVE-then-ADD), so it still gets a turn — just not
 * ahead of a candidate that helps outright.
 */
function mutationHoursDelta(m: PlannerMutation, model: ConstraintModel): number {
  switch (m.type) {
    case 'ADD_COURSE': return model.profiles.get(m.courseId)?.hours ?? 0;
    case 'REPLACE_COURSE': return (model.profiles.get(m.inId)?.hours ?? 0) - (model.profiles.get(m.outId)?.hours ?? 0);
    case 'REMOVE_COURSE': return -(model.profiles.get(m.courseId)?.hours ?? 0);
    default: return 0;
  }
}

/**
 * The action set canRecoverMoreHours branches on at each visited state.
 * Starts from enumerateActions (planner_actions.ts) — the exact production
 * action space PlannerWorker.step() itself explores — and supplements the two
 * spots where that space is deliberately narrower than "every legal option"
 * (a reasonable narrowing for the real search's own ranking/performance
 * needs, but not for this exhaustion question):
 *
 *  - ADD: enumerateActions' degree-hour-fill group only ever proposes
 *    bestLegalSemester's single lowest-load pick for an ordinary (non-annual)
 *    elective — a course illegal there (e.g. a prerequisite-timing conflict)
 *    but legal in a different semester is invisible to it (round 9).
 *    addCourseActionsFor (also used by enumerateActions itself for is_annual
 *    courses) tries every legal semester — reused here for every eligible
 *    course, not just annual ones.
 *  - REPLACE: enumerateActions' replace group only proposes a swap that is
 *    strictly preference-IMPROVING — a same-preference (e.g. both neutral)
 *    swap that is purely hours-improving is invisible to it (round 18). This
 *    generates every movable-placed × unplaced-eligible pair gated only on
 *    net hours and legal-semester membership.
 *
 * `is_unwanted` (soft-avoided) courses are excluded from both supplements by
 * default — the automatic search must never place a course the user asked to
 * avoid on its own. Whether the user could still approve one as a risky
 * elective is a distinct question.
 *
 * Codex review finding (PR #62, round 9): degreeHoursGate's own recoverability
 * question is NOT "what would the automatic search do" — it's "does ANY
 * legal, user-approvable path exist" — so a genuine recovery that MIXES an
 * approved soft-avoided course with an ordinary one (e.g. approving a 1h
 * soft-avoided prerequisite that unlocks an otherwise-illegal 4h regular
 * elective in a later semester) was invisible to both this rollout (which
 * never proposed the soft-avoided prerequisite at all) and the separate,
 * unwanted-only canRecoverViaUnwantedElective rollout (which never proposed
 * the regular course the prerequisite unlocks). `includeUnwantedElectives`,
 * when true (degreeHoursGate only — see canRecoverMoreHours' own doc comment),
 * makes `eligible` admit `is_unwanted` courses into this SAME action space,
 * so the existing multi-step best-first search (already proven, by its own
 * MOVE-then-ADD discovery, to explore action sequences rather than single
 * moves) discovers mixed sequences for free, with no bespoke combinatorial
 * code needed. Left false (default) for the pre-existing toProposal warning's
 * own canRecoverMoreHours call, unchanged from its long-standing behavior.
 */
function recoveryCandidateActions(
  state: PlanState,
  model: ConstraintModel,
  includeUnwantedElectives = false,
): PlannerMutation[] {
  // Codex review finding (PR #62, round 3, widened by round 5): a currently-
  // taking course kept visible in its placed slot must never be touched by
  // ANY candidate mutation this rollout generates — not just ADD/REPLACE-in
  // (re-proposing it, e.g. an off-board id like CUR — a genuine, NEW rule-2a
  // violation, not the benign pre-existing kind isLegalIgnoringCurrentlyTakingReuse
  // below is meant to exempt), but also MOVE/REMOVE/REPLACE-out of an
  // ALREADY-placed one (e.g. FLU). The real production search
  // (PlannerWorker.step()) can never actually relocate or remove such a
  // course either — its own validate() call rejects any resulting state
  // that still contains it anywhere BUT its original placement, the same
  // way it rejects re-adding one that was never placed (see this codebase's
  // separate, tracked follow-up finding on PlannerWorker.step() itself) — so
  // a recovery this rollout only finds by moving/removing a currently-taking
  // course is not one production can ever actually perform, and must not be
  // reported as "recoverable." Guaranteeing every candidate leaves every
  // currently-taking course's placement byte-identical to the caller's own
  // baseline state means the ONLY reuse-marker errors any candidate can ever
  // carry are inherited unchanged from that baseline, so unconditionally
  // ignoring that marker in the legality check (isLegalIgnoringCurrentlyTakingReuse)
  // stays safe and never masks a freshly-introduced or altered violation.
  const touchesCurrentlyTaking = (m: PlannerMutation): boolean => {
    const ids =
      m.type === 'ADD_COURSE' ? [m.courseId] :
      m.type === 'REMOVE_COURSE' ? [m.courseId] :
      m.type === 'MOVE_COURSE' ? [m.courseId] :
      m.type === 'REPLACE_COURSE' ? [m.outId, m.inId] :
      [];
    return ids.some(id => model.currentlyPlannedCourseIds?.has(id));
  };
  const actions = enumerateActions(state, model).filter(m => !touchesCurrentlyTaking(m));
  const placedNow = new Set(placedCourseIds(state));
  const eligible = (id: string, p: { is_mandatory?: boolean; hours?: number | null; is_unwanted?: boolean }) =>
    !p.is_mandatory && p.hours != null && p.hours !== 0 && (includeUnwantedElectives || !p.is_unwanted) &&
    !isFullyPlaced(state, model, placedNow, id) &&
    !model.completedCourseIds.has(id) && !isExcluded(model, id) &&
    !model.currentlyPlannedCourseIds?.has(id);

  for (const [id, p] of model.profiles) {
    if (!eligible(id, p)) continue;
    actions.push(...addCourseActionsFor(model, id));
  }

  for (const outId of placedNow) {
    if (!isMovable(model, outId) || model.currentlyPlannedCourseIds?.has(outId)) continue;
    const outHours = model.profiles.get(outId)?.hours ?? 0;
    const sem = semesterOf(state, outId);
    if (!sem) continue;
    for (const [inId, p] of model.profiles) {
      if (!eligible(inId, p) || (p.hours ?? 0) <= outHours) continue;
      if (!legalSemestersFor(model, inId).includes(sem)) continue;
      // Codex review (round 24) caught that REPLACE_COURSE is always illegal
      // when inId is is_annual: applyMutation's REPLACE_COURSE case places
      // inId into ONLY semesterId, but validatePlanState requires an annual
      // course to occupy every one of its spans_semesters at once (the same
      // class of bug rounds 8/9/21 already fixed for hand-rolled ADD
      // mutations). Skip generating this always-illegal single-semester
      // mutation for annual candidates — REMOVE_COURSE(outId) below, paired
      // with the atomic annual ADD bundle already generated by the "MORE
      // ADD" loop above (addCourseActionsFor doesn't exclude is_annual
      // courses), lets the general multi-step rollout discover the real
      // recovery (free the slot, then place the full bundle) without a
      // bespoke annual-replace mutation type.
      if (p.is_annual) continue;
      actions.push({ type: 'REPLACE_COURSE', outId, inId, semesterId: sem });
    }
  }

  // Codex review (round 24): recoveryCandidateActions had no REMOVE_COURSE
  // candidate at all — MOVE only relocates a placed course to one of ITS
  // OWN other legal semesters, which doesn't help when outId has no other
  // legal semester (MOVE is never an option) and the real recovery needs
  // the slot vacated entirely, e.g. so an is_annual course's atomic
  // multi-semester bundle can fit. Adding it as a plain candidate lets the
  // general best-first search discover "free this slot, then add
  // something bigger/annual" (or anything else) on its own, the same way
  // MOVE-then-ADD (round 20) already falls out of this rollout's own
  // multi-step exploration rather than a bespoke check.
  for (const outId of placedNow) {
    if (!isMovable(model, outId) || model.currentlyPlannedCourseIds?.has(outId)) continue;
    actions.push({ type: 'REMOVE_COURSE', courseId: outId });
  }

  return actions;
}

/**
 * The soft-avoided (`is_unwanted`) elective case (round 5's finding, widened
 * to annual courses by round 8) — deliberately kept separate from
 * canRecoverMoreHours above. This is NOT a gap in the real search: the
 * automatic planner must never place a course the user asked to avoid on its
 * own, so enumerateActions correctly excludes `is_unwanted` courses
 * everywhere. But the course is still a real, recoverable option if the user
 * explicitly approves it as a risky elective — exactly the advice the
 * generic fallback message already gives — which is a genuinely different
 * question from "would the automatic planner find this by itself." Reuses
 * addCourseActionsFor so an is_annual soft-avoided elective still gets its
 * correct atomic multi-semester bundle instead of a single-semester trial
 * that always fails validatePlanState for an annual course. Pure ADD (never
 * removes a placed course), so — unlike REPLACE/MOVE-then-ADD in the rollout
 * above — it can't itself un-satisfy a category or mandatory requirement,
 * and needs no completeness re-check.
 *
 * Codex review finding (PR #62, round 7): legality alone isn't recovery for
 * degreeHoursGate (the new blocking gate) — approving a single unwanted
 * elective whose hours don't close the remaining gap (e.g. a 4h elective
 * against a 5h shortfall) isn't a genuine recovery either, the same bug class
 * canRecoverMoreHours' own round-7 fix closes. `targetHours`, when supplied,
 * is the computeDegreeHours() value the resulting state must actually reach.
 * Left undefined by the pre-existing toProposal warning call site, for the
 * same "don't touch already-shipped, 21+-round-hardened (PR #41) warning
 * semantics" reason canRecoverMoreHours' own doc comment above explains.
 *
 * Codex review finding (PR #62, round 8): closing the gap can require
 * approving MULTIPLE soft-avoided electives together (e.g. two 2h electives
 * for a 4h shortfall) — testing each course in isolation against targetHours
 * can never discover that, since no single candidate alone reaches it. When
 * targetHours is supplied, this now runs its own small bounded rollout
 * (mirrors canRecoverMoreHours' own bounded-search shape, RECOVERY_ROLLOUT_
 * BUDGET-limited) chaining ADD actions across every eligible is_unwanted
 * course, not just trying each once against the original finalState. When
 * targetHours is undefined (the pre-existing toProposal warning call site),
 * this still short-circuits on the very first legal single addition found —
 * byte-identical to the old single-ADD-only behavior, since "is there any
 * untried option at all" never needed combinations.
 */
function canRecoverViaUnwantedElective(
  finalState: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
  targetHours?: number,
): boolean {
  const eligible = (state: PlanState, id: string, p: { is_unwanted?: boolean; is_mandatory?: boolean; hours?: number | null }): boolean => {
    if (!p.is_unwanted || p.is_mandatory || p.hours == null || p.hours === 0) return false;
    const placedNow = new Set(placedCourseIds(state));
    if (isFullyPlaced(state, model, placedNow, id)) return false;
    if (model.completedCourseIds.has(id) || isExcluded(model, id)) return false;
    // Same reuse-avoidance reason recoveryCandidateActions' eligible() above
    // documents: never propose (re-)adding a course the user is already
    // currently taking, even an off-board one.
    if (model.currentlyPlannedCourseIds?.has(id)) return false;
    return true;
  };

  const seen = new Set<string>([recoveryStateKey(finalState, model)]);
  let frontier: PlanState[] = [finalState];
  let visited = 0;

  while (frontier.length && visited < RECOVERY_ROLLOUT_BUDGET) {
    const state = frontier.shift()!;
    for (const [id, p] of model.profiles) {
      if (visited >= RECOVERY_ROLLOUT_BUDGET) break;
      if (!eligible(state, id, p)) continue;
      for (const a of addCourseActionsFor(model, id)) {
        const next = applyMutation(state, a);
        if (next == null) continue;
        const key = recoveryStateKey(next, model);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!isLegalIgnoringCurrentlyTakingReuse(next, model, pinnedHome)) continue;
        visited++;
        if (targetHours == null || computeDegreeHours(next, model) >= targetHours) return true;
        frontier.push(next);
      }
    }
  }
  return false;
}

/**
 * Agent Diagnosis Loop finding (2026-07-22): a course's placement can be
 * pushed later than its own earliest nominally-legal semester purely because
 * one of its prerequisites isn't satisfied until a later point — the only
 * gate enforcing this is plan_validation.ts's strict-timing rule (a
 * prerequisite must sit in a strictly EARLIER semester than its dependent).
 * Nothing in the response ever said so: PlannerWorker's trace-reason buckets
 * (mandatory / category / wanted / filler-hours) never reference sequencing,
 * and academicDecision.explanation.whyThisPlan is plan-aggregate-only. A user
 * who explicitly wanted a course "as soon as possible" (or just expected it
 * in its earliest listed semester) got zero signal that prerequisite
 * ordering — not preference, capacity, or any other visible constraint — is
 * why it landed a year later. Reproduced on both the default and
 * use_academic_decision_agent:true paths (both read this same warnings_he).
 *
 * Pure function of (finalState, model) — re-derives the same strict-timing
 * fact plan_validation.ts's own gate enforces directly from where things
 * actually ended up, so it can never be fooled by which candidate semester
 * the search happened to try first.
 *
 * Only fires when the course's nominal legal-semester restriction is
 * CONFIDENT (getLegalSemesters' own confident flag) — the same
 * "confident-or-stay-silent" rule buildValidationContext/addCourseActionsFor/
 * annualSpansFor already use. Without this guard, a course with no known
 * offering restriction falls back to treating semester 0 as "earliest legal"
 * (legalSemestersFor's unconfident fallback to every known semester), which
 * would misattribute an ordinary later placement (search order, load
 * balancing) to "the earliest semester was illegal" for almost any course
 * with an unresolved prerequisite — a false claim this guard prevents.
 */
function prerequisiteSequencingNotes(finalState: PlanState, model: ConstraintModel): string[] {
  const order = model.knownSemesterIds;
  const indexOf = new Map(order.map((id, i) => [id, i]));

  // Same convention plan_validation.ts's courseSemIdx uses: iterate semesters
  // chronologically and let a later occurrence win, so a multi-semester
  // (is_annual) course's index reflects its LATEST span, matching the
  // validator's own "prerequisite must be strictly before" semantics.
  const placedAt: Record<string, string> = {};
  for (const sem of order) {
    for (const id of finalState.semesters[sem] ?? []) placedAt[id] = sem;
  }

  const notes: string[] = [];
  for (const [courseId, semesterId] of Object.entries(placedAt)) {
    const targetIdx = indexOf.get(semesterId);
    if (targetIdx === undefined) continue;

    const profile = model.profiles.get(courseId);
    if (!profile) continue;
    const legal = getLegalSemesters(profile as CourseLegalityInfo, order);
    if (!legal.confident || !legal.semesters.length) continue;
    const legalIdxs = legal.semesters
      .map(s => indexOf.get(s))
      .filter((i): i is number => i !== undefined);
    if (!legalIdxs.length) continue;
    const earliestIdx = Math.min(...legalIdxs);
    if (earliestIdx >= targetIdx) continue; // already at (or before) its earliest nominal semester — nothing to explain

    const prereqs = model.profiles.get(courseId)?.prerequisites ?? [];
    let bindingId: string | null = null;
    let bindingIdx = -1;
    for (const prereq of prereqs) {
      if (model.completedCourseIds.has(prereq)) continue;
      if (model.currentlyPlannedCourseIds?.has(prereq)) continue;
      const prereqSem = placedAt[prereq];
      if (!prereqSem) continue;
      const idx = indexOf.get(prereqSem);
      if (idx === undefined) continue;
      // Only a prerequisite whose OWN placement lands at/after the course's
      // earliest nominal semester could have made that semester illegal —
      // one satisfied well before it never blocked anything.
      if (idx >= earliestIdx && idx > bindingIdx) { bindingIdx = idx; bindingId = prereq; }
    }
    if (!bindingId) continue;

    const courseName = model.profiles.get(courseId)?.name_he ?? courseId;
    const prereqName = model.profiles.get(bindingId)?.name_he ?? bindingId;
    notes.push(
      `${courseName} שובץ ב${semesterId} ולא ב${order[earliestIdx]} (הסמסטר המוקדם ביותר המותר לו) ` +
      `כי דרישת הקדם ${prereqName} משובצת רק ב${order[bindingIdx]}.`,
    );
  }
  return notes;
}

/**
 * Option B toProposal — pure function of (finalState, model, initialState, pinnedHome, rationale_he).
 * No PlannerWorker dependency; shared by both the worker and agentic paths.
 */
/** Exported for direct unit testing of the response-shaping/warning logic
 * (mirrors buildModel/priorHoursFromContext's existing export convention) —
 * lets a test construct an exact finalState/model combination without
 * depending on whether the real search would ever converge to it. */
export function toProposal(
  finalState: PlanState,
  model: ConstraintModel,
  initialState: PlanState,
  pinnedHome: Record<string, string>,
  rationale_he: string,
  currentlyTakingHoursFromContext?: Map<string, number>,
  plannedHoursFromContext?: Map<string, number>,
  impliedUnknownOffBoardHours = 0,
) {
  const semesters = model.knownSemesterIds
    .filter(id => (finalState.semesters[id] ?? []).length > 0)
    .map(id => ({ semester_id: id, course_ids: finalState.semesters[id] }));

  // moves: diff initial board against final plan. An id can legitimately start
  // in more than one semester at once (an is_annual course spans all of its
  // semesters together) — track every initial semester per id, not just the
  // last one seen, so an unchanged annual placement is never misreported as
  // having "moved" out of whichever semester happened to be seen first.
  const initialSemsOf: Record<string, string[]> = {};
  for (const [sem, ids] of Object.entries(initialState.semesters)) {
    for (const id of ids) (initialSemsOf[id] ??= []).push(sem);
  }
  const moves: Array<{ course_id: string; from: string | null; to: string }> = [];
  for (const [sem, ids] of Object.entries(finalState.semesters)) {
    for (const id of ids) {
      const fromSems = initialSemsOf[id];
      if (fromSems?.includes(sem)) continue;
      // A genuine move means the course no longer occupies ANY of its
      // original semesters in the final plan. When it still does (e.g.
      // repairing a partially-placed is_annual course by adding its missing
      // span alongside the unchanged original one), this is an ADDITION, not
      // a move away from a semester it never actually left — reporting a
      // `from` there would let a consumer that applies `moves` literally
      // remove the course from a semester it's still supposed to occupy.
      const stillInOriginalSemester = fromSems?.some(s => (finalState.semesters[s] ?? []).includes(id));
      moves.push({ course_id: id, from: stillInOriginalSemester ? null : (fromSems?.[0] ?? null), to: sem });
    }
  }

  const report = validateCandidate(finalState, model, pinnedHome);
  const placed = new Set(Object.values(finalState.semesters).flat());

  const requirements_status: Array<{ name: string; required: number; placed: number; satisfied: boolean }> = [];
  requirements_status.push({
    name: 'קורסי חובה',
    required: model.requiredMandatoryCourseIds.length,
    placed: model.requiredMandatoryCourseIds.filter(id => placed.has(id)).length,
    satisfied: model.requiredMandatoryCourseIds.every(id => placed.has(id)),
  });
  for (const cat of model.categories) {
    const p = cat.candidateIds.filter(id => placed.has(id)).length;
    requirements_status.push({ name: cat.name, required: cat.required, placed: Math.min(p, cat.required), satisfied: p >= cat.required });
  }

  // Codex review (round 6, refined by rounds 10-11) caught that
  // report.degreeHours (model.priorHours + placedHours(finalState)) never
  // includes hours from off-board personal_status.currently_taking courses —
  // priorHoursFromContext deliberately excludes total_hours_progress.
  // currently_planned_hours (see its own comment above), and a
  // currently-taking course is never placed on the board either, so its
  // hours are invisible to both terms. Credited by reading each
  // model.currentlyPlannedCourseIds entry's OWN hours — model.profiles when
  // the course is in the board catalog, else the client-resolved hours in
  // personal_status.currently_taking itself (round 10's fix: some
  // currently-taking courses predate the program's board window and have no
  // model.profiles entry at all). Deliberately reads ONLY
  // personal_status.currently_taking (round 11's fix), never the mixed
  // total_hours_progress.currently_planned_hours aggregate (which also
  // includes personal_status.planned — a course the planner can legitimately
  // place and credit itself via report.degreeHours; adding the aggregate on
  // top would double-count it).
  //
  // Codex review finding (PR #62, round 10): the same reasoning applies to an
  // OFF-board personal_status.planned course (model.profiles has no entry) —
  // the planner has nothing in its catalog to place, so report.degreeHours
  // can never include it either, and it's real, uncounted credit.
  // offBoardPlannedHours reads personal_status.planned directly (never the
  // coarse aggregate) and keeps only the off-board subset, so it can never
  // double-count an on-board planned course.
  const currentlyPlannedHours = [...(model.currentlyPlannedCourseIds ?? [])]
    .reduce((sum, id) => sum + (model.profiles.get(id)?.hours ?? currentlyTakingHoursFromContext?.get(id) ?? 0), 0);
  const offBoardPlannedHours = [...(plannedHoursFromContext ?? [])]
    .filter(([id]) => !model.profiles.has(id))
    .reduce((sum, [, hours]) => sum + hours, 0);
  // Codex review finding (PR #62, round 11, bounded per round 12): same
  // impliedUnknownOffBoardHours credit as degreeHoursGate's own — see that
  // gate's/the caller's doc comments for why it's a bounded, mathematically
  // derived credit rather than an unconditional skip.
  const creditedDegreeHours = report.degreeHours + currentlyPlannedHours + offBoardPlannedHours + impliedUnknownOffBoardHours;
  const degreeMetCredited = report.degreeMet || creditedDegreeHours >= model.degreeRequiredHours;
  // Codex review finding (PR #62, round 13): this generic degree-completion
  // warning (and, via risksAndTradeoffs, the academic-decision rationale
  // that surfaces warnings_he verbatim) previously used raw
  // report.degreeMet/report.degreeHours. Whenever off-board-planned or
  // aggregate-only credit alone closed the gap — the exact case
  // degreeHoursGate below already treats as non-blocking — this warning
  // still told the user the plan was short, recreating the
  // blocked:false-but-"incomplete" self-contradiction this whole PR exists
  // to close.
  //
  // Deliberately excludes currentlyPlannedHours here, unlike creditedDegreeHours
  // above — tests 8/11 (rounds 6/10) established that an in-progress
  // personal_status.currently_taking course must NOT silence this specific
  // message: the student hasn't actually earned those hours yet, so it
  // remains accurate (not contradictory) to report the board+known-completed
  // total as still short, even though CUR finishing would close the gap —
  // that stronger "nothing else can help" claim is exactly what the
  // separate מיצית branch below (gated on the full creditedDegreeHours,
  // unchanged) exists to distinguish. offBoardPlannedHours/
  // impliedUnknownOffBoardHours are different in kind — the same aggregate/
  // planned credit the frontend has ALREADY verified and reported as prior
  // progress, not an in-progress enrollment — so crediting them here doesn't
  // carry the same "not actually earned yet" caveat.
  const genericCompletionCreditedHours = report.degreeHours + offBoardPlannedHours + impliedUnknownOffBoardHours;
  const degreeMetForGenericWarning = report.degreeMet || genericCompletionCreditedHours >= model.degreeRequiredHours;

  const warnings_he: string[] = [];
  if (!degreeMetForGenericWarning) {
    warnings_he.push(`התוכנית משלימה ${genericCompletionCreditedHours}/${model.degreeRequiredHours} ש"ש.`);
  }
  for (const id of report.missingMandatory) warnings_he.push(`חסר קורס חובה: ${model.profiles.get(id)?.name_he ?? id}.`);
  for (const cid of report.unsatisfiedCategories) {
    const c = model.categories.find(x => x.id === cid);
    warnings_he.push(`דרישת קטגוריה לא מולאה: ${c?.name ?? cid}.`);
  }
  // Agent Diagnosis Loop finding: a plan can have every mandatory course and
  // every category already satisfied while still short of degreeRequiredHours,
  // with genuinely no further legal action able to close the gap (the visible
  // planning window's catalog is exhausted). Without a distinct message, this
  // looked identical to an ordinary, still-fixable shortfall, and the live
  // frontend's decision text could suggest actions (approve a risky elective,
  // wait for missing data) that don't actually exist. Only fires when
  // mandatory/category requirements are ALL satisfied — a genuinely
  // unsatisfied category already gets its own, more specific warning above.
  // Gated on report.legal and report.disallowedPlaced (rounds 3-4) so this
  // never fires alongside a real, different, already-disclosed blocker (an
  // unrelated overload, a pinned course left illegal, a hard-excluded course
  // still placed) — those must surface as themselves, not be mislabeled as
  // catalog exhaustion.
  //
  // Recoverability itself (rounds 1-2, 5, 8-9, 17-21 — see git history and
  // canRecoverMoreHours'/canRecoverViaUnwantedElective's own doc comments
  // above) is delegated entirely to those two functions instead of the prior
  // four hand-rolled combinatorial scans.
  //
  // currentlyPlannedHours/offBoardPlannedHours/creditedDegreeHours/
  // degreeMetCredited are computed once, above, before warnings_he is even
  // declared — see that block's own doc comment for the off-board credit
  // reasoning (rounds 6, 10-12) and why round 13 moved it here.
  if (
    !degreeMetCredited &&
    report.missingMandatory.length === 0 &&
    report.unsatisfiedCategories.length === 0 &&
    report.legal &&
    report.disallowedPlaced.length === 0
  ) {
    // Deliberately omits targetHours (the round-7 strict-closure check) here
    // — this pre-existing warning's own semantics (21+ Codex rounds, PR #41)
    // are about whether the visible catalog has ANY untried option left, not
    // full closure; see canRecoverMoreHours'/canRecoverViaUnwantedElective's
    // own doc comments for why that distinction matters and stays untouched
    // outside degreeHoursGate.
    const recoverable =
      canRecoverViaUnwantedElective(finalState, model, pinnedHome) ||
      canRecoverMoreHours(finalState, model, pinnedHome);
    if (!recoverable) {
      warnings_he.push(
        `מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (${creditedDegreeHours}/${model.degreeRequiredHours} ש"ש) — ` +
        `הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.`,
      );
    }
  }
  warnings_he.push(...prerequisiteSequencingNotes(finalState, model));

  // report.warnings === validatePlanState(finalState, model, pinnedHome).warnings
  warnings_he.push(...report.warnings);

  // Codex review finding (PR #62, round 13, continued): report.valid (above)
  // — and therefore the caller-supplied rationale_he (PlannerWorker.explain()'s
  // summary_he for the default path, deterministicRationale for the agentic
  // one; both built from the SAME validateCandidate result this function
  // computes into `report`) — has no knowledge of the off-board/aggregate
  // credit this whole file exists to apply. When degreeHoursGate (below,
  // same full creditedDegreeHours) would NOT block this plan, but the ONLY
  // reason report.valid is false is the raw, uncredited degree-hours check,
  // the incoming rationale_he still literally states "התוכנית אינה מלאה
  // עדיין" (the plan is not yet complete) — the exact
  // academicDecision.validation.valid:true-next-to-"incomplete"
  // self-contradiction from this PR's own original bug report, just one
  // layer further upstream than warnings_he (which the earlier part of this
  // fix already corrected). Corrected here, in the one place this function
  // already has both the raw report and every credit source in scope. Only
  // fires when degree hours are the SOLE reason report.valid is false —
  // legality/mandatory/category/disallowed problems must surface as
  // themselves via their own, unrelated gates, not be papered over here.
  const rationaleOnlyIncompleteForHours =
    !report.valid &&
    !report.degreeMet &&
    report.legal &&
    report.missingMandatory.length === 0 &&
    report.unsatisfiedCategories.length === 0 &&
    report.disallowedPlaced.length === 0;
  const correctedRationale_he = rationaleOnlyIncompleteForHours && degreeMetCredited
    ? `התוכנית תקפה: ${creditedDegreeHours}/${model.degreeRequiredHours} ש"ש (כולל קורסים בתהליך/מחוץ ללוח שכבר נספרים לזכות התואר), כל קורסי החובה והקטגוריות שנבדקו שובצו.`
    : rationale_he;

  return { semesters, moves, warnings_he, rationale_he: correctedRationale_he, requirements_status };
}

/** Build pinnedHome map from model.pinnedCourseIds + initialState positions. */
function buildPinnedHome(model: ConstraintModel, initialState: PlanState): Record<string, string> {
  const pinnedHome: Record<string, string> = {};
  for (const cid of model.pinnedCourseIds) {
    for (const [sem, ids] of Object.entries(initialState.semesters)) {
      if (ids.includes(cid)) { pinnedHome[cid] = sem; break; }
    }
  }
  return pinnedHome;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { sendError(res, 405, 'Method not allowed'); return; }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid request', 'INVALID_REQUEST', {
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const { program_id, plan_context, preferences, session_token, clarification_answers, include_interest_evaluation, academic_interest_profile, use_academic_decision_agent, interpret_free_text, preference_profile } = parsed.data;

  /**
   * S4 — the server-issued session that OWNS anything durable this request
   * creates. Resolved only on the flagged path, so the legacy/default response
   * is byte-identical and gains no Set-Cookie it never had.
   *
   * Note this is NOT `session_token`: that value is chosen by the client and
   * exists for quota accounting. An ownership key a caller can pick is not an
   * ownership key at all.
   */
  const owner = use_academic_decision_agent === true
    ? resolveOwner(req as unknown as { headers?: Record<string, string | string[] | undefined> }, res)
    : { ownerId: '', issued: false };

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();

  // Quota gate — unchanged behavior: required unless an explicit dev bypass.
  if (!isBypassQuota()) {
    if (!dbUrl) { sendError(res, 503, 'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.', 'NO_DATABASE_URL'); return; }
    if (!(await runQuotaCheck(session_token, dbUrl, res))) return;
  }

  // Clarification preflight — additive, opt-in only (default disabled, behavior
  // otherwise unchanged). When a critical input is still missing after any
  // supplied clarification_answers are applied, returns a structured
  // clarification response instead of delegating to either planner path
  // below. See academic_clarification_preflight.ts. Once unblocked, any valid
  // clarification_answers are also merged into the actual planning inputs
  // (plan_context/preferences) below — not just used to satisfy the gate. See
  // academic_clarification_plan_inputs.ts.
  let effectivePlanContext = plan_context;
  let effectivePreferences = preferences;
  if (process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT === 'true') {
    const resumed = await resumeClarificationPreflight(
      {
        programId: program_id,
        dbUrl,
        buildModelOptions: {
          completedCourseIds: (plan_context?.personal_status?.completed ?? []).map((c: any) => c.course_id),
          disallowedCourseIds: resolveHardExcludedCourseIds(preferences),
          maxHoursPerSemester: preferences.max_weekly_hours ?? undefined,
        },
      },
      clarification_answers ?? [],
    );
    if (resumed.blocked) {
      res.status(200).json({
        needsClarification: true,
        clarification: resumed.clarification,
        viewModel: resumed.viewModel,
      });
      return;
    }
    const merged = mergeClarificationAnswersIntoGeneratePlanInputs(plan_context, preferences, clarification_answers ?? []);
    effectivePlanContext = merged.planContext;
    effectivePreferences = merged.preferences;
  }
  // AcademicDecisionAgent runtime — opt-in, request-level. Clarify BEFORE
  // planning so the result can enrich the response below.
  //
  // Does NOT block planning on a critical-missing input (issue #25 Finding
  // #2): completedCourses/excludedCourses are the only fields ever marked
  // critical, and both have a safe, well-defined default (empty — "nothing
  // known yet") that the planner already uses unconditionally on the default
  // (no-flag) path below (personal_status.completed ?? [], etc.) — there is
  // no board/model-load reason to withhold a plan here. Previously this
  // returned needsClarification:true with no plan at all whenever a
  // first-time user (zero recorded completed/excluded courses — the default
  // state for any new account) hit this path, which the live frontend
  // auto-enables the moment a user picks a single AI-interest chip,
  // unrelated to whether they've entered any course history. That produced a
  // materially worse first-use experience than the identical input gets on
  // the default path (an honest partial plan). The clarification result is
  // still attached to the response below (buildAcademicDecision reads
  // academicDecisionClarification into explanation.missingData and
  // clarification.questions), so the user is still asked and can still
  // answer via the existing answer-loop — they just also get a real plan
  // meanwhile, exactly like the default path.
  let academicDecisionClarification: ClarificationResult | undefined;
  if (use_academic_decision_agent === true) {
    // Answer-loop resume: merge any supplied clarification_answers into the
    // planning inputs here too — independent of the preflight env flag above —
    // so answers submitted through the agent path both remove the field from
    // future clarification.questions AND reach the planner (buildModel /
    // currentlyPlannedCourseIds below read effectivePlanContext/
    // effectivePreferences). Reuses the shared validation/shape-checking in
    // mergeClarificationAnswersIntoGeneratePlanInputs (invalid/unknown
    // answers no-op), and is idempotent when the preflight block already
    // merged the same answers.
    const mergedForAgent = mergeClarificationAnswersIntoGeneratePlanInputs(
      effectivePlanContext,
      effectivePreferences,
      clarification_answers ?? [],
    );
    effectivePlanContext = mergedForAgent.planContext;
    effectivePreferences = mergedForAgent.preferences;

    academicDecisionClarification = await clarifyForAcademicDecision(
      extractClarificationContext(effectivePlanContext, effectivePreferences, academic_interest_profile, clarification_answers),
    );
  }

  // Unconditional (explicitly approved default-behavior change): the live
  // frontend already sends personal_status.currently_taking on every request,
  // and ignoring it let a currently-taken course be re-proposed by the planner.
  const currentlyPlannedCourseIds: string[] =
    (effectivePlanContext?.personal_status?.currently_taking ?? []).map((c: any) => c.course_id);
  // Per-course hours for the same currently_taking array, straight from the
  // client (covers ids model.profiles can't, e.g. YEAR_1_2 fallback courses
  // — see toProposal's structural-gap-warning comment for the full history).
  const currentlyTakingHoursFromContext = new Map<string, number>(
    (effectivePlanContext?.personal_status?.currently_taking ?? [])
      .filter((c: any) => typeof c?.hours === 'number')
      .map((c: any) => [c.course_id, c.hours]),
  );
  // Codex review finding (PR #62, round 10): personal_status.planned is a
  // real, distinct field (not currently_taking) for a course the student has
  // already registered/planned but not yet started — when such a course
  // predates this board's catalog window entirely (the same "off-board" case
  // round 6/10/11 already handle for currently_taking), its hours are real
  // credit toward the degree total that report.degreeHours can never include
  // (the planner has nothing in its catalog to place). Deliberately kept
  // SEPARATE from currentlyPlannedCourseIds/currentlyTakingHoursFromContext —
  // not merged in — since that set also drives prerequisite-satisfaction and
  // re-add-prevention semantics elsewhere (planner_goals.ts, this file's own
  // recovery rollouts) that only make sense for a course actually IN
  // PROGRESS, not one merely planned for later.
  const plannedHoursFromContext = new Map<string, number>(
    (effectivePlanContext?.personal_status?.planned ?? [])
      .filter((c: any) => typeof c?.hours === 'number')
      .map((c: any) => [c.course_id, c.hours]),
  );

  // Board — always plan over the full course universe.
  let board: any = null;
  if (dbUrl) {
    const pv = parseProgramVersionId(program_id);
    if (pv) {
      try { board = await queryBoardJson(dbUrl, pv.base, pv.year); } catch { board = null; }
    }
  }
  if (!board) {
    board = loadLocalBoardJson(program_id);
  }
  if (!board) {
    sendError(res, 503, 'תוכנית הלימודים המלאה אינה זמינה. נא לנסות שוב מאוחר יותר.', 'NO_UNIVERSE');
    return;
  }

  // Planning-intent boundary (opt-in): interpret the free-text Hebrew request
  // into the SAME structured planner fields the greedy planner already honors,
  // resolved against THIS board's catalog (data-driven, no hard-coded ids), and
  // merge with explicit precedence over the structured UI preferences. Runs
  // BEFORE buildModel so it deterministically changes the plan (not just the
  // LLM prompt). An empty/unrecognized request is a safe no-op.
  let interpretedIntent: PlanningIntent | undefined;
  const intentCatalog = interpret_free_text === true ? extractCatalog(board) : [];
  if (interpret_free_text === true && typeof effectivePreferences.extra_request_he === 'string' && effectivePreferences.extra_request_he.trim()) {
    interpretedIntent = interpretPlanningIntent(effectivePreferences.extra_request_he, intentCatalog);
    const merged = mergeIntentIntoPreferences(effectivePreferences, interpretedIntent);
    effectivePreferences = { ...effectivePreferences, ...merged };
  }
  // General user-fit (focus-area) → per-course soft fit signal for the planner,
  // sourced from the VALIDATED enrichment cache (no semantic extraction at Generate).
  const courseFit = interpret_free_text === true ? buildCourseFitById(board, interpretedIntent?.focusAreas ?? [], program_id) : undefined;
  const courseFitById = courseFit?.fitById;

  // Slice 14/17A — resolve the typed preference profile ONCE (single source of
  // truth): the eligibility filter drives both the semester-distribution policy
  // fed to the planner here and the eligibility disclosure in the response below.
  // Only the flagged path with a profile can set a non-neutral policy.
  const effectivePrefs: EffectivePlannerPreferences | undefined =
    use_academic_decision_agent === true && preference_profile
      ? effectivePlannerPreferences({
          version: preference_profile.version,
          preferences: preference_profile.preferences.map((p) => ({
            id: p.id, category: p.category ?? 'unknown', normalized: p.normalized, value: p.value,
            classification: p.classification, confidence: p.confidence ?? 0,
            source: p.source ?? 'existing_profile', confirmationStatus: p.confirmationStatus ?? 'unconfirmed',
            affects: p.affects, mayAffectPlanningBeforeConfirmation: p.mayAffectPlanningBeforeConfirmation ?? false,
          })),
        })
      : undefined;
  const resolvedPolicy = effectivePrefs ? resolveDistributionPolicy(effectivePrefs) : undefined;
  // K9A — the grounded course-feature objective, resolved at the SAME eligibility
  // boundary as the distribution policy so the two can never disagree about what
  // a confirmed preference means. Soft ranking only; it has no path to legality.
  const normalizedAcademicInterestProfile = normalizeAcademicInterestProfile(
    (academic_interest_profile ?? {}) as RawAcademicInterestProfile,
  );
  const groundedWithFreeTextFocus = mergeExplicitFocusObjective(
    effectivePrefs ? resolveGroundedObjective(effectivePrefs) : undefined,
    interpretedIntent?.focusAreas ?? [],
    preference_profile?.version ?? 0,
  );
  const groundedWithStructuredFocus = mergeExplicitFocusObjective(
    groundedWithFreeTextFocus,
    normalizedAcademicInterestProfile.focusAreas,
    preference_profile?.version ?? 0,
    'structured_academic_profile',
  );
  const resolvedGrounded = mergeStructuredAvoidObjective(
    groundedWithStructuredFocus,
    normalizedAcademicInterestProfile.avoidAreas,
    preference_profile?.version ?? 0,
  );
  // 'neutral' → undefined so the model (and every existing snapshot) stays byte-identical.
  const distributionPolicy: DistributionPolicy | undefined =
    resolvedPolicy && resolvedPolicy.policy !== 'neutral' ? resolvedPolicy.policy : undefined;

  const model = buildModel(board, effectivePlanContext, effectivePreferences, program_id, currentlyPlannedCourseIds, courseFitById, distributionPolicy);
  const initialState = planContextToState(effectivePlanContext, model);
  const pinnedHome = buildPinnedHome(model, initialState);
  const modelCfg = resolveModel();

  // Codex review finding (PR #62, round 11): currentlyTakingHoursFromContext/
  // plannedHoursFromContext above only credit an off-board currently_taking/
  // planned course when the client supplied that course's OWN `hours` field.
  // A compatible caller relying instead on the coarse
  // total_hours_progress.currently_planned_hours aggregate (real, accepted
  // input — plan_context is z.any(), per-course hours were always optional)
  // without per-course hours gets 0 credit for that course from either map,
  // even though the aggregate proves real, uncounted credit exists.
  //
  // Codex review finding (PR #62, round 12): an earlier version of this fix
  // responded by unconditionally skipping the blocking gate whenever the
  // aggregate was present and any off-board course lacked per-course hours —
  // regardless of magnitude, so even a trivially small aggregate (4h) against
  // a massive, genuinely unrecoverable gap (169h) wrongly went unblocked.
  // impliedUnknownOffBoardHours instead derives a mathematically BOUNDED
  // credit: onBoardKnownHours (exact — model.profiles, doesn't need
  // client-supplied hours) and offBoardKnownHours (the same per-course
  // amounts currentlyPlannedHours/offBoardPlannedHours already credit) are
  // subtracted from the aggregate first; whatever remains (clamped at 0) is
  // the hours the aggregate proves exist among ONLY the courses with unknown
  // individual hours — never more than the aggregate itself justifies, so it
  // can only close a gap the client's own numbers genuinely support, never an
  // unconditional escape hatch.
  // Codex review finding (PR #62, round 15): the live buildPlanContext
  // (semester_board_viewer.html) computes total_hours_progress.
  // currently_planned_hours by summing currently_taking + planned entries
  // AFTER filtering out any course already PLACED on the submitted board
  // (`!placedIds.has(...)`) — the real, canonical caller's aggregate NEVER
  // includes a placed course's hours to begin with. The previous
  // model.profiles.has(id)-based "onBoardKnownHours" subtraction assumed
  // the opposite (that the aggregate might double-count an in-catalog
  // course) and applied that assumption uniformly to BOTH statuses,
  // silently erasing real off-board credit whenever a genuinely PLACED
  // currently_taking course happened to coexist with an unrelated,
  // genuinely off-board one lacking per-course hours (Codex's repro: a 4h
  // board-visible course + a 4h aggregate-only off-board one wrongly
  // produced impliedUnknownOffBoardHours:0 instead of 4).
  //
  // The two statuses need DIFFERENT exclusion criteria, matching the two
  // different credit paths each already has elsewhere in this function —
  // collapsing them into one shared model.profiles.has(id) test (as before)
  // is what caused this bug:
  //  - currently_taking: rule 2a means the search can NEVER place one
  //    itself, so "in catalog" and "actually placed" are genuinely
  //    different states here. A PLACED one was never part of the frontend's
  //    aggregate (exclude, subtract nothing). A NOT-placed one is already
  //    credited via currentlyPlannedHours above (which also doesn't care
  //    whether it's in-catalog, using currentlyTakingHoursFromContext as a
  //    fallback) whenever either its catalog OR context hours are known —
  //    subtract that same amount. Only a not-placed entry with NEITHER is
  //    genuinely unclaimed.
  //  - planned: the search CAN legitimately place an in-catalog, NOT-YET-
  //    placed one later (e.g. to satisfy a category, like SOL in test 15b)
  //    — its hours will be counted via report.degreeHours once the search
  //    does, an entirely separate computation from anything here, so — per
  //    round 10's own existing offBoardPlannedHours design — any in-catalog
  //    NOT-YET-placed planned course stays excluded, to avoid eventually
  //    double-counting once the search places it.
  //
  //    Codex review finding (PR #62, round 16): that in-catalog exclusion
  //    is right for a not-yet-placed one, but the frontend's own placed-id
  //    filter applies identically to BOTH personal_status arrays (see round
  //    15's own comment above) — a planned course the client already
  //    placed itself was ALSO never part of the aggregate, exactly like the
  //    currently_taking case. Treating every in-catalog planned course the
  //    same regardless of placement (as round 15 still did) double-
  //    discounted an already-placed one the identical way round 15 fixed
  //    for currently_taking. Guarded the same way: !initiallyPlacedIds.has
  //    first, then the in-catalog-or-known-hours test.
  const totalCurrentlyPlannedHoursAggregate = effectivePlanContext?.total_hours_progress?.currently_planned_hours;
  let impliedUnknownOffBoardHours = 0;
  if (typeof totalCurrentlyPlannedHoursAggregate === 'number') {
    const initiallyPlacedIds = new Set(placedCourseIds(initialState));
    const currentlyTakingEntries = new Map<string, any>();
    for (const c of effectivePlanContext?.personal_status?.currently_taking ?? []) {
      if (c?.course_id != null) currentlyTakingEntries.set(c.course_id, c);
    }
    const plannedEntries = new Map<string, any>();
    for (const c of effectivePlanContext?.personal_status?.planned ?? []) {
      if (c?.course_id != null && !currentlyTakingEntries.has(c.course_id)) plannedEntries.set(c.course_id, c);
    }
    const knownHours = [...currentlyTakingEntries.values(), ...plannedEntries.values()]
      .filter((c: any) => !initiallyPlacedIds.has(c.course_id) && (model.profiles.has(c.course_id) || typeof c?.hours === 'number'))
      .reduce((sum: number, c: any) => sum + (model.profiles.get(c.course_id)?.hours ?? c.hours), 0);
    impliedUnknownOffBoardHours = Math.max(0, totalCurrentlyPlannedHoursAggregate - knownHours);
  }

  let proposal: ReturnType<typeof toProposal>;
  let traceForResponse: unknown[];
  let hitMaxSteps = false;
  let useLlm = false;
  // The stable planner's final PlanState — captured so the opt-in
  // AcademicDecisionAgent path can inject it as the agent's PlanningCapability
  // (orchestrate around the existing proposal, never re-plan from emptyState).
  let stableFinalState: PlanState;
  // Lean candidate metadata (flagged path only) — populated by the candidate
  // orchestration branch, surfaced under academicDecision.candidates below.
  let candidateOrchestration: Record<string, unknown> | undefined;
  // Evidence actually used by the selected candidate. Reused later by the
  // intent outcome so ranking and explanation cannot disagree.
  let selectedGroundedContributions: ObjectiveContribution[] = [];
  // Slice 18A — deterministic hard-constraint analysis (flagged path only).
  let hardConstraintOutcome: ReturnType<typeof analyzeHardConstraints> | undefined;

  // ── Candidate-orchestration path (opt-in agent flag) — the SINGLE proposal
  //    owner on the flagged path.
  //
  //    Slice 18B: every candidate is planned under ONE resolved user policy
  //    (`balanced` / `compact` / `neutral` configure scoring and search; they are
  //    NOT the alternatives shown to the user). Diversity comes from different
  //    legal course/period combinations found by bounded deterministic
  //    deviations of the SAME stable planner, each gated on the same
  //    authoritative validator and the same hard constraints. The proposal is
  //    built from the PRIMARY (rank 0) candidate's exact PlanState — no separate
  //    rerun. Absent flag => the unchanged single-plan paths below run
  //    byte-identically.
  if (use_academic_decision_agent === true) {
    const pref = distributionPolicy ?? 'neutral';

    // K9B — prepare the ONE immutable evidence snapshot for this request, BEFORE
    // any planning. This is the only place evidence is assembled; candidates
    // never acquire or resolve their own, so every candidate is scored against
    // the same snapshotId and no acquisition can occur inside the planner loop,
    // a rollout, ranking, or Apply. With no prepared documents the snapshot is
    // empty and completely inert (default-off).
    const preparedEvidence = prepareEvidence({
      courseIds: [...model.profiles.keys()],
      academicYear: model.catalogYear ?? new Date(0).getFullYear(),
      // B1 — explicit product policy: recent official syllabi may support only
      // the descriptive feature/topic layer assembled here. Legality, credits,
      // prerequisites, categories and offerings remain owned by the board/model.
      descriptiveFreshnessPolicy: RECENT_OFFICIAL_SYLLABUS_POLICY,
      documents: loadPreparedEvidenceDocuments(program_id),
    });
    /**
     * The one confirmed objective, built once so ranking, the explanation and
     * the impact probe cannot drift apart. `topicIds` is carried only for
     * `prefer_topic_alignment`; the topic index comes from the SAME prepared
     * snapshot as the features.
     */
    const groundedObjectiveOf = (id: NonNullable<typeof resolvedGrounded>['objective']) => ({
      id: id!,
      confirmed: true as const,
      snapshotId: preparedEvidence.snapshot.snapshotId,
      ...(resolvedGrounded?.topicIds?.length ? { topicIds: resolvedGrounded.topicIds } : {}),
    });
    // M1/M2 — EVERY confirmed objective reaches ranking. No precedence: the
    // set is scored independently per objective against this ONE snapshot and
    // composed symmetrically (see grounded_objective_set.ts).
    const groundedForRanking =
      resolvedGrounded?.objectives.length
        ? {
            objectives: resolvedGrounded.objectives,
            snapshotId: preparedEvidence.snapshot.snapshotId,
            features: preparedEvidence.features,
            topics: preparedEvidence.topics,
          }
        : undefined;

    const candidateSet = generateCandidateSet({
      buildModel: (p) =>
        buildModel(board, effectivePlanContext, effectivePreferences, program_id, currentlyPlannedCourseIds, courseFitById, p === 'neutral' ? undefined : p),
      policy: pref,
      initialState,
      profileVersion: preference_profile?.version ?? 0,
      pinnedHome,
      ...(groundedForRanking ? { groundedObjectives: groundedForRanking } : {}),
    });
    const selected = selectCandidate(candidateSet);
    selectedGroundedContributions = selected?.objectiveScores?.flatMap((c) => c.contributions) ?? [];
    // Proposal is built from the primary candidate's exact state; if NOTHING
    // validated, fall back to the plain greedy state so the existing blocking
    // gates below produce the deterministic non-applyable outcome — never a
    // fabricated plan, and never a degraded plan presented as an alternative.
    const selectedState = selected ? selected.state : candidateSet.legacyState;
    stableFinalState = selectedState;
    // Use the selected candidate's own stable-planner explanation so the proposal
    // is byte-identical to the default single-run path (same state → same rationale).
    const selectedRationale = selected ? selected.rationaleHe : deterministicRationale(selectedState, model);
    proposal = toProposal(
      selectedState, model, initialState, pinnedHome, selectedRationale,
      currentlyTakingHoursFromContext, plannedHoursFromContext, impliedUnknownOffBoardHours,
    );
    traceForResponse = [];
    hitMaxSteps = false;
    useLlm = false;
    // Deterministic pre-planning analysis of the HARD constraints themselves — a
    // contradiction or a structural impossibility is reported as typed reasons,
    // never silently absorbed into a best-effort plan.
    hardConstraintOutcome = analyzeHardConstraints(model);
    candidateOrchestration = {
      selectedCandidateId: selected?.id ?? null,
      selectedPolicy: candidateSet.policy,
      selectionReason: selectionReason(candidateSet),
      validCandidateCount: candidateSet.candidates.length,
      hasMeaningfulAlternatives: candidateSet.candidates.length >= 2,
      outcome: candidateSet.outcome,
      searchBudget: candidateSet.searchBudget,
      profileVersion: preference_profile?.version ?? null,
      selectedNormalizedIdentity: selected?.normalizedIdentity ?? candidateSet.legacyIdentity,
      // K9B — the ONE snapshot every candidate in this request was scored
      // against, plus truthful coverage. Coverage is disclosure only: it never
      // enters a score, so having a syllabus on file cannot itself rank a
      // candidate higher.
      evidence: {
        ...preparedEvidence.coverage,
        ...(preparedEvidence.coverage.historicalCourseIds.length
          ? {
              historicalEvidenceNoticeHe:
                `ההתאמה התיאורית מבוססת על סילבוס רשמי משנת ${preparedEvidence.coverage.academicYears.join(', ')} ` +
                `עבור קטלוג ${String(model.catalogYear ?? '')}; היא אינה קובעת חוקיות, תנאי קדם או דרישות תואר.`,
            }
          : {}),
        groundedObjective: resolvedGrounded?.objective ?? null,
        preferenceProfileVersion: preference_profile?.version ?? null,
        // K9C — the impact signal the conversation needs to decide whether asking
        // the grounded question could actually change the selected plan. Computed
        // as a PROBE over the already-retained candidates using the same prepared
        // features; it never affects ranking and is present whether or not a
        // preference is confirmed, because the UI must gate the question BEFORE
        // the user has answered it.
        groundedQuestionImpact: (() => {
          // Probe EVERY implemented objective: the one question offers all of
          // them, so it is worth asking when ANY of them could change the
          // outcome. Each probe uses the same prepared features and never
          // affects ranking.
          const probes = (['prefer_laboratory_courses', 'prefer_project_courses'] as const).map((id) => {
            const scores = candidateSet.candidates.map(
              (c) => scoreCandidateOnObjective(
                candidateCourseIds(c),
                { id, confirmed: true as const, snapshotId: preparedEvidence.snapshot.snapshotId },
                preparedEvidence.features,
              ).score,
            );
            return { id, distinguishes: new Set(scores).size > 1 };
          });
          return {
            feature: 'course_delivery_format',
            distinguishesCandidates: probes.some((p) => p.distinguishes),
            distinguishingObjectives: probes.filter((p) => p.distinguishes).map((p) => p.id),
            coverageSufficient: preparedEvidence.coverage.coveredCourseCount > 0,
            hasConflicts: preparedEvidence.coverage.conflictingCourseIds.length > 0,
          };
        })(),
        /**
         * T6 — the same truthful probe for CONTENT/TOPIC alignment, computed
         * per topic over the already-retained candidates. The question is worth
         * asking only for topics that genuinely separate at least two retained
         * candidates, so `distinguishingTopics` is both the gate and the list of
         * choices worth offering. Never affects ranking.
         */
        topicQuestionImpact: (() => {
          const distinguishingTopics = TOPIC_IDS.filter((topicId) => {
            const scores = candidateSet.candidates.map(
              (c) => scoreCandidateOnObjective(
                candidateCourseIds(c),
                { id: 'prefer_topic_alignment', confirmed: true as const, snapshotId: preparedEvidence.snapshot.snapshotId, topicIds: [topicId] },
                preparedEvidence.features,
                preparedEvidence.topics,
              ).score,
            );
            return new Set(scores).size > 1;
          });
          const coveredTopicCourses = [...preparedEvidence.topics.values()].filter((t) => t.topicIds.size > 0).length;
          return {
            category: 'course_topic_interest',
            distinguishesCandidates: distinguishingTopics.length > 0,
            distinguishingTopics,
            // W1 — localized labels travel WITH the signal, so the browser never
            // needs the topic vocabulary and an internal id can never surface as
            // a visible label. The server stays authoritative for both what is
            // impactful and what it is called.
            topicLabels: Object.fromEntries(
              distinguishingTopics.map((id) => [id, TOPIC_INTEREST_LABELS_HE[id] ?? id]),
            ),
            // Coverage is sufficient only when more than one course carries a
            // usable content statement — with one, nothing can be compared.
            coverageSufficient: coveredTopicCourses > 1,
            unknownTopicCourseCount: preparedEvidence.coverage.topicUnknownCourseIds.length,
            hasConflicts: preparedEvidence.coverage.conflictingCourseIds.length > 0,
            // The ONE snapshot these differences were computed from, and the
            // profile version they describe — so a late response can be
            // recognised as stale rather than silently applied.
            snapshotId: preparedEvidence.snapshot.snapshotId,
            profileVersion: preference_profile?.version ?? 0,
          };
        })(),
        /**
         * C5 — whether asking WHICH confirmed objective matters more could
         * actually change the recommendation, and what each possible answer
         * would recommend. Computed by replaying the real ranking over the
         * already-retained candidates, so the prediction is produced by the
         * same function that will decide the next Rebuild.
         *
         * Condition 8 ("no higher-priority clarification blocks planning") is
         * structural here rather than a flag: a blocking clarification preflight
         * returns above, long before this block runs, so an optional preference
         * question can never compete with one.
         */
        priorityQuestionImpact: (() => {
          if (!selected || !resolvedGrounded?.objectives.length) return undefined;
          return computePriorityQuestionImpact({
            candidates: candidateSet.candidates,
            objectives: resolvedGrounded.objectives,
            recommendedCandidateId: selected.id,
            snapshotId: preparedEvidence.snapshot.snapshotId,
            profileVersion: preference_profile?.version ?? 0,
            alreadyAnswered: resolvedGrounded.priorityChoice !== undefined,
          });
        })(),
      },
      selectedGroundedScore: selected?.groundedScore ?? null,
      // K9C — the concise, factual explanation of the grounded objective's
      // effect, built only from evidence actually used. Absent when no grounded
      // objective applied, so nothing is ever claimed without support.
      groundedExplanationHe: (() => {
        const objectives = resolvedGrounded?.objectives ?? [];
        const components = selected?.objectiveScores;
        if (!objectives.length || !components?.length) return null;
        const asScore = (c: (typeof components)[number]) => ({
          score: c.raw, contributions: c.contributions,
          unknownCourseIds: c.unknownCourseIds, variesBySectionCourseIds: c.variesBySectionCourseIds,
        });
        const other = candidateSet.candidates.find((c) => c.id !== selected!.id);
        return explainGroundedComposition({
          objectives: objectives.map((o) => ({ id: o.id, ...(o.topicIds?.length ? { topicIds: o.topicIds } : {}) })),
          snapshotId: preparedEvidence.snapshot.snapshotId,
          selected: components.map(asScore),
          ...(other?.objectiveScores?.length ? { alternative: other.objectiveScores.map(asScore) } : {}),
          reason: candidateSet.composition?.reason ?? 'single_objective',
          // C5 — named only when the student genuinely chose it, so the
          // explanation can never attribute a priority they did not express.
          ...(resolvedGrounded?.primaryObjectiveId
            ? { primaryObjectiveId: resolvedGrounded.primaryObjectiveId }
            : {}),
        });
      })(),
      // The official sources actually cited by the selected candidate, for the
      // UI's source disclosure. Empty when nothing was grounded.
      // Sources cited by EVERY active objective on the selected candidate, so a
      // composed explanation's disclosure is complete rather than first-only.
      groundedSources: (() => {
        const all = (selected?.objectiveScores?.flatMap((c) => c.contributions)
          ?? selected?.groundedScore?.contributions ?? [])
          .map((c) => ({ courseId: c.courseId, sourceRef: c.sourceRef, academicYear: c.academicYear }));
        // Two objectives citing the SAME official document is one source, not
        // two: the disclosure lists documents, not score contributions.
        const seen = new Set<string>();
        return all.filter((s) => {
          const key = `${s.courseId}|${s.sourceRef}|${s.academicYear}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })(),
      // M3/M4 — how the confirmed objectives were combined. Truthful metadata,
      // never a claim the student assigned weights.
      groundedComposition: candidateSet.composition ?? null,
      /**
       * C1 — the bounded set of plans the student may actually choose between.
       * Empty unless at least TWO validated, distinct, non-dominated plans exist
       * under the identical hard constraints, profile version and snapshot: one
       * plan is a proposal, not a comparison.
       */
      alternatives: buildPlanAlternatives({
        candidates: candidateSet.candidates,
        ...(selected?.id ? { selectedId: selected.id } : {}),
        model,
        constraintFingerprint: constraintFingerprint({
          model,
          completedCourseIds: [...(model.completedCourseIds ?? [])],
          ...(distributionPolicy ? { distributionPolicy } : {}),
          profileVersion: preference_profile?.version ?? 0,
        }),
        snapshotId: preparedEvidence.snapshot.snapshotId,
        profileVersion: preference_profile?.version ?? 0,
        objectiveIds: (resolvedGrounded?.objectives ?? []).map((o) => o.id),
        // The topic objective's OWN topics. `resolvedGrounded.topicIds` is the
        // LEGACY single-objective view and is populated only when the topic
        // objective happens to sort first, so reading it here made the topic
        // label unreachable whenever another objective was also active.
        ...(() => {
          const topics = (resolvedGrounded?.objectives ?? []).find((o) => o.kind === 'topic')?.topicIds;
          return topics?.length ? { topicIds: topics } : {};
        })(),
      }),
      // LEAN summary only (Slice 18B UI scope): enough for a later comparison UI
      // to rank and describe alternatives without shipping duplicate full plans.
      summaries: candidateSet.candidates.map((c) => ({
        id: c.id,
        rank: c.rank,
        normalizedIdentity: c.normalizedIdentity,
        selected: c.id === selected?.id,
        policy: c.policy,
        profileVersion: c.profileVersion,
        provenance: c.provenance,
        courseIds: candidateCourseIds(c),
        differences: c.differences,
        scoreVector: c.scoreVector,
      })),
    };

  } else if (process.env.AI_USE_AGENTIC_PLANNER === 'true') {
    // ── PlannerAgent path (Phase 5+) ─────────────────────────────────────────
    const useLlmExplain = !isDevMode() && !!modelCfg;
    const explanation = useLlmExplain ? new LlmExplainer(modelCfg!.model) : undefined;
    useLlm = useLlmExplain;

    const searchCap: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, opts) => new BeamSearchStrategy<PlanState, PlannerMutation>().explore(s, deps, opts),
    };
    const agent = new PlannerAgent({
      model, initialState, pinnedHome, search: searchCap, explanation, maxSteps: 150, beamWidth: 6,
    });

    let agentResult;
    try {
      agentResult = await agent.run();
    } catch (err) {
      console.error('[ai/generate-plan] PlannerAgent error, falling back to greedy:', err instanceof Error ? err.message : String(err));
      const fallback = new PlannerWorker(model, initialState, { topN: 6, rolloutSteps: 80 });
      fallback.run(500, 'greedy');
      agentResult = { finalState: fallback.getPlan(), trace: fallback.getTrace(), gaps: [], meta: undefined, rationale_he: fallback.explain().summary_he };
    }

    const rationale_he = agentResult.rationale_he ?? deterministicRationale(agentResult.finalState, model);
    proposal = toProposal(
      agentResult.finalState, model, initialState, pinnedHome, rationale_he,
      currentlyTakingHoursFromContext, plannedHoursFromContext, impliedUnknownOffBoardHours,
    );
    traceForResponse = agentResult.trace;
    hitMaxSteps = agentResult.meta != null && agentResult.meta.terminationReason === 'max_steps';
    stableFinalState = agentResult.finalState;

  } else {
    // ── PlannerWorker path (default) ─────────────────────────────────────────
    const worker = new PlannerWorker(model, initialState, { topN: 6, rolloutSteps: 80 });
    useLlm = !isDevMode() && !!modelCfg;
    try {
      if (useLlm) await new LlmOrchestrator(modelCfg!.model, { maxSteps: 24 }).run(worker);
      else worker.run(500, 'greedy');
    } catch (err) {
      console.error('[ai/generate-plan] orchestrator error, finishing greedily:', err instanceof Error ? err.message : String(err));
      worker.run(500, 'greedy');
    }

    proposal = toProposal(
      worker.getPlan(), model, initialState, pinnedHome, worker.explain().summary_he,
      currentlyTakingHoursFromContext, plannedHoursFromContext, impliedUnknownOffBoardHours,
    );
    traceForResponse = worker.getTrace();
    hitMaxSteps = worker.getTrace().some(a => a.action === 'STOP' && a.reason?.includes('maxSteps'));
    stableFinalState = worker.getPlan();
  }

  const blockingErrors = [
    ...overloadGate(proposal.semesters, model, effectivePreferences),
    ...disallowedGate(proposal.semesters, model),
    ...annualCompletenessGate(proposal.semesters, model),
    ...legalityGate(proposal.semesters, model, pinnedHome),
    ...missingMandatoryGate(proposal.semesters, model),
    ...mustIncludeGate(proposal.semesters, model),
    ...degreeHoursGate(proposal.semesters, model, pinnedHome, currentlyTakingHoursFromContext, plannedHoursFromContext, impliedUnknownOffBoardHours),
  ];
  // Soft, non-blocking — see maxWeeklyHoursWarnings' own comment (issue #25
  // Finding #3). Not a blockingError: the hard cap already gates via
  // overloadGate above; this is disclosure only.
  proposal.warnings_he.push(...maxWeeklyHoursWarnings(proposal.semesters, model, effectivePreferences));

  if (hitMaxSteps) {
    proposal.warnings_he.push('המתכנן לא הסיים את החישוב בגלל מגבלת מספר הצעדים — התוכנית עשויה להיות חלקית.');
    blockingErrors.push(STEP_LIMIT_ERROR);
  }

  if (!isBypassQuota() && dbUrl) {
    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, useLlm ? (modelCfg?.name ?? 'llm') : 'greedy', dbUrl),
    ]);
  }

  const responseBody: Record<string, unknown> = {
    ...proposal,
    errors: blockingErrors,
    blocked: blockingErrors.length > 0,
    trace: traceForResponse,
  };
  // Additive intent outcome — derived from the ACTUAL placements above (never
  // generated prose): which interpreted requests were honored, partially
  // honored, or unmet (incl. an exclusion that conflicts with a mandatory
  // requirement, and unresolved course phrases). Present only when free-text
  // interpretation ran.
  if (interpretedIntent) {
    const hoursById = new Map<string, number | null | undefined>();
    for (const [id, p] of model.profiles) hoursById.set(id, p.hours);
    // Aligned-placed set derived from the FINAL proposal ∩ the same fit evidence
    // the planner scored — so the focus outcome reflects real placements only.
    const placedNow = new Set(proposal.semesters.flatMap((s: any) => s.course_ids));
    const requestedGroundedTopics = new Set(groundedTopicsForFocusAreas(interpretedIntent.focusAreas ?? []));
    const groundedFocusContributions = selectedGroundedContributions.filter(
      (c) => c.feature === 'topic' && c.topicId !== undefined && requestedGroundedTopics.has(c.topicId),
    );
    const fitAlignedPlacedCourseIds = new Set([
      ...(courseFitById ? [...courseFitById.keys()].filter((id) => placedNow.has(id)) : []),
      ...groundedFocusContributions.map((c) => c.courseId).filter((id) => placedNow.has(id)),
    ]);
    // Evidence chain for the explanation: official-syllabus course evidence for each
    // aligned placed course, plus the authoritative external-context (goal→capability)
    // relationships for the requested focus areas. Kept as two distinct layers.
    const focusEvidenceByCourseId = new Map(
      courseFit
        ? [...fitAlignedPlacedCourseIds]
            .map((id) => [id, courseFit.evidenceById.get(id)] as const)
            .filter(([, e]) => e)
            .map(([id, e]) => [id, { inferenceLevel: e!.inferenceLevel, extractedEvidence: e!.extractedEvidence, sourceUrl: e!.sourceUrl, confidence: e!.confidence }] as const)
        : [],
    );
    for (const contribution of groundedFocusContributions) {
      if (focusEvidenceByCourseId.has(contribution.courseId)) continue;
      focusEvidenceByCourseId.set(contribution.courseId, {
        inferenceLevel: 'explicit',
        extractedEvidence: contribution.excerpt ?? null,
        sourceUrl: contribution.sourceRef || null,
        confidence: 0.9,
      });
    }
    const focusExternalContext = (interpretedIntent.focusAreas ?? []).some((f) => f.area === 'mechanical_design')
      ? getExternalContextEvidence('engineering_design').map((r) => ({ capability: r.capability, publisher: r.publisher, sourceUrl: r.sourceUrl, extractedEvidence: r.extractedEvidence }))
      : undefined;
    responseBody.intentOutcome = buildIntentOutcome(interpretedIntent, proposal.semesters, {
      catalog: intentCatalog,
      requiredMandatoryCourseIds: model.requiredMandatoryCourseIds,
      hoursById,
      fitAlignedPlacedCourseIds,
      focusEvidenceByCourseId,
      focusExternalContext,
    });
  }
  // Opt-in only, additive: attach an interest evaluation over the generated
  // plan. Never influences plan generation, scorePlan, ranking, or the fields
  // above — purely a read of proposal.semesters. Absent flag => key absent.
  if (include_interest_evaluation === true) {
    responseBody.interestEvaluation = buildGeneratePlanInterestEvaluation(proposal.semesters, academic_interest_profile);
  }
  // Opt-in AcademicDecisionAgent path — additive, default-off. The REAL
  // AcademicDecisionAgent class (academic_decision_agent.ts, built by
  // createDefaultAcademicDecisionAgent) genuinely executes here, orchestrating
  // AROUND the plan generated above with the stable planner injected as its
  // PlanningCapability (never re-planning from emptyState — see
  // academic_decision_integration.ts). Its clarification/gaps then feed the
  // Hebrew-ready academicDecision view (buildAcademicDecision, unchanged). A
  // controlled agent failure falls back to the adapter-only clarification and
  // is marked in `orchestration.engine`; committed state is never touched.
  // Absent flag => `academicDecision` key absent (legacy contract preserved).
  if (use_academic_decision_agent === true) {
    const agentRun = await runAcademicDecisionAgent({
      programId: program_id,
      dbUrl,
      board,
      model,
      finalState: stableFinalState,
      rationaleHe: proposal.rationale_he,
      clarification: academicDecisionClarification!,
      currentCourseIds: currentlyPlannedCourseIds,
    });
    responseBody.academicDecision = buildAcademicDecision({
      proposal,
      model,
      blocked: blockingErrors.length > 0,
      errors: blockingErrors,
      clarification: agentRun.clarification,
      context: {
        completedCourseIds: (effectivePlanContext?.personal_status?.completed ?? []).map((c: any) => c.course_id),
        currentCourseIds: currentlyPlannedCourseIds,
        excludedCourseIds: resolveHardExcludedCourseIds(effectivePreferences),
        wantedCourseIds: effectivePreferences.wanted_course_ids,
        maxWeeklyHours: effectivePreferences.max_weekly_hours ?? undefined,
      },
      academicInterestProfileRaw: academic_interest_profile,
    });
    // Safe diagnostics proving which orchestration engine ran — nested inside
    // academicDecision (agent path only), so the default path's LEGACY_KEYS
    // top-level contract is untouched.
    (responseBody.academicDecision as Record<string, unknown>).orchestration = agentRun.orchestration;
    // Plan-inert Knowledge Grounding (known/unknown/inferred/conflicting course
    // facts + provenance + structured conflicts) — reasoning input only, never
    // mutates the plan. Nested inside academicDecision (agent path only).
    (responseBody.academicDecision as Record<string, unknown>).grounding = agentRun.grounding;
    // Structured, mutually-exclusive outcome + server-side Apply-eligibility
    // floor (Slice 4). A draft is always still returned (never withheld); this
    // only tells the client which state the draft is in and whether Apply is
    // permitted. Generate never mutates the committed board regardless.
    const outcome = classifyAgentOutcome({
      engineFailed: agentRun.orchestration.engine === 'runtime-adapter-fallback',
      blocked: blockingErrors.length > 0,
      hasCriticalMissingInput: hasCriticalMissingInput(agentRun.clarification),
      // Derived from the REAL agent grounding-validation result (Slice 6) — not
      // an API-side re-count of conflicts. applyBlocked is true only when an
      // unresolved authoritative conflict was found by the class's validation
      // stage; the plan is never changed to hide it.
      hasUnresolvedConflicts: agentRun.validation?.applyBlocked === true,
      // Slice 18A — a hard user constraint that cannot be satisfied at all.
      hardConstraintsInfeasible: hardConstraintOutcome?.outcome === 'infeasible',
    });
    (responseBody.academicDecision as Record<string, unknown>).outcome = outcome;
    (responseBody.academicDecision as Record<string, unknown>).applyEligible = isApplyEligible(outcome);
    // Typed, deterministic hard-constraint reasons (stable codes, affected course
    // ids, conflicting constraints/facts, concise Hebrew explanation, safe
    // user-resolvable actions, authoritative/non-answerable distinction). Present
    // on every flagged run; `reasons` is empty when the request is satisfiable.
    (responseBody.academicDecision as Record<string, unknown>).hardConstraints = hardConstraintOutcome;
    /**
     * What prior completion was authoritatively recognized, and what the degree
     * therefore still requires. A LEAN disclosure: no digest, no rule objects,
     * no pools, no score internals — each line says only what the requirement
     * engine actually proved, and credited hours are never reported as a
     * satisfied category.
     */
    if (model.academicProgress) {
      (responseBody.academicDecision as Record<string, unknown>).academicProgress =
        describeAcademicProgress(model.academicProgress);
    }
    // Slice 14 — record the exact preference-profile version the proposal was
    // built with, plus deterministic eligibility validation (which typed
    // preferences reached the planner boundary as hard/soft, and which were
    // excluded and why). The typed profile is the source of truth; ineligible
    // preferences are surfaced, never silently dropped. Absent when the client
    // sent no profile (backward-compatible).
    if (effectivePrefs) {
      (responseBody.academicDecision as Record<string, unknown>).profileVersion = effectivePrefs.profileVersion;
      (responseBody.academicDecision as Record<string, unknown>).preferenceEligibility = {
        hard: effectivePrefs.hard.map((p) => ({ id: p.id, affects: p.affects, source: p.source })),
        soft: effectivePrefs.soft.map((p) => ({ id: p.id, affects: p.affects, source: p.source })),
        excluded: effectivePrefs.excluded,
      };
      // Slice 17A — the resolved semester-distribution policy the planner actually
      // consumed, with provenance (preference id, source, profile version).
      (responseBody.academicDecision as Record<string, unknown>).distributionPolicy = resolvedPolicy;
    }
    // K9A/B3–B5 — every grounded source is disclosed, including structured
    // academic focus/avoidance that does not require a PreferenceProfile.
    // Conflicts are surfaced here rather than silently resolved by source order.
    (responseBody.academicDecision as Record<string, unknown>).groundedObjective = {
      objective: resolvedGrounded?.objective ?? null,
      objectives: (resolvedGrounded?.objectives ?? []).map((o) => ({
        id: o.id, preferenceId: o.preferenceId, kind: o.kind, target: o.target,
        ...(o.topicIds?.length ? { topicIds: o.topicIds } : {}),
        source: o.source, profileVersion: o.profileVersion,
        ...(typeof o.priority === 'number' ? { priority: o.priority } : {}),
      })),
      ...(resolvedGrounded?.provenance ? { provenance: resolvedGrounded.provenance } : {}),
      ...(resolvedGrounded?.excluded ? { excluded: resolvedGrounded.excluded } : {}),
      ...(resolvedGrounded?.prioritySource ? { prioritySource: resolvedGrounded.prioritySource } : {}),
    };
    // Lean candidate-orchestration metadata (the flagged proposal is built from
    // the selected validated candidate). Present on every flagged run.
    if (candidateOrchestration) {
      (responseBody.academicDecision as Record<string, unknown>).candidates = candidateOrchestration;
    }
    // Typed, provenance-carrying validation findings from the class stage.
    (responseBody.academicDecision as Record<string, unknown>).validationFindings =
      agentRun.validation?.findings ?? [];
    // Unified structured clarification (answerable preference gaps +
    // non-answerable authoritative conflicts). Distinction preserved per item.
    (responseBody.academicDecision as Record<string, unknown>).structuredClarification =
      agentRun.structuredClarification;

    /**
     * S1 — retain the AUTHORITATIVE proposal.
     *
     * Everything above computed a validated candidate set and was about to
     * forget it, leaving the browser as the only holder of the plans. From here
     * the server keeps its own copy, and the client receives only a receipt:
     * ids and the versions an Apply must still match. Apply resolves the
     * candidate out of this record, so a plan sent by a client is never the
     * thing that gets committed.
     *
     * Stored only for a real, applyable proposal — there is nothing
     * authoritative about a blocked or infeasible outcome, and offering a
     * handle to one would invite an Apply that must fail anyway.
     */
    if (outcome === 'proposal' && isApplyEligible(outcome) && candidateOrchestration) {
      const alternatives = (candidateOrchestration.alternatives ?? []) as Array<{
        candidateId: string;
        semesters: Array<{ semesterId: string; courseIds: string[] }>;
        normalizedIdentity: string;
        recommended: boolean;
        applyable: boolean;
        constraintFingerprint: string;
        snapshotId: string;
      }>;
      const selectedId = candidateOrchestration.selectedCandidateId as string | null;

      /**
       * The recommendation is ALWAYS storable, even when no comparison was
       * offered: a single validated plan is still a plan the student may apply.
       * `alternatives` is empty in that case by design (one plan is a proposal,
       * not a choice), so the selected candidate is stored on its own.
       */
      const storedCandidates = alternatives.length
        ? alternatives.map((a) => ({
            candidateId: a.candidateId,
            semesters: a.semesters.map((sem) => ({ semesterId: sem.semesterId, courseIds: [...sem.courseIds] })),
            normalizedIdentity: a.normalizedIdentity,
            valid: true,
            applyable: a.applyable,
            recommended: a.recommended,
          }))
        : selectedId
          ? [{
              candidateId: selectedId,
              semesters: proposal.semesters.map((sem: { semester_id: string; course_ids: string[] }) => ({
                semesterId: sem.semester_id, courseIds: [...sem.course_ids],
              })),
              normalizedIdentity: String(candidateOrchestration.selectedNormalizedIdentity ?? ''),
              valid: true,
              applyable: true,
              recommended: true,
            }]
          : [];

      if (storedCandidates.length) {
        const now = Date.now();
        const committed = await getBoardRepository().load(owner.ownerId, program_id);
        const record: ProposalRecord = {
          proposalId: newProposalId(),
          ownerId: owner.ownerId,
          programId: program_id,
          createdAt: now,
          expiresAt: now + PROPOSAL_TTL_MS,
          baseBoardVersion: committed?.version ?? null,
          profileVersion: preference_profile?.version ?? 0,
          academicStatusDigest: academicStatusDigest(effectivePlanContext?.personal_status),
          constraintFingerprint: alternatives[0]?.constraintFingerprint
            ?? String((candidateOrchestration.evidence as Record<string, unknown> | undefined)?.snapshotId ?? 'cf_none'),
          snapshotId: alternatives[0]?.snapshotId
            ?? String((candidateOrchestration.evidence as Record<string, unknown> | undefined)?.snapshotId ?? ''),
          candidates: storedCandidates,
          recommendedCandidateId: selectedId,
          outcome,
          applyEligible: true,
        };
        await getProposalStore().put(record);
        (responseBody.academicDecision as Record<string, unknown>).proposal = toReceipt(record);
      }
    }
  }
  res.status(200).json(responseBody);
}

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
} from './planner_validate';
import { OVERLOAD_ERROR_MARKER, ANNUAL_PARTIAL_PLACEMENT_MARKER, CURRENTLY_TAKING_REUSE_ERROR_MARKER } from './plan_validation';
import {
  incompleteAnnualCourseIds,
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
import type { ConstraintModel, PlanState, PlannerMutation } from './planner_types';
import { placedCourseIds, semesterOf } from './planner_types';
import { resumeClarificationPreflight } from './academic_clarification_preflight';
import { mergeClarificationAnswersIntoGeneratePlanInputs } from './academic_clarification_plan_inputs';
import { buildGeneratePlanInterestEvaluation } from './generate_plan_interest_evaluation';
import {
  extractClarificationContext,
  clarifyForAcademicDecision,
  buildAcademicDecision,
  resolveHardExcludedCourseIds,
} from './academic_decision_runtime';
import type { ClarificationResult } from './academic_decision_types';

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

/** Build the model from board_json (full universe). board is always non-null here. */
export function buildModel(board: any, ctx: any, prefs: Preferences, program_id?: string, currentlyPlannedCourseIds?: string[]): ConstraintModel {
  // Phase 0 — identity metadata only; parseProgramVersionId is the same parser
  // already used above to route the board_json lookup, reused here for the
  // model's programId/catalogYear. No institutionId source exists yet.
  const pv = program_id ? parseProgramVersionId(program_id) : null;
  return buildConstraintModel(board, {
    completedCourseIds: (ctx?.personal_status?.completed ?? []).map((c: any) => c.course_id),
    currentlyPlannedCourseIds,
    wantedCourseIds: prefs.wanted_course_ids,
    unwantedCourseIds: prefs.unwanted_course_ids,
    disallowedCourseIds: resolveHardExcludedCourseIds(prefs),
    pinnedCourseIds: ctx?.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours: priorHoursFromContext(ctx),
    overloadAccepted: prefs.overload_accepted,
    overloadConfirmedAt: prefs.overload_confirmed_at,
    programId: pv?.base,
    catalogYear: pv?.year,
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
 */
function canRecoverMoreHours(
  finalState: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
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

    for (const mut of recoveryCandidateActions(state, model)) {
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
      if (!validatePlanState(candidate, model, pinnedHome).valid) continue;
      visited++;

      if (computeDegreeHours(candidate, model) > baselineHours) {
        const rep = validateCandidate(candidate, model, pinnedHome);
        if (
          rep.legal &&
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
 * `is_unwanted` (soft-avoided) courses are excluded from both supplements —
 * intentionally: the automatic search must never place a course the user
 * asked to avoid on its own. Whether the user could still approve one as a
 * risky elective is a distinct question, answered separately by
 * canRecoverViaUnwantedElective below, not folded into this rollout.
 */
function recoveryCandidateActions(state: PlanState, model: ConstraintModel): PlannerMutation[] {
  const actions = enumerateActions(state, model);
  const placedNow = new Set(placedCourseIds(state));
  const eligible = (id: string, p: { is_mandatory?: boolean; hours?: number | null; is_unwanted?: boolean }) =>
    !p.is_mandatory && p.hours != null && p.hours !== 0 && !p.is_unwanted &&
    !isFullyPlaced(state, model, placedNow, id) &&
    !model.completedCourseIds.has(id) && !isExcluded(model, id);

  for (const [id, p] of model.profiles) {
    if (!eligible(id, p)) continue;
    actions.push(...addCourseActionsFor(model, id));
  }

  for (const outId of placedNow) {
    if (!isMovable(model, outId)) continue;
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
    if (!isMovable(model, outId)) continue;
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
 */
function canRecoverViaUnwantedElective(
  finalState: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string>,
): boolean {
  const placedNow = new Set(placedCourseIds(finalState));
  return [...model.profiles].some(([id, p]) => {
    if (!p.is_unwanted) return false;
    if (p.is_mandatory || p.hours == null || p.hours === 0) return false;
    if (isFullyPlaced(finalState, model, placedNow, id)) return false;
    if (model.completedCourseIds.has(id) || isExcluded(model, id)) return false;
    return addCourseActionsFor(model, id).some(a => {
      const next = applyMutation(finalState, a);
      return next != null && validatePlanState(next, model, pinnedHome).valid;
    });
  });
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

  const warnings_he: string[] = [];
  if (!report.degreeMet) warnings_he.push(`התוכנית משלימה ${report.degreeHours}/${model.degreeRequiredHours} ש"ש.`);
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
  // Codex review (round 6, refined by rounds 10-11) caught that
  // report.degreeHours (model.priorHours + placedHours(finalState)) never
  // includes hours from off-board personal_status.currently_taking courses —
  // priorHoursFromContext deliberately excludes total_hours_progress.
  // currently_planned_hours (see its own comment above), and a
  // currently-taking course is never placed on the board either, so its
  // hours are invisible to both terms. A student whose known-completed +
  // board-placed hours fall short only because a real, already-in-progress
  // course isn't counted yet would see "catalog exhausted" even though the
  // gap closes once that course finishes. Credited by reading each
  // model.currentlyPlannedCourseIds entry's OWN hours — model.profiles when
  // the course is in the board catalog, else the client-resolved hours in
  // personal_status.currently_taking itself (round 10's fix: some
  // currently-taking courses, e.g. first/second-year mandatory ones the
  // frontend tracks via a static fallback, predate the program's board
  // window and have no model.profiles entry at all). Deliberately reads
  // ONLY personal_status.currently_taking (round 11's fix), never the mixed
  // total_hours_progress.currently_planned_hours aggregate (which also
  // includes personal_status.planned — a course the planner can legitimately
  // place and credit itself via report.degreeHours; adding the aggregate on
  // top would double-count it).
  const currentlyPlannedHours = [...(model.currentlyPlannedCourseIds ?? [])]
    .reduce((sum, id) => sum + (model.profiles.get(id)?.hours ?? currentlyTakingHoursFromContext?.get(id) ?? 0), 0);
  if (
    !report.degreeMet &&
    report.degreeHours + currentlyPlannedHours < model.degreeRequiredHours &&
    report.missingMandatory.length === 0 &&
    report.unsatisfiedCategories.length === 0 &&
    report.legal &&
    report.disallowedPlaced.length === 0
  ) {
    const recoverable =
      canRecoverViaUnwantedElective(finalState, model, pinnedHome) ||
      canRecoverMoreHours(finalState, model, pinnedHome);
    if (!recoverable) {
      // Codex review (round 13) caught that this message's numerator used
      // report.degreeHours alone, even though the guard just above credited
      // currentlyPlannedHours (off-board currently-taking courses) before
      // deciding the gap is genuinely structural — a partial-credit case
      // (test 8b/11b) would show e.g. "172/185" while the branch's own logic
      // already accounted for 176/185, understating real progress in this
      // user-visible message. Use the same credited total the guard itself
      // used.
      warnings_he.push(
        `מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (${report.degreeHours + currentlyPlannedHours}/${model.degreeRequiredHours} ש"ש) — ` +
        `הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.`,
      );
    }
  }
  warnings_he.push(...prerequisiteSequencingNotes(finalState, model));

  // report.warnings === validatePlanState(finalState, model, pinnedHome).warnings
  warnings_he.push(...report.warnings);

  return { semesters, moves, warnings_he, rationale_he, requirements_status };
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
  const { program_id, plan_context, preferences, session_token, clarification_answers, include_interest_evaluation, academic_interest_profile, use_academic_decision_agent } = parsed.data;

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

  const model = buildModel(board, effectivePlanContext, effectivePreferences, program_id, currentlyPlannedCourseIds);
  const initialState = planContextToState(effectivePlanContext, model);
  const pinnedHome = buildPinnedHome(model, initialState);
  const modelCfg = resolveModel();

  let proposal: ReturnType<typeof toProposal>;
  let traceForResponse: unknown[];
  let hitMaxSteps = false;
  let useLlm = false;

  if (process.env.AI_USE_AGENTIC_PLANNER === 'true') {
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
      currentlyTakingHoursFromContext,
    );
    traceForResponse = agentResult.trace;
    hitMaxSteps = agentResult.meta != null && agentResult.meta.terminationReason === 'max_steps';

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
      currentlyTakingHoursFromContext,
    );
    traceForResponse = worker.getTrace();
    hitMaxSteps = worker.getTrace().some(a => a.action === 'STOP' && a.reason?.includes('maxSteps'));
  }

  const blockingErrors = [
    ...overloadGate(proposal.semesters, model, effectivePreferences),
    ...disallowedGate(proposal.semesters, model),
    ...annualCompletenessGate(proposal.semesters, model),
    ...legalityGate(proposal.semesters, model, pinnedHome),
    ...missingMandatoryGate(proposal.semesters, model),
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
  // Opt-in only, additive: attach an interest evaluation over the generated
  // plan. Never influences plan generation, scorePlan, ranking, or the fields
  // above — purely a read of proposal.semesters. Absent flag => key absent.
  if (include_interest_evaluation === true) {
    responseBody.interestEvaluation = buildGeneratePlanInterestEvaluation(proposal.semesters, academic_interest_profile);
  }
  // Opt-in AcademicDecisionAgent runtime — additive. Orchestrates the decision
  // loop around the plan generated above (never regenerates it). Reuses the
  // clarification result computed pre-planning. Absent flag => key absent.
  if (use_academic_decision_agent === true) {
    responseBody.academicDecision = buildAcademicDecision({
      proposal,
      model,
      blocked: blockingErrors.length > 0,
      errors: blockingErrors,
      clarification: academicDecisionClarification!,
      context: {
        completedCourseIds: (effectivePlanContext?.personal_status?.completed ?? []).map((c: any) => c.course_id),
        currentCourseIds: currentlyPlannedCourseIds,
        excludedCourseIds: resolveHardExcludedCourseIds(effectivePreferences),
        wantedCourseIds: effectivePreferences.wanted_course_ids,
        maxWeeklyHours: effectivePreferences.max_weekly_hours ?? undefined,
      },
      academicInterestProfileRaw: academic_interest_profile,
    });
  }
  res.status(200).json(responseBody);
}

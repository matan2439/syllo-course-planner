/**
 * AcademicDecisionAgent runtime adapter — the named seam behind the opt-in
 * `use_academic_decision_agent` flag in generate-plan.ts.
 *
 * It orchestrates the academic decision loop AROUND generate-plan's existing,
 * unchanged plan generation:
 *
 *   Observe/Plan  — generate-plan's own planner path (untouched; this adapter
 *                   only READS the already-produced PlanProposal + model).
 *   Clarify       — DeterministicClarificationCapability over request inputs.
 *   Validate      — reuses the proposal's own validation result (errors,
 *                   warnings_he, requirements_status).
 *   Simulate/Eval — requirement coverage, workload notes (getSemesterLoad),
 *                   interestEvaluation via the full-catalog resolver (only when
 *                   a meaningful AcademicInterestProfile is supplied), and
 *                   honest missing/needs_review topic-data notes.
 *   Decide        — deterministic single-plan selection + rationale.
 *   Explain       — a Hebrew-ready structured explanation object.
 *
 * Why an adapter and not the AcademicDecisionAgent class: that class's Plan
 * stage (runPlanningOrchestration) builds a DIFFERENT ConstraintModel and
 * starts from emptyState, so routing generate-plan through it would change the
 * generated plan and break completed/currently_taking/excluded/max-hours
 * semantics. This adapter reuses the SAME capability MODULES the class uses
 * (ClarificationCapability, evaluateAcademicInterestFit, InterestPlanScorecard)
 * while leaving the planner and default response byte-identical.
 *
 * No LLM, no Supabase, no plan mutation, no fabrication.
 */

import {
  normalizeAcademicInterestProfile,
  hasMeaningfulAcademicInterests,
  type RawAcademicInterestProfile,
  type AcademicInterestProfile,
} from './academic_interest_profile';
import { DeterministicClarificationCapability } from './academic_clarification';
import type {
  ClarificationPlanningContext,
  ClarificationResult,
  MissingInputField,
} from './academic_decision_types';
import { buildGeneratePlanInterestEvaluation } from './generate_plan_interest_evaluation';
import type { AcademicInterestEvaluationResult } from './academic_interest_evaluation';
import {
  createMechanicalEngineering2027Resolver,
  summarizeCourseTopicProfileSources,
} from './course_topic_profiles_static';
import { getSemesterLoad } from './completion_analysis';
import type { ConstraintModel } from './planner_types';
import {
  DISALLOWED_PLACED_ERROR_PREFIX,
  ANNUAL_INCOMPLETE_ERROR_PREFIX,
  STEP_LIMIT_ERROR,
  LEGALITY_VIOLATION_ERROR_PREFIX,
  MISSING_MANDATORY_ERROR_PREFIX,
  DEGREE_HOURS_SHORTFALL_ERROR_PREFIX,
} from './planner_validate';

// ── Public shapes ───────────────────────────────────────────────────────────

export interface AcademicDecisionProposal {
  semesters: Array<{ semester_id: string; course_ids: string[] }>;
  moves: Array<{ course_id: string; from: string | null; to: string }>;
  warnings_he: string[];
  rationale_he: string;
  requirements_status: Array<{ name: string; required: number; placed: number; satisfied: boolean }>;
}

export interface AcademicDecisionContext {
  completedCourseIds?: string[];
  currentCourseIds?: string[];
  excludedCourseIds?: string[];
  /** wanted_course_ids from preferences — only read here to disclose a self-contradiction against excludedCourseIds; never used for plan generation itself (that already happens in generate-plan.ts). */
  wantedCourseIds?: string[];
  maxWeeklyHours?: number;
  track?: string;
}

export interface AcademicDecisionExplanation {
  mainRecommendation: string;
  whyThisPlan: string[];
  risksAndTradeoffs: string[];
  missingData: string[];
  suggestedNextActions: string[];
}

export interface AcademicDecisionValidation {
  valid: boolean;
  errors: string[];
  warnings_he: string[];
  requirementsSatisfied: boolean;
}

export interface AcademicDecisionEvaluation {
  requirementCoverage: AcademicDecisionProposal['requirements_status'];
  workloadNotes: string[];
  missingDataNotes: string[];
}

export interface AcademicDecisionDecision {
  selectedPlan: 'generated';
  rationale: string;
  tradeoffs: string[];
}

/** Full (planned) path — validation/evaluation/decision always present. */
export interface AcademicDecisionView {
  clarification: ClarificationResult;
  validation: AcademicDecisionValidation;
  evaluation: AcademicDecisionEvaluation;
  interestEvaluation?: AcademicInterestEvaluationResult;
  decision: AcademicDecisionDecision;
  explanation: AcademicDecisionExplanation;
}

/** Blocked (critical-missing) path — no plan, so validation/evaluation/decision are absent. */
export interface AcademicClarificationOnlyView {
  clarification: ClarificationResult;
  validation?: undefined;
  evaluation?: undefined;
  decision?: undefined;
  explanation: AcademicDecisionExplanation;
}

export interface BuildAcademicDecisionInput {
  proposal: AcademicDecisionProposal;
  /** Only `profiles` (course hours) is read. */
  model: Pick<ConstraintModel, 'profiles'>;
  blocked: boolean;
  errors: string[];
  clarification: ClarificationResult;
  context: AcademicDecisionContext;
  /** Untrusted request-supplied profile; normalized here. */
  academicInterestProfileRaw?: unknown;
}

/**
 * disallowed_course_ids and strongly_avoided_course_ids are two request-level
 * names for the same hard-exclusion concept (see generate-plan.ts's
 * preferencesSchema). A client may legitimately send either, both, or neither
 * — e.g. the clarification-answer merge path (academic_clarification_plan_inputs.ts)
 * writes disallowed_course_ids from an answer while leaving whatever
 * strongly_avoided_course_ids the original request already had. Every caller
 * that resolves the user's actual hard-avoid list must union both fields
 * rather than pick one nullish-first, or a course excluded only through the
 * other field name is silently treated as allowed. undefined+undefined stays
 * undefined (no restriction at all), matching BuildModelOptions' existing
 * "unset means unrestricted" contract.
 */
export function resolveHardExcludedCourseIds(
  prefs?: { disallowed_course_ids?: string[]; strongly_avoided_course_ids?: string[] } | null,
): string[] | undefined {
  const a = prefs?.disallowed_course_ids;
  const b = prefs?.strongly_avoided_course_ids;
  if (a === undefined && b === undefined) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

// ── Clarify ──────────────────────────────────────────────────────────────────

/**
 * Issue #43: `track_or_focus` is a real clarification question
 * (academic_clarification.ts's QUESTION_SPECS) but has no target field in
 * plan_context/preferences — mergeClarificationAnswersIntoGeneratePlanInputs
 * (academic_clarification_plan_inputs.ts) documents this as deliberate: no
 * planner input consumes a track/specialization value, and inventing one
 * would be out of scope. That must not mean the QUESTION itself can never be
 * marked resolved, though — without this, it re-asks identically forever
 * even after a valid answer, unlike every other clarification field. Reads
 * the answer straight from the raw request array (never merged into
 * plan_context/preferences, so it still never reaches planning) purely to
 * let clarify() see it was answered. Mirrors academic_clarification_loop.ts's
 * EXPECTED_ANSWER_KIND validation for the same question id (non-empty text).
 */
function resolveTrackAnswer(answers?: Array<{ questionId: string; value: unknown }>): string | undefined {
  if (!answers) return undefined;
  // Scan from the end so the most recent VALID answer wins — matches the
  // "later answers win" convention the rest of the clarification-merge path
  // already follows (academic_clarification_loop.ts's applyClarificationLoopAnswers).
  // A later blank/invalid duplicate is skipped (not treated as "no answer at
  // all"), so it can't shadow an earlier genuinely valid one — Codex review
  // (PR #46, discussion_r3626609490): a naive .find() picking the FIRST
  // matching entry regardless of validity could keep track unresolved even
  // when a valid answer exists later in the same batch.
  for (let i = answers.length - 1; i >= 0; i--) {
    const a = answers[i];
    if (a.questionId !== 'track_or_focus') continue;
    if (typeof a.value === 'string' && a.value.trim().length > 0) return a.value;
  }
  return undefined;
}

/** Map generate-plan's plan_context/preferences onto the clarification context. */
export function extractClarificationContext(
  planContext: any,
  preferences: any,
  rawProfile: unknown,
  clarificationAnswers?: Array<{ questionId: string; value: unknown }>,
): ClarificationPlanningContext {
  const completed = (planContext?.personal_status?.completed ?? []).map((c: any) => c?.course_id).filter(Boolean);
  const current = (planContext?.personal_status?.currently_taking ?? []).map((c: any) => c?.course_id).filter(Boolean);
  const excluded = resolveHardExcludedCourseIds(preferences);

  const context: ClarificationPlanningContext = {
    completedCourseIds: completed,
    currentCourseIds: current,
    excludedCourseIds: excluded,
    maxWeeklyHours: preferences?.max_weekly_hours ?? undefined,
  };
  const trackAnswer = resolveTrackAnswer(clarificationAnswers);
  if (trackAnswer !== undefined) context.track = trackAnswer;
  // Only introduce the interest key when a profile is actually supplied — absence
  // must leave clarification's interest questions dormant (see academic_clarification.ts).
  if (rawProfile !== undefined && rawProfile !== null) {
    context.academicInterestProfile = normalizeAcademicInterestProfile(rawProfile as RawAcademicInterestProfile);
  }
  return context;
}

export async function clarifyForAcademicDecision(
  context: ClarificationPlanningContext,
): Promise<ClarificationResult> {
  return new DeterministicClarificationCapability().clarify({ gaps: [], context });
}

export function hasCriticalMissingInput(result: ClarificationResult): boolean {
  return result.missingInputs.some((m) => m.critical);
}

// ── Hebrew labels for missing fields ──────────────────────────────────────────

const FIELD_HE: Record<MissingInputField, string> = {
  completedCourses: 'קורסים שהושלמו',
  currentCourses: 'קורסים בלימוד כעת',
  excludedCourses: 'קורסים להחרגה',
  maxWeeklyHours: 'מגבלת שעות שבועית',
  track: 'מסלול / תחום התמחות',
  academicFocusAreas: 'תחומי עניין אקדמיים',
  academicAvoidAreas: 'תחומים להימנעות',
  courseStylePreferences: 'העדפות סגנון קורס',
  optimizationPriorities: 'סדרי עדיפויות לתכנון',
  careerGoals: 'יעדים תעסוקתיים',
};

// ── Full (planned) path ────────────────────────────────────────────────────

function computeWorkloadNotes(input: BuildAcademicDecisionInput): string[] {
  const courseHours: Record<string, { hours?: number | null }> = {};
  for (const [id, p] of input.model.profiles) courseHours[id] = { hours: (p as any).hours };

  const notes: string[] = [];
  let peak = 0;
  for (const sem of input.proposal.semesters) {
    const hrs = getSemesterLoad(sem, courseHours);
    peak = Math.max(peak, hrs);
    if (input.context.maxWeeklyHours && hrs > input.context.maxWeeklyHours) {
      notes.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — מעל המגבלה שביקשת (${input.context.maxWeeklyHours}).`);
    }
  }
  if (input.proposal.semesters.length > 0) notes.push(`עומס שיא בתוכנית: ${peak} ש"ש בסמסטר.`);
  return notes;
}

/** interestEvaluation (only for a meaningful profile) + honest missing/needs_review notes. */
function computeInterest(input: BuildAcademicDecisionInput): {
  interestEvaluation?: AcademicInterestEvaluationResult;
  missingDataNotes: string[];
} {
  const missingDataNotes: string[] = [];
  const normalized = normalizeAcademicInterestProfile(
    (input.academicInterestProfileRaw ?? {}) as RawAcademicInterestProfile,
  );
  if (!hasMeaningfulAcademicInterests(normalized)) {
    return { missingDataNotes };
  }

  const interestEvaluation = buildGeneratePlanInterestEvaluation(
    input.proposal.semesters,
    input.academicInterestProfileRaw,
  );

  const unmatched = interestEvaluation.unmatchedCourseIds.length;
  if (unmatched > 0) {
    missingDataNotes.push(`${unmatched} מקורסי התוכנית ללא פרופיל תחומי — לא נכללו בהערכת ההתאמה.`);
  }
  // needs_review: matched courses whose topic profile is a 'default' placeholder.
  const resolver = createMechanicalEngineering2027Resolver();
  const resolution = resolver.resolveCourseTopicProfiles(interestEvaluation.evaluatedCourseIds);
  const sources = summarizeCourseTopicProfileSources(resolution.profilesByCourseId);
  if (sources.default > 0) {
    missingDataNotes.push(`${sources.default} מקורסי התוכנית עם פרופיל תחומי בברירת מחדל — טעונים בדיקה (needs_review).`);
  }
  return { interestEvaluation, missingDataNotes };
}

/** Build the full academicDecision view for a generated plan. Pure. */
export function buildAcademicDecision(input: BuildAcademicDecisionInput): AcademicDecisionView {
  const requirementsSatisfied = input.proposal.requirements_status.every((r) => r.satisfied);

  const validation: AcademicDecisionValidation = {
    valid: !input.blocked,
    errors: input.errors,
    warnings_he: input.proposal.warnings_he,
    requirementsSatisfied,
  };

  const workloadNotes = computeWorkloadNotes(input);
  const { interestEvaluation, missingDataNotes } = computeInterest(input);

  const evaluation: AcademicDecisionEvaluation = {
    requirementCoverage: input.proposal.requirements_status,
    workloadNotes,
    missingDataNotes,
  };

  // ── Explanation (Hebrew-ready, structured) ──
  const placedCount = input.proposal.semesters.reduce((n, s) => n + s.course_ids.length, 0);
  const semCount = input.proposal.semesters.filter((s) => s.course_ids.length > 0).length;

  // blocked can be caused by several independent gates in generate-plan.ts —
  // disallowedGate, annualCompletenessGate, overloadGate, legalityGate, and
  // the PLANNER_STEP_LIMIT sentinel — and the explanation/suggested actions
  // must name the actual cause(s) instead of defaulting to overload guidance.
  // Originally only disallowedGate was special-cased here (hasOtherBlockingError
  // treated every other error as overload); when annualCompletenessGate and
  // the step-limit sentinel were added later (PR #37, silent-empty-plan fix),
  // this cause-attribution logic was never extended to recognize them, so a
  // plan blocked ONLY by an incomplete annual course or a step-limit cutoff
  // was told "reduce your weekly load" — wrong remedial advice for a real,
  // reproducible block (found via the Agent Diagnosis Loop). Each known cause
  // gets its own flag computed directly from input.errors (not workloadNotes'
  // `overloaded`, which only reflects the user's soft max_weekly_hours
  // preference) so combinations (e.g. disallowed + annual-incomplete at once)
  // are all named, not just the first one checked. hasOverloadError is a
  // catch-all for any error that isn't one of the explicitly-known
  // non-overload causes — a genuinely new gate added in the future without a
  // matching flag here would still fall into this bucket, the same latent gap
  // this fix closes for legalityGate (the "fifth" cause this comment used to
  // anticipate, closed by the Agent Diagnosis Loop's prerequisite-timing
  // finding — a plan blocked only by a pre-existing prerequisite/duplicate/
  // pinned/illegal-semester violation was previously told "reduce your
  // weekly load" too, same wrong-advice bug as the annual/step-limit cases).
  const hasDisallowedPlacedError = input.errors.some((e) => e.startsWith(DISALLOWED_PLACED_ERROR_PREFIX));
  const hasAnnualIncompleteError = input.errors.some((e) => e.startsWith(ANNUAL_INCOMPLETE_ERROR_PREFIX));
  const hasStepLimitError = input.errors.includes(STEP_LIMIT_ERROR);
  const hasLegalityViolationError = input.errors.some((e) => e.startsWith(LEGALITY_VIOLATION_ERROR_PREFIX));
  // Agent Diagnosis Loop finding (2026-07-22): a genuinely unrecoverable
  // degree-hours shortfall (every mandatory/category requirement satisfied,
  // plan otherwise legal, but the visible catalog is exhausted before
  // reaching model.degreeRequiredHours) is its own distinct cause, needing its
  // own flag for the same reason the annual/step-limit/legality causes above
  // each got one: "reduce your weekly load" or "request a rebuild" cannot fix
  // a shortfall the catalog itself can't close.
  const hasDegreeHoursShortfallError = input.errors.some((e) => e.startsWith(DEGREE_HOURS_SHORTFALL_ERROR_PREFIX));
  // Agent Diagnosis Loop finding (2026-07-22): a missing mandatory course can
  // have two entirely different root causes — a search-budget/reachability
  // shortfall (fixable by checking prerequisite placement or requesting a
  // rebuild), or the USER'S OWN hard exclusion (disallowed_course_ids /
  // strongly_avoided_course_ids) covering a course that also happens to be
  // mandatory. The generic "check prerequisites, or request a rebuild"
  // advice is actively wrong for the second case: a rebuild is guaranteed to
  // reproduce the identical result as long as the exclusion is still in the
  // request, and a mandatory course may have no prerequisites at all. Names
  // extracted (not ids — missingMandatoryGate's error message only carries
  // name_he) via exact match after stripping the fixed Hebrew prefix, so a
  // name that happens to share a substring with the prefix's own wording
  // (e.g. the generic word "חובה") can never false-positive-match.
  const missingMandatoryNames = input.errors
    .filter((e) => e.startsWith(MISSING_MANDATORY_ERROR_PREFIX))
    .map((e) => e.slice(MISSING_MANDATORY_ERROR_PREFIX.length).trim().replace(/\.$/, ''));
  const excludedNamesInMissingMandatory = (input.context.excludedCourseIds ?? [])
    .map((id) => input.model.profiles.get(id)?.name_he ?? id)
    .filter((name) => missingMandatoryNames.includes(name));
  const hasMissingMandatoryDueToExclusion = excludedNamesInMissingMandatory.length > 0;
  const hasMissingMandatoryOtherCause = missingMandatoryNames.some(
    (name) => !excludedNamesInMissingMandatory.includes(name),
  );
  // Agent Diagnosis Loop finding: a course can appear in BOTH
  // wanted_course_ids and disallowed_course_ids/strongly_avoided_course_ids
  // at once (a self-contradictory request). resolveHardExcludedCourseIds'
  // exclusion already correctly wins during planning (silently — that part
  // is untouched here), and an unsatisfied elective category already gets a
  // truthful warning via proposal.warnings_he — but neither ever states the
  // two preferences directly conflicted, leaving the user unable to tell
  // "the category legitimately has no room" apart from "I asked for
  // contradictory things." This is independent of missingMandatoryNames
  // above: it applies to any wanted+excluded course, mandatory or elective,
  // and must surface regardless of whether the plan is blocked.
  const contradictoryWantedNames = (input.context.wantedCourseIds ?? [])
    .filter((id) => (input.context.excludedCourseIds ?? []).includes(id))
    .map((id) => input.model.profiles.get(id)?.name_he ?? id);
  // Codex finding on PR #58: when the wanted+excluded course was already on
  // the INCOMING board, planContextToState seeds that pre-existing
  // placement and the planner never removes a course on its own —
  // disallowedGate (generate-plan.ts) then reports it as a blocking error
  // instead. In that case the course IS still in proposal.semesters despite
  // the exclusion, so claiming "the exclusion won, the course was not
  // placed" is false and self-contradicts the same response's own
  // disallowed-placed error/semesters content. Names extracted the same way
  // missingMandatoryNames is above (exact match after stripping the fixed
  // Hebrew prefix).
  const disallowedPlacedNames = input.errors
    .filter((e) => e.startsWith(DISALLOWED_PLACED_ERROR_PREFIX))
    .map((e) => e.slice(DISALLOWED_PLACED_ERROR_PREFIX.length).trim().replace(/\.$/, ''));
  const contradictoryWantedStillPlacedNames = contradictoryWantedNames.filter((name) =>
    disallowedPlacedNames.includes(name),
  );
  const contradictoryWantedNotPlacedNames = contradictoryWantedNames.filter(
    (name) => !contradictoryWantedStillPlacedNames.includes(name),
  );

  const hasOverloadError = input.errors.some(
    (e) =>
      !e.startsWith(DISALLOWED_PLACED_ERROR_PREFIX) &&
      !e.startsWith(ANNUAL_INCOMPLETE_ERROR_PREFIX) &&
      !e.startsWith(LEGALITY_VIOLATION_ERROR_PREFIX) &&
      !e.startsWith(MISSING_MANDATORY_ERROR_PREFIX) &&
      !e.startsWith(DEGREE_HOURS_SHORTFALL_ERROR_PREFIX) &&
      e !== STEP_LIMIT_ERROR,
  );

  const blockingCauseClauses: string[] = [];
  if (hasDisallowedPlacedError) blockingCauseClauses.push('היא עדיין כוללת קורס שסימנת להחרגה');
  if (hasAnnualIncompleteError) blockingCauseClauses.push('קורס שנתי לא שובץ בכל הסמסטרים הנדרשים לו');
  if (hasLegalityViolationError) blockingCauseClauses.push('קיימת בתוכנית הפרת חוקיות (למשל סדר תנאי קדם, שיבוץ כפול או שיבוץ שאינו מותר) שטרם טופלה');
  if (hasMissingMandatoryDueToExclusion) {
    blockingCauseClauses.push(
      `קורס חובה (${excludedNamesInMissingMandatory.join(', ')}) לא שובץ בתוכנית כי סימנת אותו להחרגה`,
    );
  }
  if (hasMissingMandatoryOtherCause) blockingCauseClauses.push('קורס חובה לא שובץ בתוכנית');
  if (hasDegreeHoursShortfallError) blockingCauseClauses.push('לא ניתן להשלים את שעות התואר הנדרשות מתוך הקטלוג הזמין בטווח התכנון הנוכחי');
  if (hasOverloadError) blockingCauseClauses.push('יש חריגת עומס שטרם טופלה');
  if (hasStepLimitError) blockingCauseClauses.push('התהליך לא הושלם עד הסוף עקב מגבלת מספר הצעדים והתוכנית עשויה להיות חלקית');

  const mainRecommendation = !input.blocked
    ? `נבחרה תוכנית עם ${placedCount} קורסים על פני ${semCount} סמסטרים${requirementsSatisfied ? ', המכסה את כל הדרישות שנבדקו' : ''}.`
    : blockingCauseClauses.length > 0
      ? `התוכנית שנוצרה אינה ניתנת להחלה כפי שהיא — ${blockingCauseClauses.join('; ')}. יש לטפל בכך לפני שימוש (או לבקש בנייה מחדש).`
      : 'התוכנית שנוצרה אינה ניתנת להחלה כפי שהיא — נדרש בירור נוסף לפני שימוש.';

  const whyThisPlan: string[] = [];
  if (input.proposal.rationale_he) whyThisPlan.push(input.proposal.rationale_he);
  whyThisPlan.push(
    requirementsSatisfied
      ? 'התוכנית מכסה את כל דרישות החובה והקטגוריות שנבדקו.'
      : 'התוכנית מקדמת את דרישות התואר, אך חלק מהדרישות עדיין אינן מולאות.',
  );
  if (!input.blocked) whyThisPlan.push('התוכנית עברה את בדיקות החוקיות והעומס.');
  if (interestEvaluation && interestEvaluation.scorecard.summaryLevel !== 'none') {
    whyThisPlan.push(`רמת ההתאמה לתחומי העניין שציינת: ${interestEvaluation.scorecard.summaryLevel}.`);
  }

  // Deduped: generate-plan.ts's maxWeeklyHoursWarnings (issue #25 Finding #3)
  // now pushes the identical per-semester "מעל המגבלה שביקשת" message into
  // proposal.warnings_he directly, so it can also reach the default (no-flag)
  // path — computeWorkloadNotes above still computes the same message
  // (needed for the `overloaded` signal below), which would otherwise show
  // up twice in this list.
  const risksAndTradeoffs: string[] = [...new Set([...input.proposal.warnings_he, ...workloadNotes])];
  if (interestEvaluation && interestEvaluation.scorecard.avoidRiskCourses.length > 0) {
    risksAndTradeoffs.push(
      `${interestEvaluation.scorecard.avoidRiskCourses.length} קורסים בתוכנית נוגעים בתחומים שביקשת להימנע מהם.`,
    );
  }
  if (contradictoryWantedNotPlacedNames.length > 0) {
    risksAndTradeoffs.push(
      `ביקשת ${contradictoryWantedNotPlacedNames.join(', ')} אך גם סימנת אותו/ם להחרגה — ההחרגה גוברת, ולכן הקורס לא שובץ.`,
    );
  }
  if (contradictoryWantedStillPlacedNames.length > 0) {
    risksAndTradeoffs.push(
      `ביקשת ${contradictoryWantedStillPlacedNames.join(', ')} אך גם סימנת אותו/ם להחרגה — הקורס כבר שובץ בלוח הקיים ולא הוסר אוטומטית, לכן הוא עדיין מופיע בתוכנית חרף ההחרגה; יש להסירו ידנית אם ברצונך לכבד אותה.`,
    );
  }

  const missingData: string[] = [
    ...input.clarification.missingInputs.map((m) => `חסר מידע: ${FIELD_HE[m.field] ?? m.field}.`),
    ...missingDataNotes,
  ];
  if (!interestEvaluation) missingData.push('לא סופק פרופיל תחומי עניין — לא בוצעה הערכת התאמה.');

  const suggestedNextActions = buildSuggestedNextActions({
    overloaded: workloadNotes.some((n) => n.includes('מעל המגבלה')),
    hasOverloadError,
    hasAnnualIncompleteError,
    hasStepLimitError,
    hasLegalityViolationError,
    hasMissingMandatoryOtherCause,
    hasMissingMandatoryDueToExclusion,
    hasDegreeHoursShortfallError,
    excludedNamesInMissingMandatory,
    contradictoryWantedNames,
    disallowedPlaced: hasDisallowedPlacedError,
    clarification: input.clarification,
    context: input.context,
    interestEvaluation,
    hasUnmatchedOrNeedsReview: missingDataNotes.length > 0,
  });

  const tradeoffs = risksAndTradeoffs.length > 0 ? risksAndTradeoffs : ['אין פשרות מהותיות שזוהו בתוכנית זו.'];

  const decision: AcademicDecisionDecision = {
    selectedPlan: 'generated',
    rationale: !input.blocked
      ? 'זוהי התוכנית היחידה שנוצרה בסבב זה; היא נבחרה לאחר שעברה את בדיקות החוקיות והעומס.'
      : blockingCauseClauses.length > 0
        ? `זוהי התוכנית היחידה שנוצרה בסבב זה; היא נבחרה כברירת מחדל אך אינה ניתנת להחלה — ${blockingCauseClauses.join('; ')}.`
        : 'זוהי התוכנית היחידה שנוצרה בסבב זה; היא נבחרה כברירת מחדל אך אינה ניתנת להחלה.',
    tradeoffs,
  };

  return {
    clarification: input.clarification,
    validation,
    evaluation,
    interestEvaluation,
    decision,
    explanation: { mainRecommendation, whyThisPlan, risksAndTradeoffs, missingData, suggestedNextActions },
  };
}

function buildSuggestedNextActions(args: {
  overloaded: boolean;
  /** True when input.errors contains a blocking error that isn't a disallowed-placed course, an incomplete annual course, a legality violation, or the step-limit sentinel — i.e. a genuine overload/other hard-cap gate. */
  hasOverloadError: boolean;
  hasAnnualIncompleteError: boolean;
  hasStepLimitError: boolean;
  hasLegalityViolationError: boolean;
  /** True for a missing mandatory course NOT caused by the user's own hard exclusion — the only case "check prerequisites, or request a rebuild" can actually help. */
  hasMissingMandatoryOtherCause: boolean;
  /** True when at least one missing mandatory course is missing because the user hard-excluded it themselves — a rebuild can never fix this. */
  hasMissingMandatoryDueToExclusion: boolean;
  /** True for a genuinely unrecoverable degree-hours shortfall — the visible catalog is exhausted, so neither "reduce load" nor "request a rebuild" can help. */
  hasDegreeHoursShortfallError: boolean;
  excludedNamesInMissingMandatory: string[];
  /** Courses present in both wanted_course_ids and the resolved hard-exclusion list — a self-contradictory request. */
  contradictoryWantedNames: string[];
  disallowedPlaced: boolean;
  clarification: ClarificationResult;
  context: AcademicDecisionContext;
  interestEvaluation?: AcademicInterestEvaluationResult;
  hasUnmatchedOrNeedsReview: boolean;
}): string[] {
  const actions: string[] = [];
  const missingFields = new Set(args.clarification.missingInputs.map((m) => m.field));

  if (args.overloaded || args.hasOverloadError) {
    actions.push('צמצם/י את העומס השבועי או אשר/י חריגה מפורשת כדי לאפשר את החלת התוכנית.');
  }
  if (args.hasAnnualIncompleteError) {
    actions.push('בדוק/בדקי את שיבוץ הקורס השנתי בלוח — הוא חייב להופיע בכל הסמסטרים הנדרשים לו — או בקש/י בנייה מחדש.');
  }
  if (args.hasStepLimitError) {
    actions.push('התהליך לא הושלם עד הסוף עקב מגבלת מספר הצעדים — נסה/י לבקש בנייה מחדש כדי לקבל תוכנית מלאה.');
  }
  if (args.hasLegalityViolationError) {
    actions.push('בתוכנית קיימת הפרת חוקיות (למשל קורס המשובץ לפני תנאי הקדם שלו) — בדוק/בדקי את שיבוץ הקורסים בלוח, או בקש/י בנייה מחדש.');
  }
  if (args.hasMissingMandatoryDueToExclusion) {
    actions.push(
      `קורס החובה (${args.excludedNamesInMissingMandatory.join(', ')}) מוחרג על ידך ולכן לא ניתן לשבצו — ` +
        'כדי להשלים את התואר יש להסיר אותו מרשימת ההחרגה שלך; בקשת בנייה מחדש לא תשנה זאת כל עוד ההחרגה בתוקף.',
    );
  }
  if (args.hasMissingMandatoryOtherCause) {
    actions.push('קורס חובה לא שובץ בתוכנית — בדוק/בדקי אילו קורסי קדם נדרשים לו, או בקש/י בנייה מחדש.');
  }
  if (args.hasDegreeHoursShortfallError) {
    actions.push(
      'הקטלוג הזמין בטווח התכנון הנוכחי מוצה במלואו ואינו מספיק להשלמת שעות התואר — ' +
        'פנה/י ליועץ/ת הלימודים או הרחב/י את טווח הסמסטרים המוצג; בקשת בנייה מחדש לא תשנה זאת כל עוד הקטלוג הזמין נותר זהה.',
    );
  }
  if (args.contradictoryWantedNames.length > 0) {
    actions.push(
      `הבקשה שלך סותרת את עצמה לגבי ${args.contradictoryWantedNames.join(', ')} — גם רצוי וגם מוחרג. ` +
        'אם ברצונך שהקורס כן ישובץ, הסר/י אותו מרשימת ההחרגה.',
    );
  }
  if (args.disallowedPlaced) {
    actions.push('הקורס שסימנת להחרגה עדיין מופיע בתוכנית — הסר/י אותו ידנית מהלוח, או בקש/י בנייה מחדש שמסירה אותו.');
  }
  if (missingFields.has('completedCourses') || (args.context.completedCourseIds?.length ?? 0) === 0) {
    actions.push('ספק/י את רשימת הקורסים שכבר השלמת כדי לחדד את בדיקת הקדם-דרישות.');
  }
  if (missingFields.has('currentCourses') || (args.context.currentCourseIds?.length ?? 0) === 0) {
    actions.push('ציין/י אילו קורסים את/ה לומד/ת כעת כדי למנוע שיבוץ כפול.');
  }
  if (missingFields.has('excludedCourses')) {
    actions.push('ציין/י אם יש קורסים שברצונך להחריג מהתוכנית.');
  }
  if (!args.interestEvaluation) {
    actions.push('הוסף/י פרופיל תחומי עניין כדי לקבל הערכת התאמה אקדמית.');
  } else if (args.interestEvaluation.scorecard.summaryLevel === 'low' || args.interestEvaluation.scorecard.summaryLevel === 'none') {
    actions.push('ניתן להגדיל את ההתאמה לתחומי העניין על ידי עידכון תחומי הפוקוס או בקשת חלופות.');
  }
  if (args.hasUnmatchedOrNeedsReview) {
    actions.push('כדאי לבדוק/לעדכן קורסים ללא פרופיל תחומי או בברירת מחדל (needs_review).');
  }
  if (actions.length === 0) {
    actions.push('ניתן לבקש תוכנית חלופית עם דגשים אחרים (עומס, עניין, או הימנעות מקורס מסוים).');
  }
  return actions;
}

// ── Clarification-only (critical missing) block ──────────────────────────────

/**
 * Build the academicDecision view for the blocked path — no plan exists yet, so
 * validation/evaluation/decision are absent and the explanation directs the
 * user to answer the critical questions instead of pretending a plan exists.
 */
export function buildClarificationDecision(clarification: ClarificationResult): AcademicClarificationOnlyView {
  const criticalFields = clarification.missingInputs.filter((m) => m.critical).map((m) => FIELD_HE[m.field] ?? m.field);
  const missingData = clarification.missingInputs.map((m) => `חסר מידע: ${FIELD_HE[m.field] ?? m.field}.`);

  return {
    clarification,
    explanation: {
      mainRecommendation: 'דרוש מידע נוסף לפני בניית תוכנית — נא להשלים את הפרטים הקריטיים.',
      whyThisPlan: ['לא נבנתה תוכנית: חסרים נתונים קריטיים שעלולים להוביל לתוכנית שגויה.'],
      risksAndTradeoffs: ['בניית תוכנית ללא הנתונים הקריטיים עלולה להפר קדם-דרישות או לשבץ קורסים שהוחרגו.'],
      missingData,
      suggestedNextActions: criticalFields.map((f) => `נא לספק: ${f}.`),
    },
  };
}

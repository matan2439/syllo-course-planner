/**
 * AcademicDecisionAgent runtime adapter — unit tests for
 * api/ai/academic_decision_runtime.ts.
 *
 * The adapter is the named runtime seam for the opt-in
 * use_academic_decision_agent path in generate-plan.ts. It orchestrates the
 * decision loop (Clarify -> [Plan is generate-plan's own, unchanged] ->
 * Validate -> Evaluate -> Decide -> Explain) by composing the EXISTING
 * capability modules around an already-generated PlanProposal. It never
 * regenerates the plan, never calls an LLM, and never fabricates data.
 *
 * These tests exercise the pure builders in isolation (no HTTP). The
 * end-to-end opt-in path is covered in generate_plan_academic_decision_agent.test.ts.
 */

import type { ConstraintModel } from '../../api/ai/planner_types';
import {
  extractClarificationContext,
  clarifyForAcademicDecision,
  hasCriticalMissingInput,
  buildAcademicDecision,
  buildClarificationDecision,
  type AcademicDecisionProposal,
} from '../../api/ai/academic_decision_runtime';

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** Minimal model carrying only what the adapter reads (profiles.hours / name_he). */
function modelWith(hoursById: Record<string, number>, namesById: Record<string, string> = {}): ConstraintModel {
  const profiles = new Map<string, any>();
  for (const [id, hours] of Object.entries(hoursById)) {
    profiles.set(id, { hours, name_he: namesById[id] ?? id });
  }
  return { profiles } as unknown as ConstraintModel;
}

const SATISFIED_REQS = [
  { name: 'קורסי חובה', required: 1, placed: 1, satisfied: true },
  { name: 'זורמים', required: 1, placed: 1, satisfied: true },
];

function proposal(over: Partial<AcademicDecisionProposal> = {}): AcademicDecisionProposal {
  return {
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['MAND', 'FLU'] }],
    moves: [],
    warnings_he: [],
    rationale_he: 'תוכנית אוטומטית — 2 קורסים.',
    requirements_status: SATISFIED_REQS,
    ...over,
  };
}

const CLEAN_CLAR = { needsClarification: false, missingInputs: [], questions: [] };

// ── extractClarificationContext ────────────────────────────────────────────────

describe('extractClarificationContext', () => {
  test('maps generate-plan plan_context/preferences onto the clarification context', () => {
    const ctx = extractClarificationContext(
      {
        personal_status: {
          completed: [{ course_id: 'A' }, { course_id: 'B' }],
          currently_taking: [{ course_id: 'C' }],
        },
      },
      { disallowed_course_ids: ['X'], max_weekly_hours: 20 },
      undefined,
    );
    expect(ctx.completedCourseIds).toEqual(['A', 'B']);
    expect(ctx.currentCourseIds).toEqual(['C']);
    expect(ctx.excludedCourseIds).toEqual(['X']);
    expect(ctx.maxWeeklyHours).toBe(20);
  });

  test('falls back to strongly_avoided_course_ids for exclusions, leaves excluded undefined when neither present', () => {
    const withStrong = extractClarificationContext({}, { strongly_avoided_course_ids: ['Y'] }, undefined);
    expect(withStrong.excludedCourseIds).toEqual(['Y']);

    const neither = extractClarificationContext({}, {}, undefined);
    expect(neither.excludedCourseIds).toBeUndefined();
  });

  test('only sets academicInterestProfile when a raw profile is supplied (normalized)', () => {
    const withProfile = extractClarificationContext({}, {}, { focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(withProfile.academicInterestProfile).toBeDefined();
    expect(withProfile.academicInterestProfile?.focusAreas.map((f) => f.area)).toEqual(['fluids']);

    const withoutProfile = extractClarificationContext({}, {}, undefined);
    expect('academicInterestProfile' in withoutProfile).toBe(false);
  });

  // Issue #43: track_or_focus is never propagated into plan_context/preferences
  // (mergeClarificationAnswersIntoGeneratePlanInputs deliberately has no target
  // field for it — no planner consumer exists), but that must not mean the
  // clarification QUESTION can never be marked resolved. extractClarificationContext
  // reads it straight from the raw answers array, presentation-layer only.
  test('sets track from a track_or_focus clarification answer, without touching plan_context/preferences', () => {
    const withAnswer = extractClarificationContext({}, {}, undefined, [
      { questionId: 'track_or_focus', value: 'design' },
    ]);
    expect(withAnswer.track).toBe('design');

    const withoutAnswer = extractClarificationContext({}, {}, undefined, []);
    expect(withoutAnswer.track).toBeUndefined();

    const noAnswersArg = extractClarificationContext({}, {}, undefined);
    expect(noAnswersArg.track).toBeUndefined();
  });

  test('ignores a blank/whitespace-only or wrong-type track_or_focus answer (never resolves on a non-answer)', () => {
    const blank = extractClarificationContext({}, {}, undefined, [{ questionId: 'track_or_focus', value: '   ' }]);
    expect(blank.track).toBeUndefined();

    const wrongType = extractClarificationContext({}, {}, undefined, [
      { questionId: 'track_or_focus', value: 42 as unknown as string },
    ]);
    expect(wrongType.track).toBeUndefined();

    const otherQuestion = extractClarificationContext({}, {}, undefined, [
      { questionId: 'excluded_courses', value: ['X'] as unknown as string },
    ]);
    expect(otherQuestion.track).toBeUndefined();
  });

  // Codex review, 3rd round (PR #46, discussion_r3626609490): a naive
  // "first match" lookup would keep track unresolved when a stale/blank
  // duplicate happens to come BEFORE a later, genuinely valid answer in the
  // same batch — even though the later one should win, matching the
  // "later answers win" convention the rest of the clarification-merge path
  // already follows.
  test('the most recent VALID track_or_focus answer wins when a batch has duplicates', () => {
    const laterValidWins = extractClarificationContext({}, {}, undefined, [
      { questionId: 'track_or_focus', value: '' },
      { questionId: 'track_or_focus', value: 'design' },
    ]);
    expect(laterValidWins.track).toBe('design');

    // A later blank/invalid duplicate must not shadow an earlier valid one —
    // it's skipped, not treated as "the answer is now unset."
    const laterBlankSkipped = extractClarificationContext({}, {}, undefined, [
      { questionId: 'track_or_focus', value: 'design' },
      { questionId: 'track_or_focus', value: '   ' },
    ]);
    expect(laterBlankSkipped.track).toBe('design');

    const laterOfTwoValidWins = extractClarificationContext({}, {}, undefined, [
      { questionId: 'track_or_focus', value: 'analysis' },
      { questionId: 'track_or_focus', value: 'systems' },
    ]);
    expect(laterOfTwoValidWins.track).toBe('systems');
  });
});

// ── clarify + critical gate ──────────────────────────────────────────────────

describe('clarifyForAcademicDecision + hasCriticalMissingInput', () => {
  test('bare inputs (no completed, no excluded) report a critical missing input', async () => {
    const clar = await clarifyForAcademicDecision(extractClarificationContext({}, {}, undefined));
    expect(hasCriticalMissingInput(clar)).toBe(true);
    expect(clar.questions.map((q) => q.id)).toEqual(
      expect.arrayContaining(['completed_courses', 'excluded_courses']),
    );
  });

  test('sufficient inputs (completed present, exclusions defined) report no critical missing input', async () => {
    const clar = await clarifyForAcademicDecision(
      extractClarificationContext(
        { personal_status: { completed: [{ course_id: 'A' }] } },
        { disallowed_course_ids: [] },
        undefined,
      ),
    );
    expect(hasCriticalMissingInput(clar)).toBe(false);
  });
});

// ── buildAcademicDecision ────────────────────────────────────────────────────

describe('buildAcademicDecision — validation', () => {
  test('reflects a legal, unblocked plan', () => {
    const view = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: { completedCourseIds: ['A'], excludedCourseIds: [] },
    });
    expect(view.validation.valid).toBe(true);
    expect(view.validation.errors).toEqual([]);
    expect(view.validation.requirementsSatisfied).toBe(true);
  });

  test('reflects a blocked plan with errors and unmet requirements', () => {
    const view = buildAcademicDecision({
      proposal: proposal({
        warnings_he: ['חסר קורס חובה: X.'],
        requirements_status: [{ name: 'קורסי חובה', required: 2, placed: 1, satisfied: false }],
      }),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: true,
      errors: ['PLANNER_STEP_LIMIT'],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.validation.valid).toBe(false);
    expect(view.validation.errors).toContain('PLANNER_STEP_LIMIT');
    expect(view.validation.requirementsSatisfied).toBe(false);
  });
});

describe('buildAcademicDecision — evaluation & interest honesty', () => {
  test('requirementCoverage mirrors the proposal requirements_status', () => {
    const view = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.evaluation.requirementCoverage).toEqual(SATISFIED_REQS);
  });

  test('includes interestEvaluation only when a meaningful profile is supplied (no fabrication otherwise)', () => {
    const withProfile = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 's1', course_ids: ['0542-4320'] }] }),
      model: modelWith({ '0542-4320': 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
      academicInterestProfileRaw: { focusAreas: [{ area: 'fluids', weight: 1 }] },
    });
    expect(withProfile.interestEvaluation).toBeDefined();
    expect(withProfile.interestEvaluation?.hasMeaningfulAcademicInterests).toBe(true);

    const noProfile = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
      academicInterestProfileRaw: {},
    });
    expect(noProfile.interestEvaluation).toBeUndefined();
  });

  test('reports unmatched (missing topic-profile) planned courses honestly in missingDataNotes', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 's1', course_ids: ['NOT-A-REAL-COURSE'] }] }),
      model: modelWith({ 'NOT-A-REAL-COURSE': 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
      academicInterestProfileRaw: { focusAreas: [{ area: 'fluids', weight: 1 }] },
    });
    expect(view.interestEvaluation?.unmatchedCourseIds).toContain('NOT-A-REAL-COURSE');
    expect(view.evaluation.missingDataNotes.join(' ')).toMatch(/פרופיל|profile|תחומי/i);
  });

  test('flags a semester that exceeds the requested max weekly hours as a workload note', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['MAND', 'FLU'] }] }),
      model: modelWith({ MAND: 12, FLU: 12 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: { maxWeeklyHours: 20 },
    });
    expect(view.evaluation.workloadNotes.length).toBeGreaterThan(0);
    expect(view.evaluation.workloadNotes.join(' ')).toContain('20');
  });
});

describe('buildAcademicDecision — decision & explanation', () => {
  test('decision deterministically selects the single generated plan with a non-empty rationale', () => {
    const view = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.decision.selectedPlan).toBe('generated');
    expect(typeof view.decision.rationale).toBe('string');
    expect(view.decision.rationale.length).toBeGreaterThan(0);
  });

  test('explanation is the Hebrew-ready structured object with all five keys', () => {
    const view = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: false,
      errors: [],
      clarification: CLEAN_CLAR,
      context: {},
    });
    const e = view.explanation;
    expect(typeof e.mainRecommendation).toBe('string');
    expect(e.mainRecommendation.length).toBeGreaterThan(0);
    expect(Array.isArray(e.whyThisPlan)).toBe(true);
    expect(Array.isArray(e.risksAndTradeoffs)).toBe(true);
    expect(Array.isArray(e.missingData)).toBe(true);
    expect(Array.isArray(e.suggestedNextActions)).toBe(true);
    expect(e.suggestedNextActions.length).toBeGreaterThan(0);
  });

  test('suggests providing completed courses when they are missing, and reducing workload when overloaded', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['MAND', 'FLU'] }] }),
      model: modelWith({ MAND: 15, FLU: 15 }),
      blocked: true,
      errors: ['סמסטר year_3_semester_a: 30 ש"ש — חריגה מהמגבלה הקשיחה.'],
      clarification: { needsClarification: true, missingInputs: [{ field: 'completedCourses', critical: true, message: 'x' }], questions: [{ id: 'completed_courses', inputKey: 'completedCourseIds', required: true, critical: true, answerType: 'course_id_list', question: 'Which courses have you already completed?' }] },
      context: { maxWeeklyHours: 20 },
    });
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).toMatch(/עומס|hours|ש"ש/); // reduce workload
    expect(view.explanation.missingData.length).toBeGreaterThan(0);
  });

  // Diagnosis-loop finding: a plan blocked by annualCompletenessGate
  // (generate-plan.ts) or the PLANNER_STEP_LIMIT sentinel used to be
  // misattributed to "overload" here (hasOtherBlockingError treated any
  // non-disallowed-placement error as overload), telling the user to reduce
  // their weekly load or confirm an exception for a block that has nothing to
  // do with load. Neither cause is a real overload — the explanation must
  // name the actual cause instead.
  test('names an incomplete annual course as the cause, not overload, when that is the only blocking error', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['ANNUAL'] }] }),
      model: modelWith({ ANNUAL: 4 }, { ANNUAL: 'מעבדה שנתית' }),
      blocked: true,
      errors: ['קורס שנתי (מעבדה שנתית) לא הושלם בכל הסמסטרים הנדרשים ולכן התוכנית אינה תקפה.'],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.explanation.mainRecommendation).not.toMatch(/עומס|חריגה מפורשת/);
    expect(view.explanation.mainRecommendation).toMatch(/שנתי/);
    expect(view.decision.rationale).not.toMatch(/עומס/);
    expect(view.decision.rationale).toMatch(/שנתי/);
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).not.toMatch(/עומס השבועי/);
    expect(actions).toMatch(/שנתי/);
  });

  test('names the step-limit as the cause, not overload, when that is the only blocking error', () => {
    const view = buildAcademicDecision({
      proposal: proposal(),
      model: modelWith({ MAND: 4, FLU: 4 }),
      blocked: true,
      errors: ['PLANNER_STEP_LIMIT'],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.explanation.mainRecommendation).not.toMatch(/עומס|חריגה מפורשת/);
    expect(view.explanation.mainRecommendation).toMatch(/צעדים|חלקית/);
    expect(view.decision.rationale).not.toMatch(/עומס/);
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).not.toMatch(/עומס השבועי/);
    expect(actions).toMatch(/צעדים|בנייה מחדש/);
  });

  // Agent Diagnosis Loop finding (2026-07-22): validatePlanState already
  // enforces prerequisite strict-timing, duplicate placement, pinned "don't
  // move," and illegal offering-semester placement against the final state,
  // but generate-plan.ts never turned that signal into a blocking error —
  // toProposal() only read report.warnings. generate-plan.ts's new
  // legalityGate closes that gap and prefixes each message with
  // LEGALITY_VIOLATION_ERROR_PREFIX ('הפרת חוקיות בתוכנית:') specifically so
  // this cause-attribution layer (previously fixed once already, for the
  // annual/step-limit causes above) doesn't fall back into the overload
  // catch-all for this new "fifth" cause too.
  test('names a legality violation (e.g. prerequisite timing) as the cause, not overload, when that is the only blocking error', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_4_semester_a', course_ids: ['ADV'] }] }),
      model: modelWith({ ADV: 4 }, { ADV: 'מתקדם' }),
      blocked: true,
      errors: ['הפרת חוקיות בתוכנית: לא ניתן לשבץ את מתקדם (בשנה ד׳ א׳) — דרישת הקדם קדם אינה משובצת בתוכנית ולא הושלמה.'],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.explanation.mainRecommendation).not.toMatch(/עומס|חריגה מפורשת/);
    expect(view.explanation.mainRecommendation).toMatch(/הפרת חוקיות/);
    expect(view.decision.rationale).not.toMatch(/עומס/);
    expect(view.decision.rationale).toMatch(/הפרת חוקיות/);
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).not.toMatch(/עומס השבועי/);
    expect(actions).toMatch(/הפרת חוקיות|תנאי הקדם/);
  });

  test('a legality violation and a genuine overload block are both named when both occur together', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_4_semester_a', course_ids: ['ADV', 'BIG'] }] }),
      model: modelWith({ ADV: 4, BIG: 30 }, { ADV: 'מתקדם' }),
      blocked: true,
      errors: [
        'הפרת חוקיות בתוכנית: לא ניתן לשבץ את מתקדם (בשנה ד׳ א׳) — דרישת הקדם קדם אינה משובצת בתוכנית ולא הושלמה.',
        'סמסטר year_4_semester_a: 34 ש"ש — חריגה לא סבירה מעל 30. לא ניתן להחיל את התוכנית.',
      ],
      clarification: CLEAN_CLAR,
      context: {},
    });
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).toMatch(/הפרת חוקיות|תנאי הקדם/);
    expect(actions).toMatch(/עומס/);
  });

  test('names both a disallowed-placed course AND an incomplete annual course when both block the plan', () => {
    const view = buildAcademicDecision({
      proposal: proposal({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['ANNUAL', 'BAD'] }] }),
      model: modelWith({ ANNUAL: 4, BAD: 4 }, { ANNUAL: 'מעבדה שנתית', BAD: 'קורס אסור' }),
      blocked: true,
      errors: [
        'קורס לא-זמין שובץ בתוכנית: קורס אסור.',
        'קורס שנתי (מעבדה שנתית) לא הושלם בכל הסמסטרים הנדרשים ולכן התוכנית אינה תקפה.',
      ],
      clarification: CLEAN_CLAR,
      context: {},
    });
    expect(view.explanation.mainRecommendation).toMatch(/קורס שסימנת להחרגה/);
    expect(view.explanation.mainRecommendation).toMatch(/שנתי/);
    const actions = view.explanation.suggestedNextActions.join(' | ');
    expect(actions).toMatch(/שנתי/);
    expect(actions).toMatch(/להחרגה/);
  });
});

describe('buildClarificationDecision — blocked (critical missing) path', () => {
  test('carries the clarification questions and an explanation directing the user to answer, without a plan', () => {
    const clarification = {
      needsClarification: true,
      missingInputs: [{ field: 'completedCourses' as const, critical: true, message: 'x' }],
      questions: [{ id: 'completed_courses', inputKey: 'completedCourseIds', required: true, critical: true, answerType: 'course_id_list' as const, question: 'Which courses have you already completed?' }],
    };
    const view = buildClarificationDecision(clarification);
    expect(view.clarification).toEqual(clarification);
    expect(view.decision).toBeUndefined();
    expect(view.validation).toBeUndefined();
    expect(view.explanation.mainRecommendation.length).toBeGreaterThan(0);
    expect(view.explanation.missingData.length).toBeGreaterThan(0);
    expect(view.explanation.suggestedNextActions.length).toBeGreaterThan(0);
  });
});

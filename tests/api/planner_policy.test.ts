/**
 * Tests for api/ai/planner_policy.ts — PolicyProvider extraction.
 *
 * TauPolicyProvider owns: isGoal (moved verbatim from planner_agent.ts's former
 * local isGoalState), score/compareScore (delegates to planner_goals.ts,
 * unchanged), validate (delegates to planner_validate.ts's validatePlanState,
 * unchanged, adapting {valid, errors, warnings} -> {valid, reason: errors[0]}).
 *
 * isGoal has no prior direct unit test (only indirect wiring coverage via
 * planner_agent.test.ts's mock searches) — these tests are new coverage this
 * extraction motivates, isolating each of the four goal conditions.
 */

import { TauPolicyProvider } from '../../api/ai/planner_policy';
import { scorePlan, compareScore, assessCompleteness } from '../../api/ai/planner_goals';
import { enumerateActions } from '../../api/ai/planner_actions';
import type { ConstraintModel, PlanState, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

function makeProfile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id,
    name_he: id,
    category_id: 'cat_1',
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'elective',
    hours: 4,
    offered_semesters: ['s1'],
    effective_allowed_semesters: ['s1'],
    recommended_semester: null,
    allowed_semesters: null,
    program_allowed_semesters: null,
    prerequisites: [],
    corequisites: [],
    syllabus_url: null,
    syllabus_available: false,
    syllabus_summary_he: null,
    syllabus_topics_he: [],
    assessment_type: null,
    workload_score: null,
    difficulty_score: null,
    difficulty_level: null,
    grade_average: null,
    is_wanted: false,
    is_unwanted: false,
    excluded: false,
    exclusion_reason: null,
    data_confidence: 0.8,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

function makeModel(
  profiles: CourseProfile[],
  over: Partial<ConstraintModel> = {},
): ConstraintModel {
  const profileMap = new Map<string, CourseProfile>();
  for (const p of profiles) profileMap.set(p.course_id, p);
  return {
    profiles: profileMap,
    knownSemesterIds: ['s1', 's2'],
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: 0,
    priorHours: 0,
    maxHoursPerSemester: 20,
    hardCap: 20,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

const policy = new TauPolicyProvider();

describe('TauPolicyProvider.isGoal', () => {
  test('returns false when a semester exceeds hardCap', () => {
    const model = makeModel([makeProfile('c1', { hours: 8 })], { hardCap: 5, degreeRequiredHours: 0 });
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    expect(policy.isGoal(state, model)).toBe(false);
  });

  test('returns false when degreeHours is below degreeRequiredHours', () => {
    const model = makeModel([makeProfile('c1', { hours: 4 })], { degreeRequiredHours: 10, hardCap: 20 });
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    expect(policy.isGoal(state, model)).toBe(false);
  });

  test('returns false when a required mandatory course is unplaced', () => {
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      { requiredMandatoryCourseIds: ['c1'], degreeRequiredHours: 4, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['c2'], s2: [] } }; // c1 never placed
    expect(policy.isGoal(state, model)).toBe(false);
  });

  test('returns false when a category requirement is unsatisfied', () => {
    const cat: CategoryReq = { id: 'cat_1', name: 'Cat', required: 1, candidateIds: ['c2'] };
    const model = makeModel(
      [makeProfile('c1', { hours: 4 }), makeProfile('c2', { hours: 4 })],
      { categories: [cat], degreeRequiredHours: 4, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } }; // c2 (the only candidate) never placed
    expect(policy.isGoal(state, model)).toBe(false);
  });

  test('returns true when all four conditions are satisfied', () => {
    const cat: CategoryReq = { id: 'cat_1', name: 'Cat', required: 1, candidateIds: ['c2'] };
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      { requiredMandatoryCourseIds: ['c1'], categories: [cat], degreeRequiredHours: 8, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['c1', 'c2'], s2: [] } };
    expect(policy.isGoal(state, model)).toBe(true);
  });

  // Codex round 9 (PR #37): a placed is_annual course that is NOT mandatory
  // and NOT a category candidate (a plain elective) is invisible to
  // degreeMet/missingMandatory/unsatisfiedCategories/overCapSemesters —
  // without incompleteAnnual, isGoal would return true with the course only
  // half-placed, so the agentic (beam search) path would stop at step 0 and
  // never get a chance to complete it, exactly the gap the Worker path's own
  // isGoalReached/hasIncompleteAnnual closes for the default path.
  test('returns false when a placed is_annual elective occupies only one of its two known legal semesters', () => {
    const model = makeModel(
      [makeProfile('ANNUAL', { is_mandatory: false, is_annual: true, spans_semesters: ['s1', 's2'], effective_allowed_semesters: ['s1', 's2'], hours: 4 })],
      { degreeRequiredHours: 1, priorHours: 100, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['ANNUAL'], s2: [] } };
    expect(policy.isGoal(state, model)).toBe(false);
  });

  test('returns true once that annual elective occupies both known legal semesters', () => {
    const model = makeModel(
      [makeProfile('ANNUAL', { is_mandatory: false, is_annual: true, spans_semesters: ['s1', 's2'], effective_allowed_semesters: ['s1', 's2'], hours: 4 })],
      { degreeRequiredHours: 1, priorHours: 100, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['ANNUAL'], s2: ['ANNUAL'] } };
    expect(policy.isGoal(state, model)).toBe(true);
  });
});

describe('TauPolicyProvider.score / compareScore — delegation', () => {
  test('score matches scorePlan for a representative state', () => {
    const model = makeModel([makeProfile('c1', { hours: 4 })], { degreeRequiredHours: 4 });
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    expect(policy.score(state, model)).toEqual(scorePlan(state, model));
  });

  test('compareScore matches the standalone compareScore function', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 4];
    expect(policy.compareScore(a, b)).toBe(compareScore(a, b));
  });
});

describe('TauPolicyProvider.assessCompleteness — delegation', () => {
  test('matches the standalone assessCompleteness function', () => {
    const cat: CategoryReq = { id: 'cat_1', name: 'Cat', required: 1, candidateIds: ['c2'] };
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      { requiredMandatoryCourseIds: ['c1'], categories: [cat], degreeRequiredHours: 8, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } }; // c2 unplaced — a real gap
    expect(policy.assessCompleteness(state, model)).toEqual(assessCompleteness(state, model));
  });
});

describe('TauPolicyProvider.isGoal — derived from assessCompleteness', () => {
  test('isGoal is false whenever assessCompleteness reports any gap', () => {
    const cat: CategoryReq = { id: 'cat_1', name: 'Cat', required: 1, candidateIds: ['c2'] };
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      { requiredMandatoryCourseIds: ['c1'], categories: [cat], degreeRequiredHours: 8, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } }; // c2 unplaced
    const gaps = policy.assessCompleteness(state, model);
    expect(gaps.missingMandatory.length + gaps.unsatisfiedCategories.length).toBeGreaterThan(0);
    expect(policy.isGoal(state, model)).toBe(false);
  });
});

describe('TauPolicyProvider — isGoal/validate agreement on confirmed overload', () => {
  // Regression: assessCompleteness/isGoal must not disagree with validate() about
  // overload acceptance. Both must honor overloadAccepted+overloadConfirmedAt the
  // same way, since both are driven by the same ConstraintModel fields.
  test('isGoal is true and validate is valid for an over-hardCap semester with confirmed overload', () => {
    // s1 gets 7 courses x 4h = 28h: over hardCap(20 here), under ABSOLUTE_MAX_REASONABLE(30).
    const profiles = Array.from({ length: 7 }, (_, i) => makeProfile(`c${i}`, { hours: 4, effective_allowed_semesters: ['s1'] }));
    const model = makeModel(profiles, {
      degreeRequiredHours: 0, hardCap: 20,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
    });
    const state: PlanState = { semesters: { s1: profiles.map(p => p.course_id), s2: [] } };

    expect(policy.isGoal(state, model)).toBe(true);
    expect(policy.validate(state, model, {}).valid).toBe(true);
  });

  test('isGoal is false and validate is invalid for the same overload when not confirmed', () => {
    const profiles = Array.from({ length: 7 }, (_, i) => makeProfile(`c${i}`, { hours: 4, effective_allowed_semesters: ['s1'] }));
    const model = makeModel(profiles, { degreeRequiredHours: 0, hardCap: 20 }); // no overload override
    const state: PlanState = { semesters: { s1: profiles.map(p => p.course_id), s2: [] } };

    expect(policy.isGoal(state, model)).toBe(false);
    expect(policy.validate(state, model, {}).valid).toBe(false);
  });
});

describe('TauPolicyProvider.generateActions — delegation', () => {
  test('matches the standalone enumerateActions function for a representative state', () => {
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      { requiredMandatoryCourseIds: ['c1'], degreeRequiredHours: 8, hardCap: 20 },
    );
    const state: PlanState = { semesters: { s1: [], s2: [] } };
    expect(policy.generateActions(state, model)).toEqual(enumerateActions(state, model));
  });
});

describe('TauPolicyProvider.validate', () => {
  test('returns {valid: true} for a legal state', () => {
    const model = makeModel([makeProfile('c1')]); // effective_allowed_semesters: ['s1']
    const state: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    const result = policy.validate(state, model, {});
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('returns {valid: false, reason} for a state with a duplicate placement', () => {
    const model = makeModel([makeProfile('c1', { effective_allowed_semesters: ['s1', 's2'] })]);
    const state: PlanState = { semesters: { s1: ['c1'], s2: ['c1'] } }; // same course in two semesters
    const result = policy.validate(state, model, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toEqual(expect.stringContaining('משובץ פעמיים'));
  });
});

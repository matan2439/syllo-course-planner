/**
 * Tests for api/ai/plan_decision.ts — the first real, model-aware Decision
 * capability: given multiple candidate AgentResults, picks the best-scoring
 * still-valid one instead of always returning candidates[0]
 * (PassThroughDecisionCapability's behavior).
 *
 * Deliberately NOT the academic_decision_types.ts DecisionCapability (see
 * that file / plan_decision.ts's header comments for why): this one requires
 * the SAME ConstraintModel instance every candidate's finalState was
 * produced/validated against.
 */

import { ScoreBasedDecisionCapability, type PlanDecisionRequest } from '../../api/ai/plan_decision';
import type { AgentResult } from '../../api/ai/planner_agent';
import { type ConstraintModel, type PlanState, emptyState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { PolicyProvider } from '../../api/ai/planner_policy';
import type { ValidationCapability } from '../../api/ai/planner_capabilities';

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id,
    name_he: id,
    category_id: null,
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'elective',
    hours: 4,
    offered_semesters: null,
    effective_allowed_semesters: null,
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
    difficulty_score: 3,
    difficulty_level: null,
    grade_average: null,
    is_wanted: false,
    is_unwanted: false,
    excluded: false,
    exclusion_reason: null,
    data_confidence: 0.5,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  } as CourseProfile;
}

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function model(over: Partial<ConstraintModel> = {}): ConstraintModel {
  return {
    profiles: new Map(),
    knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: 40,
    priorHours: 0,
    maxHoursPerSemester: 22,
    hardCap: 26,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

function agentResult(finalState: PlanState, over: Partial<AgentResult> = {}): AgentResult {
  return { finalState, trace: [], gaps: [], ...over };
}

describe('ScoreBasedDecisionCapability — single candidate', () => {
  it('returns the only candidate when it is valid', async () => {
    const m = model();
    const base = emptyState(SEMS);
    const result = agentResult(base);

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [result], model: m });

    expect(out).toBe(result);
  });

  it('falls back to the only candidate even when policy.validate rejects it (never drops every candidate)', async () => {
    const m = model();
    const base = emptyState(SEMS);
    const result = agentResult(base);
    const rejectAll: PolicyProvider = {
      isGoal: () => true,
      score: () => [0],
      compareScore: (a, b) => a[0] - b[0],
      assessCompleteness: () => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [],
      }),
      validate: () => ({ valid: false, reason: 'rejects everything' }),
      generateActions: () => [],
    };

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [result], model: m, policy: rejectAll });

    expect(out).toBe(result);
  });
});

describe('ScoreBasedDecisionCapability — empty candidates', () => {
  it('throws rather than silently returning undefined', async () => {
    const decision = new ScoreBasedDecisionCapability();
    await expect(decision.decide({ candidates: [], model: model() })).rejects.toThrow(
      /candidates must not be empty/,
    );
  });
});

describe('ScoreBasedDecisionCapability — picks the strictly best-scoring valid candidate', () => {
  it('prefers a candidate closer to the degree-hours target', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 4 });

    const emptyPlan = emptyState(SEMS);
    const worse = agentResult(emptyPlan); // 0/4 hours

    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better); // 4/4 hours — degree_completion goal met

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [worse, betterResult], model: m });

    expect(out).toBe(betterResult);
  });

  it('is order-independent — the better candidate wins regardless of position', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 4 });

    const emptyPlan = emptyState(SEMS);
    const worse = agentResult(emptyPlan);

    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better);

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [betterResult, worse], model: m });

    expect(out).toBe(betterResult);
  });
});

describe('ScoreBasedDecisionCapability — validity gate', () => {
  it('never picks a candidate policy.validate rejects, even when its raw score looks better', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('over', profile('over', { hours: 10 }));
    const m = model({ profiles, degreeRequiredHours: 10, hardCap: 8, maxHoursPerSemester: 8 });

    const invalidButHighScoring = emptyState(SEMS);
    invalidButHighScoring.semesters['year_3_semester_a'] = ['over']; // 10h > hardCap 8 — invalid
    const invalidResult = agentResult(invalidButHighScoring);

    const validLowerScoring = agentResult(emptyState(SEMS)); // 0/10 hours, but valid

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [invalidResult, validLowerScoring], model: m });

    expect(out).toBe(validLowerScoring);
  });

  it('falls back to candidates[0] when no candidate is valid', async () => {
    const m = model();
    const c1 = agentResult(emptyState(SEMS));
    const c2 = agentResult(emptyState(SEMS));
    const rejectAll: PolicyProvider = {
      isGoal: () => true,
      score: () => [0],
      compareScore: (a, b) => a[0] - b[0],
      assessCompleteness: () => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [],
      }),
      validate: () => ({ valid: false }),
      generateActions: () => [],
    };

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [c1, c2], model: m, policy: rejectAll });

    expect(out).toBe(c1);
  });
});

describe('ScoreBasedDecisionCapability — custom ValidationCapability precedence', () => {
  it('consults the injected ValidationCapability instead of policy.validate, matching PlannerAgent\'s/plan_simulation.ts\'s own precedence', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 4 });

    const emptyPlan = agentResult(emptyState(SEMS));
    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better);

    // policy.validate (the TauPolicyProvider default) would accept both — a
    // custom ValidationCapability that rejects the better one must still block it.
    const rejectBetter: ValidationCapability = {
      validateState: jest.fn((state: any) => ({
        valid: !(Object.values(state.semesters).flat() as string[]).includes('w1'),
      })),
    };

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [emptyPlan, betterResult], model: m, validation: rejectBetter });

    expect(rejectBetter.validateState).toHaveBeenCalled();
    expect(out).toBe(emptyPlan);
  });
});

describe('ScoreBasedDecisionCapability — custom policy override', () => {
  it('uses the supplied PolicyProvider instead of the TauPolicyProvider default', async () => {
    const m = model();
    const c1 = agentResult(emptyState(SEMS));
    const c2 = agentResult(emptyState(SEMS));

    const fakePolicy: PolicyProvider = {
      isGoal: () => true,
      score: jest.fn((state) => (state === c2.finalState ? [1] : [0])),
      compareScore: (a, b) => a[0] - b[0],
      assessCompleteness: () => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [],
      }),
      validate: () => ({ valid: true }),
      generateActions: () => [],
    };

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [c1, c2], model: m, policy: fakePolicy });

    expect(fakePolicy.score).toHaveBeenCalled();
    expect(out).toBe(c2);
  });
});

describe('ScoreBasedDecisionCapability — result consistency', () => {
  it('returns the exact same AgentResult reference for the chosen candidate (no mutation, no cloning)', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 4 });

    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better, {
      rationale_he: 'הסבר קיים',
      meta: { beamWidth: 6, depthRecords: [], chosenPath: [], terminationReason: 'goal_reached', alternativePaths: [] },
    });
    const worse = agentResult(emptyState(SEMS));

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [worse, betterResult], model: m });

    expect(out).toBe(betterResult);
    expect(out.rationale_he).toBe('הסבר קיים');
    expect(out.meta).toBe(betterResult.meta);
  });

  it('never mutates any candidate or the model', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 4 });

    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better);
    const worse = agentResult(emptyState(SEMS));
    const snapshotBetter = JSON.parse(JSON.stringify(betterResult));
    const snapshotWorse = JSON.parse(JSON.stringify(worse));
    const modelProfilesBefore = [...m.profiles.entries()];
    const modelScalarsBefore = {
      degreeRequiredHours: m.degreeRequiredHours,
      priorHours: m.priorHours,
      maxHoursPerSemester: m.maxHoursPerSemester,
      hardCap: m.hardCap,
      knownSemesterIds: [...m.knownSemesterIds],
    };

    const decision = new ScoreBasedDecisionCapability();
    await decision.decide({ candidates: [worse, betterResult], model: m });

    expect([...m.profiles.entries()]).toEqual(modelProfilesBefore);
    expect({
      degreeRequiredHours: m.degreeRequiredHours,
      priorHours: m.priorHours,
      maxHoursPerSemester: m.maxHoursPerSemester,
      hardCap: m.hardCap,
      knownSemesterIds: [...m.knownSemesterIds],
    }).toEqual(modelScalarsBefore);

    expect(betterResult).toEqual(snapshotBetter);
    expect(worse).toEqual(snapshotWorse);
  });
});

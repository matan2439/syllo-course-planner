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
    // degreeRequiredHours: 0 so the empty state is genuinely complete (not
    // just returned via the empty-candidates-array fallback path).
    const m = model({ degreeRequiredHours: 0 });
    const base = emptyState(SEMS);
    const result = agentResult(base);

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [result], model: m });

    expect(out).toBe(result);
  });

  it('falls back to the only candidate even when it fails the full candidate gate (never drops every candidate)', async () => {
    // Default degreeRequiredHours (40) is unreachable by an empty plan, so
    // this candidate is genuinely incomplete/invalid under validateCandidate.
    const m = model();
    const base = emptyState(SEMS);
    const result = agentResult(base);

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [result], model: m });

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
  it('never picks a candidate the full candidate gate rejects for hard-cap overload, even when its raw score looks better', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('over', profile('over', { hours: 10 }));
    const m = model({ profiles, degreeRequiredHours: 0, hardCap: 8, maxHoursPerSemester: 8 });

    const invalidButHighScoring = emptyState(SEMS);
    invalidButHighScoring.semesters['year_3_semester_a'] = ['over']; // 10h > hardCap 8 — invalid
    const invalidResult = agentResult(invalidButHighScoring);

    const validLowerScoring = agentResult(emptyState(SEMS)); // 0h, degreeRequiredHours 0 -> complete, legal, not disallowed

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [invalidResult, validLowerScoring], model: m });

    expect(out).toBe(validLowerScoring);
  });

  it('never picks a candidate with a user-disallowed course placed, even when it strictly outscores a valid alternative', async () => {
    // Regression test for a gap Codex's review caught: the validity gate must
    // be validateCandidate (the full final-candidate gate, including the
    // disallowed-course rule), not the narrower policy.validate (hard legality
    // only) — otherwise a disallowed-course plan can out-score and beat a
    // fully valid alternative.
    const profiles = new Map<string, CourseProfile>();
    profiles.set('bad', profile('bad', { hours: 4 }));
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({
      profiles,
      degreeRequiredHours: 4,
      disallowedCourseIds: new Set(['bad']),
      wantedCourseIds: new Set(['bad']), // gives the disallowed plan a strictly higher preferences-goal score
    });

    const disallowedButHigherScoring = emptyState(SEMS);
    disallowedButHigherScoring.semesters['year_3_semester_a'] = ['bad']; // 4/4 hours + wanted-course bonus, but disallowed
    const disallowedResult = agentResult(disallowedButHigherScoring);

    const validLowerScoring = emptyState(SEMS);
    validLowerScoring.semesters['year_3_semester_a'] = ['w1']; // 4/4 hours, not wanted, not disallowed
    const validResult = agentResult(validLowerScoring);

    const policy = new (require('../../api/ai/planner_policy').TauPolicyProvider)();
    // Confirm the premise: without the fix, the disallowed candidate would
    // actually win on raw score (proves this is a real regression test, not
    // a vacuous one).
    expect(
      policy.compareScore(
        policy.score(disallowedButHigherScoring, m),
        policy.score(validLowerScoring, m),
      ),
    ).toBeGreaterThan(0);

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [disallowedResult, validResult], model: m });

    expect(out).toBe(validResult);
  });

  it('falls back to candidates[0] when no candidate is valid', async () => {
    // Default degreeRequiredHours (40) is unreachable by either empty
    // candidate, so both are genuinely incomplete under validateCandidate.
    const m = model();
    const c1 = agentResult(emptyState(SEMS));
    const c2 = agentResult(emptyState(SEMS));

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({ candidates: [c1, c2], model: m });

    expect(out).toBe(c1);
  });
});

describe('ScoreBasedDecisionCapability — custom ValidationCapability is an ADDITIONAL reject condition', () => {
  it('consults the injected ValidationCapability on top of the full candidate gate, rejecting a candidate it disapproves even though both pass validateCandidate', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    // degreeRequiredHours: 0 so BOTH candidates pass the full validateCandidate
    // gate on their own — isolating the injected validator as the only thing
    // that distinguishes them.
    const m = model({ profiles, degreeRequiredHours: 0 });

    const emptyPlan = agentResult(emptyState(SEMS));
    const better = emptyState(SEMS);
    better.semesters['year_3_semester_a'] = ['w1'];
    const betterResult = agentResult(better);

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

  it('regression: a permissive injected validator can never override the full candidate gate — rejects an incomplete candidate even when the validator approves it', async () => {
    // Codex review finding: reusing a "search-time" ValidationCapability
    // (commonly legality-only, since it must accept incomplete intermediate
    // states mid-search) as decide()'s SOLE validity check would let an
    // incomplete or disallowed-course candidate through here, since decide()
    // has no separate isGoal-style completeness guarantee the way
    // PlannerAgent's own search loop does.
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({ profiles, degreeRequiredHours: 100 }); // unreachable by either candidate

    const incomplete = emptyState(SEMS);
    incomplete.semesters['year_3_semester_a'] = ['w1']; // 4/100 hours — far from degreeMet
    const incompleteResult = agentResult(incomplete);

    const alwaysValid: ValidationCapability = { validateState: () => ({ valid: true }) };

    const decision = new ScoreBasedDecisionCapability();
    // Single candidate, permissive validator: must NOT be treated as a valid
    // decision — falls back to it only because it's the sole candidate, not
    // because it was accepted as valid.
    const out = await decision.decide({ candidates: [incompleteResult], model: m, validation: alwaysValid });
    expect(out).toBe(incompleteResult); // fallback (only candidate), not an endorsement

    // With a genuinely complete alternative present, the incomplete one must
    // lose even though the permissive validator approves both and the
    // incomplete one places more hours (would out-score on a narrower gate).
    const complete = emptyState(SEMS);
    complete.semesters['year_3_semester_a'] = ['w1'];
    const mComplete = model({ profiles, degreeRequiredHours: 4 }); // reachable — w1 alone completes it
    const completeResult = agentResult(complete);
    const incompleteUnderComplete = agentResult(emptyState(SEMS)); // 0/4 — also incomplete here, for contrast

    const out2 = await decision.decide({
      candidates: [incompleteUnderComplete, completeResult],
      model: mComplete,
      validation: alwaysValid,
    });
    expect(out2).toBe(completeResult);
  });

  it('regression: a permissive injected validator can never let a disallowed-course candidate beat a valid, lower-scoring alternative', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('bad', profile('bad', { hours: 4 }));
    profiles.set('w1', profile('w1', { hours: 4 }));
    const m = model({
      profiles,
      degreeRequiredHours: 4,
      disallowedCourseIds: new Set(['bad']),
      wantedCourseIds: new Set(['bad']),
    });

    const disallowed = emptyState(SEMS);
    disallowed.semesters['year_3_semester_a'] = ['bad'];
    const disallowedResult = agentResult(disallowed);

    const valid = emptyState(SEMS);
    valid.semesters['year_3_semester_a'] = ['w1'];
    const validResult = agentResult(valid);

    const alwaysValid: ValidationCapability = { validateState: () => ({ valid: true }) };

    const decision = new ScoreBasedDecisionCapability();
    const out = await decision.decide({
      candidates: [disallowedResult, validResult],
      model: m,
      validation: alwaysValid,
    });

    expect(out).toBe(validResult);
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

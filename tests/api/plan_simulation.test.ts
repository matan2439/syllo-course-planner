/**
 * Tests for api/ai/plan_simulation.ts — the first real, model-aware
 * Simulation capability: a bounded, deterministic single-best-neighbor local
 * search over a completed Plan-stage AgentResult.
 *
 * Deliberately NOT the academic_decision_types.ts SimulationCapability (see
 * that file / planner_orchestration.ts header comments for why): this one
 * requires the SAME ConstraintModel instance Plan actually used, which only
 * co-exists with the AgentResult inside runPlanningOrchestration.
 */

import { LocalSearchSimulationCapability, type PlanSimulationRequest } from '../../api/ai/plan_simulation';
import type { AgentResult } from '../../api/ai/planner_agent';
import { type ConstraintModel, type PlanState, emptyState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { PolicyProvider } from '../../api/ai/planner_policy';
import type { ValidationCapability } from '../../api/ai/planner_capabilities';
import type { BeamSearchMeta } from '../../api/ai/planner_search_types';

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

describe('LocalSearchSimulationCapability — no improving candidate', () => {
  it('returns the exact same AgentResult reference when no candidate actions exist', async () => {
    const m = model(); // no mandatory/categories/wanted, empty state → enumerateActions() === []
    const base = emptyState(SEMS);
    const result = agentResult(base);

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).toBe(result);
  });

  it('returns the exact same AgentResult reference when candidates exist but none strictly improve the score', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('x1', profile('x1', { hours: 4, placement_policy: 'elective' }));
    const m = model({ profiles, degreeRequiredHours: 0 }); // already at/over target -> g1 capped, no fill actions
    const base = emptyState(SEMS);
    base.semesters['year_3_semester_a'] = ['x1'];
    const result = agentResult(base);

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).toBe(result);
  });
});

describe('LocalSearchSimulationCapability — finds a strictly-improving, valid candidate', () => {
  it('adds a wanted, unplaced course and appends exactly one action to the trace', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const result = agentResult(base, { trace: [] });

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).not.toBe(result);
    const placedIds = Object.values(out.finalState.semesters).flat();
    expect(placedIds).toContain('w1');
    expect(out.trace).toHaveLength(1);
    expect(out.trace[0]).toMatchObject({ type: 'ADD_COURSE', courseId: 'w1' });
    // Original result/state are untouched.
    expect(Object.values(result.finalState.semesters).flat()).toEqual([]);
    expect(result.trace).toHaveLength(0);
  });
});

describe('LocalSearchSimulationCapability — validity gate', () => {
  it('never picks a candidate that policy.validate rejects, even when its raw score looks better', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('x1', profile('x1', { hours: 6, placement_policy: 'fixed' }));
    profiles.set('w1', profile('w1', {
      hours: 4,
      is_wanted: true,
      effective_allowed_semesters: ['year_3_semester_a'],
    }));
    const m = model({
      profiles,
      wantedCourseIds: new Set(['w1']),
      degreeRequiredHours: 100, // far from met, so g1 (degree_completion) is never capped
      hardCap: 8,
      maxHoursPerSemester: 8,
    });
    const base = emptyState(SEMS);
    base.semesters['year_3_semester_a'] = ['x1']; // 6h already there; w1 (4h) only legal in this semester → 10h > hardCap
    const result = agentResult(base);

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).toBe(result);
  });
});

describe('LocalSearchSimulationCapability — maxCandidates bound', () => {
  it('only evaluates the first N candidates in generateActions order, ignoring a later strictly-better one', async () => {
    const profiles = new Map<string, CourseProfile>();
    // Many low-preference degree-hour-fill candidates before the one real winner.
    for (let i = 0; i < 5; i++) profiles.set(`e${i}`, profile(`e${i}`, { hours: 4 }));
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const result = agentResult(base);

    // A fake policy whose generateActions puts the wanted-course action LAST,
    // after several neutral (non-improving-relative-to-each-other but still
    // valid) fill actions, so we can prove the bound is honored.
    const realPolicy: PolicyProvider = new (require('../../api/ai/planner_policy').TauPolicyProvider)();
    const allActions = realPolicy.generateActions(base, m);
    const wantedAction = allActions.find(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'w1');
    expect(wantedAction).toBeDefined();
    // enumerateActions can list the same course from more than one bullet
    // (e.g. both the "wanted courses" and "degree-hour fill" rules) — strip
    // every action that would place w1, not just the first match.
    const others = allActions.filter(a => !(a.type === 'ADD_COURSE' && (a as any).courseId === 'w1'));
    const reordered: PolicyProvider = {
      isGoal: (s, mm) => realPolicy.isGoal(s, mm),
      score: (s, mm) => realPolicy.score(s, mm),
      compareScore: (a, b) => realPolicy.compareScore(a, b),
      assessCompleteness: (s, mm) => realPolicy.assessCompleteness(s, mm),
      validate: (s, mm, ph, ctx) => realPolicy.validate(s, mm, ph, ctx),
      generateActions: () => [...others, wantedAction!],
    };

    const sim = new LocalSearchSimulationCapability({ maxCandidates: others.length });
    const out = await sim.simulate({ result, model: m, policy: reordered as PolicyProvider });

    // The wanted course is placed last (index === others.length), beyond the
    // bound — so it must never be picked. Since none of the `others` actions
    // (unwanted/neutral fill of already-degree-short state) necessarily tie or
    // lose to base, assert specifically that w1 was never placed.
    const placedIds = Object.values(out.finalState.semesters).flat();
    expect(placedIds).not.toContain('w1');
  });
});

describe('LocalSearchSimulationCapability — custom policy override', () => {
  it('uses the supplied PolicyProvider instead of the TauPolicyProvider default', async () => {
    const m = model();
    const base = emptyState(SEMS);
    const result = agentResult(base);

    const fakeAction = { type: 'ADD_COURSE' as const, courseId: 'ghost', semesterId: 'year_3_semester_a' };
    const fakePolicy: PolicyProvider = {
      isGoal: () => true,
      score: () => [0],
      compareScore: (a, b) => a[0] - b[0],
      assessCompleteness: () => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [], incompleteAnnual: [], missingMustInclude: [],
      }),
      validate: () => ({ valid: false }), // reject everything — proves the fake is actually consulted
      generateActions: jest.fn(() => [fakeAction]),
    };

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m, policy: fakePolicy });

    expect(fakePolicy.generateActions).toHaveBeenCalledWith(base, m);
    expect(out).toBe(result); // rejected by the fake's validate() → no change
  });
});

describe('LocalSearchSimulationCapability — custom ValidationCapability precedence', () => {
  it('consults the injected ValidationCapability instead of policy.validate, matching PlannerAgent\'s own precedence', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const result = agentResult(base);

    // policy.validate (the TauPolicyProvider default) would accept placing w1 —
    // proven by the earlier "finds a strictly-improving candidate" test. A
    // custom ValidationCapability that rejects everything must still block it.
    const rejectAll: ValidationCapability = {
      validateState: jest.fn(() => ({ valid: false, reason: 'custom validator rejects everything' })),
    };

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m, validation: rejectAll });

    expect(rejectAll.validateState).toHaveBeenCalled();
    expect(out).toBe(result); // rejected by the injected validator → no change, even though policy.validate would allow it
  });

  it('accepts a candidate the injected ValidationCapability allows, even though it differs from policy.validate', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('x1', profile('x1', { hours: 6, placement_policy: 'fixed' }));
    profiles.set('w1', profile('w1', {
      hours: 4,
      is_wanted: true,
      effective_allowed_semesters: ['year_3_semester_a'],
    }));
    const m = model({
      profiles,
      wantedCourseIds: new Set(['w1']),
      degreeRequiredHours: 100,
      hardCap: 8,
      maxHoursPerSemester: 8,
    });
    const base = emptyState(SEMS);
    base.semesters['year_3_semester_a'] = ['x1']; // policy.validate would reject w1 here (10h > hardCap 8)
    const result = agentResult(base);

    // A permissive custom validator overrides the hard-cap rejection policy.validate would apply.
    const allowAll: ValidationCapability = { validateState: () => ({ valid: true }) };

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m, validation: allowAll });

    expect(out).not.toBe(result);
    expect(Object.values(out.finalState.semesters).flat()).toContain('w1');
  });
});

describe('LocalSearchSimulationCapability — result consistency after an improving candidate', () => {
  it('invalidates rationale_he (no ExplanationCapability to regenerate it) instead of returning stale Hebrew text', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const result = agentResult(base, { rationale_he: 'הסבר על התוכנית לפני הסימולציה' });

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).not.toBe(result);
    expect(out.rationale_he).toBeUndefined();
    // Original result's rationale_he is untouched.
    expect(result.rationale_he).toBe('הסבר על התוכנית לפני הסימולציה');
  });

  it('extends meta.chosenPath with the simulation step, keeping it consistent with the returned trace/finalState', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const priorAction = { type: 'ADD_COURSE' as const, courseId: 'prior', semesterId: 'year_3_semester_a' };
    const meta: BeamSearchMeta = {
      beamWidth: 6,
      depthRecords: [],
      chosenPath: [{ action: priorAction, resultState: base }],
      terminationReason: 'goal_reached',
      alternativePaths: [],
    };
    const result = agentResult(base, { meta, trace: [priorAction] });

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).not.toBe(result);
    expect(out.meta).toBeDefined();
    expect(out.meta!.chosenPath).toHaveLength(2);
    // The appended step's action must be the trace's newly-appended action, and
    // its resultState must be the same object as the returned finalState —
    // chosenPath stays in lockstep with trace/finalState.
    expect(out.trace).toHaveLength(2);
    expect(out.meta!.chosenPath[1].action).toBe(out.trace[1]);
    expect(out.meta!.chosenPath[1].resultState).toBe(out.finalState);
    // The original result's meta is untouched (no mutation of the input).
    expect(result.meta!.chosenPath).toHaveLength(1);
  });

  it('leaves meta/rationale_he untouched when nothing improves (identity return)', async () => {
    const m = model();
    const base = emptyState(SEMS);
    const meta: BeamSearchMeta = {
      beamWidth: 6,
      depthRecords: [],
      chosenPath: [],
      terminationReason: 'no_legal_expansion',
      alternativePaths: [],
    };
    const result = agentResult(base, { meta, rationale_he: 'הסבר קיים' });

    const sim = new LocalSearchSimulationCapability();
    const out = await sim.simulate({ result, model: m });

    expect(out).toBe(result);
    expect(out.rationale_he).toBe('הסבר קיים');
    expect(out.meta!.chosenPath).toHaveLength(0);
  });
});

describe('LocalSearchSimulationCapability — never mutates its inputs', () => {
  it('leaves the input result, model, and finalState untouched', async () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('w1', profile('w1', { hours: 4, is_wanted: true }));
    const m = model({ profiles, wantedCourseIds: new Set(['w1']) });
    const base = emptyState(SEMS);
    const result = agentResult(base);
    const snapshotState = JSON.parse(JSON.stringify(base));
    const snapshotResult = JSON.parse(JSON.stringify(result));

    const sim = new LocalSearchSimulationCapability();
    await sim.simulate({ result, model: m });

    expect(base).toEqual(snapshotState);
    expect(result).toEqual(snapshotResult);
  });
});

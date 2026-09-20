/**
 * Phase 4 — tests for api/ai/planner_agent.ts.
 *
 * PlannerAgent owns: ConstraintModel, SearchDeps closures, detectGaps, capability
 * dispatch, trace-from-meta (primary) and diffToTrace (fallback).
 *
 * Required tests:
 *  1. SearchCapability is called with all six SearchDeps closures
 *  2. detectGaps exposes gaps in AgentResult
 *  3. Missing KnowledgeCapability does not block planning
 *  4. KnowledgeCapability.resolve called before search when gaps present
 *  5. Trace built from meta.chosenPath when BeamSearchMeta is present
 *  6. Trace falls back to diffToTrace when SearchResult has no meta
 *  7. ValidationCapability wired into deps.validate; rejection reason preserved
 *  8. ExplanationCapability absent does not block planning
 */

import {
  PlannerAgent,
  type AgentResult,
} from '../../api/ai/planner_agent';
import type {
  SearchCapability,
  KnowledgeCapability,
  ValidationCapability,
  ExplanationCapability,
  GapRecord,
} from '../../api/ai/planner_capabilities';
import type { SearchDeps } from '../../api/ai/planner_search_types';
import type { ConstraintModel, PlanState, PlannerMutation, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { PolicyProvider } from '../../api/ai/planner_policy';

// ── Minimal fixtures ──────────────────────────────────────────────────────────

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

const KNOWN_CAT: CategoryReq = { id: 'cat_1', name: 'Known Category', required: 1, candidateIds: [] };

function makeModel(profiles: CourseProfile[] = [], categories: CategoryReq[] = [KNOWN_CAT]): ConstraintModel {
  const profileMap = new Map<string, CourseProfile>();
  for (const p of profiles) profileMap.set(p.course_id, p);
  return {
    profiles: profileMap,
    knownSemesterIds: ['s1', 's2'],
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories,
    degreeRequiredHours: 100,
    priorHours: 0,
    maxHoursPerSemester: 20,
    hardCap: 30,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
  };
}

const INITIAL_STATE: PlanState = { semesters: { s1: [], s2: [] } };

/** Mock search that returns initialState unchanged (no planning needed for wiring tests). */
function noopSearch(): SearchCapability<PlanState, PlannerMutation> {
  return { search: (s, _deps, _opts) => ({ finalState: s }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlannerAgent', () => {
  // 1 — SearchCapability receives all six SearchDeps closures
  test('SearchCapability receives all six SearchDeps closures', async () => {
    let capturedDeps: SearchDeps<PlanState, PlannerMutation> | undefined;
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, _opts) => { capturedDeps = deps; return { finalState: s }; },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch });
    await agent.run();

    expect(capturedDeps).toBeDefined();
    expect(typeof capturedDeps!.generateActions).toBe('function');
    expect(typeof capturedDeps!.applyMutation).toBe('function');
    expect(typeof capturedDeps!.validate).toBe('function');
    expect(typeof capturedDeps!.score).toBe('function');
    expect(typeof capturedDeps!.compareScore).toBe('function');
    expect(typeof capturedDeps!.isGoal).toBe('function');
  });

  // 2 — detectGaps runs and result carries gaps
  test('detectGaps runs and gaps appear in AgentResult', async () => {
    const modelWithGap = makeModel([makeProfile('c1', { hours: null })]);
    const agent = new PlannerAgent({ model: modelWithGap, initialState: INITIAL_STATE, search: noopSearch() });
    const result: AgentResult = await agent.run();

    expect(result.gaps.some((g: GapRecord) => g.courseId === 'c1' && g.gapType === 'null_hours')).toBe(true);
  });

  // 3 — missing KnowledgeCapability does not block planning
  test('planning proceeds without KnowledgeCapability even when gaps exist', async () => {
    const modelWithGap = makeModel([makeProfile('c1', { hours: null })]);
    const agent = new PlannerAgent({ model: modelWithGap, initialState: INITIAL_STATE, search: noopSearch() });
    const result = await agent.run();

    expect(result.finalState).toBeDefined();
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  // 4 — KnowledgeCapability.resolve called before search when gaps present
  test('KnowledgeCapability.resolve is called before SearchCapability.search when gaps exist', async () => {
    const order: string[] = [];
    const knowledge: KnowledgeCapability = { resolve: async (_gaps) => { order.push('knowledge'); } };
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, _deps, _opts) => { order.push('search'); return { finalState: s }; },
    };
    const modelWithGap = makeModel([makeProfile('c1', { hours: null })]);
    const agent = new PlannerAgent({ model: modelWithGap, initialState: INITIAL_STATE, search: mockSearch, knowledge });
    await agent.run();

    expect(order).toEqual(['knowledge', 'search']);
  });

  // 4b — KnowledgeCapability.resolve NOT called when no gaps
  test('KnowledgeCapability.resolve is not called when there are no gaps', async () => {
    let resolveCalled = false;
    const knowledge: KnowledgeCapability = { resolve: async (_gaps) => { resolveCalled = true; } };
    // makeProfile defaults are fully specified — no gaps
    const cleanModel = makeModel([makeProfile('c1')]);
    const agent = new PlannerAgent({ model: cleanModel, initialState: INITIAL_STATE, search: noopSearch(), knowledge });
    await agent.run();

    expect(resolveCalled).toBe(false);
  });

  // 5 — trace built from meta.chosenPath when BeamSearchMeta present
  test('trace is extracted from meta.chosenPath when BeamSearchMeta is present', async () => {
    const addMut: PlannerMutation = { type: 'ADD_COURSE', courseId: 'c1', semesterId: 's1' };
    const step1State: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (_s, _deps, _opts) => ({
        finalState: step1State,
        meta: {
          beamWidth: 1,
          depthRecords: [],
          chosenPath: [{ action: addMut, resultState: step1State }],
          terminationReason: 'max_steps',
          alternativePaths: [],
        },
      }),
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch });
    const result = await agent.run();

    expect(result.meta).toBeDefined();
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({ type: 'ADD_COURSE', courseId: 'c1', semesterId: 's1' });
  });

  // 6 — trace falls back to diffToTrace when meta absent
  test('trace falls back to diffToTrace when SearchResult has no meta', async () => {
    const finalState: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (_s, _deps, _opts) => ({ finalState }), // no meta
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch });
    const result = await agent.run();

    expect(result.meta).toBeUndefined();
    const addTrace = result.trace.filter(m => m.type === 'ADD_COURSE' && m.courseId === 'c1');
    expect(addTrace).toHaveLength(1);
  });

  // 6b — diffToTrace detects removed courses too
  test('diffToTrace detects REMOVE_COURSE when a course is absent in finalState', async () => {
    const startState: PlanState = { semesters: { s1: ['c1'], s2: [] } };
    const finalState: PlanState = { semesters: { s1: [], s2: [] } };
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (_s, _deps, _opts) => ({ finalState }),
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: startState, search: mockSearch });
    const result = await agent.run();

    expect(result.meta).toBeUndefined();
    expect(result.trace.some(m => m.type === 'REMOVE_COURSE' && m.courseId === 'c1')).toBe(true);
  });

  // 7 — ValidationCapability wired into deps.validate; rejection reason preserved
  test('deps.validate uses ValidationCapability and preserves rejection reason', async () => {
    let capturedValidation: { valid: boolean; reason?: string } | undefined;
    const validation: ValidationCapability = {
      validateState: (_s: unknown) => ({ valid: false, reason: 'test-rejection' }),
    };
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, _opts) => {
        capturedValidation = deps.validate(s);
        return { finalState: s };
      },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch, validation });
    await agent.run();

    expect(capturedValidation).toEqual({ valid: false, reason: 'test-rejection' });
  });

  // 8 — ExplanationCapability absent does not block planning
  test('planning completes without ExplanationCapability', async () => {
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: noopSearch() });
    const result = await agent.run();

    expect(result.finalState).toBeDefined();
    expect(result.trace).toBeDefined();
    expect(result.gaps).toBeDefined();
  });

  // 8b — ExplanationCapability.explain called when present
  test('ExplanationCapability.explain is called after search when present', async () => {
    let explanationCalled = false;
    const explanation: ExplanationCapability = {
      explain: async (_trace: unknown[]) => { explanationCalled = true; return 'הסבר'; },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: noopSearch(), explanation });
    await agent.run();

    expect(explanationCalled).toBe(true);
  });

  // Shape test: AgentResult has required fields
  test('AgentResult has finalState, trace, gaps, and optional meta', async () => {
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: noopSearch() });
    const result = await agent.run();

    expect(result).toHaveProperty('finalState');
    expect(result).toHaveProperty('trace');
    expect(result).toHaveProperty('gaps');
    // meta is optional — just verify property access doesn't throw
    void result.meta;
  });

  // Phase 5 additions — rationale_he in AgentResult

  test('ExplanationCapability result is returned as rationale_he in AgentResult', async () => {
    const explanation: ExplanationCapability = {
      explain: async (_trace) => 'תוכנית מעולה',
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: noopSearch(), explanation });
    const result = await agent.run();
    expect(result.rationale_he).toBe('תוכנית מעולה');
  });

  test('ExplanationCapability failure is caught; rationale_he is undefined in result', async () => {
    const explanation: ExplanationCapability = {
      explain: async (_trace) => { throw new Error('LLM timeout'); },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: noopSearch(), explanation });
    const result = await agent.run();
    // Failure is caught — result still returned, rationale_he is absent (caller uses fallback)
    expect(result.rationale_he).toBeUndefined();
  });

  // PolicyProvider extraction — default and injected

  test('uses the default TauPolicyProvider when no policy option is passed', async () => {
    const cat: CategoryReq = { id: 'cat_1', name: 'Known Category', required: 1, candidateIds: ['c2'] };
    const model = makeModel(
      [makeProfile('c1', { is_mandatory: true, hours: 4 }), makeProfile('c2', { hours: 4 })],
      [cat],
    );
    model.requiredMandatoryCourseIds = ['c1'];
    model.degreeRequiredHours = 8;

    let capturedDeps: SearchDeps<PlanState, PlannerMutation> | undefined;
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, _opts) => { capturedDeps = deps; return { finalState: s }; },
    };
    const agent = new PlannerAgent({ model, initialState: INITIAL_STATE, search: mockSearch });
    await agent.run();

    const goalState: PlanState = { semesters: { s1: ['c1', 'c2'], s2: [] } };
    const nonGoalState: PlanState = { semesters: { s1: [], s2: [] } };
    expect(capturedDeps!.isGoal(goalState)).toBe(true);
    expect(capturedDeps!.isGoal(nonGoalState)).toBe(false);
  });

  test('uses an injected custom PolicyProvider instead of the default', async () => {
    const stubPolicy: PolicyProvider = {
      isGoal: (_s, _m) => true,
      score: (_s, _m) => [999],
      compareScore: (_a, _b) => 42,
      assessCompleteness: (_s, _m) => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [], incompleteAnnual: [], missingMustInclude: [],
      }),
      validate: (_s, _m, _p, _c) => ({ valid: false, reason: 'sentinel-reason' }),
      generateActions: (_s, _m) => [],
    };

    let capturedDeps: SearchDeps<PlanState, PlannerMutation> | undefined;
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, _opts) => { capturedDeps = deps; return { finalState: s }; },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch, policy: stubPolicy });
    await agent.run();

    expect(capturedDeps!.isGoal(INITIAL_STATE)).toBe(true);
    expect(capturedDeps!.score(INITIAL_STATE)).toEqual([999]);
    expect(capturedDeps!.compareScore([1], [2])).toBe(42);
    expect(capturedDeps!.validate(INITIAL_STATE)).toEqual({ valid: false, reason: 'sentinel-reason' });
  });

  // Phase 1a — enumerateActions moved behind PolicyProvider.generateActions

  test('deps.generateActions uses the injected PolicyProvider.generateActions, not enumerateActions directly', async () => {
    const sentinelAction: PlannerMutation = { type: 'ADD_COURSE', courseId: 'sentinel', semesterId: 's1' };
    const stubPolicy: PolicyProvider = {
      isGoal: (_s, _m) => true,
      score: (_s, _m) => [0],
      compareScore: (_a, _b) => 0,
      assessCompleteness: (_s, _m) => ({
        degreeHours: 0, degreeMet: true, missingMandatory: [], unsatisfiedCategories: [], overCapSemesters: [], incompleteAnnual: [], missingMustInclude: [],
      }),
      validate: (_s, _m, _p, _c) => ({ valid: true }),
      generateActions: (_s, _m) => [sentinelAction],
    };

    let capturedDeps: SearchDeps<PlanState, PlannerMutation> | undefined;
    const mockSearch: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, _opts) => { capturedDeps = deps; return { finalState: s }; },
    };
    const agent = new PlannerAgent({ model: makeModel(), initialState: INITIAL_STATE, search: mockSearch, policy: stubPolicy });
    await agent.run();

    expect(capturedDeps!.generateActions(INITIAL_STATE)).toEqual([sentinelAction]);
  });
});

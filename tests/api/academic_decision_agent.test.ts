/**
 * AcademicDecisionAgent epic — tests for api/ai/academic_decision_agent.ts.
 *
 * AcademicDecisionAgent is the top-level pipeline shell:
 *   Observe (ProgramProvider) -> Detect Gaps (pure detectGaps) -> Clarify if
 *   needed -> Plan (delegates to an injected PlanningCapability, treated as a
 *   black box) -> Validate if wired -> Simulate if needed -> Decide if needed
 *   -> Persist.
 *
 * Not wired into generate-plan.ts / planner-run.ts / PlannerWorker.
 * PlannerAgent itself is never constructed here — Plan is a pure delegation
 * to whatever PlanningCapability the caller injects.
 */

import type { ConstraintModel, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { ProgramProvider } from '../../api/ai/program_provider';
import type { PlanningCapability, AgentResult } from '../../api/ai/planner_agent';
import type { ValidationCapability } from '../../api/ai/planner_capabilities';
import type {
  ClarificationCapability,
  ClarificationResult,
  SimulationCapability,
  DecisionCapability,
  PersistenceCapability,
} from '../../api/ai/academic_decision_types';
import {
  AcademicDecisionAgent,
  type AcademicDecisionDeps,
  type AcademicDecisionRequest,
} from '../../api/ai/academic_decision_agent';

// ── Fixtures ───────────────────────────────────────────────────────────────────

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
    offered_semesters: ['semester_a'],
    effective_allowed_semesters: ['semester_a'],
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

function makeModel(profiles: CourseProfile[]): ConstraintModel {
  const profileMap = new Map<string, CourseProfile>();
  for (const p of profiles) profileMap.set(p.course_id, p);
  return {
    profiles: profileMap,
    knownSemesterIds: ['semester_a', 'semester_b'],
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [KNOWN_CAT],
    degreeRequiredHours: 100,
    priorHours: 0,
    maxHoursPerSemester: 20,
    hardCap: 30,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
  };
}

const CLEAN_MODEL = makeModel([makeProfile('c1')]);
const GAPPY_MODEL = makeModel([makeProfile('c1', { hours: null })]);

const PLANNED_RESULT: AgentResult = {
  finalState: { semesters: { semester_a: ['c1'] } },
  trace: [{ type: 'ADD_COURSE', courseId: 'c1', semesterId: 'semester_a' }],
  gaps: [],
};

class FakeProgramProvider implements ProgramProvider {
  constructor(private model: ConstraintModel = CLEAN_MODEL, private board: Record<string, unknown> | null = {}) {}
  parseProgramId = jest.fn((id: string) => ({ base: id, year: 2027 }));
  loadBoard = jest.fn(async (_programId: string, _dbUrl?: string) => this.board);
  buildModel = jest.fn((_boardJson: any, _opts: any = {}) => this.model);
}

/**
 * Returns a PlanningCapability-factory (the shape AcademicDecisionDeps.planning
 * now requires) with its inner `run` jest.fn exposed as `.run`, so existing
 * call-order/call-count assertions (`planning.run`) keep working unchanged
 * while `planning` itself is directly usable as `deps.planning`.
 */
function fakePlanning(result: AgentResult = PLANNED_RESULT): ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock } {
  const run = jest.fn(async () => result);
  const factory = ((_req: AcademicDecisionRequest) => ({ run })) as unknown as ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock };
  factory.run = run;
  return factory;
}

const REQ: AcademicDecisionRequest = { programId: 'whatever_2027' };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AcademicDecisionAgent — default (no-op) pipeline', () => {
  test('delegates planning to the injected PlanningCapability and returns it unchanged', async () => {
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run(REQ);

    expect(planning.run).toHaveBeenCalledTimes(1);
    expect(result.agentResult).toEqual(PLANNED_RESULT);
  });

  test('top-level gaps reflect the Observe-stage model (pure detectGaps)', async () => {
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(GAPPY_MODEL),
      planning: fakePlanning(),
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run(REQ);

    expect(result.gaps).toEqual([{ courseId: 'c1', gapType: 'null_hours' }]);
  });
});

describe('AcademicDecisionAgent — board not found', () => {
  test('rejects with a clear error and never invokes planning', async () => {
    const planning = fakePlanning();
    const provider = new FakeProgramProvider(CLEAN_MODEL, null);
    const deps: AcademicDecisionDeps = { programProvider: provider, planning };
    const agent = new AcademicDecisionAgent(deps);

    await expect(agent.run({ programId: 'unknown_9999' })).rejects.toThrow(/unknown_9999/);
    expect(planning.run).not.toHaveBeenCalled();
  });
});

describe('AcademicDecisionAgent — Clarify stage', () => {
  const NO_ISSUES: ClarificationResult = { needsClarification: false, missingInputs: [] };

  test('calls clarification before planning, passing the top-level gaps and the request-derived context', async () => {
    const clarify = jest.fn(async () => NO_ISSUES);
    const clarification: ClarificationCapability = { clarify };
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(GAPPY_MODEL),
      planning,
      clarification,
    };
    const agent = new AcademicDecisionAgent(deps);
    await agent.run(REQ);

    expect(clarify).toHaveBeenCalledWith({
      gaps: [{ courseId: 'c1', gapType: 'null_hours' }],
      context: {},
    });
    expect((planning.run as jest.Mock).mock.invocationCallOrder[0])
      .toBeGreaterThan(clarify.mock.invocationCallOrder[0]);
  });

  test('calls clarification even when there are no top-level gaps — it inspects request inputs, not profile gaps', async () => {
    const clarify = jest.fn(async () => NO_ISSUES);
    const clarification: ClarificationCapability = { clarify };
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning: fakePlanning(),
      clarification,
    };
    const agent = new AcademicDecisionAgent(deps);
    await agent.run(REQ);

    expect(clarify).toHaveBeenCalledWith({ gaps: [], context: {} });
  });

  test('with default non-blocking behavior, planning still runs even when clarification reports missing critical inputs', async () => {
    const clarify = jest.fn(async () => ({
      needsClarification: true,
      missingInputs: [{ field: 'completedCourses' as const, critical: true, message: 'x' }],
    }));
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
      clarification: { clarify },
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run(REQ);

    expect(planning.run).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
    expect(result.agentResult).toEqual(PLANNED_RESULT);
  });

  test('with blockOnMissingCriticalInputs: true, planning is not delegated when a critical input is missing', async () => {
    const clarificationResult = {
      needsClarification: true,
      missingInputs: [{ field: 'completedCourses' as const, critical: true, message: 'x' }],
    };
    const clarify = jest.fn(async () => clarificationResult);
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
      clarification: { clarify },
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run({ ...REQ, blockOnMissingCriticalInputs: true });

    expect(planning.run).not.toHaveBeenCalled();
    expect(result.blocked).toBe(true);
    expect(result.agentResult).toBeUndefined();
    expect(result.clarification).toEqual(clarificationResult);
  });

  test('blockOnMissingCriticalInputs: true does not block when only non-critical inputs are missing', async () => {
    const clarify = jest.fn(async () => ({
      needsClarification: true,
      missingInputs: [{ field: 'track' as const, critical: false, message: 'x' }],
    }));
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
      clarification: { clarify },
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run({ ...REQ, blockOnMissingCriticalInputs: true });

    expect(planning.run).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
  });

  test('a blocked result is an explicit, testable value — run() resolves, it does not throw', async () => {
    const clarify = jest.fn(async () => ({
      needsClarification: true,
      missingInputs: [{ field: 'excludedCourses' as const, critical: true, message: 'x' }],
    }));
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning: fakePlanning(),
      clarification: { clarify },
    };
    const agent = new AcademicDecisionAgent(deps);

    await expect(agent.run({ ...REQ, blockOnMissingCriticalInputs: true })).resolves.toMatchObject({
      blocked: true,
    });
  });
});

describe('AcademicDecisionAgent — Validate stage', () => {
  test('calls validation after planning, against the planned finalState', async () => {
    const validateState = jest.fn(() => ({ valid: true }));
    const validation: ValidationCapability = { validateState };
    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
      validation,
    };
    const agent = new AcademicDecisionAgent(deps);
    await agent.run(REQ);

    expect(validateState).toHaveBeenCalledWith(PLANNED_RESULT.finalState);
    expect(validateState.mock.invocationCallOrder[0])
      .toBeGreaterThan((planning.run as jest.Mock).mock.invocationCallOrder[0]);
  });

  test('rejects when validation reports the plan invalid', async () => {
    const validation: ValidationCapability = {
      validateState: () => ({ valid: false, reason: 'overloaded' }),
    };
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning: fakePlanning(),
      validation,
    };
    const agent = new AcademicDecisionAgent(deps);

    await expect(agent.run(REQ)).rejects.toThrow(/overloaded/);
  });

  test('no validation dep by default — no-op, does not affect the result', async () => {
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning: fakePlanning(),
    };
    const agent = new AcademicDecisionAgent(deps);
    await expect(agent.run(REQ)).resolves.toBeDefined();
  });
});

describe('AcademicDecisionAgent — Simulate / Decide / Persist ordering', () => {
  test('calls simulate, then decide with [simulated], then persist with the decided result, in order', async () => {
    const simulated: AgentResult = { ...PLANNED_RESULT, rationale_he: 'simulated' };
    const decided: AgentResult = { ...PLANNED_RESULT, rationale_he: 'decided' };

    const simulate = jest.fn(async (_r: AgentResult) => simulated);
    const decide = jest.fn(async (_candidates: AgentResult[]) => decided);
    const persist = jest.fn(async (_r: AgentResult) => { /* no-op */ });

    const simulation: SimulationCapability = { simulate };
    const decision: DecisionCapability = { decide };
    const persistence: PersistenceCapability = { persist };

    const planning = fakePlanning();
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(CLEAN_MODEL),
      planning,
      simulation,
      decision,
      persistence,
    };
    const agent = new AcademicDecisionAgent(deps);
    const result = await agent.run(REQ);

    expect(simulate).toHaveBeenCalledWith(PLANNED_RESULT);
    expect(decide).toHaveBeenCalledWith([simulated]);
    expect(persist).toHaveBeenCalledWith(decided);
    expect(result.agentResult).toEqual(decided);

    const order = [
      (planning.run as jest.Mock).mock.invocationCallOrder[0],
      simulate.mock.invocationCallOrder[0],
      decide.mock.invocationCallOrder[0],
      persist.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('AcademicDecisionAgent — default TauProgramProvider', () => {
  test('AcademicDecisionDeps.programProvider is optional (type-level default check via required planning only)', () => {
    // Compile-time check: omitting programProvider must still type-check.
    const deps: AcademicDecisionDeps = { planning: fakePlanning() };
    expect(deps.programProvider).toBeUndefined();
  });
});

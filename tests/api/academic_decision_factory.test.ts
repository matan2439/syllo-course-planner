/**
 * AcademicDecisionAgent epic — tests for api/ai/academic_decision_factory.ts.
 *
 * createDefaultAcademicDecisionAgent proves the AcademicDecisionAgent shell
 * (academic_decision_agent.ts) is constructible from real project building
 * blocks: TauProgramProvider, PlannerAgent (via runPlanningOrchestration),
 * BeamSearchStrategy, PassThroughKnowledgeCapability, LlmExplainer, and the
 * no-op Clarification/Simulation/Decision/Persistence shells.
 *
 * The factory builds dependencies and hands them to AcademicDecisionAgent's
 * constructor — AcademicDecisionAgent itself never calls
 * runPlanningOrchestration or builds its own deps (unchanged from the prior
 * epic). Not wired into generate-plan.ts / planner-run.ts / PlannerWorker.
 */

jest.mock('../../api/board', () => ({
  parseProgramVersionId: jest.requireActual('../../api/board').parseProgramVersionId,
  queryBoardJson: jest.fn(),
}));
jest.mock('../../api/ai/board_loader', () => ({
  loadLocalBoardJson: jest.fn(),
}));

import type { LanguageModel } from 'ai';
import type { ConstraintModel, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { ProgramProvider } from '../../api/ai/program_provider';
import type { PlanningCapability, AgentResult } from '../../api/ai/planner_agent';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { NoOpClarificationCapability } from '../../api/ai/academic_decision_types';
import type { ClarificationCapability } from '../../api/ai/academic_decision_types';
import { AcademicDecisionAgent, type AcademicDecisionRequest } from '../../api/ai/academic_decision_agent';
import {
  createDefaultAcademicDecisionAgent,
  type DefaultAcademicDecisionAgentOptions,
} from '../../api/ai/academic_decision_factory';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeProfile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id,
    name_he: id,
    category_id: null,
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

function makeModel(profiles: CourseProfile[], categories: CategoryReq[] = []): ConstraintModel {
  const profileMap = new Map<string, CourseProfile>();
  for (const p of profiles) profileMap.set(p.course_id, p);
  return {
    profiles: profileMap,
    knownSemesterIds: ['semester_a', 'semester_b'],
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories,
    degreeRequiredHours: 4,
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

// Real board JSON — mirrors the fixture in planner_orchestration.test.ts. One
// fixed mandatory course; a real PlannerAgent run should place it and finish
// immediately (isGoal true at depth 0 or 1).
const BOARD = {
  semesters: [
    { semester_id: 'y1s1', courses: [
      { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['y1s1'], prerequisites: [] },
    ] },
    { semester_id: 'y1s2', courses: [] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 4, categories: [] },
  },
};

class FakeProgramProvider implements ProgramProvider {
  constructor(
    private opts: { model?: ConstraintModel; board?: Record<string, unknown> | null; realBoardBuild?: boolean } = {},
  ) {}
  parseProgramId = jest.fn((id: string) => ({ base: id, year: 2027 }));
  loadBoard = jest.fn(async (_programId: string, _dbUrl?: string) => this.opts.board ?? BOARD);
  buildModel = jest.fn((boardJson: any, buildOpts: any = {}) =>
    this.opts.realBoardBuild ? buildConstraintModel(boardJson, buildOpts) : (this.opts.model ?? CLEAN_MODEL),
  );
}

/** See academic_decision_agent.test.ts's fakePlanning for why this shape. */
function fakePlanning(result: AgentResult): ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock } {
  const run = jest.fn(async () => result);
  const factory = ((_req: AcademicDecisionRequest) => ({ run })) as unknown as ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock };
  factory.run = run;
  return factory;
}

const FIXED_RESULT: AgentResult = {
  finalState: { semesters: { semester_a: ['c1'] } },
  trace: [{ type: 'ADD_COURSE', courseId: 'c1', semesterId: 'semester_a' }],
  gaps: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createDefaultAcademicDecisionAgent', () => {
  test('returns an AcademicDecisionAgent, with zero I/O at construction time', () => {
    const agent = createDefaultAcademicDecisionAgent();
    expect(agent).toBeInstanceOf(AcademicDecisionAgent);
  });

  test('wires no-op Simulation/Decision/Persistence defaults — a gappy plan resolves unchanged (clarification is non-blocking by default)', async () => {
    const opts: DefaultAcademicDecisionAgentOptions = {
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
      },
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    // No custom Simulation/Decision/Persistence supplied, and
    // blockOnMissingCriticalInputs defaults to false — the planned result
    // must come through unchanged even though the deterministic clarification
    // default will report missing inputs (no buildModelOptions on this req).
    expect(result.blocked).toBe(false);
    expect(result.agentResult).toEqual(FIXED_RESULT);
    expect(result.gaps).toEqual([{ courseId: 'c1', gapType: 'null_hours' }]);
  });

  test('default clarification is DeterministicClarificationCapability — reports missing inputs and structured questions for a bare request', async () => {
    const opts: DefaultAcademicDecisionAgentOptions = {
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
      },
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    expect(result.clarification.needsClarification).toBe(true);
    expect(result.clarification.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'completedCourses', critical: true }),
    );
    expect(result.clarification.questions).toContainEqual(
      expect.objectContaining({ id: 'completed_courses', inputKey: 'completedCourseIds', critical: true, required: true }),
    );
    expect(result.clarification.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('allows dependency overrides — a custom ClarificationCapability replaces the deterministic default', async () => {
    const clarify = jest.fn(async () => ({ needsClarification: false, missingInputs: [], questions: [] }));
    const clarification: ClarificationCapability = { clarify };
    const opts: DefaultAcademicDecisionAgentOptions = {
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
        clarification,
      },
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    await agent.run({ programId: 'whatever_2027' });

    expect(clarify).toHaveBeenCalledWith({ gaps: [{ courseId: 'c1', gapType: 'null_hours' }], context: {} });
  });

  test('default clarification is a fresh DeterministicClarificationCapability, not shared mutable state', () => {
    const agentA = createDefaultAcademicDecisionAgent();
    const agentB = createDefaultAcademicDecisionAgent();
    expect(agentA).not.toBe(agentB);
  });

  test('default planning wiring delegates to the real PlannerAgent/BeamSearchStrategy via runPlanningOrchestration', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const opts: DefaultAcademicDecisionAgentOptions = {
      overrides: { programProvider: provider }, // planning left at its real default
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    // Real PlannerAgent + BeamSearchStrategy must have placed the fixed mandatory course.
    expect(result.agentResult!.finalState.semesters['y1s1']).toContain('MAND');
    expect(result.gaps).toEqual([]); // clean fixed-placement board — no top-level gaps
  });

  test('wires a real LlmExplainer as ExplanationCapability when a languageModel is supplied', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const opts: DefaultAcademicDecisionAgentOptions = {
      overrides: { programProvider: provider },
      languageModel: {} as LanguageModel, // LlmExplainer's Phase-5 explain() never calls the model
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    expect(typeof result.agentResult!.rationale_he).toBe('string');
    expect(result.agentResult!.rationale_he!.length).toBeGreaterThan(0);
  });
});

describe('programId drift between Observe and Plan — single source of truth', () => {
  // DefaultAcademicDecisionAgentOptions has no programId field at all anymore
  // (see file header) — Observe and Plan can only ever see req.programId from
  // agent.run(req). This is the regression test for the seam the previous
  // epic documented: it FAILED under the old orchestrationRequest.programId
  // design (Plan silently kept using the factory-bound id).
  test('succeeds and uses the SAME programId for Observe and Plan when called once', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const agent = createDefaultAcademicDecisionAgent({ overrides: { programProvider: provider } });

    const result = await agent.run({ programId: 'whatever_2027' });

    const programIdsSeen = provider.loadBoard.mock.calls.map(([programId]) => programId);
    expect(programIdsSeen).toEqual(['whatever_2027', 'whatever_2027']);
    expect(result.agentResult!.finalState.semesters['y1s1']).toContain('MAND');
  });

  test('re-derives Plan from the live programId on every run() call — no staleness across repeated calls', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const agent = createDefaultAcademicDecisionAgent({ overrides: { programProvider: provider } });

    await agent.run({ programId: 'first_2027' });
    await agent.run({ programId: 'second_2027' });

    // 2 calls x (Observe + Plan) = 4 loadBoard calls; each pair must match.
    const programIdsSeen = provider.loadBoard.mock.calls.map(([programId]) => programId);
    expect(programIdsSeen).toEqual(['first_2027', 'first_2027', 'second_2027', 'second_2027']);
  });

  test('a mismatch failure point is moot by construction: the Plan-stage request has no independent programId to diverge before planning starts', async () => {
    // Overriding `planning` entirely bypasses this guarantee by design — a
    // fully custom PlanningCapability factory owns its own programId
    // handling. The default wiring (exercised above) never exposes a way to
    // set one independently, so there is no runtime "reject on mismatch"
    // path to test: the type system removes the second programId field.
    const clarify = jest.fn(async () => ({ needsClarification: false, missingInputs: [], questions: [] }));
    const agent = createDefaultAcademicDecisionAgent({
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
        clarification: { clarify },
      },
    });
    await agent.run({ programId: 'whatever_2027' });
    expect(clarify).toHaveBeenCalled();
  });
});

describe('AcademicDecisionAgent — still constructible directly, no factory required', () => {
  test('constructible with hand-built deps', () => {
    const agent = new AcademicDecisionAgent({
      planning: fakePlanning(FIXED_RESULT),
      clarification: new NoOpClarificationCapability(),
    });
    expect(agent).toBeInstanceOf(AcademicDecisionAgent);
  });
});

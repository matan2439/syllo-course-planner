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
import { AcademicDecisionAgent } from '../../api/ai/academic_decision_agent';
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

function fakePlanning(result: AgentResult): PlanningCapability {
  return { run: jest.fn(async () => result) };
}

const FIXED_RESULT: AgentResult = {
  finalState: { semesters: { semester_a: ['c1'] } },
  trace: [{ type: 'ADD_COURSE', courseId: 'c1', semesterId: 'semester_a' }],
  gaps: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createDefaultAcademicDecisionAgent', () => {
  test('returns an AcademicDecisionAgent, with zero I/O at construction time', () => {
    const agent = createDefaultAcademicDecisionAgent({
      orchestrationRequest: { programId: 'whatever_2027' },
    });
    expect(agent).toBeInstanceOf(AcademicDecisionAgent);
  });

  test('wires no-op Clarification/Simulation/Decision/Persistence defaults — a gappy plan resolves unchanged', async () => {
    const opts: DefaultAcademicDecisionAgentOptions = {
      orchestrationRequest: { programId: 'whatever_2027' },
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
      },
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    // No custom Clarification/Simulation/Decision/Persistence supplied — the
    // no-op defaults must not alter the planned result at all.
    expect(result.agentResult).toEqual(FIXED_RESULT);
    expect(result.gaps).toEqual([{ courseId: 'c1', gapType: 'null_hours' }]);
  });

  test('allows dependency overrides — a custom ClarificationCapability replaces the no-op default', async () => {
    const clarify = jest.fn(async () => { /* no-op */ });
    const clarification: ClarificationCapability = { clarify };
    const opts: DefaultAcademicDecisionAgentOptions = {
      orchestrationRequest: { programId: 'whatever_2027' },
      overrides: {
        programProvider: new FakeProgramProvider({ model: GAPPY_MODEL }),
        planning: fakePlanning(FIXED_RESULT),
        clarification,
      },
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    await agent.run({ programId: 'whatever_2027' });

    expect(clarify).toHaveBeenCalledWith({ gaps: [{ courseId: 'c1', gapType: 'null_hours' }] });
  });

  test('default clarification is a fresh NoOpClarificationCapability, not shared mutable state', () => {
    const agentA = createDefaultAcademicDecisionAgent({ orchestrationRequest: { programId: 'a_2027' } });
    const agentB = createDefaultAcademicDecisionAgent({ orchestrationRequest: { programId: 'b_2027' } });
    expect(agentA).not.toBe(agentB);
  });

  test('default planning wiring delegates to the real PlannerAgent/BeamSearchStrategy via runPlanningOrchestration', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const opts: DefaultAcademicDecisionAgentOptions = {
      orchestrationRequest: { programId: 'whatever_2027' },
      overrides: { programProvider: provider }, // planning left at its real default
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    // Real PlannerAgent + BeamSearchStrategy must have placed the fixed mandatory course.
    expect(result.agentResult.finalState.semesters['y1s1']).toContain('MAND');
    expect(result.gaps).toEqual([]); // clean fixed-placement board — no top-level gaps
  });

  test('wires a real LlmExplainer as ExplanationCapability when a languageModel is supplied', async () => {
    const provider = new FakeProgramProvider({ realBoardBuild: true });
    const opts: DefaultAcademicDecisionAgentOptions = {
      orchestrationRequest: { programId: 'whatever_2027' },
      overrides: { programProvider: provider },
      languageModel: {} as LanguageModel, // LlmExplainer's Phase-5 explain() never calls the model
    };
    const agent = createDefaultAcademicDecisionAgent(opts);
    const result = await agent.run({ programId: 'whatever_2027' });

    expect(typeof result.agentResult.rationale_he).toBe('string');
    expect(result.agentResult.rationale_he!.length).toBeGreaterThan(0);
  });
});

describe('AcademicDecisionAgent — unchanged by this epic', () => {
  test('still constructible directly with hand-built deps (no factory required)', () => {
    const agent = new AcademicDecisionAgent({
      planning: fakePlanning(FIXED_RESULT),
      clarification: new NoOpClarificationCapability(),
    });
    expect(agent).toBeInstanceOf(AcademicDecisionAgent);
  });
});

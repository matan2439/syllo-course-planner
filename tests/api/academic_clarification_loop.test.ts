/**
 * Clarification Loop Harness — tests for api/ai/academic_clarification_loop.ts.
 *
 * Proves the two existing clarification-contract pieces work together across
 * repeated AcademicDecisionAgent runs:
 *   DeterministicClarificationCapability (academic_clarification.ts) produces
 *   structured ClarificationQuestion[]; applyClarificationAnswers
 *   (academic_clarification_answers.ts) merges answers back into a fresh
 *   AcademicDecisionRequest. This harness is the closed loop: first request ->
 *   questions -> validated answers -> updated request -> re-run -> answered
 *   questions disappear.
 *
 * Pure, no-I/O, no UI/LLM/Supabase. Not wired into AcademicDecisionAgent, the
 * factory, generate-plan.ts, planner-run.ts, PlannerWorker, PlannerAgent, or
 * planner_orchestration.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConstraintModel, CategoryReq } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import type { ProgramProvider } from '../../api/ai/program_provider';
import type { PlanningCapability, AgentResult } from '../../api/ai/planner_agent';
import {
  AcademicDecisionAgent,
  type AcademicDecisionDeps,
  type AcademicDecisionRequest,
} from '../../api/ai/academic_decision_agent';
import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import {
  clarifyRequest,
  applyClarificationLoopAnswers,
  runClarificationLoopStep,
  type ClarificationLoopAnswer,
} from '../../api/ai/academic_clarification_loop';

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

class FakeProgramProvider implements ProgramProvider {
  constructor(private model: ConstraintModel = CLEAN_MODEL, private board: Record<string, unknown> | null = {}) {}
  parseProgramId = jest.fn((id: string) => ({ base: id, year: 2027 }));
  loadBoard = jest.fn(async (_programId: string, _dbUrl?: string) => this.board);
  buildModel = jest.fn((_boardJson: any, _opts: any = {}) => this.model);
}

function fakePlanning(result: AgentResult): ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock } {
  const run = jest.fn(async () => result);
  const factory = ((_req: AcademicDecisionRequest) => ({ run })) as unknown as ((req: AcademicDecisionRequest) => PlanningCapability) & { run: jest.Mock };
  factory.run = run;
  return factory;
}

const PLANNED_RESULT: AgentResult = {
  finalState: { semesters: { semester_a: ['c1'] } },
  trace: [{ type: 'ADD_COURSE', courseId: 'c1', semesterId: 'semester_a' }],
  gaps: [],
};

function makeRequest(overrides: Partial<AcademicDecisionRequest> = {}): AcademicDecisionRequest {
  return { programId: 'prog-1', ...overrides };
}

const ALL_FIVE_IDS = [
  'completed_courses',
  'current_courses',
  'excluded_courses',
  'max_weekly_hours',
  'track_or_focus',
];

const ALL_ANSWERS: ClarificationLoopAnswer[] = [
  { questionId: 'completed_courses', value: ['c1'] },
  { questionId: 'current_courses', value: ['c2'] },
  { questionId: 'excluded_courses', value: ['c3'] },
  { questionId: 'max_weekly_hours', value: 18 },
  { questionId: 'track_or_focus', value: 'systems' },
];

// ── clarifyRequest ────────────────────────────────────────────────────────────

describe('clarifyRequest', () => {
  test('a request missing all clarification fields produces the five stable questions', async () => {
    const result = await clarifyRequest(makeRequest());
    expect(result.needsClarification).toBe(true);
    expect(result.questions.map((q) => q.id)).toEqual(ALL_FIVE_IDS);
  });
});

// ── applyClarificationLoopAnswers + clarifyRequest round trip ─────────────────

describe('applyClarificationLoopAnswers + clarifyRequest round trip', () => {
  test('applying answers for all five questions produces an updated request', () => {
    const { request, invalidAnswers } = applyClarificationLoopAnswers(makeRequest(), ALL_ANSWERS);
    expect(invalidAnswers).toEqual([]);
    expect(request.buildModelOptions?.completedCourseIds).toEqual(['c1']);
    expect(request.currentCourseIds).toEqual(['c2']);
    expect(request.buildModelOptions?.disallowedCourseIds).toEqual(['c3']);
    expect(request.buildModelOptions?.maxHoursPerSemester).toBe(18);
    expect(request.track).toBe('systems');
  });

  test('re-running clarification on the updated request produces needsClarification: false', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), ALL_ANSWERS);
    const result = await clarifyRequest(request);
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toEqual([]);
  });

  test('applying only completed_courses removes only the completed_courses question', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'completed_courses', value: ['c1'] },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('applying only current_courses removes only the current_courses question', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'current_courses', value: ['c2'] },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('applying only excluded_courses removes only the excluded_courses question', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'excluded_courses', value: ['c3'] },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('applying only max_weekly_hours removes only the max_weekly_hours question', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'max_weekly_hours', value: 18 },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'track_or_focus',
    ]);
  });

  test('applying only track_or_focus removes only the track_or_focus question', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'track_or_focus', value: 'systems' },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
    ]);
  });

  test('partial answers preserve unanswered questions in deterministic order', async () => {
    const { request } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'excluded_courses', value: ['c3'] },
      { questionId: 'track_or_focus', value: 'systems' },
    ]);
    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'max_weekly_hours',
    ]);
  });
});

// ── Invalid answers ────────────────────────────────────────────────────────────

describe('applyClarificationLoopAnswers — invalid answers', () => {
  test('an invalid max_weekly_hours value is surfaced and does not update the request', async () => {
    const { request, invalidAnswers } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'max_weekly_hours', value: 'a lot' },
    ]);
    expect(invalidAnswers).toEqual([
      { questionId: 'max_weekly_hours', reason: expect.stringContaining('max_weekly_hours') },
    ]);
    expect(request.buildModelOptions?.maxHoursPerSemester).toBeUndefined();

    const result = await clarifyRequest(request);
    expect(result.questions.map((q) => q.id)).toContain('max_weekly_hours');
  });

  test('a mix of valid and invalid answers applies only the valid ones and reports the invalid one', () => {
    const { request, invalidAnswers } = applyClarificationLoopAnswers(makeRequest(), [
      { questionId: 'completed_courses', value: ['c1'] },
      { questionId: 'excluded_courses', value: 'not-an-array' },
    ]);
    expect(request.buildModelOptions?.completedCourseIds).toEqual(['c1']);
    expect(request.buildModelOptions?.disallowedCourseIds).toBeUndefined();
    expect(invalidAnswers).toEqual([
      { questionId: 'excluded_courses', reason: expect.stringContaining('excluded_courses') },
    ]);
  });
});

// ── Non-mutation ───────────────────────────────────────────────────────────────

describe('applyClarificationLoopAnswers — does not mutate the original request', () => {
  test('the original request is unchanged after applying answers', () => {
    const req = makeRequest({ buildModelOptions: { completedCourseIds: ['c0'] } });
    const snapshot = JSON.parse(JSON.stringify(req));
    applyClarificationLoopAnswers(req, ALL_ANSWERS);
    expect(req).toEqual(snapshot);
  });
});

// ── No divergent ids ───────────────────────────────────────────────────────────

describe('clarifyRequest ids match the loop harness answer contract — no divergent ids', () => {
  test('applying an answer for every id clarifyRequest produced fully resolves clarification', async () => {
    const first = await clarifyRequest(makeRequest());
    const answers: ClarificationLoopAnswer[] = first.questions.map((q) => {
      switch (q.id) {
        case 'completed_courses':
        case 'current_courses':
        case 'excluded_courses':
          return { questionId: q.id, value: ['x'] };
        case 'max_weekly_hours':
          return { questionId: q.id, value: 10 };
        default:
          return { questionId: q.id, value: 'design' };
      }
    });
    const { request, invalidAnswers } = applyClarificationLoopAnswers(makeRequest(), answers);
    expect(invalidAnswers).toEqual([]);

    const second = await clarifyRequest(request);
    expect(second.needsClarification).toBe(false);
  });
});

// ── No UI/LLM/Supabase/production wiring ───────────────────────────────────────

describe('academic_clarification_loop.ts — no UI/LLM/Supabase/production imports', () => {
  test('import statements stay within the AcademicDecisionAgent capability stack', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'api', 'ai', 'academic_clarification_loop.ts'),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n')
      .toLowerCase();
    const forbidden = [
      'react',
      'supabase',
      'localstorage',
      'document.',
      "from 'ai'",
      'generate-plan',
      'planner-run',
      'plannerworker',
      'planner_agent',
      'llm_explainer',
    ];
    for (const token of forbidden) {
      expect(importLines).not.toContain(token);
    }
  });
});

// ── Integration: runClarificationLoopStep with a fake AcademicDecisionAgent ──

describe('runClarificationLoopStep — integration with a fake AcademicDecisionAgent', () => {
  test('non-blocking clarification returns questions while planning still delegates', async () => {
    const planning = fakePlanning(PLANNED_RESULT);
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(),
      planning,
      clarification: new DeterministicClarificationCapability(),
    };
    const agent = new AcademicDecisionAgent(deps);
    const step = await runClarificationLoopStep(agent, makeRequest());

    expect(planning.run).toHaveBeenCalledTimes(1);
    expect(step.blocked).toBe(false);
    expect(step.needsClarification).toBe(true);
    expect(step.questions.map((q) => q.id)).toEqual(ALL_FIVE_IDS);
  });

  test('with blockOnMissingCriticalInputs: true, the first run blocks and returns questions', async () => {
    const planning = fakePlanning(PLANNED_RESULT);
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(),
      planning,
      clarification: new DeterministicClarificationCapability(),
    };
    const agent = new AcademicDecisionAgent(deps);
    const step = await runClarificationLoopStep(agent, makeRequest({ blockOnMissingCriticalInputs: true }));

    expect(planning.run).not.toHaveBeenCalled();
    expect(step.blocked).toBe(true);
    expect(step.agentResult).toBeUndefined();
    expect(step.questions).toContainEqual(expect.objectContaining({ id: 'completed_courses', critical: true }));
    expect(step.questions).toContainEqual(expect.objectContaining({ id: 'excluded_courses', critical: true }));
  });

  test('after applying critical answers, the follow-up run no longer blocks for those fields', async () => {
    const planning = fakePlanning(PLANNED_RESULT);
    const deps: AcademicDecisionDeps = {
      programProvider: new FakeProgramProvider(),
      planning,
      clarification: new DeterministicClarificationCapability(),
    };
    const agent = new AcademicDecisionAgent(deps);
    const req = makeRequest({ blockOnMissingCriticalInputs: true });

    const first = await runClarificationLoopStep(agent, req);
    expect(first.blocked).toBe(true);

    const { request: updated } = applyClarificationLoopAnswers(req, [
      { questionId: 'completed_courses', value: ['c1'] },
      { questionId: 'excluded_courses', value: [] },
    ]);
    const second = await runClarificationLoopStep(agent, updated);

    expect(planning.run).toHaveBeenCalledTimes(1);
    expect(second.blocked).toBe(false);
    expect(second.agentResult).toEqual(PLANNED_RESULT);
  });
});

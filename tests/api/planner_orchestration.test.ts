/**
 * Phase 2b (AcademicDecisionAgent track) — tests for
 * api/ai/planner_orchestration.ts.
 *
 * runPlanningOrchestration is the transport-agnostic entry point: it takes a
 * program id + user context in, and returns an AgentResult out, with no
 * knowledge of HTTP/Vercel/UI. It composes ProgramProvider (Phase 2) with the
 * existing PlannerAgent/PolicyProvider/capability stack (Phase 3/4) — pure
 * composition, no behavior invented. Not wired into generate-plan.ts or
 * planner-run.ts.
 */

jest.mock('../../api/board', () => ({
  parseProgramVersionId: jest.requireActual('../../api/board').parseProgramVersionId,
  queryBoardJson: jest.fn(),
}));
jest.mock('../../api/ai/board_loader', () => ({
  loadLocalBoardJson: jest.fn(),
}));

import {
  runPlanningOrchestration,
  type OrchestrationRequest,
  type OrchestrationDeps,
} from '../../api/ai/planner_orchestration';
import type { ProgramProvider } from '../../api/ai/program_provider';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { emptyState, type PlanState, type PlannerMutation } from '../../api/ai/planner_types';
import { PlannerAgent } from '../../api/ai/planner_agent';
import type { SearchCapability, ValidationCapability } from '../../api/ai/planner_capabilities';
import { LocalSearchSimulationCapability } from '../../api/ai/plan_simulation';
import { queryBoardJson } from '../../api/board';
import { loadLocalBoardJson } from '../../api/ai/board_loader';

const mockQueryBoardJson = queryBoardJson as jest.Mock;
const mockLoadLocalBoardJson = loadLocalBoardJson as jest.Mock;

// Small, fast board — mirrors the fixture already used in planner-run.test.ts.
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

function noopSearch(): SearchCapability<PlanState, PlannerMutation> {
  return { search: (s) => ({ finalState: s }) };
}

class FakeProgramProvider implements ProgramProvider {
  parseProgramId = jest.fn((id: string) => ({ base: id, year: 2027 }));
  loadBoard = jest.fn(async (_programId: string, _dbUrl?: string): Promise<Record<string, unknown> | null> => BOARD);
  buildModel = jest.fn((boardJson: any, opts: any = {}) => buildConstraintModel(boardJson, opts));
}

beforeEach(() => {
  mockQueryBoardJson.mockReset();
  mockLoadLocalBoardJson.mockReset();
});

describe('runPlanningOrchestration — happy path', () => {
  it('returns the same AgentResult as constructing PlannerAgent directly with the loaded model', async () => {
    const model = buildConstraintModel(BOARD, {});
    const initialState = emptyState(model.knownSemesterIds);
    const expected = await new PlannerAgent({ model, initialState, search: noopSearch() }).run();

    const provider = new FakeProgramProvider();
    const req: OrchestrationRequest = { programId: 'whatever_2027' };
    const deps: OrchestrationDeps = { programProvider: provider, search: noopSearch() };
    const actual = await runPlanningOrchestration(req, deps);

    expect(actual).toEqual(expected);
  });
});

describe('runPlanningOrchestration — board not found', () => {
  it('rejects with a clear error and never invokes search', async () => {
    const provider = new FakeProgramProvider();
    provider.loadBoard = jest.fn(async (_programId: string, _dbUrl?: string): Promise<Record<string, unknown> | null> => null);
    const searchFn = jest.fn(() => ({ finalState: emptyState([]) }));
    const search: SearchCapability<PlanState, PlannerMutation> = { search: searchFn };

    await expect(
      runPlanningOrchestration({ programId: 'unknown_9999' }, { programProvider: provider, search }),
    ).rejects.toThrow(/unknown_9999/);
    expect(searchFn).not.toHaveBeenCalled();
  });
});

describe('runPlanningOrchestration — default ProgramProvider', () => {
  it('uses TauProgramProvider (real queryBoardJson/loadLocalBoardJson) when programProvider is omitted', async () => {
    mockQueryBoardJson.mockResolvedValue(BOARD);
    const result = await runPlanningOrchestration(
      { programId: 'mechanical_engineering_2027', dbUrl: 'postgres://fake' },
      { search: noopSearch() },
    );
    expect(mockQueryBoardJson).toHaveBeenCalledWith('postgres://fake', 'mechanical_engineering', 2027);
    expect(mockLoadLocalBoardJson).not.toHaveBeenCalled();
    expect(result.finalState).toBeDefined();
  });
});

describe('runPlanningOrchestration — preferences mapping fidelity', () => {
  it('forwards every OrchestrationRequest field to provider.buildModel unchanged (no re-derivation)', async () => {
    const provider = new FakeProgramProvider();
    const req: OrchestrationRequest = {
      programId: 'whatever_2027',
      completedCourseIds: ['A'],
      wantedCourseIds: ['B'],
      unwantedCourseIds: ['C'],
      disallowedCourseIds: ['D'],
      pinnedCourseIds: ['E'],
      maxHoursPerSemester: 22,
      priorHours: 40,
      overloadAccepted: true,
      overloadConfirmedAt: 123,
    };
    await runPlanningOrchestration(req, { programProvider: provider, search: noopSearch() });

    expect(provider.buildModel).toHaveBeenCalledWith(BOARD, {
      completedCourseIds: ['A'],
      wantedCourseIds: ['B'],
      unwantedCourseIds: ['C'],
      disallowedCourseIds: ['D'],
      pinnedCourseIds: ['E'],
      maxHoursPerSemester: 22,
      priorHours: 40,
      overloadAccepted: true,
      overloadConfirmedAt: 123,
    });
  });
});

describe('runPlanningOrchestration — optional deps threaded through unchanged', () => {
  it('passes maxSteps/beamWidth to the search capability opts', async () => {
    let capturedOpts: { maxSteps: number; width?: number } | undefined;
    const search: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, _deps, opts) => { capturedOpts = opts; return { finalState: s }; },
    };
    const provider = new FakeProgramProvider();
    await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search, maxSteps: 77, beamWidth: 9 },
    );
    expect(capturedOpts).toEqual({ maxSteps: 77, width: 9 });
  });

  it('threads an ExplanationCapability result into AgentResult.rationale_he', async () => {
    const explanation = { explain: jest.fn().mockResolvedValue('הסבר') };
    const provider = new FakeProgramProvider();
    const result = await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search: noopSearch(), explanation },
    );
    expect(explanation.explain).toHaveBeenCalled();
    expect(result.rationale_he).toBe('הסבר');
  });
});

describe('runPlanningOrchestration — optional PlanSimulationCapability (additive, drift-free)', () => {
  it('is byte-identical to before this dep existed when simulation is omitted', async () => {
    const provider = new FakeProgramProvider();
    const withoutDep = await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search: noopSearch() },
    );
    const provider2 = new FakeProgramProvider();
    const explicitlyUndefined = await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider2, search: noopSearch(), simulation: undefined },
    );
    expect(explicitlyUndefined).toEqual(withoutDep);
  });

  it('calls simulation.simulate with the SAME model instance Plan built, and returns its result', async () => {
    let capturedModel: unknown;
    const simulatedResult = { finalState: emptyState(['y1s1', 'y1s2']), trace: [], gaps: [] };
    const simulation = {
      simulate: jest.fn(async (req: { result: unknown; model: unknown }) => {
        capturedModel = req.model;
        return simulatedResult;
      }),
    };
    const provider = new FakeProgramProvider();
    const result = await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search: noopSearch(), simulation },
    );

    expect(simulation.simulate).toHaveBeenCalledTimes(1);
    const call = simulation.simulate.mock.calls[0][0] as { result: { finalState: unknown } };
    expect(call.result.finalState).toBeDefined();
    // Same model instance provider.buildModel returned for this run — not a second, independently-built model.
    expect(capturedModel).toBe(provider.buildModel.mock.results[0].value);
    expect(result).toBe(simulatedResult);
  });

  it('composes end-to-end with the real LocalSearchSimulationCapability, still returning a valid AgentResult', async () => {
    const provider = new FakeProgramProvider();
    const result = await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search: noopSearch(), simulation: new LocalSearchSimulationCapability() },
    );
    expect(result.finalState).toBeDefined();
    expect(Array.isArray(result.trace)).toBe(true);
  });

  it('threads deps.validation into simulation.simulate — the same ValidationCapability PlannerAgent itself received', async () => {
    const validation: ValidationCapability = { validateState: jest.fn(() => ({ valid: true })) };
    const simulation = { simulate: jest.fn(async (req: { result: import('../../api/ai/planner_agent').AgentResult }) => req.result) };
    const provider = new FakeProgramProvider();
    await runPlanningOrchestration(
      { programId: 'whatever_2027' },
      { programProvider: provider, search: noopSearch(), simulation, validation },
    );

    expect(simulation.simulate).toHaveBeenCalledTimes(1);
    const call = simulation.simulate.mock.calls[0][0] as { validation?: unknown };
    expect(call.validation).toBe(validation);
  });
});

describe('runPlanningOrchestration — simulation honors the same ValidationCapability PlannerAgent used', () => {
  // A board with one wanted, unconstrained elective — deliberately NOT placed
  // by noopSearch, so LocalSearchSimulationCapability has an improving
  // candidate available (mirrors plan_simulation.test.ts's own "finds a
  // strictly-improving candidate" fixture).
  const ELECTIVE_BOARD = {
    semesters: [
      { semester_id: 'y1s1', courses: [
        { course_id: 'ELEC', name_he: 'בחירה', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['y1s1', 'y1s2'], prerequisites: [] },
      ] },
      { semester_id: 'y1s2', courses: [] },
    ],
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 0, categories: [] },
    },
  };

  class FakeElectiveProvider implements ProgramProvider {
    parseProgramId = jest.fn((id: string) => ({ base: id, year: 2027 }));
    loadBoard = jest.fn(async (): Promise<Record<string, unknown> | null> => ELECTIVE_BOARD);
    buildModel = jest.fn((boardJson: any, opts: any = {}) => buildConstraintModel(boardJson, opts));
  }

  it('(control) with no custom validator, simulation places the higher-scoring wanted elective', async () => {
    const provider = new FakeElectiveProvider();
    const result = await runPlanningOrchestration(
      { programId: 'whatever_2027', wantedCourseIds: ['ELEC'] },
      { programProvider: provider, search: noopSearch(), simulation: new LocalSearchSimulationCapability() },
    );
    expect(Object.values(result.finalState.semesters).flat()).toContain('ELEC');
  });

  it('never lets simulation apply a candidate the injected ValidationCapability rejects, even though it scores higher', async () => {
    const rejectElective: ValidationCapability = {
      validateState: (state: unknown) => {
        const placed = Object.values((state as PlanState).semesters).flat();
        return placed.includes('ELEC') ? { valid: false, reason: 'blocked in test' } : { valid: true };
      },
    };
    const provider = new FakeElectiveProvider();
    const result = await runPlanningOrchestration(
      { programId: 'whatever_2027', wantedCourseIds: ['ELEC'] },
      {
        programProvider: provider,
        search: noopSearch(),
        simulation: new LocalSearchSimulationCapability(),
        validation: rejectElective,
      },
    );
    expect(Object.values(result.finalState.semesters).flat()).not.toContain('ELEC');
  });
});

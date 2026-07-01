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
import type { SearchCapability } from '../../api/ai/planner_capabilities';
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

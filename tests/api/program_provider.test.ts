/**
 * Phase 2 — tests for api/ai/program_provider.ts.
 *
 * ProgramProvider is the generic interface owning "how do I get a program's
 * board_json and turn it into a ConstraintModel". TauProgramProvider is its
 * first implementation: a verbatim delegation to the existing
 * parseProgramVersionId / queryBoardJson / loadLocalBoardJson / buildConstraintModel
 * pipeline (the same DB-then-local-file fallback order generate-plan.ts uses
 * inline today). No behavior change — this is pure extraction, not wired into
 * any production path yet.
 */

jest.mock('../../api/board', () => ({
  parseProgramVersionId: jest.requireActual('../../api/board').parseProgramVersionId,
  queryBoardJson: jest.fn(),
}));
jest.mock('../../api/ai/board_loader', () => ({
  loadLocalBoardJson: jest.fn(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { TauProgramProvider, type ProgramProvider } from '../../api/ai/program_provider';
import { queryBoardJson } from '../../api/board';
import { loadLocalBoardJson } from '../../api/ai/board_loader';
import { buildConstraintModel } from '../../api/ai/planner_model';

const mockQueryBoardJson = queryBoardJson as jest.Mock;
const mockLoadLocalBoardJson = loadLocalBoardJson as jest.Mock;

const REAL_BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json'), 'utf8'),
);

// A second, made-up program — proves buildModel is not ME-specific, mirroring
// the CS_BOARD fixture already used in planner_model.test.ts.
const CS_BOARD = {
  semesters: [
    { semester_id: 'year_2_semester_a', courses: [
      { course_id: 'CS-M1', name_he: 'אלגוריתמים', weekly_hours: 5, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_2_semester_a'], prerequisites: [] },
    ] },
    { semester_id: 'year_2_semester_b', courses: [] },
  ],
  metadata: {
    completed_course_ids: ['CS-DONE'],
    program_requirements_categories: {
      total_required_hours: 120,
      program_name_he: 'מדעי המחשב',
      categories: [
        { category_id: 'theory', name_he: 'תאוריה', min_courses: 1, course_ids: ['CS-T1', 'CS-T2'] },
        { category_id: 'open', name_he: 'חופשי', min_courses: 0, course_ids: ['CS-O1'] },
      ],
    },
  },
};

beforeEach(() => {
  mockQueryBoardJson.mockReset();
  mockLoadLocalBoardJson.mockReset();
});

describe('TauProgramProvider.parseProgramId', () => {
  const provider: ProgramProvider = new TauProgramProvider();

  it('parses a well-formed program_id the same way parseProgramVersionId does', () => {
    expect(provider.parseProgramId('mechanical_engineering_2027')).toEqual({ base: 'mechanical_engineering', year: 2027 });
  });

  it('returns null for a malformed program_id', () => {
    expect(provider.parseProgramId('not-a-valid-id')).toBeNull();
  });
});

describe('TauProgramProvider.loadBoard', () => {
  const provider: ProgramProvider = new TauProgramProvider();

  it('DB hit: returns queryBoardJson result and does not touch the local loader', async () => {
    mockQueryBoardJson.mockResolvedValue({ semesters: [], metadata: {} });
    const board = await provider.loadBoard('mechanical_engineering_2027', 'postgres://fake');
    expect(mockQueryBoardJson).toHaveBeenCalledWith('postgres://fake', 'mechanical_engineering', 2027);
    expect(board).toEqual({ semesters: [], metadata: {} });
    expect(mockLoadLocalBoardJson).not.toHaveBeenCalled();
  });

  it('DB miss (null): falls back to the local loader and returns its result', async () => {
    mockQueryBoardJson.mockResolvedValue(null);
    mockLoadLocalBoardJson.mockReturnValue({ semesters: ['local'], metadata: {} });
    const board = await provider.loadBoard('mechanical_engineering_2027', 'postgres://fake');
    expect(mockLoadLocalBoardJson).toHaveBeenCalledWith('mechanical_engineering_2027');
    expect(board).toEqual({ semesters: ['local'], metadata: {} });
  });

  it('DB throws: falls back to the local loader instead of rejecting', async () => {
    mockQueryBoardJson.mockRejectedValue(new Error('connection refused'));
    mockLoadLocalBoardJson.mockReturnValue({ semesters: ['local'], metadata: {} });
    const board = await provider.loadBoard('mechanical_engineering_2027', 'postgres://fake');
    expect(board).toEqual({ semesters: ['local'], metadata: {} });
  });

  it('no dbUrl: goes straight to the local loader, never calls queryBoardJson', async () => {
    mockLoadLocalBoardJson.mockReturnValue({ semesters: ['local'], metadata: {} });
    const board = await provider.loadBoard('mechanical_engineering_2027', undefined);
    expect(mockQueryBoardJson).not.toHaveBeenCalled();
    expect(mockLoadLocalBoardJson).toHaveBeenCalledWith('mechanical_engineering_2027');
    expect(board).toEqual({ semesters: ['local'], metadata: {} });
  });

  it('malformed program_id with a dbUrl: skips the DB query entirely, goes to local loader', async () => {
    mockLoadLocalBoardJson.mockReturnValue(null);
    const board = await provider.loadBoard('not-a-valid-id', 'postgres://fake');
    expect(mockQueryBoardJson).not.toHaveBeenCalled();
    expect(mockLoadLocalBoardJson).toHaveBeenCalledWith('not-a-valid-id');
    expect(board).toBeNull();
  });

  it('neither DB nor local has it: returns null', async () => {
    mockQueryBoardJson.mockResolvedValue(null);
    mockLoadLocalBoardJson.mockReturnValue(null);
    const board = await provider.loadBoard('mechanical_engineering_2027', 'postgres://fake');
    expect(board).toBeNull();
  });
});

describe('TauProgramProvider.buildModel', () => {
  const provider: ProgramProvider = new TauProgramProvider();

  it('delegates verbatim to buildConstraintModel for a real board (ME-2027)', () => {
    const opts = { completedCourseIds: ['SOME_COURSE'], maxHoursPerSemester: 22 };
    const viaProvider = provider.buildModel(REAL_BOARD, opts);
    const viaDirect = buildConstraintModel(REAL_BOARD, opts);
    expect(viaProvider).toEqual(viaDirect);
  });

  it('delegates verbatim to buildConstraintModel for a made-up, non-ME program (proves program-agnosticism)', () => {
    const viaProvider = provider.buildModel(CS_BOARD, {});
    const viaDirect = buildConstraintModel(CS_BOARD, {});
    expect(viaProvider).toEqual(viaDirect);
  });

  it('defaults opts to {} when omitted, matching buildConstraintModel default param', () => {
    const viaProvider = provider.buildModel(CS_BOARD);
    const viaDirect = buildConstraintModel(CS_BOARD);
    expect(viaProvider).toEqual(viaDirect);
  });
});

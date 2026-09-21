/**
 * The committed board the server returns carries the degree requirements recomputed for THAT plan,
 * so the progress badge follows manual edits instead of showing the base board's numbers forever.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn((programId: string) => BOARDS[programId] ?? null) }));

import editBoard from '../../api/ai/edit-board';
import applyPlan from '../../api/ai/apply-plan';
import { getAcademicContextStore, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const OWNER = 'o'.repeat(43);
const WITH = 'req_program_2027';
const WITHOUT = 'no_snapshot_2027';
const A = 'year_3_semester_a';
const B = 'year_3_semester_b';

const repositoryCourse = {
  course_id: 'C1', name_he: 'קורס ליבה', weekly_hours: 3, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective', offered_semesters: [A, B], prerequisites: [],
};
const boardWith = (base: boolean) => ({
  semesters: [{ semester_id: A, courses: [] }, { semester_id: B, courses: [] }],
  metadata: {
    completed_course_ids: [],
    ...(base ? { program_requirements_validation: { valid: false } } : {}),
    program_requirements_categories: {
      total_required_hours: 10, core_courses_total_min: 1, mandatory_course_ids: [],
      categories: [{
        category_id: 'core_a', name_he: 'ליבה', min_courses: 1, needs_review: false, is_core: true, course_ids: ['C1'],
      }],
    },
    program_repository_courses: [repositoryCourse],
  },
});
const BOARDS: Record<string, unknown> = { [WITH]: boardWith(true), [WITHOUT]: boardWith(false) };

const makeRes = () => ({
  statusCode: 0, _body: undefined as any, _headers: {} as Record<string, unknown>, headersSent: false,
  setHeader(this: any, key: string, value: unknown) { this._headers[key] = value; return this; },
  getHeader(this: any, key: string) { return this._headers[key]; },
  status(this: any, code: number) { this.statusCode = code; return this; },
  json(this: any, body: unknown) { this._body = body; this.headersSent = true; return this; },
});
const cookie = { cookie: `${SESSION_COOKIE}=${OWNER}` };
const edit = async (programId: string, body: Record<string, unknown>) => {
  const res: any = makeRes();
  await editBoard({ method: 'POST', headers: cookie, body: { program_id: programId, course_id: 'C1', academic_status_digest: 'as_current', ...body } } as any, res);
  return res;
};
const add = (programId: string) => edit(programId, {
  operation: 'add_course', expected_board_version: null, operation_id: 'edit_0123456789abcdef', semester_id: A,
});
const remove = (programId: string) => edit(programId, {
  operation: 'remove_course', expected_board_version: 'bv_1', operation_id: 'remove_0123456789abcdef',
});
const committed = async (programId: string) => {
  const res: any = makeRes();
  await applyPlan({ method: 'GET', headers: cookie, query: { program_id: programId } } as any, res);
  return res;
};

beforeEach(async () => {
  process.env.AI_DEV_MODE = 'true';
  resetApplyRuntime();
  for (const programId of [WITH, WITHOUT]) {
    await getAcademicContextStore().put({
      ownerId: OWNER, programId, digest: 'as_current', personalStatus: {},
      planContext: { semesters: [], personal_status: {} }, preferences: { disallowed_course_ids: [] },
    });
  }
});
afterAll(() => { delete process.env.AI_DEV_MODE; });

describe('committed board requirements', () => {
  test('adding a course recomputes hours and category coverage for the new plan', async () => {
    const res = await add(WITH);
    expect(res.statusCode).toBe(200);
    const requirements = res._body.board.requirements_validation;
    expect(requirements).toEqual(expect.objectContaining({
      planned_hours: 3, remaining_hours: 7, total_required_hours: 10,
      core_courses_selected: 1, core_courses_satisfied: true, valid: true, warnings: [],
    }));
    expect(requirements.category_results[0]).toEqual(expect.objectContaining({
      category_id: 'core_a', selected_count: 1, satisfied: true,
    }));
  });

  test('removing it again brings the numbers back down', async () => {
    await add(WITH);
    const res = await remove(WITH);
    expect(res.statusCode).toBe(200);
    expect(res._body.board.requirements_validation).toEqual(expect.objectContaining({
      planned_hours: 0, remaining_hours: 10, core_courses_selected: 0, core_courses_satisfied: false, valid: false,
    }));
  });

  test('the committed board read after a reload returns the same recomputed numbers', async () => {
    await add(WITH);
    const res = await committed(WITH);
    expect(res._body.board.requirements_validation).toEqual(expect.objectContaining({ planned_hours: 3, valid: true }));
  });

  test('a program that ships no base snapshot gets no requirements block', async () => {
    const res = await add(WITHOUT);
    expect(res.statusCode).toBe(200);
    expect(res._body.board).not.toHaveProperty('requirements_validation');
  });
});

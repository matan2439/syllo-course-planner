jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));

import handler from '../../api/ai/edit-board';
import { getAcademicContextStore, getBoardRepository, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const OWNER = 'o'.repeat(43);
const OTHER = 'x'.repeat(43);
const PROGRAM = 'test_program_2027';
const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const BOARD = {
  semesters: [{ semester_id: A, courses: [] }, { semester_id: B, courses: [] }],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 3, categories: [] },
    program_repository_courses: [{
      course_id: 'C1', name_he: 'קורס', weekly_hours: 3, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [A, B], prerequisites: [],
    }],
  },
};

const makeRes = () => ({
  statusCode: 0, _body: undefined as any, _headers: {} as Record<string, unknown>, headersSent: false,
  setHeader(this: any, key: string, value: unknown) { this._headers[key] = value; return this; },
  getHeader(this: any, key: string) { return this._headers[key]; },
  status(this: any, code: number) { this.statusCode = code; return this; },
  json(this: any, body: unknown) { this._body = body; this.headersSent = true; return this; },
});
const body = (over: Record<string, unknown> = {}) => ({
  operation: 'add_course', program_id: PROGRAM, expected_board_version: null,
  operation_id: 'edit_0123456789abcdef', course_id: 'C1', semester_id: A,
  academic_status_digest: 'as_current', ...over,
});
const removeBody = (over: Record<string, unknown> = {}) => ({
  operation: 'remove_course', program_id: PROGRAM, expected_board_version: 'bv_1',
  operation_id: 'remove_0123456789abcdef', course_id: 'C1',
  academic_status_digest: 'as_current', ...over,
});
const call = async (owner: string, requestBody: Record<string, unknown>) => {
  const res: any = makeRes();
  await handler({ method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${owner}` }, body: requestBody } as any, res);
  return res;
};

beforeEach(async () => {
  process.env.AI_DEV_MODE = 'true';
  resetApplyRuntime();
  await getAcademicContextStore().put({
    ownerId: OWNER, programId: PROGRAM, digest: 'as_current', personalStatus: {},
    planContext: { semesters: [], personal_status: {} }, preferences: { disallowed_course_ids: [] },
  });
});
afterAll(() => { delete process.env.AI_DEV_MODE; });

describe('R2 — POST /api/ai/edit-board', () => {
  test('commits the server-prepared course and mints one board version', async () => {
    const res = await call(OWNER, body());
    expect(res.statusCode).toBe(200);
    expect(res._body).toEqual(expect.objectContaining({ ok: true, replayed: false, operation_id: 'edit_0123456789abcdef' }));
    expect(res._body.board.version).toBe('bv_1');
    expect(res._body.board.semesters[0].courseIds).toEqual(['C1']);
  });

  test('identical retry replays without a second mutation', async () => {
    const first = await call(OWNER, body());
    const replay = await call(OWNER, body());
    expect(first._body.board.version).toBe('bv_1');
    expect(replay._body).toEqual(expect.objectContaining({ ok: true, replayed: true }));
    expect((await getBoardRepository().load(OWNER, PROGRAM))?.version).toBe('bv_1');
  });

  test('rejects stale, fabricated and cross-session requests without mutation', async () => {
    expect((await call(OWNER, body({ course_id: 'FAKE' })))._body.code).toBe('UNKNOWN_COURSE');
    expect((await call(OTHER, body()))._body.code).toBe('ACADEMIC_CONTEXT_NOT_FOUND');
    await call(OWNER, body());
    const stale = await call(OWNER, body({ operation_id: 'edit_stale_1234567890', course_id: 'C1' }));
    expect(stale._body.code).toBe('BOARD_VERSION_CONFLICT');
  });

  test('strict parsing rejects a browser-supplied plan and unsupported methods', async () => {
    expect((await call(OWNER, body({ semesters: [] })))._body.code).toBe('INVALID_REQUEST');
    const res: any = makeRes();
    await handler({ method: 'DELETE', headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });

  test('removes a present course with CAS and rejects an absent one', async () => {
    await call(OWNER, body());
    const removed = await call(OWNER, removeBody());
    expect(removed.statusCode).toBe(200);
    expect(removed._body.board).toEqual(expect.objectContaining({ version: 'bv_2' }));
    expect(removed._body.board.semesters[0].courseIds).toEqual([]);

    const absent = await call(OWNER, removeBody({
      expected_board_version: 'bv_2', operation_id: 'remove_absent_123456789',
    }));
    expect(absent._body.code).toBe('COURSE_NOT_PRESENT');
  });

  test('moves a present course while the server resolves its source semester', async () => {
    await call(OWNER, body());
    const moved = await call(OWNER, {
      operation: 'move_course', program_id: PROGRAM, expected_board_version: 'bv_1',
      operation_id: 'move_0123456789abcdef', course_id: 'C1',
      semester_id: B, academic_status_digest: 'as_current',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved._body.board.version).toBe('bv_2');
    expect(moved._body.board.semesters).toEqual(expect.arrayContaining([
      { semesterId: A, courseIds: [] },
      { semesterId: B, courseIds: ['C1'] },
    ]));
  });
});

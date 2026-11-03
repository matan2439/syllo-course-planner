jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
import handler from '../../api/ai/student-workspace';
import { getAcademicContextStore, getBoardRepository, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { MemoryStudentWorkspaceStore, installStudentWorkspaceStoreForTests } from '../../api/ai/student_workspace_store';
import { SESSION_COOKIE } from '../../api/ai/session_owner';
import * as authSession from '../../api/ai/auth_session';
import { createEmptyBiddingDraft } from '../../shared/planner/bidding';
const OWNER = 'w'.repeat(43), OTHER = 'x'.repeat(43), PROGRAM = 'test_program_2027', A = 'year_3_semester_a';
const BOARD = { semesters: [{ semester_id: A, courses: [] }], metadata: {
  program_requirements_categories: { total_required_hours: 3, categories: [] },
  program_repository_courses: [{ course_id: 'C1', name_he: 'קורס', weekly_hours: 3,
    placement_policy: 'elective', offered_semesters: [A], prerequisites: [], is_mandatory: false }],
} };
const plan = { id: 'plan_12345678', name: 'תוכנית ראשונה', notes: '', catalogVersion: null, createdAt: 1, updatedAt: 1,
  semesters: [{ semesterId: A, courseIds: ['C1'] }], weeklySchedule: { termMapping: {}, selections: {}, freeDays: [] } };
let store: MemoryStudentWorkspaceStore;
const call = async (method: string, body: unknown, owner = OWNER, query: Record<string, string> = {}, headers: Record<string,string> = {}) => {
  const res: any = { statusCode: 0, body: undefined, headers: {},
    setHeader(key: string, value: unknown) { this.headers[key] = value; },
    getHeader(key: string) { return this.headers[key]; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  await handler({ method, headers: { cookie: `${SESSION_COOKIE}=${owner}`, ...headers }, query, body } as any, res);
  return res;
};
beforeEach(async () => {
  jest.restoreAllMocks();
  resetApplyRuntime(); store = new MemoryStudentWorkspaceStore(); installStudentWorkspaceStoreForTests(store);
  await getAcademicContextStore().put({ ownerId: OWNER, programId: PROGRAM, digest: 'as_current', personalStatus: {},
    planContext: { semesters: [], personal_status: {} }, preferences: {} });
});
afterAll(() => { installStudentWorkspaceStoreForTests(undefined); resetApplyRuntime(); });

test('strict writes are owner scoped and revision protected', async () => {
  expect((await call('POST', { scope: 'preferences', expected_revision: 0, data: { locale: 'en' } })).statusCode).toBe(200);
  expect((await call('POST', { scope: 'preferences', expected_revision: 0, data: { locale: 'he' } })).statusCode).toBe(409);
  expect((await call('GET', null, OTHER, { scope: 'preferences' })).body).toMatchObject({ revision: 0, data: { locale: 'he' } });
  expect((await call('POST', { scope: 'preferences', owner: OTHER, expected_revision: 1, data: { locale: 'he' } })).statusCode).toBe(400);
});

test('persists the selected numbered slot with its independent combination under workspace CAS', async () => {
  const second = { ...plan, id: 'plan_87654321', name: 'גיבוי', weeklySchedule: { ...plan.weeklySchedule, selections: { 'C1:2027:1': ['02'] } } };
  const data = { plans: [plan, second], activePlanId: second.id };
  const request = { scope: 'program', program_id: PROGRAM, expected_revision: 0, data };
  expect((await call('POST', request)).statusCode).toBe(200);
  expect((await call('GET', null, OWNER, { scope: 'program', program_id: PROGRAM })).body.data).toMatchObject(data);
  expect((await call('POST', { ...request, data: { ...data, activePlanId: plan.id } })).statusCode).toBe(409);
  expect((await call('GET', null, OTHER, { scope: 'program', program_id: PROGRAM })).body.data.plans).toEqual([]);
});
test('supports same-origin writes behind the trusted local proxy and rejects a foreign origin', async () => {
  const previous = process.env.AI_DEV_MODE; process.env.AI_DEV_MODE = 'true';
  try {
    const headers = { host: 'localhost:3012', 'x-forwarded-host': 'localhost:3011', origin: 'http://localhost:3011' };
    expect((await call('POST', { scope: 'preferences', expected_revision: 0, data: { locale: 'en' } }, OWNER, {}, headers)).statusCode).toBe(200);
    expect((await call('POST', { scope: 'preferences', expected_revision: 1, data: { locale: 'he' } }, OWNER, {}, { ...headers, origin: 'https://unrelated.example' })).statusCode).toBe(403);
  } finally { if (previous === undefined) delete process.env.AI_DEV_MODE; else process.env.AI_DEV_MODE = previous; }
});

test('round-trips saved searches, schedule constraints, exams and round archives without leaking owners', async () => {
  const biddingRounds = [{ id: 'round_12345678', savedAt: 123, draft: createEmptyBiddingDraft(2026) }];
  const extended = { ...plan, biddingRounds, weeklySchedule: { ...plan.weeklySchedule,
    busyTimes: [{ id: 'busy_12345678', day: 'א', start: '09:00', end: '12:00', label: 'עבודה', semesterId: A }],
    exams: [{ id: 'exam_12345678', courseId: 'C1', date: '2027-02-01', start: '09:00', end: '12:00', kind: 'a', semesterId: A }],
    calendarRange: { startDate: '2026-11-01', endDate: '2027-01-31' } } };
  const data = { plans: [extended], activePlanId: extended.id, biddingRounds,
    courseSearches: [{ id: 'search_12345678', name: 'בחירה בסמסטר א', query: 'קורס', filters: { semesters: ['a'], minGrade: 80 } }] };
  const written = await call('POST', { scope: 'program', program_id: PROGRAM, expected_revision: 0, data });
  expect(written.statusCode).toBe(200);
  expect((await call('GET', null, OWNER, { scope: 'program', program_id: PROGRAM })).body.data).toMatchObject(data);
  expect((await call('GET', null, OTHER, { scope: 'program', program_id: PROGRAM })).body.data.courseSearches ?? []).toEqual([]);
  const restored = await call('POST', { action: 'restore', program_id: PROGRAM, plan_id: extended.id, expected_board_version: null, idempotency_key: 'restore_extended_fields' });
  expect(restored.statusCode).toBe(200);
  expect(restored.body.weeklySchedule).toEqual(extended.weeklySchedule);
  expect(restored.body.biddingRounds).toEqual(biddingRounds);
});

test('rejects an impossible calendar date and private favorite-id snapshots before storage', async () => {
  const data = { plans: [{ ...plan, weeklySchedule: { ...plan.weeklySchedule, calendarRange: { startDate: '2027-02-30', endDate: '2027-03-01' } } }] };
  expect((await call('POST', { scope: 'program', program_id: PROGRAM, expected_revision: 0, data })).statusCode).toBe(400);
  expect((await call('POST', { scope: 'program', program_id: PROGRAM, expected_revision: 0, data: {
    courseSearches: [{ id: 'search_12345678', name: 'search', query: '', filters: { favoriteIds: ['C1'] } }],
  } })).statusCode).toBe(400);
  expect(await store.load(OWNER, `program:${PROGRAM}`)).toBeNull();
});
test('restores only own saved content through validation and CAS', async () => {
  await store.save(OWNER, `program:${PROGRAM}`, 0, { plans: [plan] });
  const request = { action: 'restore', program_id: PROGRAM, plan_id: plan.id, expected_board_version: null, idempotency_key: 'restore_12345678' };
  expect((await call('POST', request, OTHER)).statusCode).toBe(404);
  const result = await call('POST', request);
  expect(result.statusCode).toBe(200);
  expect(result.body.board).toMatchObject({ version: 'bv_1', semesters: plan.semesters });
  expect((await call('POST', { ...request, idempotency_key: 'restore_new_key' })).statusCode).toBe(409);
  expect((await call('POST', request)).body.board.version).toBe('bv_1');
});
test('rejects a saved unknown course and preserves current board', async () => {
  await store.save(OWNER, `program:${PROGRAM}`, 0, { plans: [{ ...plan, semesters: [{ semesterId: A, courseIds: ['fabricated'] }] }] });
  const result = await call('POST', { action: 'restore', program_id: PROGRAM, plan_id: plan.id, expected_board_version: null, idempotency_key: 'restore_invalid_plan' });
  expect(result.statusCode).toBe(422);
  expect(await getBoardRepository().load(OWNER, PROGRAM)).toBeNull();
});
test('sharing requires a verified account and history has no raw reports', async () => {
  const draft = { academicYear: 2025, semester: 1, round: 1, budget: 100, minimumBid: 5,
    transferMode: 'automatic', rulesConfirmed: true, rulesSource: 'faculty',
    entries: [{ id: 'c1', label: 'course', kind: 'course', courseId: 'C1', group: '01', points: 10, priority: 1, outcome: 'accepted', members: [] }] };
  expect((await call('POST', { action: 'share', program_id: PROGRAM, consent: true, draft })).statusCode).toBe(401);
  const history = await call('GET', null, OWNER, { scope: 'history', program_id: PROGRAM, academic_year: '2026', semester: '1', round: '1' });
  expect(history.body.history.summaries).toEqual([]);
  expect(JSON.stringify(history.body)).not.toContain('owner');
});
test('consented reports retain initial allocation, exclude unknown final transferred scores, and withdraw', async () => {
  jest.spyOn(authSession, 'resolveRequestOwner').mockResolvedValue({ ownerId: 'auth:00000000-0000-4000-8000-000000000001', issued: false });
  const entry = { id: 'c1', label: 'course', kind: 'course', courseId: 'C1', group: '01', points: 10, priority: 1, outcome: 'accepted', members: [] };
  const draft = { academicYear: 2025, semester: 1, round: 1, budget: 100, minimumBid: 5,
    transferMode: 'automatic', rulesConfirmed: true, rulesSource: 'faculty', entries: [entry, { ...entry, id: 'c2', group: '02', priority: 2 }] };
  expect((await call('POST', { action: 'share', program_id: PROGRAM, consent: true, draft })).statusCode).toBe(200);
  const rows = await store.observations(PROGRAM, 2026, 1, 1);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ initialPoints: 10, points: null });
  await store.replaceObservations('auth:00000000-0000-4000-8000-000000000001', PROGRAM, 2024, 2, 2,
    [{ kind: 'course', courseId: 'C1', group: '01', points: 30, outcome: 'accepted', rejectionReason: '' }]);
  expect((await call('POST', { action: 'share', program_id: PROGRAM, consent: false, draft })).statusCode).toBe(200);
  expect(await store.observations(PROGRAM, 2026, 1, 1)).toHaveLength(0);
  expect(await store.observations(PROGRAM, 2026, 2, 2)).toHaveLength(0);
});
test('requesting a future target year cannot expose live-year bidding observations', async () => {
  const year = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  for (let i = 0; i < 5; i++) await store.replaceObservations(`auth:user${i}`, PROGRAM, year, 1, 1,
    [{ kind: 'course', courseId: 'C1', group: '01', points: 20, outcome: 'accepted', rejectionReason: '' }]);
  const result = await call('GET', null, OWNER, { scope: 'history', program_id: PROGRAM, academic_year: String(year + 1), semester: '1', round: '1' });
  expect(result.body.history.summaries).toHaveLength(0);
});

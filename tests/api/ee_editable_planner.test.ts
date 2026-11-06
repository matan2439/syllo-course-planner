import handler from '../../api/ai/student-workspace';
import { loadLocalBoardJson } from '../../api/ai/board_loader';
import { isServableProgramId } from '../../shared/programs';
import { SESSION_COOKIE } from '../../api/ai/session_owner';
import { programWorkspaceSchema } from '../../shared/planner/student-workspace';
import { getAcademicContextStore, getBoardRepository, resetApplyRuntime } from '../../api/ai/apply_runtime';
import { MemoryStudentWorkspaceStore, installStudentWorkspaceStoreForTests } from '../../api/ai/student_workspace_store';
import { prepareManualCourseAdd, prepareManualCourseMove, prepareManualCourseRemove } from '../../api/ai/manual_board_edit_service';
import type { AcademicContextRecord } from '../../api/ai/academic_context_store';

const PROGRAM = 'electrical_engineering_2027', EARLY = 'electrical_engineering_years_1_2_2027';
const OWNER = 'e'.repeat(43), OTHER = 'f'.repeat(43), A = 'year_3_semester_a';
const original = process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
const call = async (body: unknown, owner = OWNER, query: Record<string, string> = {}) => {
  const res: any = { statusCode: 0, headers: {}, body: null,
    setHeader(k: string, v: unknown) { this.headers[k] = v; }, getHeader(k: string) { return this.headers[k]; },
    status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
  await handler({ method: body === undefined ? 'GET' : 'POST', headers: { cookie: `${SESSION_COOKIE}=${owner}` }, query, body } as any, res);
  return res;
};
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
  else process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = original;
  installStudentWorkspaceStoreForTests(undefined); resetApplyRuntime();
});

test('the public editable EE planner serves its actual boards without a preview flag', () => {
  delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
  expect(loadLocalBoardJson(PROGRAM).metadata.program_requirements_categories.group_minimums.track).toBe(12);
  expect(loadLocalBoardJson(EARLY).metadata.window_of_program_id).toBe(PROGRAM);
  expect(isServableProgramId(PROGRAM)).toBe(true);
});

test('two real EE course copies switch both ways with independent weekly choices and owner isolation', async () => {
  process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = '1';
  resetApplyRuntime(); const store = new MemoryStudentWorkspaceStore(); installStudentWorkspaceStoreForTests(store);
  await getAcademicContextStore().put({ ownerId: OWNER, programId: PROGRAM, digest: 'ee_status',
    personalStatus: {}, planContext: { semesters: [], personal_status: {} }, preferences: {} });
  const plan = (id: string, course: string, group: string) => ({ id, name: id, notes: '', catalogVersion: null,
    createdAt: 1, updatedAt: 1, semesters: [{ semesterId: A, courseIds: [course] }],
    weeklySchedule: { termMapping: {}, selections: { [`${course}:2026:1`]: [group] }, freeDays: [] } });
  const one = plan('plan_ee_first', '0512-4264', '01'), two = plan('plan_ee_second', '0512-4100', '02');
  const workspaceQuery = { scope: 'program', program_id: PROGRAM };
  const saved = await call({ ...workspaceQuery, expected_revision: 0, data: { plans: [one, two], activePlanId: one.id } });
  expect(saved.statusCode).toBe(200);
  expect(saved.body.revision).toBe(1);
  const otherWorkspace = await call(undefined, OTHER, workspaceQuery);
  expect(otherWorkspace.statusCode).toBe(200);
  expect(otherWorkspace.body.data.plans).toEqual([]);
  const restore = (id: string, version: string | null, key: string, owner = OWNER) => call({
    action: 'restore', program_id: PROGRAM, plan_id: id, expected_board_version: version, idempotency_key: key,
  }, owner);
  expect((await restore(one.id, null, 'ee_other_owner', OTHER)).statusCode).toBe(404);
  const first = await restore(one.id, null, 'ee_first_restore');
  expect(first.statusCode).toBe(200);
  expect(first.body.weeklySchedule).toEqual(one.weeklySchedule);
  const second = await restore(two.id, first.body.board.version, 'ee_second_restore');
  expect(second.statusCode).toBe(200);
  expect(second.body.weeklySchedule).toEqual(two.weeklySchedule);
  const back = await restore(one.id, second.body.board.version, 'ee_restore_back');
  expect(back.statusCode).toBe(200);
  expect(back.body.board.semesters.find((s: any) => s.semesterId === A).courseIds).toEqual(['0512-4264']);
  expect(back.body.weeklySchedule).toEqual(one.weeklySchedule);
  const reloaded = await call(undefined, OWNER, workspaceQuery);
  expect(reloaded.statusCode).toBe(200);
  expect(programWorkspaceSchema.parse(reloaded.body.data).plans).toEqual([one, two]);
  expect(await getBoardRepository().load(OTHER, PROGRAM)).toBeNull();
});

test('the existing edit service adds, moves and removes a real EE elective', () => {
  process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = '1';
  const boardJson = loadLocalBoardJson(PROGRAM), B = 'year_3_semester_b';
  const context: AcademicContextRecord = { ownerId: OWNER, programId: PROGRAM, digest: 'ee_status', updatedAt: 1,
    personalStatus: {}, planContext: { semesters: [], personal_status: {} }, preferences: {} };
  const base = { program_id: PROGRAM, academic_status_digest: 'ee_status', operation_id: 'ee_manual_edit_12345',
    expected_board_version: null, course_id: '0512-4200', semester_id: A };
  const added = prepareManualCourseAdd({ boardJson, context, currentBoard: null,
    request: { ...base, operation: 'add_course' } });
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error(JSON.stringify(added));
  const current = { ownerId: OWNER, programId: PROGRAM, version: 'bv_1', updatedAt: 1, semesters: added.semesters };
  const moved = prepareManualCourseMove({ boardJson, context, currentBoard: current,
    request: { ...base, operation: 'move_course', expected_board_version: 'bv_1', semester_id: B } });
  expect(moved.ok).toBe(true);
  if (!moved.ok) throw new Error(JSON.stringify(moved));
  expect(moved.semesters.find(s => s.semesterId === B)?.courseIds).toContain('0512-4200');
  const removed = prepareManualCourseRemove({ boardJson, context, currentBoard: { ...current, semesters: moved.semesters },
    request: { ...base, operation: 'remove_course', expected_board_version: 'bv_1' } });
  expect(removed.ok).toBe(true);
  if (removed.ok) expect(removed.semesters.flatMap(s => s.courseIds)).not.toContain('0512-4200');
});

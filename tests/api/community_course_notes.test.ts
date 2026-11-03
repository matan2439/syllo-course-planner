jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => null) }));
import handler from '../../api/ai/student-workspace';
import { resetApplyRuntime } from '../../api/ai/apply_runtime';
import { MemoryStudentWorkspaceStore, installStudentWorkspaceStoreForTests } from '../../api/ai/student_workspace_store';
import * as authSession from '../../api/ai/auth_session';

const user = (n: number) => `auth:00000000-0000-4000-8000-00000000000${n}`;
let store: MemoryStudentWorkspaceStore;
const call = async (owner: string, method: string, body: unknown, query: Record<string, string> = {}) => {
  jest.spyOn(authSession, 'resolveRequestOwner').mockResolvedValue({ ownerId: owner, issued: false });
  const res: any = { statusCode: 0, body: undefined, headers: {},
    setHeader(key: string, value: unknown) { this.headers[key] = value; },
    getHeader(key: string) { return this.headers[key]; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  await handler({ method, headers: {}, query, body } as any, res);
  return res;
};
const note = { id: 'note_00000001', courseId: '0542-2400', kind: 'tip', lecturer: 'ד״ר כהן', body: 'להתחיל מוקדם את התרגילים' };
const list = async (owner: string) => (await call(owner, 'GET', null, { scope: 'community_notes', course_id: '0542-2400' })).body.notes;

beforeEach(() => {
  jest.restoreAllMocks();
  resetApplyRuntime(); store = new MemoryStudentWorkspaceStore(); installStudentWorkspaceStoreForTests(store);
});
afterAll(() => { installStudentWorkspaceStoreForTests(undefined); resetApplyRuntime(); });

test('a shared note is readable by others without any author identity, and withdrawal removes it', async () => {
  expect((await call(user(1), 'POST', { action: 'publish_note', note })).statusCode).toBe(200);
  const seen = await list(user(2))
  expect(seen).toEqual([expect.objectContaining({ courseId: '0542-2400', kind: 'tip', lecturer: 'ד״ר כהן', body: note.body, mine: false, reported: false })]);
  expect(JSON.stringify(seen)).not.toContain('00000001'); // neither the author's user id nor their private note id
  expect((await list(user(1)))[0].mine).toBe(true);
  // Guests can read but never publish or report.
  expect(await list('guest_owner_abcdefghijklmnopqrstuvwxyz0123456789')).toHaveLength(1);
  expect((await call('guest_owner_abcdefghijklmnopqrstuvwxyz0123456789', 'POST', { action: 'publish_note', note })).statusCode).toBe(401);
  expect((await call(user(1), 'POST', { action: 'withdraw_note', note_id: note.id })).statusCode).toBe(200);
  expect(await list(user(2))).toEqual([]);
});

test('three distinct reports hide a note until a developer restores or removes it', async () => {
  await call(user(1), 'POST', { action: 'publish_note', note });
  const [{ id }] = await list(user(2));
  expect((await call(user(1), 'POST', { action: 'report_note', public_id: id })).statusCode).toBe(422); // own note
  for (const n of [2, 2, 3]) expect((await call(user(n), 'POST', { action: 'report_note', public_id: id })).statusCode).toBe(200);
  expect(await list(user(5))).toHaveLength(1); // a repeated report from user 2 does not count twice
  await call(user(4), 'POST', { action: 'report_note', public_id: id });
  expect(await list(user(5))).toEqual([]);
  // Re-publishing (an edit) does not clear the hold.
  await call(user(1), 'POST', { action: 'publish_note', note: { ...note, body: 'גרסה ערוכה' } });
  expect(await list(user(5))).toEqual([]);

  expect((await call(user(5), 'GET', null, { scope: 'moderation' })).statusCode).toBe(403);
  store.developers.add(user(9));
  expect((await call(user(9), 'GET', null, { scope: 'moderation' })).body.notes).toEqual([expect.objectContaining({ id, reports: 3, body: 'גרסה ערוכה' })]);
  expect((await call(user(5), 'POST', { action: 'moderate_note', public_id: id, decision: 'restore' })).statusCode).toBe(403);
  expect((await call(user(9), 'POST', { action: 'moderate_note', public_id: id, decision: 'restore' })).statusCode).toBe(200);
  expect(await list(user(5))).toHaveLength(1);
  expect((await call(user(9), 'POST', { action: 'moderate_note', public_id: id, decision: 'remove' })).statusCode).toBe(200);
  expect(await list(user(5))).toEqual([]);
});

test('rejects malformed note requests', async () => {
  expect((await call(user(1), 'POST', { action: 'publish_note', note: { ...note, body: '' } })).statusCode).toBe(400);
  expect((await call(user(1), 'POST', { action: 'publish_note', note: { ...note, owner: user(2) } })).statusCode).toBe(400);
  expect((await call(user(1), 'POST', { action: 'report_note', public_id: 'not-a-uuid' })).statusCode).toBe(400);
  expect((await call(user(1), 'GET', null, { scope: 'community_notes', course_id: 'bad id!' })).statusCode).toBe(400);
});

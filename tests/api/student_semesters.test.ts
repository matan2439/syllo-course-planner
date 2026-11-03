import { InMemoryBoardRepository } from '../../api/ai/board_repository';
import {
  loadAddedSemesters, loadBoardWithAddedSemesters, saveAddedSemesters,
} from '../../api/ai/student_semesters';
import { installStudentWorkspaceStoreForTests, MemoryStudentWorkspaceStore } from '../../api/ai/student_workspace_store';

const PROGRAM = 'mechanical_engineering_2027'; // a four-year board: Years 3–4
const OWN = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];
const GUEST = 'g'.repeat(43);
const ACCOUNT = 'auth:00000000-0000-4000-8000-000000000001';
let store: MemoryStudentWorkspaceStore;

beforeEach(() => { store = new MemoryStudentWorkspaceStore(); installStudentWorkspaceStoreForTests(store); });
afterAll(() => installStudentWorkspaceStoreForTests(undefined));

describe('added semesters as an account preference', () => {
  test('saved per owner and program, keeping only ids past the program\'s own years', async () => {
    await saveAddedSemesters(ACCOUNT, PROGRAM, ['year_5_semester_b', 'year_3_semester_a', 'year_5_semester_a', 'year_9_semester_a']);
    expect(await loadAddedSemesters(ACCOUNT, PROGRAM)).toEqual(['year_5_semester_a', 'year_5_semester_b']);
    expect(await loadAddedSemesters(GUEST, PROGRAM)).toEqual([]);
    await saveAddedSemesters(ACCOUNT, PROGRAM, []);
    expect(await loadAddedSemesters(ACCOUNT, PROGRAM)).toEqual([]);
  });

  test('a board replaced without the column (Apply, restore) still loads with it', async () => {
    const repo = new InMemoryBoardRepository();
    await saveAddedSemesters(ACCOUNT, PROGRAM, ['year_5_semester_a']);
    expect(await loadBoardWithAddedSemesters(repo, ACCOUNT, PROGRAM)).toBeNull();
    await repo.commit({
      ownerId: ACCOUNT, programId: PROGRAM, expectedVersion: null, proposalId: 'p', candidateId: 'c', idempotencyKey: 'apply_0123456789',
      semesters: OWN.map((semesterId) => ({ semesterId, courseIds: [] })),
    });
    const board = await loadBoardWithAddedSemesters(repo, ACCOUNT, PROGRAM);
    expect(board?.semesters.map((s) => s.semesterId)).toEqual([...OWN, 'year_5_semester_a']);
    expect(board?.semesters.at(-1)?.courseIds).toEqual([]);
  });

  test('a guest\'s added semesters move to the account at sign-in', async () => {
    await saveAddedSemesters(GUEST, PROGRAM, ['year_5_semester_a']);
    await store.adopt(GUEST, ACCOUNT);
    expect(await loadAddedSemesters(ACCOUNT, PROGRAM)).toEqual(['year_5_semester_a']);
  });

  test('storage trouble never blocks loading a board', async () => {
    installStudentWorkspaceStoreForTests({ ...store, load: async () => { throw new Error('down'); } } as any);
    expect(await loadAddedSemesters(ACCOUNT, PROGRAM)).toEqual([]);
  });
});

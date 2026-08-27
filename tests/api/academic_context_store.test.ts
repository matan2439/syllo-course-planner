import { InMemoryAcademicContextStore } from '../../api/ai/academic_context_store';

const OWNER = 'o'.repeat(43);
const OTHER = 'x'.repeat(43);
const PROGRAM = 'mechanical_engineering_2027';

describe('R2 — session-owned academic context store', () => {
  test('stores the exact normalized status and digest for one owner/program', async () => {
    const store = new InMemoryAcademicContextStore({ clock: () => 100 });
    await store.put({
      ownerId: OWNER, programId: PROGRAM, digest: 'as_first',
      personalStatus: { completed: [{ course_id: 'A' }] },
    });
    expect(await store.load(OWNER, PROGRAM)).toEqual({
      ownerId: OWNER, programId: PROGRAM, digest: 'as_first',
      personalStatus: { completed: [{ course_id: 'A' }] }, updatedAt: 100,
    });
  });

  test('isolates sessions and programs', async () => {
    const store = new InMemoryAcademicContextStore();
    await store.put({ ownerId: OWNER, programId: PROGRAM, digest: 'as_a', personalStatus: {} });
    expect(await store.load(OTHER, PROGRAM)).toBeNull();
    expect(await store.load(OWNER, 'electrical_engineering_2027')).toBeNull();
  });

  test('newer Generate replaces the current context without mutating returned values', async () => {
    const store = new InMemoryAcademicContextStore();
    const status: any = { completed: [{ course_id: 'A' }] };
    await store.put({ ownerId: OWNER, programId: PROGRAM, digest: 'as_1', personalStatus: status });
    status.completed.push({ course_id: 'ATTACK' });
    const first: any = await store.load(OWNER, PROGRAM);
    expect(first.personalStatus.completed).toEqual([{ course_id: 'A' }]);
    first.personalStatus.completed.push({ course_id: 'MUTATE' });
    expect((await store.load(OWNER, PROGRAM) as any).personalStatus.completed).toEqual([{ course_id: 'A' }]);

    await store.put({ ownerId: OWNER, programId: PROGRAM, digest: 'as_2', personalStatus: {} });
    expect((await store.load(OWNER, PROGRAM))?.digest).toBe('as_2');
  });
});

import {
  PlannerStorageError,
  plannerDatabaseConfigured,
  storageKindFor,
} from '../../api/ai/apply_runtime';

describe('planner storage selection', () => {
  test('selects Postgres before local file storage', () => {
    const env = {
      SYLLO_PLANNER_DATABASE_URL: 'postgres://preview',
      SYLLO_BOARD_STATE_DIR: 'runtime/boards',
    } as NodeJS.ProcessEnv;

    expect(storageKindFor(env)).toBe('postgres');
    expect(plannerDatabaseConfigured(env)).toBe(true);
  });

  test('keeps explicit local file and deterministic memory modes', () => {
    expect(storageKindFor({ SYLLO_BOARD_STATE_DIR: 'runtime/boards' })).toBe('file');
    expect(storageKindFor({})).toBe('memory');
    expect(plannerDatabaseConfigured({})).toBe(false);
  });

  test('fails closed instead of selecting process memory on Vercel', () => {
    expect(() => storageKindFor({ VERCEL: '1' })).toThrow(
      new PlannerStorageError('PLANNER_STORAGE_UNAVAILABLE'),
    );
  });
});

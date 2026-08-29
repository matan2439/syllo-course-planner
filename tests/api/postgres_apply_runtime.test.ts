import {
  ensurePlannerStorageReady,
  getAcademicContextStore,
  getAuthoritativeApplyStore,
  getBoardRepository,
  getProposalStore,
  installPostgresPlannerStateFactoryForTests,
  productionStorageConfigured,
  resetApplyRuntime,
  storageKind,
} from '../../api/ai/apply_runtime';
import type { PostgresPlannerState } from '../../api/ai/postgres/postgres_planner_state';

describe('Postgres apply runtime', () => {
  const previousUrl = process.env.SYLLO_PLANNER_DATABASE_URL;

  afterEach(() => {
    resetApplyRuntime();
    if (previousUrl === undefined) delete process.env.SYLLO_PLANNER_DATABASE_URL;
    else process.env.SYLLO_PLANNER_DATABASE_URL = previousUrl;
  });

  test('shares one durable bundle and reports configured only after schema verification', async () => {
    process.env.SYLLO_PLANNER_DATABASE_URL = 'postgres://preview-only';
    const ensureSchemaCurrent = jest.fn().mockResolvedValue(undefined);
    const state = {
      boardRepository: { load: jest.fn(), commit: jest.fn() },
      academicContextStore: { load: jest.fn(), put: jest.fn() },
      proposalStore: { get: jest.fn(), put: jest.fn() },
      authoritativeApplyStore: { apply: jest.fn() },
      ensureSchemaCurrent,
    } as unknown as PostgresPlannerState;
    const factory = jest.fn(() => state);
    installPostgresPlannerStateFactoryForTests(factory);

    expect(storageKind()).toBe('postgres');
    expect(getBoardRepository()).toBe(state.boardRepository);
    expect(getAcademicContextStore()).toBe(state.academicContextStore);
    expect(getProposalStore()).toBe(state.proposalStore);
    expect(getAuthoritativeApplyStore()).toBe(state.authoritativeApplyStore);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(productionStorageConfigured()).toBe(false);

    await ensurePlannerStorageReady();

    expect(ensureSchemaCurrent).toHaveBeenCalledTimes(1);
    expect(productionStorageConfigured()).toBe(true);
  });

  test('has no atomic Apply store in deterministic memory mode', () => {
    delete process.env.SYLLO_PLANNER_DATABASE_URL;
    expect(storageKind()).toBe('memory');
    expect(getAuthoritativeApplyStore()).toBeNull();
    expect(productionStorageConfigured()).toBe(false);
  });
});

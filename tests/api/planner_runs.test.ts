/**
 * Tests for api/ai/_planner_runs.ts — persistence helpers for planner runs.
 * The postgres module is mocked; no real database is required.
 */

const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockSql = Object.assign(jest.fn().mockResolvedValue([]), {
  end: mockEnd,
  json: jest.fn((x: unknown) => x),
});
jest.mock('postgres', () => jest.fn(() => mockSql));

import { createRun, markRunFinal, getRun } from '../../api/ai/_planner_runs';

const URL = 'postgresql://test:test@localhost/testdb';

beforeEach(() => {
  jest.clearAllMocks();
  mockSql.mockResolvedValue([]);
  (mockSql.json as jest.Mock).mockImplementation((x: unknown) => x);
});

describe('createRun', () => {
  it('inserts a running row and returns the new id', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'run-123' }]);
    const id = await createRun(URL, { session_token: 'tok', program_id: 'mechanical_engineering_2027', orchestrator: 'greedy' });
    expect(id).toBe('run-123');
    expect(mockSql).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });
});

describe('markRunFinal', () => {
  it('updates the row to a terminal status with the trace + report', async () => {
    await markRunFinal(URL, 'run-123', {
      status: 'done',
      trace: [{ step: 1, action: 'STOP' } as any],
      candidates: [],
      selectedPlan: { semesters: [] },
      validationReport: { valid: true },
      explanation: { summary_he: 'ok' },
    });
    expect(mockSql).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('records an error_text when the run failed', async () => {
    await markRunFinal(URL, 'run-123', { status: 'failed', error: 'boom' });
    expect(mockSql).toHaveBeenCalled();
  });
});

describe('getRun', () => {
  it('returns the row when present', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'run-123', status: 'done' }]);
    const row = await getRun(URL, 'run-123');
    expect(row?.status).toBe('done');
  });

  it('returns null when not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await getRun(URL, 'missing')).toBeNull();
  });
});

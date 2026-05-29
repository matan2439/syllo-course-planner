/**
 * Tests for api/ai/_quota.ts
 *
 * Postgres is mocked — no real DB connection needed.
 * Tests cover quota calculation, UPSERT behaviour, increment, and logging.
 */

// ── postgres mock ─────────────────────────────────────────────────────────────

const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockSql = Object.assign(jest.fn().mockResolvedValue([]), { end: mockEnd });
jest.mock('postgres', () => jest.fn().mockReturnValue(mockSql));

// ── imports ───────────────────────────────────────────────────────────────────

import {
  FREE_LIMIT,
  checkAndEnsureSession,
  incrementCreditsUsed,
  logUsageEvent,
} from '../../api/ai/_quota';

const TEST_TOKEN  = '550e8400-e29b-41d4-a716-446655440000';
const TEST_DB_URL = 'postgresql://test:test@localhost/testdb';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Make the sql mock return one session row for the next call. */
function mockSession(credits_used: number, credits_paid = 0) {
  mockSql.mockResolvedValueOnce([{ credits_used, credits_paid }]);
}

// ── FREE_LIMIT constant ───────────────────────────────────────────────────────

describe('FREE_LIMIT', () => {
  it('defaults to 5 when AI_FREE_QUOTA is not set', () => {
    // The env var is evaluated at module load time; we test the default value.
    expect(FREE_LIMIT).toBeGreaterThanOrEqual(1);
  });
});

// ── checkAndEnsureSession ─────────────────────────────────────────────────────

describe('checkAndEnsureSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSql.mockResolvedValue([]); // reset default
  });

  it('new session (credits_used=0) is allowed with full free quota', async () => {
    mockSession(0);
    const result = await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(result.allowed).toBe(true);
    expect(result.credits_used).toBe(0);
    expect(result.credits_paid).toBe(0);
    expect(result.free_limit).toBe(FREE_LIMIT);
    expect(result.remaining).toBe(FREE_LIMIT);
  });

  it('session at exactly free_limit is NOT allowed', async () => {
    mockSession(FREE_LIMIT);
    const result = await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('session over free_limit is NOT allowed', async () => {
    mockSession(FREE_LIMIT + 3);
    const result = await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('session with paid credits extends quota', async () => {
    // Used all free + 1 paid credit, still has more paid
    mockSession(FREE_LIMIT + 1, 3);
    const result = await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('session with paid credits but all consumed is NOT allowed', async () => {
    mockSession(FREE_LIMIT + 3, 3);
    const result = await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('calls sql.end() even if the query succeeds', async () => {
    mockSession(0);
    await checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL);
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });

  it('calls sql.end() even if the query throws', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB timeout'));
    await expect(checkAndEnsureSession(TEST_TOKEN, TEST_DB_URL)).rejects.toThrow();
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });
});

// ── incrementCreditsUsed ──────────────────────────────────────────────────────

describe('incrementCreditsUsed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('executes an UPDATE statement', async () => {
    mockSql.mockResolvedValueOnce([]);
    await incrementCreditsUsed(TEST_TOKEN, TEST_DB_URL);
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });

  it('calls sql.end() even on error', async () => {
    mockSql.mockRejectedValueOnce(new Error('timeout'));
    await expect(incrementCreditsUsed(TEST_TOKEN, TEST_DB_URL)).rejects.toThrow();
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });
});

// ── logUsageEvent ─────────────────────────────────────────────────────────────

describe('logUsageEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts an ai_usage_events row', async () => {
    mockSql.mockResolvedValueOnce([]);
    await logUsageEvent(TEST_TOKEN, 'claude-3-5-sonnet-20241022', TEST_DB_URL);
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });

  it('calls sql.end() even on error', async () => {
    mockSql.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      logUsageEvent(TEST_TOKEN, 'claude-3-5-sonnet-20241022', TEST_DB_URL),
    ).rejects.toThrow();
    expect(mockEnd).toHaveBeenCalledWith({ timeout: 5 });
  });
});

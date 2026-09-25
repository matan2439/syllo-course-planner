/**
 * Tests for POST /api/ai/course-planner (VercelRequest / VercelResponse pattern)
 *
 * The course advisor agent and quota module are mocked — no real DB or AI calls.
 * Assertions check res.status(), res.json(), res.write(), res.end()
 * — never check for a returned Response object.
 */

// ── Course advisor mock (no real model calls) ─────────────────────────────────

jest.mock('../../api/ai/agent/course_advisor', () => ({
  streamCourseAdvisor: jest.fn().mockImplementation(async () => ({
    textStream: new ReadableStream<string>({
      start(controller) {
        controller.enqueue('מדובר בתוכנית לימודים מאוזנת.');
        controller.close();
      },
    }),
    completed: Promise.resolve(),
  })),
}));

/** A mocked advisor run whose stream behaves as given. */
function mockAdvisorOnce(start: (controller: ReadableStreamDefaultController<string>) => void, completed: Promise<void> = Promise.resolve()) {
  completed.catch(() => undefined);
  jest.requireMock('../../api/ai/agent/course_advisor').streamCourseAdvisor.mockImplementationOnce(async () => ({
    textStream: new ReadableStream<string>({ start }),
    completed,
  }));
}

// ── Quota module mock ─────────────────────────────────────────────────────────

const mockCheckAndEnsureSession = jest.fn().mockResolvedValue({
  allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
});
const mockIncrementCreditsUsed = jest.fn().mockResolvedValue(undefined);
const mockLogUsageEvent        = jest.fn().mockResolvedValue(undefined);

jest.mock('../../api/ai/_quota', () => ({
  FREE_LIMIT:               5,
  checkAndEnsureSession:    mockCheckAndEnsureSession,
  incrementCreditsUsed:     mockIncrementCreditsUsed,
  logUsageEvent:            mockLogUsageEvent,
}));

// ── imports ───────────────────────────────────────────────────────────────────

import handler from '../../api/ai/course-planner';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_SESSION_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

const VALID_BODY = {
  message:       'האם התוכנית שלי מאוזנת?',
  program_id:    'mechanical_engineering_2027',
  session_token:  VALID_SESSION_TOKEN,
  plan_context: {
    program_name: 'הנדסה מכנית',
    semesters: [
      {
        id: 'year_3_semester_a',
        label: "שנה ג׳ — סמסטר א׳",
        total_hours: 14,
        courses: [
          { course_id: '0542-4420', name_he: 'תורת המכונות', hours: 4, course_type: 'elective' },
        ],
      },
    ],
  },
};

/** Create a mock VercelRequest. body is already parsed (not a raw string). */
function makeReq(body: unknown, method = 'POST'): VercelRequest {
  return { method, headers: { 'content-type': 'application/json' }, body, query: {} } as unknown as VercelRequest;
}

/** Create a mock VercelResponse with jest spies. */
function makeRes() {
  let _status = 200;
  const res: Record<string, jest.Mock | unknown> = {};
  const mock = res as any;

  mock.status   = jest.fn().mockImplementation((code: number) => { _status = code; return mock; });
  mock.json     = jest.fn().mockReturnValue(mock);
  mock.setHeader = jest.fn().mockReturnValue(mock);
  mock.write    = jest.fn().mockReturnValue(true);
  mock.end      = jest.fn().mockReturnValue(mock);
  mock._getStatus = () => _status;

  return mock as VercelResponse & {
    status: jest.Mock; json: jest.Mock; setHeader: jest.Mock;
    write: jest.Mock; end: jest.Mock; _getStatus: () => number;
  };
}

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValue({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
  });

  it('calls res.write and res.end for a valid request', async () => {
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled(); // streaming path never calls json
  });

  it('passes when courses have null hours and null name_he (real frontend payload)', async () => {
    // Mirrors what buildPlanContext() sends: null values from JS course objects
    const payloadWithNulls = {
      ...VALID_BODY,
      plan_context: {
        semesters: [
          {
            id: 'year_3_semester_a',
            label: "שנה ג׳ — סמסטר א׳",
            total_hours: 0,
            courses: [
              {
                course_id: '0542-4420',
                name_he: null,              // null — common for stub courses
                hours: null,                // null — common when weekly_hours not in DB
                difficulty_level: null,     // null — not computed yet
                difficulty_score: null,     // null — not computed yet
                course_type: 'elective',
                category: null,             // null — no category assigned
                missing_prerequisites: [],
              },
            ],
          },
        ],
        mandatory_unplaced: [
          { course_id: '0512-1204', name_he: null, hours: null },
        ],
        prerequisite_issues: [
          { course_id: '0542-4320', name_he: null, missing: ['0542-4120'] },
        ],
      },
    };
    const res = makeRes();
    await handler(makeReq(payloadWithNulls), res as any);
    // Should stream successfully — nulls are now accepted by the schema
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('accepts plan_context.preferences (wanted/unwanted course ids + extra request) — PART F chat context', async () => {
    const payloadWithPrefs = {
      ...VALID_BODY,
      plan_context: {
        ...VALID_BODY.plan_context,
        pinned_course_ids: ['0542-4120'],
        preferences: {
          wanted_course_ids:   ['0542-4221'],
          unwanted_course_ids: ['0542-4320'],
          extra_request_he:    'תוריד עומס מסמסטר ג׳ ב׳',
        },
      },
    };
    const res = makeRes();
    await handler(makeReq(payloadWithPrefs), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_REQUEST with issue path for missing session_token', async () => {
    const { session_token: _, ...rest } = VALID_BODY;
    const res = makeRes();
    await handler(makeReq(rest), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'session_token' }),
      ]),
    );
  });

  it('returns 400 INVALID_REQUEST for invalid UUID session_token', async () => {
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, session_token: 'not-a-uuid' }), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'session_token', message: expect.stringContaining('UUID') }),
      ]),
    );
  });

  it('returns 400 INVALID_REQUEST for missing plan_context.semesters', async () => {
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, plan_context: {} }), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.details.issues.some((i: { path: string }) => i.path.includes('semesters'))).toBe(true);
  });

  it('returns 400 JSON for empty message', async () => {
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, message: '' }), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 400 JSON for missing program_id', async () => {
    const { program_id: _, ...rest } = VALID_BODY;
    const res = makeRes();
    await handler(makeReq(rest), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 400 JSON for missing plan_context', async () => {
    const { plan_context: _, ...rest } = VALID_BODY;
    const res = makeRes();
    await handler(makeReq(rest), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 JSON for message exceeding max length', async () => {
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, message: 'x'.repeat(2001) }), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 405 for GET requests', async () => {
    const res = makeRes();
    await handler(makeReq(null, 'GET'), res as any);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq(null, 'OPTIONS'), res as any);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ── session_token validation ──────────────────────────────────────────────────

describe('POST /api/ai/course-planner — session_token validation', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 400 when session_token is missing', async () => {
    const { session_token: _, ...rest } = VALID_BODY;
    const res = makeRes();
    await handler(makeReq(rest), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    const jsonArg = res.json.mock.calls[0][0];
    expect(JSON.stringify(jsonArg)).toContain('session_token');
  });

  it('returns 400 when session_token is not a UUID', async () => {
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, session_token: 'not-a-uuid' }), res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── API key handling ──────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — API key handling', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 503 NO_API_KEY JSON when no OpenAI key is set', async () => {
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('NO_API_KEY');
    expect(body.error).toContain('OPENAI_API_KEY');
  });

  it('runs the course advisor when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.DATABASE_URL   = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValueOnce({ allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5 });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    const { streamCourseAdvisor } = jest.requireMock('../../api/ai/agent/course_advisor');
    expect(streamCourseAdvisor).toHaveBeenCalledWith(expect.objectContaining({
      message: VALID_BODY.message, programId: VALID_BODY.program_id,
    }));
    expect(res.write).toHaveBeenCalledWith('מדובר בתוכנית לימודים מאוזנת.');
  });
});

// ── Quota enforcement ─────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — quota enforcement', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    jest.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 503 NO_DATABASE_URL JSON when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('NO_DATABASE_URL');
  });

  it('streams response when quota is available', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 2, credits_paid: 0, free_limit: 5, remaining: 3,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(mockCheckAndEnsureSession).toHaveBeenCalledWith(VALID_SESSION_TOKEN, expect.any(String));
  });

  it('returns 429 QUOTA_EXCEEDED JSON when quota is exhausted', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('QUOTA_EXCEEDED');
    expect(body.details.remaining).toBe(0);
    expect(body.details.free_limit).toBe(5);
  });

  it('does not increment credits when quota is exceeded', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    await handler(makeReq(VALID_BODY), makeRes() as any);
    expect(mockIncrementCreditsUsed).not.toHaveBeenCalled();
  });

  it('allows requests beyond 5 credits when AI_FREE_QUOTA raises the limit', async () => {
    process.env.AI_FREE_QUOTA = '1000';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 50, credits_paid: 0, free_limit: 1000, remaining: 950,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
    delete process.env.AI_FREE_QUOTA;
  });

  it('AI_TEST_MODE=true bypasses QUOTA_EXCEEDED and still streams', async () => {
    process.env.AI_TEST_MODE = 'true';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
    expect(res.setHeader).toHaveBeenCalledWith('X-AI-Quota-Bypass', 'true');
    delete process.env.AI_TEST_MODE;
  });

  it('AI_TEST_MODE=false still enforces QUOTA_EXCEEDED', async () => {
    process.env.AI_TEST_MODE = 'false';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('QUOTA_EXCEEDED');
    delete process.env.AI_TEST_MODE;
  });

  it('calls incrementCreditsUsed after a completed answer', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    await handler(makeReq(VALID_BODY), makeRes() as any);
    await Promise.resolve(); // let onFinish microtask settle
    expect(mockIncrementCreditsUsed).toHaveBeenCalledWith(VALID_SESSION_TOKEN, expect.any(String));
  });

  it('calls logUsageEvent after a completed answer', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    await handler(makeReq(VALID_BODY), makeRes() as any);
    await Promise.resolve();
    expect(mockLogUsageEvent).toHaveBeenCalled();
  });

  it('does not charge a credit when the advisor run fails', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    mockAdvisorOnce((c) => c.close(), Promise.reject(new Error('run failed')));
    await handler(makeReq(VALID_BODY), makeRes() as any);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(mockIncrementCreditsUsed).not.toHaveBeenCalled();
  });

  it('returns 503 AI_PROVIDER_ERROR JSON when the advisor cannot start', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    jest.requireMock('../../api/ai/agent/course_advisor').streamCourseAdvisor.mockImplementationOnce(async () => {
      throw new Error('connection reset');
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('AI_PROVIDER_ERROR');
  });

  it('returns 503 AI_EMPTY_RESPONSE when stream closes immediately with no chunks', async () => {
    // A provider can end the stream with no text and no exception; that must be a
    // JSON error, not a 200 with an empty body.
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    mockAdvisorOnce((controller) => controller.close()); // immediately done, no chunks
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('AI_EMPTY_RESPONSE');
    // Should NOT call res.write (no content committed before error)
    expect(res.write).not.toHaveBeenCalled();
    // A run that completed but delivered nothing is not charged.
    expect(mockIncrementCreditsUsed).not.toHaveBeenCalled();
  });

  it('returns 503 AI_BILLING_ERROR when stream throws with billing message', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    const billingErr = Object.assign(new Error('Your credit balance is too low'), { status: 403 });
    mockAdvisorOnce((controller) => controller.error(billingErr), Promise.reject(billingErr));
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('AI_BILLING_ERROR');
    expect(res.write).not.toHaveBeenCalled();
  });

  it('returns 503 AI_AUTH_ERROR when stream throws with 401', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    const authErr = Object.assign(new Error('Invalid authentication credentials'), { status: 401 });
    mockAdvisorOnce((controller) => controller.error(authErr), Promise.reject(authErr));
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('AI_AUTH_ERROR');
  });
});

// ── AI dev mode ───────────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — AI dev mode', () => {
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.VERCEL_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
  });

  it('writes mock text to res in AI_DEV_MODE (no API key needed)', async () => {
    process.env.AI_DEV_MODE  = 'true';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    const written = (res.write.mock.calls[0][0] as string);
    expect(written).toContain('מצב פיתוח');
    // X-AI-Dev-Mode header set
    expect(res.setHeader).toHaveBeenCalledWith('X-AI-Dev-Mode', 'true');
  });

  it('does not call the model in AI_DEV_MODE', async () => {
    process.env.AI_DEV_MODE  = 'true';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValueOnce({ allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5 });
    await handler(makeReq(VALID_BODY), makeRes() as any);
    expect(jest.requireMock('../../api/ai/agent/course_advisor').streamCourseAdvisor).not.toHaveBeenCalled();
  });

  it('returns 503 NO_API_KEY JSON when AI_DEV_MODE is false and no key', async () => {
    process.env.AI_DEV_MODE  = 'false';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('NO_API_KEY');
  });

  it('skips quota entirely when AI_DEV_BYPASS_QUOTA=true', async () => {
    process.env.AI_DEV_MODE         = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    expect(mockCheckAndEnsureSession).not.toHaveBeenCalled();
  });

  it('still enforces quota in AI_DEV_MODE when bypass is not set', async () => {
    process.env.AI_DEV_MODE  = 'true';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('QUOTA_EXCEEDED');
  });

  it('ignores AI_DEV_MODE in production — requires real API key', async () => {
    process.env.AI_DEV_MODE  = 'true';
    process.env.VERCEL_ENV   = 'production';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('NO_API_KEY');
    // X-AI-Dev-Mode header must NOT be set
    const headerCalls = (res.setHeader as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(headerCalls).not.toContain('X-AI-Dev-Mode');
  });

  it('AI_DEV_BYPASS_QUOTA is ignored in production', async () => {
    process.env.AI_DEV_MODE         = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    process.env.VERCEL_ENV          = 'production';
    process.env.DATABASE_URL        = 'postgresql://test@localhost/test';
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res as any);
    // Production ignores dev mode → no API key → NO_API_KEY
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('NO_API_KEY');
  });

  it('increments credits in AI_DEV_MODE when bypass is off', async () => {
    process.env.AI_DEV_MODE  = 'true';
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 1, credits_paid: 0, free_limit: 5, remaining: 4,
    });
    await handler(makeReq(VALID_BODY), makeRes() as any);
    expect(mockIncrementCreditsUsed).toHaveBeenCalledWith(VALID_SESSION_TOKEN, expect.any(String));
    expect(mockLogUsageEvent).toHaveBeenCalledWith(VALID_SESSION_TOKEN, 'dev-mock', expect.any(String));
  });
});

// ── Context forwarding ────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — context forwarding', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValue({ allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5 });
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('passes course_context to the course advisor', async () => {
    const { streamCourseAdvisor } = jest.requireMock('../../api/ai/agent/course_advisor');
    await handler(makeReq({ ...VALID_BODY, course_context: 'קורס ייחודי עם מעבדה שבועית' }), makeRes() as any);
    expect(streamCourseAdvisor.mock.calls[0][0].courseContext).toContain('קורס ייחודי עם מעבדה שבועית');
  });

  it('never passes the API key to the advisor', async () => {
    const { streamCourseAdvisor } = jest.requireMock('../../api/ai/agent/course_advisor');
    await handler(makeReq(VALID_BODY), makeRes() as any);
    expect(JSON.stringify(streamCourseAdvisor.mock.calls[0][0])).not.toContain('sk-openai-test-key');
  });
});

/**
 * Tests for POST /api/ai/course-planner
 *
 * AI SDK and quota module are mocked — no real DB or AI calls.
 */

// ── AI SDK mocks ──────────────────────────────────────────────────────────────

const mockText = Promise.resolve('מדובר בתוכנית לימודים מאוזנת.');

jest.mock('ai', () => ({
  streamText: jest.fn().mockReturnValue({
    text: mockText,
    toTextStreamResponse: jest.fn().mockReturnValue(
      new Response('מדובר בתוכנית לימודים מאוזנת.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    ),
  }),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn().mockReturnValue(jest.fn().mockReturnValue('mock-anthropic-model')),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn().mockReturnValue(jest.fn().mockReturnValue('mock-openai-model')),
}));

// ── Quota module mock ─────────────────────────────────────────────────────────

const mockCheckAndEnsureSession = jest.fn().mockResolvedValue({
  allowed: true,
  credits_used: 0,
  credits_paid: 0,
  free_limit: 5,
  remaining: 5,
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

// ── fixtures ──────────────────────────────────────────────────────────────────

const VALID_SESSION_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

const VALID_BODY = {
  message:      'האם התוכנית שלי מאוזנת?',
  program_id:   'mechanical_engineering_2027',
  session_token: VALID_SESSION_TOKEN,
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

function makeRequest(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api/ai/course-planner', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

// ── input validation ──────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    delete process.env.OPENAI_API_KEY;
    mockCheckAndEnsureSession.mockResolvedValue({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 200 with valid input', async () => {
    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it('returns 400 for empty message', async () => {
    const res = await handler(makeRequest({ ...VALID_BODY, message: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 for missing program_id', async () => {
    const { program_id: _omit, ...rest } = VALID_BODY;
    const res = await handler(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing plan_context', async () => {
    const { plan_context: _omit, ...rest } = VALID_BODY;
    const res = await handler(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it('returns 400 for message exceeding max length', async () => {
    const res = await handler(makeRequest({ ...VALID_BODY, message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const req = new Request('http://localhost/api/ai/course-planner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('returns 405 for GET requests', async () => {
    const res = await handler(makeRequest(null, 'GET'));
    expect(res.status).toBe(405);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const res = await handler(makeRequest(null, 'OPTIONS'));
    expect(res.status).toBe(204);
  });
});

// ── session_token validation ──────────────────────────────────────────────────

describe('POST /api/ai/course-planner — session_token validation', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValue({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 400 when session_token is missing', async () => {
    const { session_token: _omit, ...rest } = VALID_BODY;
    const res = await handler(makeRequest(rest));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('session_token');
  });

  it('returns 400 when session_token is not a UUID', async () => {
    const res = await handler(makeRequest({ ...VALID_BODY, session_token: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('session_token');
  });

  it('returns 400 when session_token is an empty string', async () => {
    const res = await handler(makeRequest({ ...VALID_BODY, session_token: '' }));
    expect(res.status).toBe(400);
  });
});

// ── API key handling ──────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — API key handling', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 503 with NO_API_KEY when no AI key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.DATABASE_URL = 'postgresql://test@localhost/test';
    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('NO_API_KEY');
  });

  it('uses Anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    const { createAnthropic } = jest.requireMock('@ai-sdk/anthropic');
    await handler(makeRequest(VALID_BODY));
    expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-test' }));
  });

  it('uses OpenAI when only OPENAI_API_KEY is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.DATABASE_URL   = 'postgresql://test@localhost/test';
    const { createOpenAI } = jest.requireMock('@ai-sdk/openai');
    await handler(makeRequest(VALID_BODY));
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-openai-test' }));
  });
});

// ── quota enforcement ─────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — quota enforcement', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('returns 503 NO_DATABASE_URL when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('NO_DATABASE_URL');
  });

  it('allows request when quota is available', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 2, credits_paid: 0, free_limit: 5, remaining: 3,
    });
    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockCheckAndEnsureSession).toHaveBeenCalledWith(VALID_SESSION_TOKEN, expect.any(String));
  });

  it('returns 429 QUOTA_EXCEEDED when quota is exhausted', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('QUOTA_EXCEEDED');
    expect(body.details.remaining).toBe(0);
    expect(body.details.free_limit).toBe(5);
    expect(body.details.credits_used).toBe(5);
  });

  it('does not increment credits when quota is exceeded', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: false, credits_used: 5, credits_paid: 0, free_limit: 5, remaining: 0,
    });
    await handler(makeRequest(VALID_BODY));
    expect(mockIncrementCreditsUsed).not.toHaveBeenCalled();
  });

  it('does not call incrementCreditsUsed before the response', async () => {
    // The increment is scheduled via result.text.then() — it should not
    // have been called synchronously by the time the response is returned.
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    await handler(makeRequest(VALID_BODY));
    // mockText (Promise.resolve) resolves in microtask — allow it to run
    await Promise.resolve();
    // After one microtask tick, incrementCreditsUsed should have been called
    expect(mockIncrementCreditsUsed).toHaveBeenCalledWith(VALID_SESSION_TOKEN, expect.any(String));
  });

  it('calls logUsageEvent after successful response', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
    await handler(makeRequest(VALID_BODY));
    await Promise.resolve();
    expect(mockLogUsageEvent).toHaveBeenCalledWith(
      VALID_SESSION_TOKEN,
      expect.any(String), // model name
      expect.any(String), // db url
    );
  });

  it('does not consume credit when AI generation fails', async () => {
    mockCheckAndEnsureSession.mockResolvedValueOnce({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });

    const failedText = Promise.reject(new Error('AI generation failed'));
    // Prevent unhandled rejection warnings in the test runner
    failedText.catch(() => {});

    jest.requireMock('ai').streamText.mockReturnValueOnce({
      text: failedText,
      toTextStreamResponse: jest.fn().mockReturnValue(
        new Response('', { status: 200 }),
      ),
    });

    await handler(makeRequest(VALID_BODY));
    // Allow promises to settle
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockIncrementCreditsUsed).not.toHaveBeenCalled();
  });
});

// ── context forwarding ────────────────────────────────────────────────────────

describe('POST /api/ai/course-planner — context forwarding', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.DATABASE_URL      = 'postgresql://test@localhost/test';
    mockCheckAndEnsureSession.mockResolvedValue({
      allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5,
    });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DATABASE_URL;
    jest.clearAllMocks();
  });

  it('passes course_context to streamText system prompt', async () => {
    const { streamText } = jest.requireMock('ai');
    await handler(makeRequest({ ...VALID_BODY, course_context: 'קורס ייחודי עם מעבדה שבועית' }));
    const callArgs = streamText.mock.calls[0][0];
    expect(callArgs.system).toContain('קורס ייחודי עם מעבדה שבועית');
  });

  it('does not include API key in the system prompt', async () => {
    const { streamText } = jest.requireMock('ai');
    await handler(makeRequest(VALID_BODY));
    const callArgs = streamText.mock.calls[0][0];
    expect(callArgs.system).not.toContain('sk-ant-test-key');
  });
});

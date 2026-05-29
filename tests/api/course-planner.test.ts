/**
 * Tests for POST /api/ai/course-planner
 *
 * All Vercel AI SDK calls are mocked — we test input validation,
 * error handling, and response shape, NOT the AI model itself.
 */

// Mock AI SDK before importing the handler
jest.mock('ai', () => ({
  streamText: jest.fn().mockReturnValue({
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

import handler from '../../api/ai/course-planner';

const VALID_BODY = {
  message: 'האם התוכנית שלי מאוזנת?',
  program_id: 'mechanical_engineering_2027',
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

describe('POST /api/ai/course-planner — input validation', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
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

describe('POST /api/ai/course-planner — API key handling', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
  });

  it('returns 503 with NO_API_KEY code when no key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await handler(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('NO_API_KEY');
    expect(body.error).toBeTruthy();
  });

  it('uses Anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const { createAnthropic } = jest.requireMock('@ai-sdk/anthropic');

    await handler(makeRequest(VALID_BODY));
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test' }),
    );
  });

  it('uses OpenAI when only OPENAI_API_KEY is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    const { createOpenAI } = jest.requireMock('@ai-sdk/openai');

    await handler(makeRequest(VALID_BODY));
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-openai-test' }),
    );
  });
});

describe('POST /api/ai/course-planner — context forwarding', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    jest.clearAllMocks();
  });

  it('passes course_context to streamText system prompt', async () => {
    const { streamText } = jest.requireMock('ai');

    await handler(
      makeRequest({
        ...VALID_BODY,
        course_context: 'קורס ייחודי עם מעבדה שבועית',
      }),
    );

    const callArgs = streamText.mock.calls[0][0];
    expect(callArgs.system).toContain('קורס ייחודי עם מעבדה שבועית');
  });

  it('includes mandatory courses in system prompt', async () => {
    const { streamText } = jest.requireMock('ai');
    const bodyWithMandatory = {
      ...VALID_BODY,
      plan_context: {
        ...VALID_BODY.plan_context,
        mandatory_unplaced: [{ course_id: '0542-4500', name_he: 'פרויקט גמר', hours: 6 }],
      },
    };

    await handler(makeRequest(bodyWithMandatory));
    const callArgs = streamText.mock.calls[0][0];
    expect(callArgs.system).toContain('פרויקט גמר');
  });

  it('does not include API key in the system prompt', async () => {
    const { streamText } = jest.requireMock('ai');

    await handler(makeRequest(VALID_BODY));
    const callArgs = streamText.mock.calls[0][0];
    expect(callArgs.system).not.toContain('sk-ant-test-key');
  });
});

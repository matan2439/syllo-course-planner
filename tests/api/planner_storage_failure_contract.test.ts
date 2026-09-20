const ensurePlannerStorageReady = jest.fn();

jest.mock('../../api/ai/apply_runtime', () => {
  const actual = jest.requireActual('../../api/ai/apply_runtime');
  return { ...actual, ensurePlannerStorageReady };
});

import applyHandler from '../../api/ai/apply-plan';
import editHandler from '../../api/ai/edit-board';
import planningContextHandler from '../../api/ai/planning-context';
import generateHandler from '../../api/ai/generate-plan';

function res() {
  return {
    statusCode: 0, headersSent: false, _body: undefined as any, _headers: {} as Record<string, unknown>,
    setHeader: jest.fn(function (this: any, key: string, value: unknown) { this._headers[key] = value; return this; }),
    getHeader: jest.fn(function (this: any, key: string) { return this._headers[key]; }),
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, body: unknown) { this._body = body; return this; }),
    end: jest.fn(),
  } as any;
}

const storageError = (code: string) => Object.assign(new Error('secret postgres://must-not-leak'), { code });

describe('planner storage failures are typed and fail closed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test.each([
    ['apply', applyHandler, { method: 'GET', headers: {}, query: { program_id: 'program' } }],
    ['manual edit', editHandler, { method: 'POST', headers: {}, body: {
      operation: 'add_course', program_id: 'program', expected_board_version: null,
      operation_id: 'operation_12345678', course_id: 'course', semester_id: 'semester',
      academic_status_digest: 'as_test',
    } }],
    ['planning context', planningContextHandler, { method: 'POST', headers: {}, body: {
      program_id: 'program', plan_context: { personal_status: {}, semesters: [] }, preferences: {},
    } }],
    ['Generate', generateHandler, {
      method: 'POST', headers: {}, body: {
        program_id: 'program', plan_context: {}, preferences: {},
        session_token: '00000000-0000-4000-8000-000000000001',
        use_academic_decision_agent: true,
      },
    }],
  ])('%s maps schema mismatch to a sanitized 503', async (_name, handler, request) => {
    ensurePlannerStorageReady.mockRejectedValueOnce(storageError('PLANNER_SCHEMA_MISMATCH'));
    const response = res();
    await handler(request as any, response);
    expect(response.statusCode).toBe(503);
    expect(response._body).toEqual(expect.objectContaining({
      code: 'PLANNER_SCHEMA_MISMATCH',
    }));
    expect(JSON.stringify(response._body)).not.toContain('postgres://');
  });
});

/**
 * Tests for POST /api/ai/planner-run (api/ai/planner-run.ts).
 *
 * Backend-only: the DB layer, quota, and board loader are mocked. The endpoint
 * streams NDJSON PlannerAction events and persists a planner_runs row. The
 * deterministic greedy orchestrator is used so runs are reproducible.
 */

import { randomUUID } from 'crypto';

jest.mock('../../api/board', () => ({
  parseProgramVersionId: jest.requireActual('../../api/board').parseProgramVersionId,
  queryBoardJson: jest.fn(),
}));
jest.mock('../../api/ai/_planner_runs', () => ({
  createRun: jest.fn().mockResolvedValue('run-1'),
  markRunFinal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../api/ai/_quota', () => ({
  checkAndEnsureSession: jest.fn().mockResolvedValue({ allowed: true, credits_used: 0, credits_paid: 0, free_limit: 5, remaining: 5 }),
  incrementCreditsUsed: jest.fn().mockResolvedValue(undefined),
  logUsageEvent: jest.fn().mockResolvedValue(undefined),
}));

import handler from '../../api/ai/planner-run';
import { queryBoardJson } from '../../api/board';
import { createRun, markRunFinal } from '../../api/ai/_planner_runs';

// Small, fast board: 1 fixed mandatory, 1 category (1 candidate), 2 electives; 12 degree hours.
const BOARD = {
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [
      { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
    ] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: {
      total_required_hours: 12,
      categories: [{ category_id: 'fluids', name_he: 'זורמים', min_courses: 1, course_ids: ['FLU'] }],
    },
    program_repository_courses: [
      { course_id: 'FLU', name_he: 'זורם', weekly_hours: 4, category_id: 'fluids', effective_allowed_semesters: ['year_3_semester_b'] },
      { course_id: 'E0', name_he: 'בחירה0', weekly_hours: 4 },
      { course_id: 'E1', name_he: 'בחירה1', weekly_hours: 4 },
    ],
  },
};

function makeReq(body: any, method = 'POST') {
  return { method, body } as any;
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 0,
    ended: false,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn().mockReturnThis(),
    write: jest.fn((c: string) => { chunks.push(c); return true; }),
    end: jest.fn(function (this: any) { this.ended = true; return this; }),
  };
  res._chunks = chunks;
  res._events = () => chunks.join('').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return res;
}

const VALID_BODY = {
  program_id: 'mechanical_engineering_2027',
  session_token: randomUUID(),
  orchestrator: 'greedy',
  prior_hours: 0,
};

describe('POST /api/ai/planner-run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (queryBoardJson as jest.Mock).mockResolvedValue(BOARD);
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/testdb';
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  it('returns 405 for non-POST', async () => {
    const res = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 for an invalid body', async () => {
    const res = makeRes();
    await handler(makeReq({ program_id: '' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 503 when DATABASE_URL is missing and dev bypass is not enabled', async () => {
    delete process.env.DATABASE_URL;
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(res.statusCode).toBe(503);
  });

  it('streams run_started → action(s) → done and persists the run', async () => {
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res);

    const events = res._events();
    expect(events[0].type).toBe('run_started');
    expect(events.some((e: any) => e.type === 'action')).toBe(true);
    const final = events[events.length - 1];
    expect(final.type).toBe('done');
    expect(final.status).toBe('done');
    expect(final.validation_report.valid).toBe(true);
    expect(final.selected_plan.semesters.length).toBeGreaterThan(0);

    expect(createRun).toHaveBeenCalled();
    expect(markRunFinal).toHaveBeenCalledWith(
      expect.any(String), 'run-1', expect.objectContaining({ status: 'done' }),
    );
    expect(res.ended).toBe(true);
  });

  it('runs in dev/no-persistence mode (no DB) when dev bypass is enabled and a board is supplied', async () => {
    delete process.env.DATABASE_URL;
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, board_json: BOARD }), res);

    const events = res._events();
    expect(events[events.length - 1].type).toBe('done');
    expect(createRun).not.toHaveBeenCalled();   // no persistence without a DB
    expect(markRunFinal).not.toHaveBeenCalled();
  });
});

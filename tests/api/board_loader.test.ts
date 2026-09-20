/**
 * Tests for api/ai/board_loader.ts — loads the full local board_json snapshot
 * for a program when DATABASE_URL is unavailable.
 *
 * Fix 6 invariant: the planner must NEVER build its planning world from a
 * client-side subset. When DB is absent, use the committed local snapshot or
 * return a clear error. planContextToBoard must not be called in the real path.
 */

import { loadLocalBoardJson } from '../../api/ai/board_loader';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('loadLocalBoardJson', () => {
  it('returns the full board_json for a known program_id', () => {
    const board = loadLocalBoardJson('mechanical_engineering_2027');
    expect(board).not.toBeNull();
    // Must have semesters and a course universe
    expect(Array.isArray(board!.semesters)).toBe(true);
    expect(board!.semesters.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown program_id (no local file)', () => {
    const board = loadLocalBoardJson('unknown_program_9999');
    expect(board).toBeNull();
  });

  it('the full board has a program_repository_courses with many more courses than a typical client subset', () => {
    const board = loadLocalBoardJson('mechanical_engineering_2027')!;
    // The full universe lives in metadata.program_repository_courses
    const repoCourses: any[] = board?.metadata?.program_repository_courses ?? [];
    // The full ME-2027 universe has 50+ courses; a typical client subset has ~4-8
    expect(repoCourses.length).toBeGreaterThan(20);
  });
});

describe('generate-plan — DB-less path uses full local board, not plan_context subset', () => {
  const handler = require('../../api/ai/generate-plan').default;
  const { randomUUID } = require('crypto');

  function makeRes() {
    const res: any = {
      statusCode: 0,
      setHeader: jest.fn().mockReturnThis(),
      status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
      json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
      write: jest.fn(),
      end: jest.fn(),
    };
    return res;
  }

  // Minimal plan_context with only 1 course — much smaller than full universe
  const SPARSE_PLAN_CONTEXT = {
    program_name: 'מכונות',
    semesters: [
      { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
      { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
      { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 0, courses: [] },
      { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
    ],
    category_requirements: [
      { name: 'קטגוריה אחת', category_id: 'cat1', required: 1, placed: 0, candidates: [
        { course_id: 'ONLY_COURSE', name_he: 'קורס יחיד', hours: 4, effective_allowed_semesters: ['year_4_semester_a'] },
      ] },
    ],
    total_hours_progress: { known_completed_hours: 170, degree_required_hours: 185 },
    personal_status: { completed: [] },
    mandatory_unplaced: [],
  };

  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  it('when DB absent, loads full local board and model has many more courses than plan_context', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: SPARSE_PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
    } }, res);

    expect(res.statusCode).toBe(200);
    // The trace should reference courses not in SPARSE_PLAN_CONTEXT (proof of full universe)
    const body = res._body;
    const allPlacedIds: string[] = body.semesters.flatMap((s: any) => s.course_ids);
    // In a full-universe plan, there will be many more courses placed than just ONLY_COURSE
    expect(allPlacedIds.length).toBeGreaterThan(1);
  });

  it('returns 503 NO_UNIVERSE when DB absent and no local snapshot for program_id', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {
      program_id: 'unknown_program_9999',
      plan_context: SPARSE_PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
    } }, res);

    expect(res.statusCode).toBe(503);
    const body = res._body;
    expect(body.code).toBe('NO_UNIVERSE');
  });

  it('a course absent from plan_context but present in local board appears in model profiles', async () => {
    // Load the full board directly to find a course not in SPARSE_PLAN_CONTEXT
    const board = loadLocalBoardJson('mechanical_engineering_2027')!;
    const allBoardCourseIds = new Set<string>();
    for (const sem of board.semesters) for (const c of sem.courses ?? []) allBoardCourseIds.add(c.course_id);

    const planCtxCourseIds = new Set(['ONLY_COURSE']);
    const courseInBoardNotInCtx = [...allBoardCourseIds].find(id => !planCtxCourseIds.has(id));
    expect(courseInBoardNotInCtx).toBeDefined();

    // If the model is built from the full board, the placed courses in the response
    // may include courses absent from SPARSE_PLAN_CONTEXT
    const res = makeRes();
    await handler({ method: 'POST', body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: SPARSE_PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
    } }, res);

    expect(res.statusCode).toBe(200);
    // At minimum, the plan should NOT be limited to just ONLY_COURSE
    const allPlacedIds: string[] = res._body.semesters.flatMap((s: any) => s.course_ids);
    const hasCoursesFromFullBoard = allPlacedIds.some(id => id !== 'ONLY_COURSE');
    expect(hasCoursesFromFullBoard).toBe(true);
  });
});

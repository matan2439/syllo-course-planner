/**
 * B8 — exact in-progress/off-board planned credit must reach SEARCH, not only
 * the final shortfall gate. Otherwise the response can be valid yet contain a
 * filler course beyond the student's real remaining degree state.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({ loadPreparedEvidenceDocuments: jest.fn(() => []) }));

import generateHandler from '../../api/ai/generate-plan';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const SEMESTER = 'year_4_semester_a';
const course = (course_id: string, weekly_hours: number) => ({
  course_id, name_he: course_id, weekly_hours,
  is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
  offered_semesters: [SEMESTER], prerequisites: [],
});

const BOARD = {
  semesters: [{ semester_id: SEMESTER, courses: [] }],
  metadata: {
    board_data_version: 'in-progress-hours-red-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: [
      course('DONE_5H', 5), course('FILLER_3H', 3),
      course('CURRENT_3H', 3), course('PLANNED_3H', 3),
    ],
  },
};

function makeRes() {
  return {
    statusCode: 0,
    setHeader: jest.fn(), getHeader: jest.fn(),
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, body: any) { this._body = body; return this; }),
    write: jest.fn(), end: jest.fn(),
  } as any;
}

beforeAll(() => {
  process.env.AI_DEV_MODE = 'true';
  process.env.AI_DEV_BYPASS_QUOTA = 'true';
});
afterAll(() => {
  delete process.env.AI_DEV_MODE;
  delete process.env.AI_DEV_BYPASS_QUOTA;
});

async function run(personal_status: any, total_hours_progress: any, semesters: any[] = [{ id: SEMESTER, courses: [] }], preferences: any = { disallowed_course_ids: [] }) {
  const res = makeRes();
  await generateHandler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'c'.repeat(48)}` },
    body: {
      program_id: 'test_program_in_progress_hours_2027',
      plan_context: {
        semesters, personal_status, total_hours_progress,
      },
      preferences,
      session_token: '22222222-2222-4222-8222-222222222222',
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
    },
  } as any, res);
  return res;
}

const baseStatus = (over: Record<string, unknown> = {}) => ({
  completed: [{ course_id: 'DONE_5H' }],
  currently_taking: [], planned: [],
  completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  ...over,
});

test('off-board planned hours that close the degree prevent filler over-allocation', async () => {
  const res = await run(
    baseStatus({ planned: [{ course_id: 'OFFBOARD_PLANNED_3H', hours: 3 }] }),
    { known_completed_hours: 5, currently_planned_hours: 3 },
  );

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual([]);
  expect(res._body.academicDecision.academicProgress).toMatchObject({
    inProgressHours: 3,
    currentlyTakingHours: 0,
    aggregateOnlyHours: 0,
  });
  expect(res._body.academicDecision.academicProgress.explanationHe.join(' ')).toContain('מתוכננות מחוץ לחלון');
});

test('an unplaced currently-taking catalog course closes the search gap and is not re-proposed', async () => {
  const res = await run(
    baseStatus({ currently_taking: [{ course_id: 'CURRENT_3H' }] }),
    { known_completed_hours: 5, currently_planned_hours: 3 },
  );
  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual([]);
  expect(res._body.blocked).toBe(false);
  expect(res._body.academicDecision.academicProgress.currentlyTakingHours).toBe(3);
  expect(res._body.academicDecision.academicProgress.explanationHe.join(' ')).toContain('טרם הושלמו');
});

test('a currently-taking course already visible on the board is counted once', async () => {
  const res = await run(
    baseStatus({ currently_taking: [{ course_id: 'CURRENT_3H' }] }),
    { known_completed_hours: 5, currently_planned_hours: 0 },
    [{ id: SEMESTER, courses: [{ course_id: 'CURRENT_3H' }] }],
  );
  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual(['CURRENT_3H']);
  expect(res._body.blocked).toBe(false);
});

test('a stale aggregate cannot count an identified on-board current course a second time', async () => {
  const res = await run(
    baseStatus({ currently_taking: [{ course_id: 'CURRENT_3H' }] }),
    // The typed contract says this aggregate is off-board only, but an older
    // or fabricated client can still send a contradictory value. The server
    // knows the identity is already placed and must fail safe against a second
    // identity-free credit.
    { known_completed_hours: 5, currently_planned_hours: 3 },
    [{ id: SEMESTER, courses: [{ course_id: 'CURRENT_3H' }] }],
  );

  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual(['CURRENT_3H']);
  expect(res._body.academicDecision.academicProgress).toMatchObject({
    inProgressHours: 0,
    currentlyTakingHours: 0,
    aggregateOnlyHours: 0,
  });
  expect(res._body.academicDecision.academicProgress.explanationHe.join(' ')).not.toContain('ללא זהות קורס');
});

test('an in-catalog planned course is not pre-credited and must still be placed', async () => {
  const res = await run(
    baseStatus({ planned: [{ course_id: 'PLANNED_3H', hours: 3 }] }),
    { known_completed_hours: 5, currently_planned_hours: 3 },
    undefined,
    { disallowed_course_ids: [], wanted_course_ids: ['PLANNED_3H'] },
  );
  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual(['PLANNED_3H']);
});

test('aggregate-only residual closes search without inventing a course id', async () => {
  const res = await run(
    baseStatus({ planned: [{ course_id: 'UNKNOWN_WITHOUT_HOURS' }] }),
    { known_completed_hours: 5, currently_planned_hours: 3 },
  );
  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toEqual([]);
  expect(JSON.stringify(res._body)).not.toContain('UNKNOWN_WITHOUT_HOURS');
});

test('insufficient aggregate credit does not suppress genuinely needed planning', async () => {
  const res = await run(
    baseStatus({ planned: [{ course_id: 'UNKNOWN_WITHOUT_HOURS' }] }),
    { known_completed_hours: 5, currently_planned_hours: 2 },
  );
  expect(res.statusCode).toBe(200);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids).length).toBe(1);
});

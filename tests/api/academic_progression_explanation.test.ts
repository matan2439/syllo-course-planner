/**
 * Phase A.3 — completed-course academic progression must be grounded in the
 * authoritative prerequisite graph and reach the native explanation.
 *
 * Break caught: legality can correctly admit ADV because PRE was completed,
 * while AcademicProgress says nothing about that prerequisite contribution.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({ loadPreparedEvidenceDocuments: jest.fn(() => []) }));

import handler from '../../api/ai/generate-plan';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const SEMESTER = 'year_4_semester_b';
const course = (course_id: string, prerequisites: string[] = []) => ({
  course_id,
  name_he: course_id === 'PRE' ? 'קורס יסוד' : 'קורס המשך',
  weekly_hours: 2,
  is_mandatory: false,
  course_type: 'elective',
  placement_policy: 'elective',
  offered_semesters: [SEMESTER],
  prerequisites,
});

const BOARD = {
  semesters: [{ semester_id: SEMESTER, courses: [] }],
  metadata: {
    board_data_version: 'progression-explanation-red-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 4, categories: [] },
    program_repository_courses: [course('PRE'), course('ADV', ['PRE']), course('GHOST_ADV', ['GHOST'])],
  },
};

const makeRes = () => ({
  statusCode: 0,
  setHeader: jest.fn().mockReturnThis(),
  getHeader: jest.fn(),
  status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
  json: jest.fn(function (this: any, body: any) { this._body = body; return this; }),
  write: jest.fn(),
  end: jest.fn(),
} as any);

beforeAll(() => {
  process.env.AI_DEV_MODE = 'true';
  process.env.AI_DEV_BYPASS_QUOTA = 'true';
});

afterAll(() => {
  delete process.env.AI_DEV_MODE;
  delete process.env.AI_DEV_BYPASS_QUOTA;
});

test('a completed prerequisite truthfully explains the newly eligible course it unlocks', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'7'.repeat(48)}` },
    body: {
      program_id: 'test_progression_2027',
      plan_context: {
        semesters: [{ id: SEMESTER, courses: [] }],
        personal_status: {
          completed: [{ course_id: 'PRE' }],
          currently_taking: [],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 2 },
      },
      preferences: { wanted_course_ids: ['ADV'], disallowed_course_ids: [] },
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      session_token: '77777777-7777-4777-8777-777777777777',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toContain('ADV');

  const progress = res._body.academicDecision.academicProgress;
  expect(progress.prerequisiteContributions).toEqual([
    { completedCourseId: 'PRE', unlockedCourseIds: ['ADV'] },
  ]);
  expect(progress.explanationHe.join(' ')).toContain('קורס יסוד');
  expect(progress.explanationHe.join(' ')).toContain('קורס המשך');
  expect(progress.explanationHe.join(' ')).toContain('תנאי קדם');
});

test('an unrecognized completed id cannot satisfy a hard wanted course prerequisite', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'8'.repeat(48)}` },
    body: {
      program_id: 'test_progression_2027',
      plan_context: {
        semesters: [{ id: SEMESTER, courses: [] }],
        personal_status: {
          completed: [{ course_id: 'GHOST' }],
          currently_taking: [],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 0 },
      },
      preferences: { wanted_course_ids: ['GHOST_ADV'], disallowed_course_ids: [] },
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      session_token: '88888888-8888-4888-8888-888888888888',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(true);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('GHOST_ADV');
  expect(res._body.academicDecision.academicProgress.unresolvedCourseIds).toEqual(['GHOST']);
});

test('an unrecognized currently-taking id cannot satisfy a hard wanted course prerequisite', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'6'.repeat(48)}` },
    body: {
      program_id: 'test_progression_2027',
      plan_context: {
        semesters: [{ id: SEMESTER, courses: [] }],
        personal_status: {
          completed: [],
          currently_taking: [{ course_id: 'GHOST', hours: 2 }],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 0, currently_planned_hours: 2 },
      },
      preferences: { wanted_course_ids: ['GHOST_ADV'], disallowed_course_ids: [] },
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      session_token: '66666666-6666-4666-8666-666666666666',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(true);
  expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('GHOST_ADV');
});

/**
 * B9 — realistic combined-state acceptance against the frozen Mechanical 2027
 * program.  The regression this catches is a split academic truth: completion,
 * in-progress prerequisites, hard constraints, ranking, and alternatives may
 * each work alone while the native handler composes them against different
 * progress states.
 */
import handler from '../../api/ai/generate-plan';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SESSION_COOKIE } from '../../api/ai/session_owner';

const BOARD = JSON.parse(readFileSync(
  join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'),
  'utf8',
));

const COMPLETED_BY_CATEGORY = ['0542-4120', '0542-4220', '0542-4420', '0581-4131'];
const CURRENT_PREREQUISITE = '0542-4621';
const WANTED_SUCCESSOR = '0542-4624';
const EXCLUDED_MATERIALS_COURSE = '0542-4425';

const makeRes = () => ({
  statusCode: 0,
  setHeader: jest.fn().mockReturnThis(),
  getHeader: jest.fn(),
  status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
  json: jest.fn(function (this: any, body: any) { this._body = body; return this; }),
  write: jest.fn(),
  end: jest.fn(),
} as any);

const plannedIds = (plan: any): string[] => [
  ...new Set<string>((plan?.semesters ?? []).flatMap((s: any) => s.course_ids ?? s.courseIds ?? [])),
].sort();

const candidatePlans = (body: any): any[] => {
  const alternatives = body?.academicDecision?.candidates?.alternatives ?? [];
  return alternatives.length > 0 ? alternatives : [{ semesters: body?.semesters ?? [] }];
};

beforeAll(() => {
  process.env.AI_DEV_MODE = 'true';
  process.env.AI_DEV_BYPASS_QUOTA = 'true';
});

afterAll(() => {
  delete process.env.AI_DEV_MODE;
  delete process.env.AI_DEV_BYPASS_QUOTA;
});

test('one native request composes authoritative progress, current prerequisites, hard constraints, and grounded preferences', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'9'.repeat(48)}` },
    body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: {
        semesters: BOARD.semesters.map((semester: any) => ({
          id: semester.semester_id,
          courses: (semester.courses ?? []).map((course: any) => ({ course_id: course.course_id })),
        })),
        personal_status: {
          completed: COMPLETED_BY_CATEGORY.map((course_id) => ({ course_id })),
          currently_taking: [{ course_id: CURRENT_PREREQUISITE }],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 92, currently_planned_hours: 3 },
      },
      preferences: {
        wanted_course_ids: [WANTED_SUCCESSOR],
        disallowed_course_ids: [EXCLUDED_MATERIALS_COURSE],
      },
      academic_interest_profile: { focusAreas: [{ area: 'materials', weight: 1 }] },
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      session_token: '99999999-9999-4999-8999-999999999999',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);

  const progress = res._body.academicDecision.academicProgress;
  expect(progress).toMatchObject({
    recognizedCourseCount: 4,
    recognizedHours: 13,
    currentlyTakingHours: 3,
    inProgressHours: 3,
  });
  expect(progress.remainingByCategory.map((c: any) => ({
    name: c.name,
    remaining: c.remaining,
    satisfiedBy: c.satisfiedBy,
  }))).toEqual([
    { name: 'מעבדות מתקדמות', remaining: 0, satisfiedBy: ['0581-4131'] },
    { name: 'קורסי ליבה — זורמים', remaining: 0, satisfiedBy: ['0542-4120'] },
    { name: 'קורסי ליבה — מוצקים', remaining: 0, satisfiedBy: ['0542-4220'] },
    { name: 'קורסי ליבה — מערכות', remaining: 0, satisfiedBy: ['0542-4420'] },
  ]);

  const plans = candidatePlans(res._body);
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    const ids = plannedIds(plan);
    expect(ids).toContain(WANTED_SUCCESSOR);
    expect(ids).not.toContain(EXCLUDED_MATERIALS_COURSE);
    expect(ids).not.toContain(CURRENT_PREREQUISITE);
    for (const completedId of COMPLETED_BY_CATEGORY) expect(ids).not.toContain(completedId);
  }

  const alternatives = res._body.academicDecision.candidates.alternatives ?? [];
  if (alternatives.length > 1) {
    expect(new Set(alternatives.map((a: any) => a.constraintFingerprint)).size).toBe(1);
    expect(new Set(alternatives.map((a: any) => a.profileVersion)).size).toBe(1);
    expect(new Set(alternatives.map((a: any) => a.snapshotId)).size).toBe(1);
  }
});

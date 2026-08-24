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
const ADVANCED_LABS = ['0542-4391', '0542-4624', '0581-4131', '0542-4093', '0542-4094'];
const COMPLETED_MID_DEGREE_MANDATORY = ['0512-1204', '0542-2400'];
const REMAINING_MANDATORY = [
  '0542-2500',
  '0542-3243',
  '0542-3620',
  '0542-3780',
  '0542-3791',
  '0542-3792',
  '0542-4010',
  '0542-4020',
  '0542-4091',
  '0542-4092',
];
const ALL_MANDATORY = [...COMPLETED_MID_DEGREE_MANDATORY, ...REMAINING_MANDATORY];

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

test('a near-graduation request fills the one remaining real category without using an excluded lab', async () => {
  const completedCore = COMPLETED_BY_CATEGORY.slice(0, 3);
  const excludedLab = '0581-4131';
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'8'.repeat(48)}` },
    body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: {
        semesters: BOARD.semesters.map((semester: any) => ({
          id: semester.semester_id,
          courses: (semester.courses ?? []).map((course: any) => ({ course_id: course.course_id })),
        })),
        personal_status: {
          completed: completedCore.map((course_id) => ({ course_id })),
          currently_taking: [{ course_id: CURRENT_PREREQUISITE }],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        // The aggregate closes only the identity-free hour total. It cannot
        // manufacture the still-missing advanced-lab category fact.
        total_hours_progress: { known_completed_hours: 181, currently_planned_hours: 3 },
      },
      preferences: { wanted_course_ids: [], disallowed_course_ids: [excludedLab] },
      use_academic_decision_agent: true,
      preference_profile: { version: 2, preferences: [] },
      session_token: '88888888-8888-4888-8888-888888888888',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);
  const labGap = res._body.academicDecision.academicProgress.remainingByCategory
    .find((category: any) => category.name === 'מעבדות מתקדמות');
  expect(labGap).toMatchObject({ remaining: 1, satisfiedBy: [] });

  const plans = candidatePlans(res._body);
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    const ids = plannedIds(plan);
    expect(ids).not.toContain(excludedLab);
    expect(ids).not.toContain(CURRENT_PREREQUISITE);
    for (const completedId of completedCore) expect(ids).not.toContain(completedId);
    expect(ids.some((id) => ADVANCED_LABS.includes(id) && id !== excludedLab)).toBe(true);
  }
});

test('a mid-degree request plans every remaining real mandatory course without rescheduling completed or current study', async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'7'.repeat(48)}` },
    body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: {
        semesters: BOARD.semesters.map((semester: any) => ({
          id: semester.semester_id,
          courses: (semester.courses ?? []).map((course: any) => ({ course_id: course.course_id })),
        })),
        personal_status: {
          completed: COMPLETED_MID_DEGREE_MANDATORY.map((course_id) => ({ course_id })),
          currently_taking: [{ course_id: CURRENT_PREREQUISITE }],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 90, currently_planned_hours: 3 },
      },
      preferences: { wanted_course_ids: [], disallowed_course_ids: [] },
      use_academic_decision_agent: true,
      preference_profile: { version: 3, preferences: [] },
      session_token: '77777777-7777-4777-8777-777777777777',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);
  expect(res._body.academicDecision.academicProgress).toMatchObject({
    recognizedCourseCount: 2,
    recognizedHours: 7.5,
    currentlyTakingHours: 3,
    inProgressHours: 3,
  });
  expect(res._body.academicDecision.academicProgress.remainingByCategory.map((category: any) => ({
    name: category.name,
    remaining: category.remaining,
  }))).toEqual([
    { name: 'מעבדות מתקדמות', remaining: 1 },
    { name: 'קורסי ליבה — זורמים', remaining: 1 },
    { name: 'קורסי ליבה — מוצקים', remaining: 1 },
    { name: 'קורסי ליבה — מערכות', remaining: 1 },
  ]);

  const plans = candidatePlans(res._body);
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    const ids = plannedIds(plan);
    for (const completedId of COMPLETED_MID_DEGREE_MANDATORY) expect(ids).not.toContain(completedId);
    expect(ids).not.toContain(CURRENT_PREREQUISITE);
    for (const mandatoryId of REMAINING_MANDATORY) expect(ids).toContain(mandatoryId);
  }
});

test('a fully completed real degree produces no phantom future courses or reopened requirements', async () => {
  const completed = [...ALL_MANDATORY, ...COMPLETED_BY_CATEGORY];
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'6'.repeat(48)}` },
    body: {
      program_id: 'mechanical_engineering_2027',
      plan_context: {
        semesters: BOARD.semesters.map((semester: any) => ({
          id: semester.semester_id,
          courses: (semester.courses ?? []).map((course: any) => ({ course_id: course.course_id })),
        })),
        personal_status: {
          completed: completed.map((course_id) => ({ course_id })),
          currently_taking: [],
          planned: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 185, currently_planned_hours: 0 },
      },
      preferences: { wanted_course_ids: [], disallowed_course_ids: [] },
      use_academic_decision_agent: true,
      preference_profile: { version: 4, preferences: [] },
      session_token: '66666666-6666-4666-8666-666666666666',
    },
  } as any, res);

  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);
  expect(res._body.requirements_status.every((requirement: any) => requirement.satisfied)).toBe(true);
  expect(res._body.academicDecision.academicProgress).toMatchObject({
    recognizedCourseCount: 16,
    inProgressHours: 0,
    currentlyTakingHours: 0,
    aggregateOnlyHours: 0,
  });
  expect(res._body.academicDecision.academicProgress.remainingByCategory.every(
    (category: any) => category.remaining === 0,
  )).toBe(true);

  const plans = candidatePlans(res._body);
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) expect(plannedIds(plan)).toEqual([]);
});

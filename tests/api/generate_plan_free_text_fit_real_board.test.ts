/**
 * PRODUCT acceptance — a broad Hebrew USER-FIT request ("אני רוצה להתמקד בתכן",
 * "I want to focus on design") measurably shifts the ACTUAL native proposal's
 * elective selection toward design-aligned courses on the REAL Mechanical-
 * Engineering board — without violating legality, completion, or workload, and
 * without manufacturing surplus.
 *
 * Generic by construction: the request resolves to a canonical AcademicFocusArea
 * (mechanical_design) with a strength — NOT a design-only boolean — via the SAME
 * keyword vocabulary the course-side inference uses, and reaches the planner as a
 * per-course fit signal (scorePlan's interest_fit goal). The evidence that a
 * course is design-aligned is the existing deterministic topic-profile inference
 * (getTopicWeight(profile,'mechanical_design') > 0), never this test's opinion.
 *
 * No production logic is special-cased for this sentence, area, or course id.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMechanicalEngineering2027TopicProfiles } from '../../api/ai/course_topic_profiles_static';
import { getTopicWeight } from '../../api/ai/course_topic_profile';

const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);
const FOCUS_SENTENCE = 'אני רוצה להתמקד בתכן';
const TOPICS = getMechanicalEngineering2027TopicProfiles();
const designWeight = (id: string): number => {
  const tp = TOPICS[id];
  return tp ? getTopicWeight(tp, 'mechanical_design') : 0;
};

function planContext() {
  return {
    semesters: BOARD.semesters.map((s: any) => ({
      id: s.semester_id,
      courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })),
    })),
    personal_status: { completed: [], currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: 90 },
  };
}
const makeRes = () => {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
};
async function run(body: any) {
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id: 'mechanical_engineering_2027', session_token: randomUUID(), ...body } } as any, res);
  return res;
}
const placedIds = (body: any): string[] => [...new Set((body.semesters as any[]).flatMap((s) => s.course_ids))];
const designFitSum = (body: any): number => placedIds(body).reduce((sum, id) => sum + designWeight(id), 0);
const designPlaced = (body: any): string[] => placedIds(body).filter((id) => designWeight(id) > 0);
const totalHours = (body: any): number => {
  // exact accounting via the model's own hours would require the model; use the board's declared hours.
  const hoursById = new Map<string, number>();
  for (const s of BOARD.semesters) for (const c of (s.courses || [])) if (typeof c.hours === 'number') hoursById.set(c.course_id, c.hours);
  for (const c of (BOARD.metadata?.program_repository_courses || [])) if (typeof c.hours === 'number') hoursById.set(c.course_id, c.hours);
  return placedIds(body).reduce((sum, id) => sum + (hoursById.get(id) ?? 0), 0);
};

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// (16) CONTROL — no focus request: never claims a design preference was requested/honored.
test('CONTROL: without the request, no intentOutcome is attached (no false honored claim)', async () => {
  const res = await run({ plan_context: planContext(), preferences: {} });
  expect(res.statusCode).toBe(200);
  expect(res._body.intentOutcome).toBeUndefined();
}, 60000);

// (2,4,5,6,11,12,15,17) The core non-vacuous shift + legality/completion/outcome.
test('the focus request shifts the real proposal toward design — legal, complete, no surplus, honestly reported', async () => {
  const control = await run({ plan_context: planContext(), preferences: {} });
  const focus = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: FOCUS_SENTENCE },
    interpret_free_text: true,
  });
  expect(focus.statusCode).toBe(200);
  expect(focus._body.blocked).toBe(false);
  expect(focus._body.errors).toEqual([]);

  // (4) non-vacuous: the request measurably increases design alignment of the actual placements
  expect(designFitSum(focus._body)).toBeGreaterThan(designFitSum(control._body));
  // (5)+(6) at least one verified design-aligned course present, backed by repository evidence
  expect(designPlaced(focus._body).length).toBeGreaterThan(0);
  for (const id of designPlaced(focus._body)) expect(designWeight(id)).toBeGreaterThan(0);
  // a specific design course the control did NOT place is now present (the actual selection changed)
  const newlyDesign = designPlaced(focus._body).filter((id) => !placedIds(control._body).includes(id));
  expect(newlyDesign.length).toBeGreaterThan(0);

  // (14) no surplus degree hours manufactured to fake alignment: focus does not carry more hours than control
  expect(totalHours(focus._body)).toBeLessThanOrEqual(totalHours(control._body));

  // (15) outcome derived from the ACTUAL plan, and (16) truthful
  expect(focus._body.intentOutcome).toBeDefined();
  expect(focus._body.intentOutcome.honored.join(' ')).toContain('תכן');
}, 120000);

// (9) explicit exclusion wins over a general user-fit preference.
test('explicit exclusion beats the focus preference: a disallowed design course stays absent', async () => {
  const control = await run({ plan_context: planContext(), preferences: {} });
  const focus = await run({ plan_context: planContext(), preferences: { extra_request_he: FOCUS_SENTENCE }, interpret_free_text: true });
  // A design course the FOCUS plan added beyond the control is, by construction, an
  // elective (mandatory courses appear in both) — the exclusion must be able to drop it.
  const newlyDesign = designPlaced(focus._body).filter((id) => !placedIds(control._body).includes(id));
  const target = newlyDesign[0];
  expect(typeof target).toBe('string');
  const excluded = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: FOCUS_SENTENCE, disallowed_course_ids: [target] },
    interpret_free_text: true,
  });
  expect(excluded.statusCode).toBe(200);
  expect(placedIds(excluded._body)).not.toContain(target); // exclusion wins over the fit preference
}, 120000);

// (10) an explicit wanted-course preference outranks the general fit preference.
test('explicit wanted course is honored alongside the focus preference (wanted outranks fit)', async () => {
  const OSC = '0542-4220'; // תורת התנודות — a non-design elective, B-only
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: FOCUS_SENTENCE, wanted_course_ids: [OSC] },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).toContain(OSC); // wanted honored despite the fit pull toward design
}, 120000);

// (19) an unsupported/undiscoverable focus domain is reported honestly, never fabricated into placements.
test('an unresolved focus domain does not falsely claim to have changed the plan', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: 'אני רוצה להתמקד במשהו שלא קיים כתחום' },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.intentOutcome.honored.join(' ')).not.toContain('התמקד');
  // it is reported as not-recognized, not silently honored
  expect(res._body.intentOutcome.unmet.length).toBeGreaterThan(0);
}, 60000);

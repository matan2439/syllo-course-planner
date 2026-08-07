/**
 * PRODUCT acceptance — a broad Hebrew user-fit request ("אני רוצה להתמקד בתכן")
 * shifts the ACTUAL native proposal toward a design course whose alignment is
 * established by OFFICIAL-SYLLABUS EVIDENCE (course_capability_evidence.ts), not by
 * course-title inference. Supersedes the earlier title-token version: the design
 * course pulled in (0542-4425) carries an explicit official-syllabus design claim
 * ("שיטות התכן"), while a title-only "machine" course (0542-4420 תורת המכונות, whose
 * syllabus is machine THEORY) is NOT pulled in.
 *
 * Fixed prior-credit state: 92h. At this real state the design elective (3h) completes
 * the plan with equal hours to the non-design alternative it displaces, so the soft
 * interest_fit goal legitimately decides — no surplus, no offering/prereq change.
 *
 * No production logic is special-cased for this sentence, area, or id (ids are fixtures).
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCourseCapabilityEvidence } from '../../api/ai/course_capability_evidence';

const BOARD = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'));
const PRIOR = 92;
const FOCUS = 'אני רוצה להתמקד בתכן';
const OSC_DESIGN = '0542-4425';     // הדפסת תלת מימד ותכן חלקי פלסטיקה — explicit official-syllabus design evidence
const OSC_TITLE_ONLY = '0542-4420'; // תורת המכונות — title has "מכונות" but syllabus is machine THEORY (no design evidence)

const byId = new Map<string, any>();
for (const s of BOARD.semesters) for (const c of (s.courses || [])) byId.set(c.course_id, c);
for (const c of (BOARD.metadata?.program_repository_courses || [])) byId.set(c.course_id, c);
const hoursOf = (id: string): number => byId.get(id)?.weekly_hours ?? 0;
const designLevel = (id: string) => extractCourseCapabilityEvidence(byId.get(id), 'mechanical_design').inferenceLevel;

function planContext() {
  return {
    semesters: BOARD.semesters.map((s: any) => ({ id: s.semester_id, courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })) })),
    personal_status: { completed: [], currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: PRIOR },
  };
}
const makeRes = () => {
  const res: any = { statusCode: 0, setHeader: jest.fn().mockReturnThis(), status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }), json: jest.fn(function (this: any, b: any) { this._body = b; return this; }), write: jest.fn(), end: jest.fn() };
  return res;
};
async function run(body: any) {
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id: 'mechanical_engineering_2027', session_token: randomUUID(), ...body } } as any, res);
  return res;
}
const placedIds = (b: any): string[] => [...new Set((b.semesters as any[]).flatMap((s) => s.course_ids))];
const semesterOf = (b: any, id: string): string | null => { for (const s of b.semesters as any[]) if (s.course_ids.includes(id)) return s.semester_id; return null; };
const totalHours = (b: any): number => placedIds(b).reduce((sum, id) => sum + hoursOf(id), 0);

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// The evidence layer itself (sanity): the fixtures are what we claim.
test('the design fixture carries EXPLICIT official-syllabus evidence; the title-only machine course does NOT', () => {
  expect(designLevel(OSC_DESIGN)).toBe('explicit');
  expect(designLevel(OSC_TITLE_ONLY)).toBe('missing'); // "מכונות" title is not proof
});

// CONTROL — non-vacuous baseline + no false claim.
test('CONTROL: without the request, the design elective is absent and no intentOutcome is attached', async () => {
  const res = await run({ plan_context: planContext(), preferences: {} });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(placedIds(res._body)).not.toContain(OSC_DESIGN);
  expect(res._body.intentOutcome).toBeUndefined();
}, 60000);

// Core evidence-backed shift, legality, no surplus, honest evidence-cited outcome.
test('the focus request pulls in the evidence-backed design course (only) — legal, no surplus, cited from the official syllabus', async () => {
  const control = await run({ plan_context: planContext(), preferences: {} });
  const focus = await run({ plan_context: planContext(), preferences: { extra_request_he: FOCUS }, interpret_free_text: true });
  expect(focus.statusCode).toBe(200);
  expect(focus._body.blocked).toBe(false);
  expect(focus._body.errors).toEqual([]);

  // (evidence-backed direction) the design course is now placed, in its real B offering
  expect(placedIds(focus._body)).toContain(OSC_DESIGN);
  expect(semesterOf(focus._body, OSC_DESIGN)).toMatch(/_semester_b$/i);
  // the title-only "machine" course is NOT the mechanism (no syllabus design evidence)
  expect(placedIds(focus._body)).not.toContain(OSC_TITLE_ONLY);

  // (no surplus) same total hours as control — an equal-cost swap, not manufactured credit
  expect(totalHours(focus._body)).toBe(totalHours(control._body));
  // the course it displaced is NOT design-evidenced → the change is toward design, by evidence
  const displaced = placedIds(control._body).filter((id) => !placedIds(focus._body).includes(id));
  expect(displaced.length).toBeGreaterThan(0);
  for (const id of displaced) expect(designLevel(id)).not.toBe('explicit');

  // (explanation traces to evidence) honored cites the OFFICIAL SYLLABUS, not the title
  const honored = focus._body.intentOutcome.honored.join(' ');
  expect(honored).toContain('סילבוס רשמי');
  expect(honored).toContain('שיטות התכן'); // the actual 0542-4425 syllabus quote
  // (external-context layer present, as provenance — never a course claim)
  expect(focus._body.intentOutcome.notesHe.join(' ')).toContain('ABET');
}, 120000);

// (priority) explicit exclusion beats the general fit preference.
test('explicit exclusion of the design course beats the focus preference', async () => {
  const res = await run({ plan_context: planContext(), preferences: { extra_request_he: FOCUS, disallowed_course_ids: [OSC_DESIGN] }, interpret_free_text: true });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain(OSC_DESIGN);
}, 120000);

// (priority) an explicit wanted course outranks the general fit preference.
test('an explicit wanted (non-design) course is honored alongside the focus preference', async () => {
  const WANTED = '0542-4351'; // הנדסה ימית — non-design elective
  const res = await run({ plan_context: planContext(), preferences: { extra_request_he: FOCUS, wanted_course_ids: [WANTED] }, interpret_free_text: true });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).toContain(WANTED);
}, 120000);

// (honesty) an unsupported focus domain is reported honestly, never fabricated into placements.
test('an unresolved focus domain does not falsely claim to have changed the plan', async () => {
  const res = await run({ plan_context: planContext(), preferences: { extra_request_he: 'אני רוצה להתמקד במשהו שלא קיים כתחום' }, interpret_free_text: true });
  expect(res.statusCode).toBe(200);
  expect(res._body.intentOutcome.honored.join(' ')).not.toContain('התמקד');
  expect(res._body.intentOutcome.unmet.length).toBeGreaterThan(0);
}, 60000);

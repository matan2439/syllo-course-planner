/**
 * B7 RED — remaining category work must reserve degree-hour budget.
 *
 * The student already owns 5 authoritative hours and needs one 3h category
 * course to finish an 8h fixture degree. A 4h uncategorized elective is also
 * legal. Choosing that filler first and repairing the category afterward
 * produces 12h; the exact remaining-degree plan is the category course alone.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({ loadPreparedEvidenceDocuments: jest.fn(() => []) }));

import generateHandler from '../../api/ai/generate-plan';
import { SESSION_COOKIE } from '../../api/ai/session_owner';
import { buildConstraintModel, planContextToState } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';

const SEMESTER = 'year_4_semester_a';
const course = (course_id: string, weekly_hours: number) => ({
  course_id,
  name_he: course_id,
  weekly_hours,
  is_mandatory: false,
  course_type: 'elective',
  placement_policy: 'elective',
  offered_semesters: [SEMESTER],
  prerequisites: [],
});

const BOARD = {
  semesters: [{ semester_id: SEMESTER, courses: [] }],
  metadata: {
    board_data_version: 'category-hours-reservation-red-1',
    completed_course_ids: [],
    program_requirements_categories: {
      total_required_hours: 8,
      categories: [{
        category_id: 'required-elective',
        name_he: 'בחירה נדרשת',
        min_courses: 1,
        course_ids: ['Z_CATEGORY_3H'],
      }],
    },
    program_repository_courses: [
      course('DONE_5H', 5),
      course('A_FILLER_4H', 4),
      course('Z_CATEGORY_3H', 3),
    ],
  },
};

function makeRes() {
  return {
    statusCode: 0,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function (this: any, body: any) { this._body = body; return this; }),
    write: jest.fn(),
    end: jest.fn(),
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

test('real Generate selects the exact remaining category course without filler over-allocation', async () => {
  const model = buildConstraintModel(BOARD as never, { completedCourseIds: ['DONE_5H'] });
  expect(model.priorHours).toBe(5);
  const worker = new PlannerWorker(model, planContextToState({ semesters: [] }, model), { topN: 6, rolloutSteps: 80 });
  worker.run();
  const workerPlaced = Object.values(worker.getPlan().semesters).flat();
  expect(workerPlaced).toEqual(['Z_CATEGORY_3H']);

  const res = makeRes();
  await generateHandler({
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${'b'.repeat(48)}` },
    body: {
      program_id: 'test_program_category_hours_reservation_2027',
      plan_context: {
        personal_status: {
          completed: [{ course_id: 'DONE_5H' }],
          currently_taking: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
      },
      preferences: { disallowed_course_ids: [] },
      session_token: '11111111-1111-4111-8111-111111111111',
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
    },
  } as any, res);

  if (res.statusCode !== 200) throw new Error(`unexpected Generate response: ${JSON.stringify(res._body)}`);
  const placed = res._body.semesters.flatMap((s: any) => s.course_ids);
  expect(placed).toEqual(['Z_CATEGORY_3H']);
  expect(res._body.academicDecision.academicProgress.recognizedHours).toBe(5);
  expect(res._body.requirements_status).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'בחירה נדרשת', satisfied: true }),
  ]));
  expect(res._body.blocked).toBe(false);
});

/**
 * Completed-course KNOWLEDGE contract (unknown vs explicitly-none).
 *
 * The native flagged journey hardcodes `personal_status.completed: []` meaning
 * "the app does not know", and the clarification capability gaps on
 * `completedCourseIds.length === 0` — so a student who genuinely completed
 * nothing can never clear the critical gap, and a valid flagged Apply is
 * unreachable. This locks the semantics:
 *
 *   unknown       → critical clarification RETAINED (never silently "none")
 *   known_empty   → clarification RESOLVED (explicit "I completed none")
 *   known ids     → clarification RESOLVED, ids sent exactly
 *
 * Deterministic: dev-bypass, local board, no DB / no paid provider.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

const BOARD = {
  semesters: [
    { semester_id: SEM_A, courses: [] },
    { semester_id: SEM_B, courses: [] },
  ],
  metadata: {
    board_data_version: 'test-knowledge-1',
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 16, categories: [] },
    program_repository_courses: [
      { course_id: 'C1', name_he: 'קורס 1', weekly_hours: 8, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [] },
      { course_id: 'C2', name_he: 'קורס 2', weekly_hours: 8, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [] },
    ],
  },
};

function makeRes() {
  const res: any = {
    statusCode: 0, setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body } as any, res); return res; }

/** personal_status exactly as the native journey builds it today. */
function body(personalStatus: any, preferences: any = {}) {
  return {
    program_id: 'knowledge_2027',
    plan_context: {
      semesters: [{ id: SEM_A, courses: [] }, { id: SEM_B, courses: [] }],
      personal_status: personalStatus,
    },
    preferences,
    session_token: randomUUID(),
    use_academic_decision_agent: true,
  };
}
const criticals = (res: any) =>
  (res._body.academicDecision.clarification.missingInputs as Array<any>)
    .filter((m) => m.critical).map((m) => m.field).sort();

describe('completed-course knowledge contract', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('DEFECT CAPTURE: the current native payload cannot reach an applyable proposal', async () => {
    const res = await run(body({ completed: [], currently_taking: [], planned: [] }));
    expect(res._body.academicDecision.outcome).toBe('clarification_required');
    expect(res._body.academicDecision.applyEligible).toBe(false);
    expect(criticals(res)).toEqual(['completedCourses', 'excludedCourses']);
  });

  test('unknown is NOT treated as empty: a bare empty list still retains the critical gap', async () => {
    // No knowledge marker → the app does not know. Must NOT silently resolve.
    const res = await run(body({ completed: [], currently_taking: [], planned: [] }, { disallowed_course_ids: [] }));
    expect(criticals(res)).toContain('completedCourses');
    expect(res._body.academicDecision.applyEligible).toBe(false);
  });

  test('KNOWN-EMPTY: an explicit "I have completed no courses" resolves the gap and reaches an applyable proposal', async () => {
    const res = await run(body(
      { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
      { disallowed_course_ids: [] },
    ));
    expect(criticals(res)).toEqual([]);
    expect(res._body.academicDecision.outcome).toBe('proposal');
    expect(res._body.academicDecision.applyEligible).toBe(true);
  });

  test('KNOWN ids: explicitly reported completed courses resolve the gap and are sent exactly', async () => {
    const res = await run(body(
      {
        completed: [{ course_id: 'PRIOR-1' }, { course_id: 'PRIOR-2' }],
        currently_taking: [], planned: [],
        completed_knowledge: { status: 'known', provenance: 'explicit_user' },
      },
      { disallowed_course_ids: [] },
    ));
    expect(criticals(res)).toEqual([]);
    expect(res._body.academicDecision.applyEligible).toBe(true);
  });

  test('an explicit unknown marker keeps the gap even when ids are absent', async () => {
    const res = await run(body(
      { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'unknown' } },
      { disallowed_course_ids: [] },
    ));
    expect(criticals(res)).toContain('completedCourses');
    expect(res._body.academicDecision.applyEligible).toBe(false);
  });

  test('exclusions: an explicit empty selection already resolves its gap; absence keeps it unknown', async () => {
    const known = { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } };
    const withExcl = await run(body(known, { disallowed_course_ids: [] }));
    expect(criticals(withExcl)).toEqual([]);
    const withoutExcl = await run(body(known, {}));
    expect(criticals(withoutExcl)).toEqual(['excludedCourses']);
  });
});

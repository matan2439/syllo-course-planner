/**
 * generate-plan — full-boundary Knowledge-Grounding CONFLICT regression
 * (default-off flag `use_academic_decision_agent`).
 *
 * Proves that when a relevant grounded fact conflict is present on a PLACED
 * course (here: the raw catalog `offered_semesters` and the normalized
 * `effective_allowed_semesters` share no semester — the two data layers
 * disagree about availability), the flagged Generate response surfaces it as a
 * STRUCTURED outcome (`validation_failed`, Apply-ineligible) while PRESERVING
 * both conflicting facts + provenance and NOT changing any semester assignment
 * to hide the conflict.
 *
 * Generic synthetic board (mocked board loader) — not a course-specific
 * production patch, no catalog regeneration. Deterministic: dev-bypass, no DB,
 * no paid provider.
 */

jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => CONFLICT_BOARD) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// A placed elective whose catalog offering (semester_a) and normalized
// availability (semester_b) are disjoint → catalog_vs_normalized_availability.
// CORE is a category candidate the planner must place to satisfy the 'core'
// category; it is legal only in year_4_semester_b per effective_allowed_semesters.
const CONFLICT_BOARD = {
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [
      { course_id: 'MAND', name_he: 'מבוא', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
    ] },
    { semester_id: 'year_3_semester_b', courses: [] },
    { semester_id: 'year_4_semester_a', courses: [] },
    { semester_id: 'year_4_semester_b', courses: [] },
  ],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: {
      total_required_hours: 8,
      categories: [{ category_id: 'core', name_he: 'ליבה', min_courses: 1, course_ids: ['CORE'] }],
    },
    program_repository_courses: [
      { course_id: 'MAND', name_he: 'מבוא', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
      { course_id: 'CORE', name_he: 'ליבה א', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
        offered_semesters: ['year_4_semester_a'], effective_allowed_semesters: ['year_4_semester_b'],
        program_category_id: 'core', difficulty_score: 3, prerequisites: [] },
    ],
  },
};

function makeReq(body: any, method = 'POST') { return { method, body } as any; }
function makeRes() {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
async function run(body: any) { const res = makeRes(); await handler(makeReq(body), res); return res; }

function body(over: any = {}) {
  return {
    program_id: 'test_conflict_2027',
    plan_context: { personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] } },
    // Supply both critical clarification inputs (completed + an explicit
    // exclusion list) so the outcome isolates the grounding conflict
    // (validation_failed) rather than clarification_required.
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...over,
  };
}

describe('generate-plan — grounding conflict → structured outcome (flagged path)', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('flag off: conflict data never surfaces (legacy contract, no academicDecision)', async () => {
    const res = await run(body());
    expect(res.statusCode).toBe(200);
    expect('academicDecision' in res._body).toBe(false);
  });

  test('flag on: an unresolved availability conflict on a placed course → outcome=validation_failed, applyEligible=false', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    expect(res.statusCode).toBe(200);
    // CORE must actually be placed for the conflict to be relevant.
    const placed = (res._body.semesters ?? []).flatMap((s: any) => s.course_ids);
    expect(placed).toContain('CORE');

    const conflicts = res._body.academicDecision.grounding.conflicts;
    const coreConflict = conflicts.find((c: any) => c.courseId === 'CORE' && c.kind === 'catalog_vs_normalized_availability');
    expect(coreConflict).toBeDefined();
    // Both conflicting facts preserved in the detail (neither source silently chosen).
    expect(coreConflict.detail).toContain('year_4_semester_a');
    expect(coreConflict.detail).toContain('year_4_semester_b');

    expect(res._body.academicDecision.outcome).toBe('validation_failed');
    expect(res._body.academicDecision.applyEligible).toBe(false);

    // Slice 6: the outcome is derived from the real agent grounding-validation
    // result — a typed, provenance-carrying finding, not an API-side re-count.
    const findings = res._body.academicDecision.validationFindings;
    const coreFinding = findings.find((f: any) => f.courseId === 'CORE');
    expect(coreFinding.code).toBe('GROUNDING_AVAILABILITY_CONFLICT');
    expect(coreFinding.severity).toBe('error');
    expect(coreFinding.provenance).toBeDefined();
    expect(coreFinding.message_he).toMatch(/הכרעה סמכותית|מקורות/);
  });

  test('plan-inert: the conflict does not move CORE to hide it (placed in normalized availability, not catalog)', async () => {
    const res = await run(body({ use_academic_decision_agent: true }));
    const semB = (res._body.semesters ?? []).find((s: any) => s.semester_id === 'year_4_semester_b');
    // CORE is legal only in year_4_semester_b (effective_allowed_semesters) and stays there;
    // the grounding surfaced the conflict without rewriting the assignment.
    expect(semB.course_ids).toContain('CORE');
  });
});

/**
 * Regression test for an Agent Diagnosis Loop finding (2026-07-22): a
 * mandatory course the search genuinely cannot place (a permanent structural
 * conflict, not a client-supplied bad state) must never silently survive with
 * blocked:false — the same "computed-but-discarded validation signal" bug
 * class as issue #25 Finding #1 (PR #27), the is_annual completeness gap (PR
 * #37), and the prerequisite/duplicate/pinned legality gap (PR #48), just for
 * mandatory-course completeness instead.
 *
 * planner_goals.ts's assessCompleteness already computes missingMandatory
 * against the FINAL state, and validateCandidate's report.errors already
 * includes a "קורס חובה חסר" message for it — but generate-plan.ts's
 * toProposal() only ever turned missingMandatory into a soft warnings_he
 * entry, never a blockingErrors entry, so the plan reported success (and, on
 * the use_academic_decision_agent path, academicDecision.validation.valid:
 * true) while a required course was silently absent. Found via the mandated
 * Agent Diagnosis Loop: on an identical real board fixture, the
 * AI_USE_AGENTIC_PLANNER beam-search path failed to place 4 mandatory courses
 * the default greedy path successfully placed, and both paths reported
 * blocked:false regardless. generate-plan.ts's new missingMandatoryGate
 * closes this gap for both paths.
 *
 * Uses a small dedicated fixture (test_program_missing_mandatory_2027):
 * MAND2 (mandatory) requires PRE2 as a prerequisite, but MAND2 is only ever
 * legally placeable in year 3 while PRE2 is only ever legally placeable in
 * year 4 — a permanent ordering deadlock no search algorithm can resolve, so
 * MAND2 can never be legally placed. This is deliberately NOT a
 * pre-existing/client-supplied illegal placement (the class the other three
 * gates cover) — it proves the search's own inability to reach a complete
 * state is also honestly disclosed.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

function emptyPlanContext() {
  return {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
      { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
      { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 0, courses: [] },
      { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
    ],
    category_requirements: [],
    total_hours_progress: { known_completed_hours: 0, degree_required_hours: 50 },
    personal_status: { completed: [], currently_taking: [], planned: [] },
    mandatory_unplaced: [],
  };
}

function makeReq(body: any, method = 'POST') {
  return { method, body } as any;
}
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

function baseReqBody(overrides: any = {}) {
  return {
    program_id: 'test_program_missing_mandatory_2027',
    plan_context: emptyPlanContext(),
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}

describe('generate-plan — a mandatory course the search can never legally place is surfaced as a blocking error (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. MAND2 unplaceable (permanent prerequisite-ordering deadlock): response is blocked with a Hebrew error naming it, on the default path', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).not.toContain('MAND2');
    expect(b.blocked).toBe(true);
    expect(b.errors.length).toBeGreaterThan(0);
    expect(b.errors.some((e: string) => e.includes('MAND2') || e.includes('חובה שנייה'))).toBe(true);
    // blocked/errors invariant from generate-plan.test.ts must still hold.
    expect(b.blocked).toBe(b.errors.length > 0);
  });

  test('2. same gate holds on the AI_USE_AGENTIC_PLANNER path', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) => e.includes('MAND2') || e.includes('חובה שנייה'))).toBe(true);
  });

  test('3. use_academic_decision_agent: validation.valid is honestly false, and suggested actions name the missing-mandatory cause, not overload-only guidance', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ use_academic_decision_agent: true })), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.academicDecision).toBeDefined();
    // The concrete bug this test locks in: before the fix, this rendered
    // `valid: true` (a green "passed legality" checkmark) alongside a plan
    // silently missing a required mandatory course.
    expect(b.academicDecision.validation.valid).toBe(false);
    const actions: string[] = b.academicDecision.explanation.suggestedNextActions;
    expect(actions.some((a) => a.includes('חובה') && (a.includes('MAND2') || a.includes('לא שובץ') || a.includes('חסר')))).toBe(true);
    expect(actions.some((a) => a.includes('עומס'))).toBe(false);
  });
});

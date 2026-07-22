/**
 * Regression test for an Agent Diagnosis Loop finding (2026-07-22): a
 * genuinely unrecoverable degree-hours shortfall (every mandatory course and
 * elective category satisfied, the plan otherwise legal, but the visible
 * catalog exhausted before reaching model.degreeRequiredHours) must never
 * silently survive with blocked:false — the same "computed-but-discarded
 * validation signal" bug class as disallowedGate/annualCompletenessGate/
 * legalityGate/missingMandatoryGate above (issue #25 Finding #1, PR #27; the
 * is_annual completeness gap, PR #37; the prerequisite/duplicate/pinned
 * legality gap, PR #48; the missing-mandatory-search-budget gap, PR #?).
 *
 * generate-plan.ts's toProposal() already computed this exact condition (see
 * its own "מיצית את כל הקורסים הזמינים" warnings_he branch, added by an
 * earlier fix) but only ever pushed it as a soft warning, never a
 * blockingErrors entry — so a plan could report blocked:false and, on the
 * use_academic_decision_agent path, academicDecision.validation.valid:true,
 * while academicDecision.explanation.whyThisPlan admitted in the very same
 * response that the plan does not complete degree hours. Concretely
 * reproduced (see the Agent Diagnosis Loop report this fix closes): a fixture
 * with degree_required_hours:100 against a catalog totaling only 12h produced
 * `blocked:false`, `academicDecision.validation.valid:true`, and
 * `academicDecision.explanation.whyThisPlan` containing the Hebrew text for
 * "the plan is not yet complete" in the same payload.
 *
 * Reuses the exact same fixture/scenario
 * (generate_plan_structural_degree_gap_warning.test.ts's test_program_gap_2027,
 * planContext(0)) that already proves the underlying exhaustion condition is
 * genuinely unrecoverable (20+ Codex-hardened rounds covering ADD/REPLACE/
 * MOVE-then-ADD/REMOVE recovery paths) — this test only adds the missing
 * blockingErrors/academicDecision honesty assertions on top of that same,
 * already-proven-correct scenario, rather than re-deriving recoverability
 * from scratch.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PROGRAM_ID = 'test_program_gap_2027';

function planContext(knownCompletedHours = 0) {
  return {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
        { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
      ] },
      { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
      { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
      { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
    ],
    total_hours_progress: { known_completed_hours: knownCompletedHours },
    personal_status: { completed: [], currently_taking: [] },
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
async function run(body: any) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

describe('generate-plan — genuinely unrecoverable degree-hours shortfall is a blocking error, not just a warning (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('1. default path: catalog exhausted well short of the degree target → blocked:true with a dedicated Hebrew error', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
    // blocked/errors invariant from generate-plan.test.ts must still hold.
    expect(res._body.blocked).toBe(res._body.errors.length > 0);
    // The pre-existing soft warning stays too — additive, not a replacement.
    expect(res._body.warnings_he.some((w: string) => w.includes('מיצית את כל הקורסים הזמינים'))).toBe(true);
  });

  test('2. default path: prior hours close the same catalog up to the real 185h target → NOT blocked', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(173),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('3. a still-recoverable shortfall (a soft-avoided elective remains a real option) must NOT be blocked by this gate', async () => {
    const res = await run({
      program_id: 'test_program_gap_unwanted_2027',
      plan_context: planContext(0),
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('4. agent path (use_academic_decision_agent:true): validation.valid is honestly false, mainRecommendation/whyThisPlan route through the blocked branch, and the cause is named distinctly from overload guidance', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.academicDecision).toBeDefined();
    // The concrete self-contradiction this test locks in: before the fix,
    // this rendered valid:true (a green "passed" signal) alongside
    // whyThisPlan admitting, in the very same response, that the plan does
    // not complete degree hours.
    expect(b.academicDecision.validation.valid).toBe(false);
    expect(b.academicDecision.explanation.mainRecommendation).not.toMatch(/^נבחרה תוכנית/);
    const actions: string[] = b.academicDecision.explanation.suggestedNextActions;
    expect(actions.some((a) => a.includes('קטלוג') && a.includes('הרחב'))).toBe(true);
    expect(actions.some((a) => a.includes('עומס'))).toBe(false);
    expect(actions.some((a) => a.includes('בקש/י בנייה מחדש') && !a.includes('לא תשנה'))).toBe(false);
  });

  test('5. AI_USE_AGENTIC_PLANNER path: same gate holds', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    try {
      const res = await run({
        program_id: PROGRAM_ID,
        plan_context: planContext(0),
        preferences: {},
        session_token: randomUUID(),
      });
      expect(res._body.blocked).toBe(true);
      expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
    } finally {
      delete process.env.AI_USE_AGENTIC_PLANNER;
    }
  });

  test('6. a DIFFERENT, already-disclosed blocker (overload) must surface as itself, not be double-counted or mislabeled by this gate', async () => {
    const res = await run({
      program_id: 'test_program_gap_overload_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 31, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
            { course_id: 'MAND_OVERLOAD', name_he: 'חובה עמוסה', hours: 27, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        total_hours_progress: { known_completed_hours: 0 },
        personal_status: { completed: [], currently_taking: [] },
        mandatory_unplaced: [],
      },
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => /חריגה|עומס/.test(e))).toBe(true);
    // The degree-hours-shortfall gate must NOT ALSO fire here — this scenario
    // is gated out (report.legal is false), same as the pre-existing warning.
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(false);
  });

  // test_program_2027's entire catalog universe is MAND(4h)+FLU(4h) = 8h max
  // reachable (data/boards/test_program_2027.json) against a 185h target —
  // genuinely, permanently exhausted regardless of known_completed_hours.
  // FLU is both pre-placed on the board (year_4_semester_a, as the real
  // frontend deliberately keeps a currently-taking course visible — see
  // legalityGate's own comment in generate-plan.ts) AND listed in
  // personal_status.currently_taking, triggering plan_validation.ts's rule 2a
  // CURRENTLY_TAKING_REUSE_ERROR_MARKER.
  function fluCurrentlyTakingAndPlacedContext(knownCompletedHours: number) {
    return {
      program_name: 'בדיקה',
      semesters: [
        { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
          { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
        ] },
        { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
        { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 4, courses: [
          { course_id: 'FLU', name_he: 'זורם', hours: 4, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
        ] },
        { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
      ],
      category_requirements: [
        { name: 'זורמים', category_id: 'fluids', required: 1, placed: 1, candidates: [
          { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
        ] },
      ],
      total_hours_progress: { known_completed_hours: knownCompletedHours },
      personal_status: { completed: [], currently_taking: [{ course_id: 'FLU' }] },
      mandatory_unplaced: [],
    };
  }

  test('7. Codex-caught regression: a currently-taking course still visible in its placed board slot (rule 2a, the normal/expected client state for an actively-enrolled student) must NOT suppress this gate — the benign reuse marker is not a real legality violation', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: fluCurrentlyTakingAndPlacedContext(100),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
    // The benign rule-2a marker itself must never surface as a blocking error
    // — same "normal client state" exclusion legalityGate already applies.
    expect(res._body.errors.some((e: string) => e.includes('כבר מתוכנן/נלמד כעת'))).toBe(false);
  });

  test('8. Codex-caught regression (round 2): a currently-taking course already PLACED on the board must not have its hours credited twice — double-counting could mask a genuine shortfall', async () => {
    // known_completed_hours=174: report.degreeHours = 174 + (MAND 4 + FLU 4)
    // = 182, genuinely 3h short of 185 (and permanently unrecoverable — this
    // fixture's catalog has nothing else). Before the fix, FLU's 4h were
    // credited a SECOND time (already counted once via placement), pushing
    // creditedHours to 186 >= 185 — falsely reading as fully satisfied and
    // suppressing the gate entirely (blocked:false, no shortfall error at
    // all, not even the generic warning, since the outer guard in the
    // pre-existing warnings_he branch uses the same doubled sum).
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: fluCurrentlyTakingAndPlacedContext(174),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('182/185'))).toBe(true);
  });
});

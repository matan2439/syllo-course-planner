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

  test('3. a still-recoverable shortfall (a soft-avoided elective can actually close the gap) must NOT be blocked by this gate', async () => {
    // known_completed_hours=169: MAND(4)+FLU(4)+SOL(4)+169 = 181/185, exactly
    // 4h short — SPARE's own 4h genuinely closes the gap to 185/185. Chosen
    // deliberately (unlike an arbitrary/earlier known_completed_hours value)
    // so this test's "recoverable" claim is mathematically true under the
    // round-7 fix below: canRecoverViaUnwantedElective/canRecoverMoreHours
    // must reach model.degreeRequiredHours exactly, not merely add *some*
    // hours (round 7's own Codex finding — see those functions' doc comments
    // — a smaller elective than the remaining gap is NOT a real recovery).
    const res = await run({
      program_id: 'test_program_gap_unwanted_2027',
      plan_context: planContext(169),
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('3b. Codex-caught regression (round 7): a soft-avoided elective smaller than the remaining gap can NEVER fully close it — must still be blocked, not falsely reported recoverable', async () => {
    // known_completed_hours=168: MAND(4)+FLU(4)+SOL(4)+168 = 180/185, 5h
    // short — but SPARE (the only remaining catalog option) is only 4h, so
    // even approving it as a risky elective caps the plan at 184/185,
    // permanently 1h short (the catalog has nothing else). Before the fix,
    // canRecoverViaUnwantedElective/canRecoverMoreHours returned true merely
    // because SPARE was a legal, hours-adding action — never checking
    // whether it (or any reachable sequence) could actually reach
    // model.degreeRequiredHours — so this genuinely unrecoverable shortfall
    // was reported blocked:false/errors:[]. Exact repro from Codex's own
    // review comment on this PR.
    const res = await run({
      program_id: 'test_program_gap_unwanted_2027',
      plan_context: planContext(168),
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
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
    // Codex-caught regression (round 5): mainRecommendation itself must not
    // suggest a rebuild either — same self-contradiction as suggestedNextActions
    // would have had, since a rebuild is guaranteed to reproduce an identical
    // shortfall while the catalog stays unchanged.
    expect(b.academicDecision.explanation.mainRecommendation).not.toMatch(/בנייה מחדש/);
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

  test('9. Codex-caught regression (round 3): a still-recoverable soft-avoided elective must be found even when an unrelated currently-taking course is visibly placed on the board — the recovery probes must ignore the same benign reuse marker the gate itself does', async () => {
    // test_program_gap_unwanted_2027: MAND(4h,mandatory)+FLU(4h,fluids)+
    // SOL(4h,solids)+SPARE(4h, no category, marked unwanted here). FLU AND
    // SOL are both PRE-PLACED (mandatory/category requirements already fully
    // satisfied without the search doing anything — deliberately sidesteps a
    // separate, deeper pre-existing PlannerWorker.step() gap this same Agent
    // Diagnosis Loop pass surfaced: the worker's own candidate-legality
    // filter also uses raw, unfiltered validatePlanState, so it independently
    // stops finding ANY legal action once a currently-taking course is
    // visibly placed — tracked separately, out of scope for this PR, which is
    // about generate-plan.ts's post-search gates and recovery probes only).
    // FLU is additionally listed as currently_taking (the same benign rule-2a
    // reuse scenario as tests 7/8). SPARE remains a real, legal, recoverable
    // option — canRecoverViaUnwantedElective must be able to find it despite
    // FLU's unrelated, pre-existing reuse marker. Before this fix,
    // canRecoverViaUnwantedElective's OWN internal validatePlanState call saw
    // FLU's persistent reuse marker in EVERY candidate (since FLU is never
    // removed by any recovery mutation) and wrongly rejected every one of
    // them as illegal — reporting "not recoverable" and firing the new
    // blocking shortfall error even though a real recovery genuinely exists.
    const res = await run({
      program_id: 'test_program_gap_unwanted_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 8, courses: [
            { course_id: 'FLU', name_he: 'זורם', hours: 4, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
            { course_id: 'SOL', name_he: 'מוצק', hours: 4, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
          ] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        category_requirements: [
          { name: 'זורמים', category_id: 'fluids', required: 1, placed: 1, candidates: [
            { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
          ] },
          { name: 'מוצקים', category_id: 'solids', required: 1, placed: 1, candidates: [
            { course_id: 'SOL', name_he: 'מוצק', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
          ] },
        ],
        // known_completed_hours=169 (not 0 — see test 3's own comment above,
        // and round 7's own fix): MAND(4)+FLU(4)+SOL(4)+169=181/185, exactly
        // 4h short, so SPARE's own 4h genuinely closes the gap — this test
        // is about the currently-taking reuse-marker exclusion, not about
        // round 7's separate "does recovery actually close the gap" fix, so
        // it must use a mathematically real recovery, not merely a legal one.
        total_hours_progress: { known_completed_hours: 169 },
        personal_status: { completed: [], currently_taking: [{ course_id: 'FLU' }] },
        mandatory_unplaced: [],
      },
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('SPARE');
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(false);
  });

  test('10. Codex-caught regression (round 4): a still-recoverable soft-avoided elective legal ONLY in a currently-EMPTY semester must be found — the recovery probes must not reconstruct a sparse state missing empty-semester keys', async () => {
    // data/boards/test_program_gap_empty_semester_2027.json: MAND(4h,fixed,
    // year_3_semester_a) + FLU(4h,fluids,legal ONLY year_4_semester_a) +
    // SOL(4h,solids,legal ONLY year_4_semester_a) + SPARE(4h,legal ONLY
    // year_3_semester_b — a semester left completely EMPTY in this scenario).
    // toProposal() drops empty semesters from its own `semesters` output, so
    // degreeHoursGate's naive `Object.fromEntries(semesters.map(...))`
    // reconstruction previously had no key at all for year_3_semester_b —
    // applyMutation's ADD_COURSE case (planner_goals.ts) returns null when a
    // target semester key is entirely missing (not just empty), so
    // canRecoverViaUnwantedElective's ADD-SPARE-to-year_3_semester_b
    // candidate always failed, wrongly reporting "not recoverable" even
    // though SPARE is a real, legal, addable option.
    const res = await run({
      program_id: 'test_program_gap_empty_semester_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 8, courses: [
            { course_id: 'FLU', name_he: 'זורם', hours: 4, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a'] },
            { course_id: 'SOL', name_he: 'מוצק', hours: 4, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a'] },
          ] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        category_requirements: [
          { name: 'זורמים', category_id: 'fluids', required: 1, placed: 1, candidates: [
            { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a'] },
          ] },
          { name: 'מוצקים', category_id: 'solids', required: 1, placed: 1, candidates: [
            { course_id: 'SOL', name_he: 'מוצק', hours: 4, effective_allowed_semesters: ['year_4_semester_a'] },
          ] },
        ],
        // known_completed_hours=169 — same reason as test 9's own comment
        // above (round 7's fix requires a mathematically real recovery, not
        // merely a legal one): MAND(4)+FLU(4)+SOL(4)+169=181/185, exactly 4h
        // short, closed exactly by SPARE's own 4h.
        total_hours_progress: { known_completed_hours: 169 },
        personal_status: { completed: [], currently_taking: [] },
        mandatory_unplaced: [],
      },
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('SPARE');
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(false);
  });

  test('11. Codex-caught regression (round 5): a MOVE-then-ADD "recovery" that requires relocating a currently-taking course must NOT be counted — production planning itself can never perform that move', async () => {
    // Reuses the exact test_program_gap_move_then_add_2027 fixture
    // (generate_plan_structural_degree_gap_warning.test.ts's test 16):
    // year_4_semester_a starts at FILLER_A(24h,fixed)+MOVABLE(2h,elective) =
    // 26h, exactly HARD_LOAD_CAP. TARGET(2h) is legal ONLY in
    // year_4_semester_a — a direct ADD there is illegal (28h, over cap).
    // Relocating MOVABLE to year_4_semester_b (its other legal semester,
    // 24h+2h=26h there, legal) frees year_4_semester_a back to 24h, at which
    // point ADD TARGET becomes legal — the exact move-then-add recovery
    // canRecoverMoreHours' rollout is designed to discover.
    //
    // Here MOVABLE is ALSO listed as currently_taking. The real production
    // search (PlannerWorker.step()) can never actually perform this
    // relocation — its own legality check rejects ANY state where a
    // currently-taking course sits anywhere other than its original
    // placement, the same way it rejects re-adding one that was never
    // placed. Before this fix, the recovery rollout's own candidate
    // generation had no such restriction, so it wrongly found this
    // move-then-add path and reported the plan as "recoverable" (blocked:
    // false) even though production could never actually execute it.
    const res = await run({
      program_id: 'test_program_gap_move_then_add_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 26, courses: [
            { course_id: 'FILLER_A', name_he: 'ממלא א', hours: 24, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'] },
            { course_id: 'MOVABLE', name_he: 'נייד', hours: 2, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
          ] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 24, courses: [
            { course_id: 'FILLER_B', name_he: 'ממלא ב', hours: 24, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_b'] },
          ] },
        ],
        total_hours_progress: { known_completed_hours: 100 },
        personal_status: { completed: [], currently_taking: [{ course_id: 'MOVABLE' }] },
        mandatory_unplaced: [],
      },
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('TARGET');
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
  });

  test('12. Codex-caught regression (round 8): closing the gap requires approving MULTIPLE soft-avoided electives together — must be discovered, not just each course tried alone', async () => {
    // data/boards/test_program_gap_unwanted_multi_2027.json: MAND(4h)+
    // FLU(4h,fluids)+SOL(4h,solids)+SPARE_A(2h,unwanted)+SPARE_B(2h,unwanted).
    // known_completed_hours=169: 12+169=181/185, exactly 4h short. Neither
    // SPARE_A nor SPARE_B alone (2h each) can close a 4h gap — only approving
    // BOTH reaches 185/185 exactly. Before the round-8 fix,
    // canRecoverViaUnwantedElective tested each course in isolation against
    // targetHours, so neither single candidate ever reached it and the gate
    // wrongly reported this genuinely recoverable shortfall as blocked.
    const res = await run({
      program_id: 'test_program_gap_unwanted_multi_2027',
      plan_context: planContext(169),
      preferences: { unwanted_course_ids: ['SPARE_A', 'SPARE_B'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('13. Codex-caught regression (round 9): a recovery that MIXES an approved soft-avoided prerequisite with a regular elective it unlocks must be discovered', async () => {
    // data/boards/test_program_gap_unwanted_prereq_2027.json: MAND(4h)+
    // FLU(4h,fluids)+SOL(4h,solids)+PREREQ(1h,unwanted,legal ONLY
    // year_3_semester_b)+BONUS(4h, NOT unwanted, legal ONLY
    // year_4_semester_a, prerequisites:["PREREQ"]). known_completed_hours=168:
    // 12+168=180/185, exactly 5h short. BONUS can never be legally placed
    // until PREREQ (its own prerequisite) is placed in a strictly earlier
    // semester — and the automatic search never places PREREQ on its own
    // since it's soft-avoided. Only a sequence that first approves PREREQ
    // (1h) and then adds BONUS (4h, now legal) reaches 185/185 exactly.
    // Before the round-9 fix, canRecoverViaUnwantedElective only ever chained
    // is_unwanted ADDs (BONUS, not being unwanted, was invisible to it), and
    // canRecoverMoreHours excluded is_unwanted courses entirely (PREREQ was
    // invisible to it) — so neither probe, alone, could find this mixed
    // sequence, and the gate wrongly reported this genuinely recoverable
    // shortfall as blocked.
    const res = await run({
      program_id: 'test_program_gap_unwanted_prereq_2027',
      plan_context: planContext(168),
      preferences: { unwanted_course_ids: ['PREREQ'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('14. Codex-caught regression (round 10): an off-board personal_status.planned course (predates this board window) is real credit and must count toward the degree total', async () => {
    // test_program_gap_2027 (PROGRAM_ID above): MAND(4h)+FLU(4h,fluids)+
    // SOL(4h,solids)+HUGE(27h, illegal — over the hard cap). known_completed_
    // hours=169: 12+169=181/185, exactly 4h short, and genuinely unrecoverable
    // through the catalog alone (test 1's own scenario, same fixture, proves
    // this exhaustively). An OFF-board personal_status.planned course (not in
    // this board's catalog at all — model.profiles has no entry for it) is
    // real, already-registered credit the planner can never place or count
    // via report.degreeHours. Before the round-10 fix, degreeHoursGate only
    // read model.currentlyPlannedCourseIds (personal_status.currently_taking
    // only), so this real 4h credit was silently ignored and the plan was
    // wrongly reported as an unrecoverable structural shortfall.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'OFFBOARD_PLANNED', hours: 4 }] } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('14b. Codex-caught regression (round 10) — control: an ON-board personal_status.planned course must NOT be credited (double-count guard)', async () => {
    // Same fixture/gap as test 14, but the "planned" course_id (SOL) IS in
    // this board's catalog — SOL is already placed automatically to satisfy
    // the solids category, so crediting it a second time here would double-
    // count it and could mask a genuine shortfall. known_completed_hours=169
    // is still 4h short (181/185) with no other real recovery option, so this
    // must stay blocked.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'SOL', hours: 4 }] } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
  });

  test('15. Codex-caught regression (round 11): total_hours_progress.currently_planned_hours aggregate without per-course hours must not be silently ignored — stay unblocked rather than guess', async () => {
    // Same fixture/gap as test 14 (known_completed_hours=169, exactly 4h
    // short) — but here the off-board planned course carries NO per-course
    // `hours` field, only the client's aggregate
    // total_hours_progress.currently_planned_hours:4. Before the round-11
    // fix, both currentlyPlannedHours/offBoardPlannedHours (which only read
    // per-course hours) credited 0 for this course, so degreeHoursGate
    // wrongly hard-blocked a plan a compatible aggregate-only caller had
    // already proven complete. Since the true split of the aggregate can't be
    // derived precisely (the pre-existing round-10/11 comment already
    // explains why it can't just be added on top), the fix stays silent
    // (no hard block) rather than guess — this test only asserts the
    // (previously false) hard block is gone, not an exact hours total.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'OFFBOARD_PLANNED' }] } as any;
    ctx.total_hours_progress = { known_completed_hours: 169, currently_planned_hours: 4 } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('15b. Codex-caught regression (round 11) — control: the aggregate must NOT suppress a genuine block when off-board hours ARE fully known (no unverifiable course present)', async () => {
    // Same fixture/gap as test 14b (SOL is on-board, so its hours are always
    // known exactly via model.profiles, regardless of the client's own
    // per-course hours field), plus an aggregate that happens to equal SOL's
    // own hours. impliedUnknownOffBoardHours = max(0, 4 - onBoardKnownHours(4)
    // - offBoardKnownHours(0)) = 0 — the aggregate is fully absorbed by
    // SOL's own known on-board hours, none left over to credit — so this
    // must remain a genuine, correctly-detected block. Guards against the
    // round-11/12 fix over-crediting whenever ANY aggregate is present,
    // regardless of whether it's actually unclaimed.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'SOL' }] } as any;
    ctx.total_hours_progress = { known_completed_hours: 169, currently_planned_hours: 4 } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
  });

  test('16. Codex-caught regression (round 12): a small aggregate must not unconditionally skip the gate for a massive, genuinely unrecoverable gap', async () => {
    // Codex's own exact repro: known_completed_hours=0 (MAND+FLU+SOL=12h
    // placed/catalog total, same permanently-exhausted catalog test 1 already
    // proves), an off-board planned course with NO per-course hours, and
    // total_hours_progress.currently_planned_hours:4 — a small aggregate that
    // can only ever justify 4h of credit (16/185), nowhere near closing a
    // ~169h gap. Before the round-12 fix, an earlier version of the round-11
    // fix unconditionally skipped this whole gate whenever ANY aggregate was
    // present alongside an unverifiable off-board course, regardless of
    // magnitude — wrongly reporting blocked:false for this obviously still-
    // incomplete plan, the exact "incomplete presented as complete" bug this
    // gate exists to prevent.
    const ctx = planContext(0);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'OFFBOARD_PLANNED' }] } as any;
    ctx.total_hours_progress = { known_completed_hours: 0, currently_planned_hours: 4 } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('פער שעות תואר'))).toBe(true);
  });

  test('17. Codex-caught regression (round 13): once off-board credit closes the gap, the generic "still incomplete" warning/rationale must not recreate the contradiction this whole gate exists to close', async () => {
    // Exact same scenario as test 14 (known_completed_hours=169, an off-board
    // OFFBOARD_PLANNED course worth 4h → 181 board/catalog hours + 4h
    // off-board credit = 185/185, genuinely closing the gap). Test 14 only
    // ever asserted blocked:false/errors:[] — it never checked warnings_he or
    // the agent-path rationale. Before the round-13 fix, toProposal()'s
    // generic "התוכנית משלימה X/Y ש"ש" warning (and, via risksAndTradeoffs,
    // academicDecision.explanation) used raw report.degreeMet/
    // report.degreeHours — uncredited — so it still said the plan only
    // reached 181/185 and was incomplete, in the very same response that
    // blocked:false/validation.valid:true call it done. Same self-
    // contradiction bug class this whole PR (and PR #56/#60's disclosure
    // fixes) exists to eliminate.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'OFFBOARD_PLANNED', hours: 4 }] } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      use_academic_decision_agent: true,
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
    // The generic uncredited "X/Y ש"ש" completion warning must not appear —
    // credited hours (185/185) genuinely close the gap.
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(false);
    // Nor the structural-exhaustion message — the same credited total also
    // feeds that branch's own condition.
    expect(res._body.warnings_he.some((w: string) => w.includes('מיצית את כל הקורסים'))).toBe(false);
    const b = res._body;
    expect(b.academicDecision.validation.valid).toBe(true);
    expect(
      b.academicDecision.explanation.whyThisPlan.some((w: string) => w.includes('אינה מלאה') || w.includes('אינן מולאות')),
    ).toBe(false);
    expect(
      b.academicDecision.explanation.risksAndTradeoffs.some((w: string) => w.includes('התוכנית משלימה')),
    ).toBe(false);
  });

  test('17b. Codex-caught regression (round 13) — control: when credit does NOT close the gap, the generic warning must still appear with the credited (not raw) total', async () => {
    // Same shape as 17 but the off-board course is only 3h — 181+3=184/185,
    // still genuinely 1h short, so this must stay blocked AND the warning
    // must still fire, using the credited total (184), not the raw board-
    // only total (181), so the number a user sees matches reality.
    const ctx = planContext(169);
    ctx.personal_status = { completed: [], currently_taking: [], planned: [{ course_id: 'OFFBOARD_PLANNED', hours: 3 }] } as any;
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.blocked).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה 184/185'))).toBe(true);
  });

  test('18. Codex-caught regression (round 14): a decisive single-step recovery must not be missed because 200 individually-insufficient legal candidates exhaust the rollout budget first', async () => {
    // data/boards/test_program_gap_unwanted_bounded_search_2027.json: same
    // MAND(4h)+FLU(4h,fluids)+SOL(4h,solids)=12h shape as test 1's fixture,
    // plus 200 soft-avoided 1h electives (SMALL_001..SMALL_200) enumerated
    // BEFORE one soft-avoided 5h elective (DECISIVE) in
    // program_repository_courses order (the exact order
    // canRecoverMoreHours' ADD loop iterates model.profiles in). All 201 are
    // marked unwanted so the automatic search never places any of them on
    // its own — the gap stays genuinely open until the recovery probe (the
    // thing actually under test) considers them via includeUnwantedElectives.
    // known_completed_hours=168: 168+12=180/185, exactly 5h short — closed
    // ONLY by DECISIVE alone (each SMALL_* is individually insufficient, and
    // RECOVERY_ROLLOUT_BUDGET=200 legal candidates is exactly consumed by
    // the 200 SMALL_* siblings from the very first state, before enumeration
    // ever reaches DECISIVE) — Codex's exact repro shape (many small legal
    // candidates ahead of the one that alone closes the gap). Before the
    // round-14 fix (sorting each state's candidates by their own hours delta,
    // descending, before spending any budget), this fixture reproduced
    // exactly that: blocked:true even though a genuine single-step recovery
    // exists and is trivially legal.
    const ctx = planContext(168);
    const smallIds = Array.from({ length: 200 }, (_, i) => `SMALL_${String(i + 1).padStart(3, '0')}`);
    const res = await run({
      program_id: 'test_program_gap_unwanted_bounded_search_2027',
      plan_context: ctx,
      preferences: { unwanted_course_ids: [...smallIds, 'DECISIVE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('19. Codex-caught regression (round 15): a placed currently-taking course must not erase unrelated off-board aggregate credit', async () => {
    // The live buildPlanContext (semester_board_viewer.html) computes
    // total_hours_progress.currently_planned_hours by summing
    // currently_taking/planned entries AFTER filtering OUT any course
    // already placed on the submitted board — the real aggregate NEVER
    // includes a placed course's hours. Codex's exact repro: CUR_BOARD is a
    // currently-taking course genuinely PLACED on the board (4h, known via
    // its own personal_status.currently_taking[].hours), coexisting with an
    // unrelated OFFBOARD_PLANNED course (personal_status.planned) whose
    // per-course hours are missing from this payload but whose real 4h is
    // reflected only in the aggregate. Before the round-15 fix, the
    // model.profiles.has(id)-based "onBoardKnownHours" subtraction treated
    // FLU's known 4h as if it were STILL part of the 4h aggregate
    // (double-discounting it), leaving 0 credit for OFFBOARD_PLANNED even
    // though the aggregate was already exclusively about it.
    //
    // Uses FLU (a real course in this fixture's board_json, unlike an
    // invented id) as the placed currently-taking course — model.profiles
    // is built from the server-side board_json, not plan_context, so an
    // ad-hoc course embedded only in plan_context would never reach
    // initialState at all (planContextToState skips any id
    // !model.profiles.has). SOL is ALSO pre-placed client-side (not left for
    // the search to place) — a separate, already-flagged, out-of-scope
    // finding from an earlier round of this same PR notes PlannerWorker's
    // own search can get stuck on unrelated actions whenever ANY
    // currently-taking course is visibly placed on the board; pre-placing
    // every requirement client-side keeps this test isolated to the
    // aggregate-credit computation under test, not that separate search
    // issue. MAND(4)+FLU(4)+SOL(4)=12h placed, known_completed_hours=169 →
    // 181/185, exactly 4h short — closed ONLY by OFFBOARD_PLANNED's real
    // (aggregate-only) 4h.
    const ctx: any = planContext(169);
    ctx.semesters[2].courses.push({ course_id: 'FLU' }, { course_id: 'SOL' });
    ctx.personal_status = {
      completed: [],
      currently_taking: [{ course_id: 'FLU', hours: 4 }],
      planned: [{ course_id: 'OFFBOARD_PLANNED' }],
    };
    ctx.total_hours_progress = { known_completed_hours: 169, currently_planned_hours: 4 };
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });

  test('20. Codex-caught regression (round 16): a placed personal_status.planned course must not erase unrelated off-board aggregate credit', async () => {
    // Mirrors test 19, but for personal_status.planned instead of
    // currently_taking. SOL is pre-placed client-side (personal_status.planned,
    // not currently_taking — so it's a plain, freely-movable course from the
    // search's perspective, no rule-2a stuck-search risk) alongside an
    // unrelated off-board OFFBOARD_PLANNED2 whose per-course hours are
    // missing but whose real 4h is reflected only in the aggregate. Before
    // the round-16 fix, round 15's own in-catalog exclusion for `planned`
    // entries (correct for a NOT-yet-placed one like test 15b's SOL) was
    // applied even to an ALREADY-placed one, double-discounting it the same
    // way round 15 fixed for currently_taking.
    // MAND(4)+SOL(4, placed)+FLU(4, search-placed)=12h, known_completed_hours=169
    // → 181/185, exactly 4h short — closed ONLY by OFFBOARD_PLANNED2's real
    // (aggregate-only) 4h.
    const ctx: any = planContext(169);
    ctx.semesters[2].courses.push({ course_id: 'SOL' });
    ctx.personal_status = {
      completed: [],
      currently_taking: [],
      planned: [{ course_id: 'SOL' }, { course_id: 'OFFBOARD_PLANNED2' }],
    };
    ctx.total_hours_progress = { known_completed_hours: 169, currently_planned_hours: 4 };
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: ctx,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.blocked).toBe(false);
    expect(res._body.errors.length).toBe(0);
  });
});

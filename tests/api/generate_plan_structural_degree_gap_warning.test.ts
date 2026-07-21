/**
 * generate-plan — real-Agent diagnosis finding: when the planner has placed
 * every mandatory course and satisfied every elective category but the
 * catalog visible in plan_context simply doesn't contain enough hours to
 * reach model.degreeRequiredHours, the search terminates having exhausted
 * every legal action (planner_lookahead.ts's projectFeasibility already
 * detects this internally — see planner_worker.ts's use of it as a ranking
 * signal). Previously the ONLY disclosure was the generic
 * "התוכנית משלימה X/Y ש"ש" line — identical wording to an ordinary,
 * still-fixable shortfall. A real user (and the live frontend's decision
 * text, semester_board_viewer.html's postPlanChangeSummary) can't tell
 * "more course selection would help" apart from "the visible planning
 * window is structurally too small; nothing left to add". This is
 * misleading, not just incomplete: the frontend currently suggests
 * "approve a risky elective from the list" even when no such elective
 * exists.
 *
 * Fix: toProposal() now also runs projectFeasibility(finalState, model) and,
 * when degree hours are unmet AND every mandatory/category requirement is
 * already satisfied AND the ONLY remaining feasibility blocker is the
 * aggregate 'degree_hours' gap (i.e. no further legal action could close it
 * from this final state), pushes a distinct, unambiguous warning.
 *
 * Uses the dedicated data/boards/test_program_gap_2027.json fixture: a tiny,
 * fully-legal catalog (one 4h mandatory course + one 4h candidate in each of
 * two categories, 8h reachable ceiling) against a real 185h degree target —
 * category/hours data here comes from the STATIC board file (loaded by
 * program_id), not from plan_context, matching how buildModel/
 * buildConstraintModel actually source category_requirements_categories.
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

const STRUCTURAL_GAP_FRAGMENT = 'מיצית את כל הקורסים הזמינים בחלון התכנון';

describe('generate-plan — structural degree-hours gap warning (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('1. default path: every requirement satisfied but the catalog is exhausted well short of the degree target → distinct structural warning', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
    // The generic hours line still appears too — additive, not a replacement.
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
  });

  test('1b. Codex-caught regression (round 2): a raw ADD_COURSE candidate that is actually illegal (HUGE, 27h — always breaches the 26h hard cap alone) must not be counted as a real available add', async () => {
    // Same fixture/scenario as test 1 — this fixture's catalog also contains
    // HUGE (data/boards/test_program_gap_2027.json), a plain elective with no
    // legal semester that fits it under the hard cap. enumerateActions still
    // emits an ADD_COURSE for it (its own docstring: "illegality is judged
    // later by validation"), so an unvalidated raw-action check would have
    // wrongly treated this as "still something to add" and suppressed the
    // warning. Asserting it here (distinct from test 1) documents exactly
    // which candidate this guards against.
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('HUGE');
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('2. default path: prior hours bring the same tiny catalog up to the real 185h target → no structural warning', async () => {
    // MAND(4) + FLU(4) + SOL(4) = 12 placed; 173 prior hours closes exactly to 185.
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(173),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('2b. Codex-caught regression: a SMALL shortfall with ample empty semester capacity but zero remaining eligible courses still fires the warning (projectFeasibility headroom would have masked this — it only compares hard-cap headroom to the gap, not real course availability)', async () => {
    // MAND(4) + FLU(4) + SOL(4) = 12 placed; 170 prior hours (182 total) leaves
    // only a 3h gap — trivially within the ~90h+ of unused hard-cap headroom
    // across the 4 known semesters, but this fixture's catalog has nothing
    // left to add.
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(170),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('3. default path: a category genuinely cannot be satisfied (its one candidate is hard-excluded) → unsatisfiedCategories warning fires, NOT the structural gap warning', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: { strongly_avoided_course_ids: ['SOL'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.some((r: any) => !r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes('דרישת קטגוריה לא מולאה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('4. agent path (use_academic_decision_agent:true): same structural warning reaches warnings_he', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('5. Codex-caught regression (round 3): a PRE-EXISTING, unrelated legality violation (two fixed mandatory courses together breaching the hard cap) must surface as ITSELF, not be mislabeled as a structural catalog-exhaustion gap', async () => {
    // data/boards/test_program_gap_overload_2027.json: MAND(4h) + MAND_OVERLOAD(27h),
    // both fixed/immovable in the same semester — 31h always breaches the 26h
    // hard cap (and the 30h absolute max), with no way for the search to ever
    // resolve it (neither course can move). Every ADD_COURSE candidate's
    // resulting state still carries this same pre-existing error, so an
    // ungated canStillAddHours check would read "false" for the wrong reason
    // and mislabel a real, different, already-disclosed overload blocker as
    // "catalog exhausted."
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
    // The real blocker (overload) is disclosed as a genuine blocking error —
    // this proves the scenario actually reproduces a pre-existing illegal state.
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => /חריגה|עומס/.test(e))).toBe(true);
    // The new structural-gap warning must NOT fire — it would misattribute
    // the shortfall to catalog exhaustion instead of the real overload cause.
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('6. Codex-caught regression (round 4): a hard-excluded course already placed on the board (issue #25 Finding #1) must surface as ITSELF, not be mislabeled as a structural catalog-exhaustion gap', async () => {
    // FLU is already placed (as if the user added it before also hard-
    // excluding it — the classic Finding #1 scenario: the planner only ever
    // adds/moves courses, never removes a previously-placed one on its own).
    // report.disallowedPlaced tracks this SEPARATELY from
    // validatePlanState/report.legal (that's the whole reason disallowedGate
    // exists as its own post-hoc check), so report.legal alone doesn't catch
    // it — both categories still read as "satisfied" (FLU counts as placed
    // regardless of being disallowed; SOL gets added for the solids
    // category), degree hours are still short, and a report.legal-only gate
    // would wrongly fire the structural-gap warning alongside the real,
    // actionable hard-exclusion blocker.
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 4, courses: [
            { course_id: 'FLU', name_he: 'זורם', hours: 4, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
          ] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        total_hours_progress: { known_completed_hours: 0 },
        personal_status: { completed: [], currently_taking: [] },
        mandatory_unplaced: [],
      },
      preferences: { strongly_avoided_course_ids: ['FLU'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    // The real blocker (hard-excluded course still placed) is disclosed as a
    // genuine blocking error — proves the scenario actually reproduces it.
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.some((e: string) => e.includes('קורס לא-זמין שובץ בתוכנית'))).toBe(true);
    // The new structural-gap warning must NOT fire.
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('7. Codex-caught regression (round 5): a course only SOFT-avoided (unwanted_course_ids, not hard-excluded) still leaves a real, recoverable option — must NOT be reported as catalog exhaustion', async () => {
    // data/boards/test_program_gap_unwanted_2027.json: same MAND+FLU+SOL shape
    // as test 1's fixture, plus SPARE — a legal, positive-hour, non-mandatory
    // elective with nothing else placed on it. enumerateActions' own
    // degree-hour-fill group (group 4, planner_actions.ts) deliberately skips
    // `p.is_unwanted` courses so the SEARCH never proposes placing something
    // the user asked to avoid — but the course is still genuinely addable if
    // the user approves it as a risky elective (the exact advice the generic
    // fallback message already gives). Checking only enumerateActions' output
    // would read this as "nothing left to add" and wrongly claim the visible
    // planning window's catalog is exhausted, when in fact one real option
    // (SPARE) remains, just gated behind a soft preference, not scarcity.
    const res = await run({
      program_id: 'test_program_gap_unwanted_2027',
      plan_context: planContext(0),
      preferences: { unwanted_course_ids: ['SPARE'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('SPARE');
    // The generic hours-shortfall line still appears (still short of 185h) —
    // but not the misleading "exhausted" claim, since SPARE is recoverable.
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  function currentlyTakingPlanContext(knownCompletedHours: number) {
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
      personal_status: { completed: [], currently_taking: [{ course_id: 'CUR' }] },
      mandatory_unplaced: [],
    };
  }

  test('8. Codex-caught regression (round 6): an off-board currently-taking MANDATORY course whose hours fully close the gap — must NOT be reported as catalog exhaustion', async () => {
    // data/boards/test_program_gap_currently_taking_2027.json: same MAND+FLU+SOL
    // shape as test 1's fixture, plus CUR — a SECOND 4h mandatory course the
    // user is currently taking (personal_status.currently_taking), never placed
    // on the board and never re-proposable (buildConstraintModel already
    // excludes a currently-taking course from requiredMandatoryCourseIds, and
    // enumerateActions' degree-hour-fill group skips every is_mandatory course
    // regardless). report.degreeHours (= priorHours + placedHours) has no way
    // to see CUR's hours at all — MAND(4)+FLU(4)+SOL(4)=12 placed, 169 prior =
    // 181, exactly 4h short of the 185h target — the same 4h CUR is already
    // covering in reality. Without crediting it, this would wrongly claim the
    // catalog is exhausted and nothing else can help.
    const res = await run({
      program_id: 'test_program_gap_currently_taking_2027',
      plan_context: currentlyTakingPlanContext(169),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    // Still genuinely short in board/completed terms — the generic line stays.
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    // But NOT the stronger "nothing else can help" claim — CUR finishing closes it.
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('8b. regression: currently-taking hours that only PARTIALLY close the gap still leave the structural warning firing', async () => {
    // Same fixture/shape as test 8, but only 160 prior hours: 12 placed + 160 =
    // 172, a 13h gap — CUR's 4h isn't enough to close it (176 still < 185), so
    // the catalog genuinely is exhausted relative to the real (credited) total.
    const res = await run({
      program_id: 'test_program_gap_currently_taking_2027',
      plan_context: currentlyTakingPlanContext(160),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('9. Codex-caught regression (round 8): a soft-avoided ANNUAL elective is the only recoverable option — must be tried as an atomic multi-semester bundle, not a single-semester trial', async () => {
    // data/boards/test_program_gap_unwanted_annual_2027.json: same MAND+FLU+SOL
    // shape as test 7's fixture, but the one recoverable soft-avoided course
    // (SPARE_ANNUAL) is is_annual with a confident spans_semesters bundle
    // (year_3_semester_b + year_4_semester_a). A single-semester ADD_COURSE
    // trial (the round-5/7 implementation's bestLegalSemester + one mutation)
    // always fails validatePlanState, since an annual course must occupy
    // EVERY one of its spans at once — that would wrongly report "not
    // recoverable" and fire the exhaustion warning even though approving
    // SPARE_ANNUAL as a risky elective genuinely closes the gap.
    const res = await run({
      program_id: 'test_program_gap_unwanted_annual_2027',
      plan_context: planContext(169),
      preferences: { unwanted_course_ids: ['SPARE_ANNUAL'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('SPARE_ANNUAL');
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('10. Codex-caught regression (round 9): an ordinary elective whose LOWEST-load legal semester violates prerequisite timing, but a later legal semester satisfies it — must NOT be reported as catalog exhaustion', async () => {
    // data/boards/test_program_gap_prereq_timing_2027.json: MAND (fixed,
    // year_3_semester_a) + PREREQ (a SECOND mandatory course, fixed,
    // year_4_semester_a) + ORD — a plain (not mandatory, not a category
    // candidate, not unwanted) elective legal in year_3_semester_b OR
    // year_4_semester_b, requiring PREREQ. bestLegalSemester (planner_actions.ts,
    // used by enumerateActions' group 4 — the actual search's ONLY source of
    // ADD_COURSE candidates for a plain filler elective) ranks candidate
    // semesters by CURRENT LOAD only — year_3_semester_b and year_4_semester_b
    // are both empty (tied at 0), so it picks the first — year_3_semester_b
    // (index 1) — which is BEFORE PREREQ (index 2, year_4_semester_a),
    // violating the strict prerequisite-timing rule. That single proposed
    // action is illegal, so the WORKER itself never places ORD either (a
    // narrower, separate gap in the core search — out of scope for this
    // response-warnings-only fix). What round 9 fixes is specifically the
    // MISLEADING claim: without this fix, the response would say the visible
    // catalog is exhausted (canRecoverViaWiderSearch/canStillAddHours both
    // false), when in fact ORD is still a real, recoverable option (a legal
    // placement — year_4_semester_b, AFTER PREREQ — genuinely exists, just
    // not one the worker's own bestLegalSemester heuristic tries). The
    // generic hours-shortfall line must stay (ORD is still genuinely
    // unplaced), but not the stronger "nothing else can help" claim.
    const res = await run({
      program_id: 'test_program_gap_prereq_timing_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 4, courses: [
            { course_id: 'PREREQ', name_he: 'דרישת קדם', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'] },
          ] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        total_hours_progress: { known_completed_hours: 173 },
        personal_status: { completed: [], currently_taking: [] },
        mandatory_unplaced: [],
      },
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).not.toContain('ORD');
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });
});

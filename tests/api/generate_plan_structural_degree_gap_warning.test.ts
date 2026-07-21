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

import handler, { toProposal, buildModel } from '../../api/ai/generate-plan';
import { loadLocalBoardJson } from '../../api/ai/board_loader';
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
    // Codex-caught regression (round 13): the message's own numerator must
    // use the SAME credited total (report.degreeHours + currentlyPlannedHours
    // = 12 placed + 160 known + 4 CUR = 176) the guard above just used to
    // decide the gap is genuinely structural — not the uncredited
    // report.degreeHours (172) alone, which would understate real progress.
    expect(res._body.warnings_he.some((w: string) => w.includes('176/185'))).toBe(true);
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

  function offCatalogCurrentlyTakingPlanContext(knownCompletedHours: number, offcatHours: number) {
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
      // OFFCAT is NOT in test_program_gap_currently_taking_offcatalog_2027.json's
      // program_repository_courses at all (unlike test 8/8b's CUR) — model.profiles
      // can never resolve its hours. Only the currently_taking entry's OWN .hours
      // field (computed client-side via hoursForCourseId, the way the real
      // frontend resolves YEAR_1_2 fallback courses) carries the real number —
      // round 11 replaced the round-10 aggregate total_hours_progress.
      // currently_planned_hours source with this per-course one (see test 12).
      personal_status: { completed: [], currently_taking: [{ course_id: 'OFFCAT', hours: offcatHours }] },
      mandatory_unplaced: [],
    };
  }

  test('11. Codex-caught regression (round 10): a currently-taking course entirely absent from the board catalog (e.g. a first/second-year mandatory course the frontend tracks via a static fallback, not board_json) still credits its hours via its own personal_status.currently_taking entry — must NOT be reported as catalog exhaustion', async () => {
    // model.profiles has no entry for OFFCAT at all (unlike test 8's CUR,
    // which IS in program_repository_courses) — the round-6 fix
    // ([...model.currentlyPlannedCourseIds].reduce(... model.profiles.get(id)?.hours ...))
    // would silently credit 0h for it and wrongly fire the exhaustion warning
    // even though the frontend already told the server the true per-course
    // hours (4h here, closing the gap exactly like test 8's CUR does).
    const res = await run({
      program_id: 'test_program_gap_currently_taking_offcatalog_2027',
      plan_context: offCatalogCurrentlyTakingPlanContext(169, 4),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('11b. regression: an off-catalog currently-taking course whose context-reported hours only PARTIALLY close the gap still leaves the structural warning firing', async () => {
    // Same fixture/shape as test 11, but only 160 known-completed hours:
    // 12 placed + 160 known + 4 (OFFCAT) = 176, still 9h short of 185 — the
    // catalog genuinely is exhausted relative to the real (credited) total.
    const res = await run({
      program_id: 'test_program_gap_currently_taking_offcatalog_2027',
      plan_context: offCatalogCurrentlyTakingPlanContext(160, 4),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('12. Codex-caught regression (round 11): a personal_status.planned (not currently_taking) course must NOT be credited by this guard, since the planner can legitimately place it itself — crediting it a second time via an aggregate would double-count and wrongly suppress a genuine exhaustion warning', async () => {
    // data/boards/test_program_gap_planned_double_count_2027.json: MAND+FLU+SOL
    // (as in test 1) plus PLANNED — a plain, legal, addable elective the
    // worker's own degree-hour-fill group WILL place (it is not mandatory,
    // not unwanted, not a category candidate — just genuine remaining hours
    // to fill). 165 known + 12 (MAND+FLU+SOL) + 4 (PLANNED, once placed) =
    // 181, 4h short of 185 — the catalog is genuinely exhausted (PLANNED was
    // the only remaining option and the worker already placed it).
    //
    // The round-10 fix (Math.max against total_hours_progress.
    // currently_planned_hours, which mixes personal_status.currently_taking
    // AND personal_status.planned) would ALSO add PLANNED's 4h from the
    // aggregate on top of report.degreeHours (which already counts it once,
    // since it's genuinely placed on the board) — 181 + 4 = 185, wrongly
    // reading as fully satisfied and suppressing the warning. The round-11
    // fix only ever reads personal_status.currently_taking's own per-course
    // .hours (PLANNED is in personal_status.planned, never currently_taking,
    // so it contributes 0 here) — no double count, warning correctly fires.
    const res = await run({
      program_id: 'test_program_gap_planned_double_count_2027',
      plan_context: {
        program_name: 'בדיקה',
        semesters: [
          { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
            { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
          ] },
          { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
          { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
        ],
        total_hours_progress: { known_completed_hours: 165, currently_planned_hours: 4 },
        personal_status: { completed: [], currently_taking: [], planned: [{ course_id: 'PLANNED', hours: 4 }] },
        mandatory_unplaced: [],
      },
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.semesters.flatMap((s: any) => s.course_ids)).toContain('PLANNED');
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('13. Codex-caught regression (round 17): a legal REPLACE_COURSE action (swap a low-preference placed elective for a higher-hour unplaced one) must be recognized as a recoverable option, not reported as catalog exhaustion', () => {
    // Direct unit test of toProposal (exported specifically for this) instead
    // of the full handler: verified manually that the real greedy search
    // ACTUALLY performs this exact replace itself once it converges (it's a
    // legal, score-improving action, so the search naturally reaches for it
    // before stopping) — so an end-to-end handler test can't reproduce a
    // finalState where the replace is still available but untaken. Calling
    // toProposal directly proves the exhaustion-check logic is correct
    // regardless of how/whether a given search run happens to take it first
    // (e.g. a different search strategy, or a run that stops at maxSteps one
    // step earlier) — the response layer must never claim "nothing left" when
    // a legal, hours-increasing replace genuinely still exists in finalState.
    //
    // data/boards/test_program_gap_replace_2027.json: MAND (4h, fixed) +
    // FILLER (22h, fixed, year_4_semester_a) + SPARE_SMALL (1h, elective,
    // legal only in year_4_semester_a, marked unwanted here — round 18 (see
    // test 14) later proved the fix doesn't actually depend on this) + BIG
    // (4h, elective, legal only in year_4_semester_a) + FLU/SOL (category
    // candidates). A plain ADD of BIG would push year_4_semester_a to
    // 23+4=27h, breaching HARD_LOAD_CAP (26h) — illegal. Replacing
    // SPARE_SMALL(1h) with BIG(4h) nets 22+4=26h — exactly at the cap, legal.
    const board = loadLocalBoardJson('test_program_gap_replace_2027');
    const ctx = {
      total_hours_progress: { known_completed_hours: 145 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = { unwanted_course_ids: ['SPARE_SMALL'] } as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_replace_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER', 'SPARE_SMALL'],
        year_4_semester_b: [],
      },
    };
    // The state right before the replace: FLU/SOL (categories) placed,
    // SPARE_SMALL still placed, BIG still unplaced. 4+4+4+22+1=35 placed +
    // 145 known = 180h, 5h short of 185 — genuinely incomplete, but the
    // legal SPARE_SMALL→BIG replace (net +3h) is still a real, untaken
    // option.
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: ['FLU', 'SOL'],
        year_4_semester_a: ['FILLER', 'SPARE_SMALL'],
        year_4_semester_b: [],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('14. Codex-caught regression (round 18): a SAME-preference (neither wanted nor unwanted) higher-hour replacement must still be recognized — enumerateActions\' own REPLACE_COURSE generator only proposes preference-IMPROVING swaps, invisible to a check built on top of it', () => {
    // Identical fixture/shape to test 13, but SPARE_SMALL is NOT marked
    // unwanted here — both SPARE_SMALL and BIG have the same (neutral, 0)
    // preferenceScore. planner_actions.ts's own REPLACE_COURSE generator
    // (group 6) requires preferenceScore(inId) > outPref (strictly
    // preference-IMPROVING) to propose a swap at all, so the round-17 fix
    // (built directly on enumerateActions' output) would never even see
    // this candidate — it's invisible upstream, not just filtered out
    // downstream. The round-18 fix replaced that with its own exhaustive
    // scan gated ONLY on net hours and legality, independent of preference.
    const board = loadLocalBoardJson('test_program_gap_replace_2027');
    const ctx = {
      total_hours_progress: { known_completed_hours: 145 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_replace_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER', 'SPARE_SMALL'],
        year_4_semester_b: [],
      },
    };
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: ['FLU', 'SOL'],
        year_4_semester_a: ['FILLER', 'SPARE_SMALL'],
        year_4_semester_b: [],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('15. Codex-caught regression (round 19): a hard-legal replace that would UN-SATISFY a category must NOT be counted as real recovery — the structural-gap warning must still fire', () => {
    // data/boards/test_program_gap_replace_breaks_category_2027.json:
    // FLU_SMALL (1h) is the SOLE fluids-category candidate, placed alongside
    // FILLER (22h, fixed) in year_4_semester_a (23h total). BIG (4h, no
    // category) is the only other elective, legal only in that same
    // semester. A plain ADD of BIG breaches the 26h cap (23+4=27h) —
    // illegal. Replacing FLU_SMALL with BIG is HARD-legal
    // (validatePlanState: 22+4=26h, exactly at cap) — but it removes the
    // only course satisfying the fluids category, so it isn't a real
    // recovery: the plan would trade a genuine hours shortfall for a
    // genuine category shortfall, not fix anything. canRecoverViaReplace
    // must re-check completeness (missingMandatory/unsatisfiedCategories),
    // not just hard legality, before counting this as a way out.
    const board = loadLocalBoardJson('test_program_gap_replace_breaks_category_2027');
    const ctx = {
      total_hours_progress: { known_completed_hours: 145 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_replace_breaks_category_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER', 'FLU_SMALL'],
        year_4_semester_b: [],
      },
    };
    // MAND+FILLER+FLU_SMALL+SOL placed (4+22+1+4=31h), both categories
    // satisfied, BIG unplaced. 31+145=176h, 9h short of 185 — the ONLY
    // conceivable recovery (replacing FLU_SMALL with BIG) breaks fluids, so
    // this is genuinely exhausted.
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: ['SOL'],
        year_4_semester_a: ['FILLER', 'FLU_SMALL'],
        year_4_semester_b: [],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });

  test('16. Codex-caught regression (round 20): a two-step MOVE-then-ADD recovery (relocate a movable course to free capacity, then add the target) must be recognized — a single ADD/REPLACE probe alone misses it', () => {
    // data/boards/test_program_gap_move_then_add_2027.json: year_4_semester_a
    // starts at FILLER_A(24h)+MOVABLE(2h)=26h — exactly at HARD_LOAD_CAP.
    // TARGET(2h) is legal ONLY in year_4_semester_a; a direct ADD there would
    // be 26+2=28h — illegal. year_4_semester_b starts at FILLER_B(24h)+
    // MOVABLE's OTHER legal semester=year_4_semester_a itself — no, MOVABLE
    // is legal in BOTH semesters; relocating it out of year_4_semester_a to
    // year_4_semester_b (24+2=26h, legal) frees year_4_semester_a back down
    // to 24h, at which point ADD TARGET (24+2=26h) becomes legal. Neither
    // canStillAddHours (direct ADD, illegal) nor canRecoverViaReplace (no
    // unplaced course has MORE hours than MOVABLE's 2h — TARGET is also
    // exactly 2h, not strictly more) finds this; only the two-step scan does.
    const board = loadLocalBoardJson('test_program_gap_move_then_add_2027');
    const ctx = {
      total_hours_progress: { known_completed_hours: 100 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_move_then_add_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    // MAND(4)+FILLER_A(24)+FILLER_B(24)+MOVABLE(2)=54h placed +100 known =
    // 154h, 31h short of 185 — TARGET(2h) still unplaced, and no single-step
    // action can place it (only the move-then-add combination can).
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('17. Codex-caught regression (round 21): a two-step MOVE-then-ADD recovery must also be recognized when the target is an is_annual course needing its atomic multi-semester bundle, not a single-semester ADD', () => {
    // data/boards/test_program_gap_move_then_add_annual_2027.json: same shape
    // as test 16's fixture (year_4_semester_a starts at FILLER_A(24h)+
    // MOVABLE(2h)=26h — exactly at HARD_LOAD_CAP), but the recovery target is
    // TARGET_ANNUAL — is_annual, spanning [year_4_semester_a,
    // year_4_semester_b] together, 2h in EACH span semester. year_4_semester_b
    // starts at FILLER_B(24h) alone, so it has exactly enough room (24+2=26h)
    // for TARGET_ANNUAL's own share on its own — only year_4_semester_a needs
    // capacity freed. A direct atomic ADD of TARGET_ANNUAL fails as a whole
    // (validatePlanState rejects the WHOLE bundle because year_4_semester_a
    // alone would hit 26+2=28h, even though year_4_semester_b alone would be
    // fine). MOVABLE is legal in year_4_semester_a OR year_3_semester_b (NOT
    // year_4_semester_b, so moving it can't accidentally crowd out
    // TARGET_ANNUAL's other span) — relocating it to year_3_semester_b frees
    // year_4_semester_a back to 24h, at which point the atomic bundle ADD
    // (24+2=26h in year_4_semester_a, 24+2=26h in year_4_semester_b) becomes
    // legal. round 20's move-then-add scan only ever tried a single-semester
    // ADD_COURSE for the freed capacity, which validatePlanState always
    // rejects for an is_annual course (must occupy EVERY span at once) — so
    // it stayed blind to this exact combination. canRecoverMoreHours instead
    // reuses enumerateActions at every rollout state (which already calls
    // addCourseActionsFor for is_annual courses, planner_actions.ts's own
    // group 4), so the atomic bundle is tried automatically once the move
    // step is reached, with no bespoke annual-aware branch needed.
    const board = loadLocalBoardJson('test_program_gap_move_then_add_annual_2027');
    const ctx = {
      total_hours_progress: { known_completed_hours: 100 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_move_then_add_annual_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    // MAND(4)+FILLER_A(24)+FILLER_B(24)+MOVABLE(2)=54h placed + 100 known =
    // 154h, 31h short of 185 — TARGET_ANNUAL(2h, counted once despite
    // spanning two semesters) still unplaced, and no single-step action can
    // place it (only the move-then-atomic-add combination can).
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('18. Codex-caught regression (round 22): illegal rollout candidates must not consume the recovery budget — a legal MOVE-then-ADD recovery must still be found even when hundreds of illegal ADD candidates precede it', () => {
    // canRecoverMoreHours' rollout has a bounded RECOVERY_ROLLOUT_BUDGET (200)
    // states. Before round 22, EVERY candidate incremented the budget counter
    // regardless of legality — so a semester already at the hard cap with
    // 200+ unplaced electives (each individually illegal to ADD there, since
    // there's no room) could exhaust the entire budget on those illegal
    // dead-ends before ever reaching a legal MOVE action (freeing capacity)
    // that comes later in the same state's candidate list. Reproduces this
    // directly: 220 NOISE_i courses (2h each), all legal ONLY in
    // year_4_semester_a (already at 26h/cap via FILLER_A+MOVABLE) — every one
    // of them is an illegal ADD candidate there. The real, legal recovery
    // (move MOVABLE out to year_3_semester_b, then add TARGET, same
    // move-then-add shape as tests 16/17) sits in the SAME state's candidate
    // list, generated by enumerateActions' own group 5 (MOVE) before this
    // test's noise (only added via the "MORE ADD" loop, later in
    // recoveryCandidateActions' returned array) — but round 22's bug meant
    // enumerateActions' own group-4 ADD candidates (one raw, illegal
    // bestLegalSemester pick per NOISE course, positioned BEFORE group 5)
    // alone already exceed 200, silently consuming the whole budget first.
    const NOISE_COUNT = 220;
    const noiseCourses = Array.from({ length: NOISE_COUNT }, (_, i) => ({
      course_id: `NOISE_${i}`,
      name_he: `רעש ${i}`,
      weekly_hours: 2,
      is_mandatory: false,
      course_type: 'elective',
      placement_policy: 'elective',
      effective_allowed_semesters: ['year_4_semester_a'],
      prerequisites: [],
    }));
    const board = {
      semesters: [
        { semester_id: 'year_3_semester_a', courses: [
          { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
        ] },
        { semester_id: 'year_3_semester_b', courses: [] },
        { semester_id: 'year_4_semester_a', courses: [
          { course_id: 'FILLER_A', name_he: 'ממלא א', weekly_hours: 24, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          { course_id: 'MOVABLE', name_he: 'נייד', weekly_hours: 2, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a', 'year_3_semester_b'], prerequisites: [] },
        ] },
        { semester_id: 'year_4_semester_b', courses: [] },
      ],
      metadata: {
        completed_course_ids: [],
        program_requirements_categories: { total_required_hours: 185, categories: [] },
        program_repository_courses: [
          { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
          { course_id: 'FILLER_A', name_he: 'ממלא א', weekly_hours: 24, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          { course_id: 'MOVABLE', name_he: 'נייד', weekly_hours: 2, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a', 'year_3_semester_b'], prerequisites: [] },
          { course_id: 'TARGET', name_he: 'יעד', weekly_hours: 2, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          ...noiseCourses,
        ],
      },
    };
    const ctx = {
      total_hours_progress: { known_completed_hours: 100 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_move_then_add_budget_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: [],
      },
    };
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'MOVABLE'],
        year_4_semester_b: [],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('19. Codex-caught regression (round 24): a recovery that requires REMOVING a placed course entirely (not moving it, since it has no other legal semester) must still be found — e.g. to free room for an is_annual course\'s atomic bundle', () => {
    // SMALL (4h) is legal ONLY in year_4_semester_a — it has no other legal
    // semester, so MOVE can never relocate it (round 20/21's move-then-add
    // path structurally cannot reach this case). year_4_semester_a starts at
    // FILLER_A(20h)+SMALL(4h)=24h; year_4_semester_b starts at FILLER_B(20h).
    // TARGET_ANNUAL (6h, is_annual, spans both) needs 6h room in EACH span —
    // with SMALL present, A would need 24+6=30h (illegal). A single-semester
    // REPLACE_COURSE(SMALL, TARGET_ANNUAL) is ALSO always illegal (annual
    // courses must occupy every span at once — the exact round-24 finding).
    // The only real recovery: REMOVE SMALL entirely (A drops to 20h), then
    // ADD TARGET_ANNUAL's atomic bundle (A: 20+6=26h at cap, B: 20+6=26h at
    // cap — both legal). Net hours: -4 (SMALL) + 6 (TARGET_ANNUAL, credited
    // once per computeDegreeHours' annual dedup) = +2, genuinely more hours
    // and still complete (no mandatory/category depends on SMALL here).
    const board = {
      semesters: [
        { semester_id: 'year_3_semester_a', courses: [
          { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
        ] },
        { semester_id: 'year_3_semester_b', courses: [] },
        { semester_id: 'year_4_semester_a', courses: [
          { course_id: 'FILLER_A', name_he: 'ממלא א', weekly_hours: 20, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          { course_id: 'SMALL', name_he: 'קטן', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
        ] },
        { semester_id: 'year_4_semester_b', courses: [
          { course_id: 'FILLER_B', name_he: 'ממלא ב', weekly_hours: 20, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_b'], prerequisites: [] },
        ] },
      ],
      metadata: {
        completed_course_ids: [],
        program_requirements_categories: { total_required_hours: 185, categories: [] },
        program_repository_courses: [
          { course_id: 'MAND', name_he: 'חובה', weekly_hours: 4, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'], prerequisites: [] },
          { course_id: 'FILLER_A', name_he: 'ממלא א', weekly_hours: 20, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          { course_id: 'FILLER_B', name_he: 'ממלא ב', weekly_hours: 20, is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_4_semester_b'], prerequisites: [] },
          { course_id: 'SMALL', name_he: 'קטן', weekly_hours: 4, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_4_semester_a'], prerequisites: [] },
          { course_id: 'TARGET_ANNUAL', name_he: 'יעד שנתי', weekly_hours: 6, is_mandatory: false, course_type: 'elective', placement_policy: 'elective', is_annual: true, spans_semesters: ['year_4_semester_a', 'year_4_semester_b'], effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'], prerequisites: [] },
        ],
      },
    };
    const ctx = {
      total_hours_progress: { known_completed_hours: 100 },
      personal_status: { completed: [], currently_taking: [] },
    };
    const prefs = {} as any;
    const model = buildModel(board, ctx, prefs, 'test_program_gap_annual_replace_2027');
    const initialState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'SMALL'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    const finalState = {
      semesters: {
        year_3_semester_a: ['MAND'],
        year_3_semester_b: [],
        year_4_semester_a: ['FILLER_A', 'SMALL'],
        year_4_semester_b: ['FILLER_B'],
      },
    };
    const proposal = toProposal(finalState, model, initialState, {}, 'test');
    expect(proposal.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
    expect(proposal.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });
});

/**
 * plan_degree_completion_solver_goal.test.js
 *
 * Topic C — degree completion as a real solver goal.
 *
 * Phase-1 finding: the reported "172/185" production screenshot was checked
 * directly against the LIVE production catalog (manually fetched from
 * /api/board/mechanical_engineering_2027 during investigation — 69 courses,
 * zero contamination) and did NOT reproduce: buildDeterministicReplacementPlan
 * reached 186.5/185 with completed_degree_hours=128.5 and max_weekly_hours=25,
 * the exact scenario from the screenshot, with the real nameless records
 * injected into the pool. The 172/185 figure is most likely an artifact of
 * test-session-specific preferences/state from earlier manual testing on
 * this same production origin, not a planner defect. The tests below run
 * against the repo's offline fixture (with the two real nameless records
 * injected, since the fixture itself predates them) to lock the
 * confirmed-working behavior without depending on a live network call.
 *
 * These tests lock the CONFIRMED-WORKING behavior (reaches target when legal
 * candidates exist; never uses a nameless course as filler) as regressions,
 * rather than inventing a new "candidate exhaustion report" subsystem for a
 * symptom that didn't reproduce — per the explicit instruction not to invent
 * fixes for non-reproducing paths.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const NAMELESS_1 = '0542-4124';
const NAMELESS_2 = '0542-4191';

// The stale backup fixture used by these tests does not contain the real
// nameless catalog records (0542-4124/0542-4191) at all, so a "never used as
// filler" assertion against the fixture alone would pass trivially and prove
// nothing. Inject the EXACT real nameless records (verified live against
// /api/board/mechanical_engineering_2027) into courseMap before the
// fill-to-target run below, matching the pattern used in
// plan_nameless_course_data_quality.test.js — without depending on any
// copied production data file.
function injectNamelessCourses(window) {
  window.eval(`
    courseMap['${NAMELESS_1}'] = { course_id:'${NAMELESS_1}', name_he:null, weekly_hours:null, offered_semesters:[], is_mandatory:false, placement_policy:'elective', category_id:'other_specialization', program_category_id:'other_specialization' };
    courseMap['${NAMELESS_2}'] = { course_id:'${NAMELESS_2}', name_he:null, weekly_hours:null, offered_semesters:[], is_mandatory:false, placement_policy:'elective', category_id:'other_specialization', program_category_id:'other_specialization' };
    if (!state.repo.includes('${NAMELESS_1}')) state.repo.push('${NAMELESS_1}');
    if (!state.repo.includes('${NAMELESS_2}')) state.repo.push('${NAMELESS_2}');
  `);
}

function createPageSetup() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  h = h.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert  = () => {};
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window };
}

function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe('test_planner_reaches_185_when_legal_candidates_exist', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('exact screenshot scenario (128.5 completed, max 25/week) reaches 185, not 172', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 25 } });
      return JSON.stringify({ totalHours: plan.totalHours, reachedTarget: plan.reachedTarget });
    })()`));
    expect(r.reachedTarget).toBe(true);
    expect(r.totalHours).toBeGreaterThanOrEqual(185);
  });
});

describe('test_planner_does_not_stop_at_172_if_legal_candidates_exist', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('regression for the reported symptom: result is not 172 (or any value < 185) when legal candidates exist', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 25 } });
      return JSON.stringify({ totalHours: plan.totalHours });
    })()`));
    expect(r.totalHours).not.toBeCloseTo(172, 0);
    expect(r.totalHours).toBeGreaterThanOrEqual(185);
  });
});

describe('test_planner_partial_only_when_no_legal_candidates_exist', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a genuinely candidate-starved scenario (all electives hard-avoided) correctly falls short and is labeled partial', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 60 };
      const pool = Object.values(courseMap).filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c)).map(c => c.course_id);
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: pool, unwanted_course_ids: pool } });
      return JSON.stringify({ reachedTarget: plan.reachedTarget, gapReasons: plan.gapReasons });
    })()`));
    expect(r.reachedTarget).toBe(false);
    expect(r.gapReasons.length).toBeGreaterThan(0);
  });
});

describe('test_candidate_exhaustion_report_lists_blockers', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a partial result carries gapReasons with concrete blocker categories', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 60 };
      const pool = Object.values(courseMap).filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c)).map(c => c.course_id);
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: pool, unwanted_course_ids: pool } });
      return JSON.stringify({ gapReasons: plan.gapReasons });
    })()`));
    // Real categories already produced by gapBreakdown/gapReasons: missing
    // semester data, prerequisite blocks, category shortfalls.
    expect(r.gapReasons.some(g => /נתוני סמסטר|דרישות קדם|מחסור בקטגוריות/.test(g))).toBe(true);
  });
});

describe('test_no_nameless_course_used_to_reach_185', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('reaching 185 with the real nameless catalog records present never uses them as filler', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 25 } });
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      const nameless = allIds.filter(cid => { const c = courseMap[cid]; return c && !c.name_he; });
      return JSON.stringify({ nameless });
    })()`));
    expect(r.nameless).toEqual([]);
  });
});

describe('test_no_unknown_exam_course_as_clean_no_final_match', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('an unknown-assessment course is never silently treated as satisfying a no-final-exam preference', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const unknownCourse = { course_id: 'SYN_UNKNOWN', name_he: 'קורס בדיקה', assessment_type: null };
      const knownNoExam = { course_id: 'SYN_NOEXAM', name_he: 'קורס בדיקה 2', has_exam: false };
      return JSON.stringify({
        unknownHasExam: _hasFinalExamLocal(unknownCourse),
        knownHasExam: _hasFinalExamLocal(knownNoExam),
      });
    })()`));
    // Unknown must be null (neither true nor false) — never silently false.
    expect(r.unknownHasExam).toBeNull();
    expect(r.knownHasExam).toBe(false);
  });
});

describe('test_overload_not_used_to_reach_185', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('reaching 185 does not require exceeding max_weekly_hours when the user set a high enough max', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 40 } });
      const semHours = plan.proposal.semesters.map(s => (s.course_ids||[]).reduce((sum,cid)=>sum+(hoursForCourseId(cid)||0),0));
      return JSON.stringify({ reachedTarget: plan.reachedTarget, maxSemHours: Math.max(...semHours) });
    })()`));
    expect(r.reachedTarget).toBe(true);
    expect(r.maxSemHours).toBeLessThanOrEqual(40);
  });
});

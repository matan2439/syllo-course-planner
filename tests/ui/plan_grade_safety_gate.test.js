/**
 * plan_grade_safety_gate.test.js
 *
 * Over-selection fix: fillToDegreeTargetLocal no longer adds a risk ≥ 0.9 course as
 * pure hours-filler. A very-hard course is placed ONLY when it is mandatory, an
 * explicit user request, or it satisfies a STILL-UNMET category minimum. Otherwise the
 * planner leaves the small gap and surfaces it honestly. These tests prove the new
 * behavior and that counting / categories / exclusions are unaffected.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
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
  window.fetch  = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return dom;
}
function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try { if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve(); } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}
// Build a full-185 plan with a strength focus + grade target (the scenario that
// previously over-selected risk-1.0 solids/fluids/systems courses), and return rich
// diagnostics from the live debugger.
const BUILD = `(function(){
  degreeHoursProfile = { completed_degree_hours: 90 }; userCourseStatuses = {};
  const _origBoard = new Set(Object.values(state.semesters||{}).flat());
  _aiPickerState = { wanted: [], unwanted: ['0542-4120'], strongUnwanted: ['0542-4120'], shaarRuachAssessmentPref: null, _initialized: true };
  _aiPlanLastPreferences = { extra_request_he: 'דגש על חוזק ותכן, ממוצע 82, בלי תרמודינמיקה 2', grade_target: 82 };
  _aiUserIntentProfile = buildUserIntentProfileLocal(_aiPlanLastPreferences.extra_request_he, { gradeTarget: 82, extraHardExclude: ['0542-4120'] });
  const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
  const placed = plan.proposal.semesters.flatMap(s => s.course_ids || []);
  const d = debugCurrentPlan();
  const hardPlaced = placed.filter(c => courseMap[c] && (courseMap[c].course_type||'elective')!=='mandatory' && _gradeRiskScoreLocal(courseMap[c]).risk >= 0.9);
  const cats = (programRequirements.categories||[]);
  const catStatus = {};
  const countedSet = new Set([...placed, ...(typeof completedCourseIds!=='undefined'?completedCourseIds:[])]);
  for (const cat of cats) { const n = (cat.course_ids||[]).filter(c=>countedSet.has(c)).length; catStatus[cat.category_id] = { min: cat.min_courses||0, counted: n, satisfied: n >= (cat.min_courses||0) }; }
  const solidsPlaced = (cats.find(c=>c.category_id==='solids')?.course_ids||[]).filter(c=>placed.includes(c));
  const hardOnBoard = placed.filter(c => courseMap[c] && (courseMap[c].course_type||'elective')!=='mandatory' && _gradeRiskScoreLocal(courseMap[c]).risk>=0.9 && _origBoard.has(c));
  const maxLoad = Math.max(0, ...plan.proposal.semesters.map(s=>(s.course_ids||[]).reduce((t,c)=>t+(hoursForCourseId(c)||0),0)));
  return JSON.stringify({
    total: d.layer1_degreeProgress.totalCountedHours,
    remaining: d.layer1_degreeProgress.remainingHoursTo185,
    duplicateHours: d.layer1_degreeProgress.duplicateHours,
    countedSum: d.layer1_degreeProgress.countedCourses.filter(c=>c.counted).reduce((s,c)=>s+(c.hours||0),0),
    canonical: buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters }).totalAfterPlan,
    hardPlacedCount: hardPlaced.length,
    hardPlaced: hardPlaced.map(c=>({id:c, name:courseMap[c].name_he, risk:Math.round(_gradeRiskScoreLocal(courseMap[c]).risk*100)/100, onBoard:_origBoard.has(c)})),
    hardOnBoardCount: hardOnBoard.length,
    hardAddedByPlanner: hardPlaced.filter(c=>!_origBoard.has(c)).length,
    solidsPlacedCount: solidsPlaced.length,
    catStatus,
    t2Placed: placed.includes('0542-4120'),
    skippedFiller: plan.skippedHighRiskFiller || [],
    skippedGlobal: _aiPlanLastSkippedFiller || [],
    whyNotFull: d.whyNotLegalFull || null,
    summary: formatFull185SummaryLocal(plan),
    layer5Roles: (d.layer5_selectedExplanation||[]).map(x=>({id:x.id, risk:x.gradeRiskScore, role:x.categoryRole, because:x.selectedBecause})),
    layer5Skipped: d.layer5_skippedHighRiskFiller || [],
    maxLoad: Math.round(maxLoad*10)/10,
    hardCap: HARD_LOAD_CAP,
  });
})()`;

describe('grade-safety over-selection gate', () => {
  let dom, window, R;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); R = JSON.parse(window.eval(BUILD)); }, 30000);
  afterAll(() => dom && dom.window.close());

  test('1 — degree-hours counting remains consistent (debug == canonical PlanContext)', () => {
    expect(R.total).toBeCloseTo(R.canonical, 1);
  });

  test('2 — no duplicate counting (counted-sum == total, duplicateHours 0)', () => {
    expect(R.duplicateHours).toBe(0);
    expect(Math.round(R.countedSum * 10) / 10).toBeCloseTo(R.total, 1);
  });

  test('3 — all category minimums are still satisfied', () => {
    for (const k of Object.keys(R.catStatus)) {
      if (R.catStatus[k].min > 0) expect(R.catStatus[k].satisfied).toBe(true);
    }
  });

  test('4 — excluded תרמודינמיקה (2) (0542-4120) is never selected', () => {
    expect(R.t2Placed).toBe(false);
  });

  test('5 — a risk≥0.9 course IS still selected when it satisfies an unmet category min (solids)', () => {
    // solids min is 1 and every solids option is risk ≥1.0 → exactly the needed one stays.
    expect(R.solidsPlacedCount).toBeGreaterThanOrEqual(1);
    const requiredHard = R.layer5Roles.filter(x => x.risk >= 0.9 && x.role === 'category_required');
    expect(requiredHard.length).toBeGreaterThanOrEqual(1);
  });

  test('6 — risk≥0.9 filler (no unmet category min) is SKIPPED, not placed', () => {
    expect(R.skippedFiller.length).toBeGreaterThan(0);
    const skippedIds = new Set(R.skippedFiller.map(s => s.course_id));
    // none of the skipped courses ended up in the plan
    for (const x of R.hardPlaced) expect(skippedIds.has(x.id)).toBe(false);
    // each skipped is tagged as high-risk filler not category-required
    for (const s of R.skippedFiller) { expect(s.risk).toBeGreaterThanOrEqual(0.9); expect(s.reason).toBe('high_risk_filler_not_category_required'); }
  });

  test('7 — the planner surfaces the remaining gap honestly instead of force-filling', () => {
    expect(R.summary).toMatch(/דילגתי על.*סיכון ציונים גבוה/);
    expect(R.whyNotFull).not.toBeNull();
    expect(R.whyNotFull.highRiskFillerSkipped).toBeGreaterThan(0);
    expect(Array.isArray(R.whyNotFull.requirementsSatisfiedDespiteGap)).toBe(true);
  });

  test('8 — debug marks skipped courses as high-risk filler + selected courses carry categoryRole', () => {
    expect(R.layer5Skipped.length).toBeGreaterThan(0);
    expect(R.layer5Roles.every(x => typeof x.role === 'string')).toBe(true);
    // at least one placed hard course is flagged category_required (the unavoidable solids one)
    expect(R.layer5Roles.some(x => x.risk >= 0.9 && x.role === 'category_required')).toBe(true);
  });

  test('9 — selected high-risk course count DROPS vs the prior over-selecting behavior (was 6)', () => {
    // Prior behavior placed 6 risk≥0.9 courses (3 solids + הזורמים2 + תורת המכונות + דינמיקה ובקרה).
    expect(R.hardPlacedCount).toBeLessThan(6);
    expect(R.solidsPlacedCount).toBeLessThanOrEqual(1); // was 3
  });

  test('10 — the resulting plan is lighter and introduces no NEW semester overload', () => {
    // The grade-safety gate removes over-selected hard courses → a strictly lighter
    // plan. (A pre-existing 27-ש"ש peak from mandatory/board packing is a separate
    // load-balancing concern, present before this patch — this fix must not worsen it.)
    expect(R.total).toBeLessThan(182.5);       // strictly lighter than the old force-filled plan
    expect(R.maxLoad).toBeLessThanOrEqual(27); // not worse than the prior peak
  });
});

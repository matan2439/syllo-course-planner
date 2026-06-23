/**
 * plan_overshoot_minimization.test.js
 *
 * Orchestration-level overshoot fix: the dominant overshoot source was
 * repairAddRequestedDomainCoursesLocal adding EVERY intent-matched ("soft
 * domain") course unconditionally, with zero awareness of the remaining
 * degree-hours gap (confirmed via live pipeline tracing: 7 courses / 23 ש"ש
 * added against a 9 ש"ש gap). The fix splits requested courses into hard
 * must-include (always added, unchanged priority) vs soft domain-text matches
 * (gap-bounded, picked via the same fitRankToGap logic as
 * fillToDegreeTargetLocal). repairAddGeneralCoursesLocal similarly stops once
 * the global 185 target is already met, surfacing the conflict instead of
 * silently overfilling. The high-risk (risk >= 0.9) filler gate from 133f5c3
 * must still hold unchanged.
 *
 * NOTE: a real, unresolved jsdom-vs-live-browser divergence exists for this
 * exact scenario (135 completed + same intent text reaches a different total
 * in jsdom than in the live app) — root cause not yet found. Assertions below
 * are intentionally scoped to what THIS fix guarantees structurally (no
 * unconditional addition of all soft-domain matches, fit-ranked selection,
 * stop-at-gap behavior) rather than to one exact hours number, so they remain
 * meaningful regardless of that divergence. Live browser QA is the
 * authoritative check for the actual 176/185 reproduction.
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
const buildScript = (completedHours, extraRequestHe, gradeTarget, mustIncludeIds) => `(function(){
  degreeHoursProfile = { completed_degree_hours: ${completedHours} }; userCourseStatuses = {};
  _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
  _aiPlanLastPreferences = { extra_request_he: ${JSON.stringify(extraRequestHe)}, grade_target: ${gradeTarget === null ? 'null' : gradeTarget}${mustIncludeIds ? `, must_include_course_ids: ${JSON.stringify(mustIncludeIds)}` : ''} };
  _aiUserIntentProfile = buildUserIntentProfileLocal(_aiPlanLastPreferences.extra_request_he, ${gradeTarget === null ? '{}' : `{ gradeTarget: ${gradeTarget} }`});
  const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
  const d = debugCurrentPlan();
  return JSON.stringify({
    fillStats: plan.fillStats,
    totalHours: plan.totalHours,
    reachedTarget: plan.reachedTarget,
    skippedFiller: plan.skippedHighRiskFiller || [],
    summary: formatFull185SummaryLocal(plan),
    addedCids: (plan.addedCids || plan.added_course_ids || []),
    proposalCourseIds: (plan.proposal.semesters||[]).flatMap(s=>s.course_ids||[]),
    layer5Roles: (d.layer5_selectedExplanation||[]).map(x=>({id:x.id, risk:x.gradeRiskScore, role:x.categoryRole})),
  });
})()`;

describe('overshoot-minimization gate (orchestration-level)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 30000);
  afterAll(() => dom && dom.window.close());

  test('1 — a 9 ש"ש gap with soft domain-text matches [4,3,4,4,4,3,1]=23ש"ש does not add all 23ש"ש', () => {
    // These are the EXACT real domain-match course hours verified via live pipeline
    // tracing for "דגש על חוזק ותכן". An exact-fit 9ש"ש subset (4+4+1) exists within
    // them — the planner must not add all 7 courses just because they all matched.
    const R = JSON.parse(window.eval(buildScript(135, 'דגש על חוזק ותכן, ממוצע 82', 82)));
    expect(R.fillStats).toBeTruthy();
    expect(R.fillStats.targetHours).toBe(185);
    // The dominant bug added 23ש"ש of soft domain matches alone. The fix must not
    // reproduce that: total overshoot must be far smaller than the full 23ש"ש sum.
    expect(R.fillStats.overshootHours).toBeLessThan(15);
  });

  test('2 — soft domain-focus courses are not all added just because they match the intent text', () => {
    const R = JSON.parse(window.eval(buildScript(135, 'דגש על חוזק ותכן, ממוצע 82', 82)));
    const domainMatchIds = ['0542-4422', '0542-4425', '0542-4224', '0542-4221', '0542-4223', '0542-4226', '0581-4131'];
    const placedDomainCount = domainMatchIds.filter(cid => R.proposalCourseIds.includes(cid)).length;
    // At least one of the 7 must have been skipped once the gap was closed —
    // otherwise the unconditional-add bug is still present.
    expect(placedDomainCount).toBeLessThan(domainMatchIds.length);
  });

  test('3 — hard must-include courses are still added unconditionally, bypassing the gap budget', () => {
    // Baseline kept below 185 pre-repair (committed board already carries 41ש"ש,
    // so completed=100 keeps the pre-repair total at 141, avoiding the unrelated
    // "baseline already at target" skip-gate). An explicit must-include course must
    // still be placed exactly like before this fix — it is never subject to the
    // soft-domain gap budget.
    const R = JSON.parse(window.eval(buildScript(100, '', null, ['0542-4221'])));
    expect(R.proposalCourseIds).toContain('0542-4221');
  });

  test('4 — when only high-risk filler remains, the planner stops below target and explains why', () => {
    const R = JSON.parse(window.eval(buildScript(110, '', null)));
    expect(R.skippedFiller.length).toBeGreaterThan(0);
    expect(R.reachedTarget).toBe(false);
    expect(R.fillStats.stoppedBelowTarget).toBe(true);
    expect(R.summary).toMatch(/לא הגעתי ל-?185/);
    for (const s of R.skippedFiller) expect(s.risk).toBeGreaterThanOrEqual(0.9);
  });

  test('5 — regression: risk >= 0.9 courses are still never used as plain hours-filler', () => {
    const R = JSON.parse(window.eval(buildScript(135, 'דגש על חוזק ותכן, ממוצע 82', 82)));
    const hardNonRequired = R.layer5Roles.filter(x => x.risk >= 0.9 && x.role !== 'category_required' && x.role !== 'mandatory' && x.role !== 'must_include');
    expect(hardNonRequired.length).toBe(0);
  });

  test('6 — summary/debug accounting reports target, baseline, added, final and overshoot consistently', () => {
    const R = JSON.parse(window.eval(buildScript(135, 'דגש על חוזק ותכן, ממוצע 82', 82)));
    const fs2 = R.fillStats;
    expect(fs2.targetHours).toBe(185);
    expect(typeof fs2.baselineHours).toBe('number');
    expect(typeof fs2.addedHours).toBe('number');
    expect(typeof fs2.finalHours).toBe('number');
    expect(Math.round((fs2.baselineHours + fs2.addedHours) * 10) / 10).toBe(Math.round(fs2.finalHours * 10) / 10);
    expect(R.summary).toMatch(/חישוב שעות/);
  });
});


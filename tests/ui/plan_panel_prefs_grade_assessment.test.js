/**
 * plan_panel_prefs_grade_assessment.test.js
 *
 * Planning Preferences panel → UserIntentProfile/PlanContext, grade-target ranking,
 * שער-רוח no-final-exam preference, and concise build response.
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
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

// Set the Planning Preferences panel state (exclude תרמו 2, grade 82, prefer no-exam,
// 90h baseline) and run a full-185 build via the same path the chat uses.
const BUILD_WITH_PANEL = `(function(){
  degreeHoursProfile = { completed_degree_hours: 90 };
  _aiPickerState = { wanted: [], unwanted: ['0542-4120'], strongUnwanted: ['0542-4120'], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
  _aiPlanLastPreferences = { extra_request_he: 'התמקדות בחוזק ותכן ורעידות, ממוצע סביב 82', grade_target: 82 };
  _aiUserIntentProfile = buildUserIntentProfileLocal(_aiPlanLastPreferences.extra_request_he, { gradeTarget: 82, shaarRuachAssessmentPref: 'prefer_no_exam', extraHardExclude: ['0542-4120'] });
  return rebuildDraftFromProfileLocal({ fillToTarget: true });
})()`;

describe('Planning Preferences panel integration', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  const build = () => JSON.parse(window.eval(`(function(){
    const plan = ${BUILD_WITH_PANEL};
    const pc = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters });
    const placed = new Set(plan.proposal.semesters.flatMap(s=>s.course_ids||[]));
    const profile = plan.userIntentProfile;
    const g = plan.gapBreakdown;
    const t2relax = (g.relaxableCourses||[]).find(r=>r.course_id==='0542-4120');
    return JSON.stringify({
      total: pc.totalAfterPlan, status: computeDraftStatusLocal().status,
      t2Placed: placed.has('0542-4120'),
      profileHardExclude: profile.hardExcludeCourseIds||[],
      profileGrade: profile.gradeTarget, profileAssess: profile.shaarRuachAssessmentPref,
      blockedByHardExclude: g.blockedByHardExclude, blockedByWorkload: g.blockedByWorkload,
      t2InRelaxable: !!t2relax, t2Blocker: t2relax ? t2relax.blocker : null,
      summary: formatFull185SummaryLocal(plan),
    });
  })()`));

  test('G1 — panel-excluded course is in UserIntentProfile.hardExcludeCourseIds', () => {
    expect(build().profileHardExclude).toContain('0542-4120');
  });

  test('G2 — תרמודינמיקה (2) excluded in the panel is never selected', () => {
    expect(build().t2Placed).toBe(false);
  });

  test('G3 — the reason for the excluded course is "user excluded", not "workload"', () => {
    const r = build();
    expect(r.blockedByHardExclude).toBeGreaterThanOrEqual(1);
    // It must NOT be counted under workload (and not appear as a workload-relaxable).
    expect(r.t2Blocker).not.toBe('workload');
    expect(r.summary).toMatch(/תרמודינמיקה.*לא שובצה כי ביקשת לא לשבץ/);
  });

  test('G6 — completed-hours baseline from the panel is used (90h)', () => {
    const completed = window.eval(`(function(){ ${BUILD_WITH_PANEL}; return buildPlanContextFromState({}).completedHours; })()`);
    expect(completed).toBe(90);
  });

  test('G7+G8+G10 — reaches 185 with the full repository; legal_full only at >=185', () => {
    const r = build();
    expect(r.total).toBeGreaterThanOrEqual(185);
    expect(r.status).toBe('legal_full');
  });

  test('G11 — gradeTarget 82 is represented in the profile', () => {
    expect(build().profileGrade).toBe(82);
  });

  test('G17 — no-final-exam preference is read into the profile', () => {
    expect(build().profileAssess).toBe('prefer_no_exam');
  });

  test('G21 — the build response is concise (no exhaustive course list by default)', () => {
    const r = build();
    const nLines = r.summary.split('\n').length;
    expect(nLines).toBeLessThanOrEqual(16);
    expect(r.summary).toContain('לפירוט מלא');
  });
});

describe('Grade-risk + no-final-exam ranking', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('G12 — a lower grade-risk course outranks a higher-risk one at equal relevance', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('', { gradeTarget: 85 });
      const safe = { course_id: 'X-1', name_he: 'safe', tau_factor_avg_grade: 90 };
      const risky = { course_id: 'X-2', name_he: 'risky', tau_factor_avg_grade: 65 };
      return JSON.stringify({
        safe: scoreCourseAgainstIntentProfileLocal(safe, profile).score,
        risky: scoreCourseAgainstIntentProfileLocal(risky, profile).score,
      });
    })()`));
    expect(res.safe).toBeGreaterThan(res.risky);
  });

  test('G13 — missing grade data is penalized (not ignored) when a target is set', () => {
    const res = JSON.parse(window.eval(`(function(){
      const withTarget = buildUserIntentProfileLocal('', { gradeTarget: 85 });
      const noTarget = buildUserIntentProfileLocal('', {});
      const unknown = { course_id: 'X-3', name_he: 'unknown' };
      return JSON.stringify({
        withTarget: scoreCourseAgainstIntentProfileLocal(unknown, withTarget).score,
        noTarget: scoreCourseAgainstIntentProfileLocal(unknown, noTarget).score,
      });
    })()`));
    expect(res.withTarget).toBeLessThan(res.noTarget);
  });

  test('G18+G19 — שער-רוח no-exam outranks exam and unknown when prefer_no_exam', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('', { shaarRuachAssessmentPref: 'prefer_no_exam' });
      const noExam  = { course_id: '0609-1001', name_he: 'no exam', has_exam: false };
      const exam    = { course_id: '0609-1002', name_he: 'exam', has_exam: true };
      const unknown = { course_id: '0609-1003', name_he: 'unknown' };
      return JSON.stringify({
        noExam:  scoreCourseAgainstIntentProfileLocal(noExam, profile).score,
        exam:    scoreCourseAgainstIntentProfileLocal(exam, profile).score,
        unknown: scoreCourseAgainstIntentProfileLocal(unknown, profile).score,
      });
    })()`));
    expect(res.noExam).toBeGreaterThan(res.unknown);
    expect(res.unknown).toBeGreaterThan(res.exam);
  });

  test('G14 — a relevant strength/design course outranks unrelated filler', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('דגש על חוזק ותכן', {});
      // strength-domain course vs an unrelated general course
      const domainCid = (PLANNING_DOMAINS.strength && PLANNING_DOMAINS.strength.course_ids || [])[0];
      const filler = Object.keys(courseMap).find(cid => cid.startsWith('0609') && courseMap[cid].name_he);
      if (!domainCid || !filler) return JSON.stringify({ skip: true });
      return JSON.stringify({
        domain: scoreCourseAgainstIntentProfileLocal(courseMap[domainCid], profile).score,
        filler: scoreCourseAgainstIntentProfileLocal(courseMap[filler], profile).score,
      });
    })()`));
    if (!res.skip) expect(res.domain).toBeGreaterThan(res.filler);
  });

  test('G22 — full detail appears only on explicit request ("פתח פירוט מלא")', () => {
    const t = window.eval(`(function(){ return classifyCorrectionIntentLocal('פתח פירוט מלא').type; })()`);
    expect(t).toBe('explain_full_detail');
  });
});

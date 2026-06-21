/**
 * plan_completed_source_workload_thermal.test.js
 *
 * Completed-courses panel as source of truth, post-185 workload trim, grade-risk on
 * hard courses, and the thermal-design course data audit / discoverability.
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

describe('Completed courses = source of truth', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  const buildWithCompleted = () => JSON.parse(window.eval(`(function(){
    degreeHoursProfile = { completed_degree_hours: 90 };
    const onBoard = Object.values(state.semesters).flat();
    const done = onBoard.find(cid => courseMap[cid] && (courseMap[cid].course_type||'elective')!=='mandatory') || onBoard[0];
    userCourseStatuses[done] = { status: 'completed' };
    const plan = buildFull185PlanLocal({ extra_request_he: 'דגש על חוזק ותכן, ממוצע 82' });
    const placed = new Set(plan.proposal.semesters.flatMap(s=>s.course_ids||[]));
    const pc = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters });
    const audit = auditCompletedStateLocal();
    return JSON.stringify({ done, reScheduled: placed.has(done), total: pc.totalAfterPlan, audit });
  })()`));

  test('C1+C2 — a completed course is removed from the draft and never re-scheduled', () => {
    const r = buildWithCompleted();
    expect(r.reScheduled).toBe(false);
    expect(r.audit.completedCourseIds).toContain(r.done);
  });

  test('C7 — auditCompletedStateLocal exposes the completed-state fields', () => {
    const r = buildWithCompleted();
    for (const k of ['completedHours','existingBoardHours','totalAfterPlan','remainingHoursTo185',
                     'completedCourseIds','currentlyTakingCourseIds','plannedCourseIds']) {
      expect(r.audit[k]).toBeDefined();
    }
  });
});

describe('185 completion + workload trim', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('F1+F12 — reaches the legal ceiling; legal_full at 185, else legal_partial (data-limited)', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      activateProposalDraft(plan.proposal);
      const ds = computeDraftStatusLocal();
      return JSON.stringify({ total: ds.total, status: ds.status });
    })()`));
    // With the שער-רוח cap, 185 needs schedulable engineering electives; when those run
    // out (unschedulable_missing_data) the honest status is legal_partial, NOT legal_full.
    if (r.total >= 185) expect(r.status).toBe('legal_full');
    else { expect(r.total).toBeGreaterThan(180); expect(r.status).toBe('legal_partial'); }
  });

  test('F4 — workload trim never drops the total below its starting point', () => {
    const ok = window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      const before = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters }).totalAfterPlan;
      const trimmed = minimizeOverloadAfterTargetLocal(plan.proposal, { requiredHours: 185, beforeCids: new Set(Object.values(state.semesters).flat()), userIntentProfile: plan.userIntentProfile });
      const after = buildPlanContextFromState({ proposalSemesters: trimmed.semesters }).totalAfterPlan;
      return after >= Math.min(before, 185) - 0.01 && after <= before + 0.01;
    })()`);
    expect(ok).toBe(true);
  });
});

describe('Grade-risk + thermal-design audit/discoverability', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('F5 — a hard/high-risk course (low TAU grade) loses to an easier equal-relevance one', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('דגש על חוזק', { gradeTarget: 82 });
      // Two strength-domain courses, equal relevance, different grade risk.
      const hard = { course_id: 'S-1', name_he: 'hard', tau_factor_avg_grade: 48 };
      const easy = { course_id: 'S-2', name_he: 'easy', tau_factor_avg_grade: 88 };
      return JSON.stringify({
        hard: scoreCourseAgainstIntentProfileLocal(hard, profile).score,
        easy: scoreCourseAgainstIntentProfileLocal(easy, profile).score,
      });
    })()`));
    expect(res.easy).toBeGreaterThan(res.hard);
  });

  test('F7 — the thermal-design course is discoverable by name variants', () => {
    const res = JSON.parse(window.eval(`JSON.stringify({
      a: resolveCourseMentionsLocal('תכן תרמי מתקדם'),
      b: resolveCourseMentionsLocal('thermal design'),
    })`));
    expect(res.a).toContain('0542-4135');
    expect(res.b).toContain('0542-4135');
  });

  test('F9 — auditCourseDataLocal reports the exact missing field for 0542-4135', () => {
    const a = JSON.parse(window.eval(`JSON.stringify(auditCourseDataLocal('0542-4135'))`));
    expect(a.in_courseMap).toBe(true);
    expect(a.missing_fields).toContain('offered_semesters');
    expect(a.schedulable).toBe(false);
    expect(a.blocking_reason).toContain('offered_semesters');
  });

  test('F8/D — the build summary surfaces relevant courses blocked by missing data', () => {
    const summary = window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: 'דגש על תכן ומעבר חום' });
      _aiPlanLastGapBreakdown = plan.gapBreakdown;
      activateProposalDraft(plan.proposal);
      return formatFull185SummaryLocal(plan);
    })()`);
    expect(summary).toContain('נתוני סמסטר');
  });
});

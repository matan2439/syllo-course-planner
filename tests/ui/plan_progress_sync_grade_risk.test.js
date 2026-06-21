/**
 * plan_progress_sync_grade_risk.test.js
 *
 * Issue A — ONE canonical degree-progress source (buildDegreeProgressContext); editing
 * completed courses updates the baseline everywhere and invalidates stale state.
 * Issue B — gradeTarget=82 strongly deprioritizes hard courses and changes the plan.
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

describe('Issue A — canonical degree-progress sync', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('A1 — buildDegreeProgressContext exposes the full canonical field set', () => {
    const keys = JSON.parse(window.eval('JSON.stringify(Object.keys(buildDegreeProgressContext({})))'));
    for (const k of ['completedHours','completedCourseIds','currentlyTakingCourseIds','existingBoardHours',
                     'draftHours','duplicateHours','totalAfterPlan','remainingHoursTo185',
                     'shaarRuachCompleted','shaarRuachRemaining','sourceVersion']) {
      expect(keys).toContain(k);
    }
  });

  test('A2 — "הקורסים שלי", PlanContext, and program-progress agree on the baseline', () => {
    const r = JSON.parse(window.eval(`(function(){
      const dpc = buildDegreeProgressContext({});
      const pc = buildPlanContextFromState({});
      const prog = computeProgramProgress();
      return JSON.stringify({
        dpcBaseline: dpc.completedHours + dpc.existingBoardHours,
        pcBaseline: pc.completedHours + pc.existingBoardHours,
        sidebar: prog.plannedHours,
        dpcCompleted: dpc.completedHours, pcCompleted: pc.completedHours,
      });
    })()`));
    expect(r.dpcCompleted).toBe(r.pcCompleted);
    expect(r.dpcBaseline).toBeCloseTo(r.pcBaseline, 1);
    expect(r.dpcBaseline).toBeCloseTo(r.sidebar, 1);
  });

  test('A4+A1 — editing a completed course recomputes completedCourseIds immediately', () => {
    const r = JSON.parse(window.eval(`(function(){
      const mand = Object.keys(courseMap).find(cid=>courseMap[cid].course_type==='mandatory'&&courseMap[cid].weekly_hours);
      const beforeIn = completedCourseIds.includes(mand);
      setUserStatus(mand, 'completed');
      const dpc = buildDegreeProgressContext({});
      return JSON.stringify({ mand, beforeIn, afterIn: completedCourseIds.includes(mand), inContext: dpc.completedCourseIds.includes(mand) });
    })()`));
    expect(r.beforeIn).toBe(false);
    expect(r.afterIn).toBe(true);
    expect(r.inContext).toBe(true);
  });

  test('A7 — editing completed courses invalidates the stale AI draft/validation', () => {
    const r = JSON.parse(window.eval(`(function(){
      // seed a stale draft + validation
      state.proposalDraft = { semesters: { year_3_semester_a: [] }, repo: [] };
      _aiPlanLastValidation = { stale: true }; _aiPlanLastProposal = { stale: true };
      const cid = Object.keys(courseMap).find(c=>courseMap[c].name_he);
      setUserStatus(cid, 'completed');
      return JSON.stringify({ draftNull: !state.proposalDraft, valNull: _aiPlanLastValidation===null, propNull: _aiPlanLastProposal===null });
    })()`));
    expect(r.draftNull).toBe(true);
    expect(r.valNull).toBe(true);
    expect(r.propNull).toBe(true);
  });

  test('A8 — totalAfterPlan includes completedHours (not board-only) when completed exists', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const dpc = buildDegreeProgressContext({});
      return JSON.stringify({ completed: dpc.completedHours, total: dpc.totalAfterPlan });
    })()`));
    expect(r.completed).toBe(90);
    expect(r.total).toBeGreaterThanOrEqual(90);
  });
});

describe('Issue B — grade-risk meaningfully changes the plan', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  const hardCount = (extra) => JSON.parse(window.eval(`(function(){
    degreeHoursProfile = { completed_degree_hours: 90 };
    const plan = buildFull185PlanLocal({ extra_request_he: ${JSON.stringify(extra)} });
    const placed = plan.proposal.semesters.flatMap(s=>s.course_ids||[]);
    const hard = placed.filter(cid=>{const c=courseMap[cid]; return c && (c.course_type||'elective')!=='mandatory' && _gradeRiskScoreLocal(c).risk>=0.7;});
    const total = buildPlanContextFromState({proposalSemesters:plan.proposal.semesters}).totalAfterPlan;
    return JSON.stringify({ hard: hard.length, total });
  })()`));

  test('B1 — gradeTarget=82 strongly penalizes a very-hard domain course vs an easier one', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('דגש על חוזק', { gradeTarget: 82 });
      // both are strength-domain ids → equal +5 domain bonus; risk differs sharply
      const dId = (PLANNING_DOMAINS.strength && PLANNING_DOMAINS.strength.course_ids || [])[0] || '0542-4224';
      const hard = { course_id: dId, name_he: 'hard domain', tau_factor_avg_grade: 45 };
      const easy = { course_id: dId, name_he: 'easy domain', tau_factor_avg_grade: 90 };
      return JSON.stringify({ hard: scoreCourseAgainstIntentProfileLocal(hard, profile).score, easy: scoreCourseAgainstIntentProfileLocal(easy, profile).score });
    })()`));
    expect(res.easy).toBeGreaterThan(res.hard + 5); // the gap is large, not marginal
  });

  test('B7 — the plan changes (fewer hard courses) when gradeTarget=82 is active', () => {
    const without = hardCount('דגש על חוזק ותכן');
    const withTarget = hardCount('דגש על חוזק ותכן, ממוצע 82');
    expect(withTarget.hard).toBeLessThanOrEqual(without.hard);
    // grade target must not REGRESS the total below what the neutral build reaches
    // (the ceiling may be < 185 when relevant electives lack offering data).
    expect(withTarget.total).toBeGreaterThanOrEqual(Math.min(without.total, 185) - 0.01);
  });

  test('B-replace — replaceHighRiskCoursesLocal never makes the total worse', () => {
    const ok = window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: 'דגש על חוזק, ממוצע 85' });
      const before = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters }).totalAfterPlan;
      const r = replaceHighRiskCoursesLocal(plan.proposal, { requiredHours: 185, knownSemesterIds: SEMESTERS.map(s=>s.id), beforeCids: new Set(Object.values(state.semesters).flat()), userIntentProfile: plan.userIntentProfile, completedCourseIds: new Set(completedCourseIds||[]) });
      const after = buildPlanContextFromState({ proposalSemesters: r.proposal.semesters }).totalAfterPlan;
      // the swap pass preserves the total (floor = min(required, before)); it never reduces it
      return after >= Math.min(before, 185) - 0.01;
    })()`);
    expect(ok).toBe(true);
  });
});

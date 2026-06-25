/**
 * plan_partial_contract_all_paths.test.js
 *
 * Item 4 follow-up: the deterministic-replacement rescue path was fixed to use
 * the partial-plan contract ("לא הצלחתי להגיע…" / "טיוטה חלקית" / "החל טיוטה
 * חלקית (לא מלאה)"), but live preview verification found a SECOND path —
 * activateTentativeDraft / buildPlanningFallback — that produced a below-
 * target draft (~144/185) without that framing: the message just said
 * "סה״כ ש״ש לאחר השיבוץ: ~144/185. חסרות עוד כ-41 ש״ש…" and the apply button
 * read plain "החל טיוטה". A third path (the LLM-accepted SUCCESS_WITH_CHANGES
 * message, postPlanChangeSummary) and the persistent board-draft-apply banner
 * (the actual generic apply surface for any active draft) had the same gap.
 *
 * Root cause: each path computed/rendered its own ad-hoc hours line instead of
 * sharing one contract. Fixed by extracting buildPartialPlanContract(total,
 * target) and using it everywhere a below-target plan can be presented.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function createPageSetup(aiResponseFn) {
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
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(aiResponseFn ? aiResponseFn(window) : { semesters: [], warnings_he: [] }) });
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

describe('buildPartialPlanContract — shared helper', () => {
  let dom, window;
  beforeAll(async () => { dom = createPageSetup().dom; window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('returns null when total >= target (complete plan keeps normal framing)', () => {
    const r = window.eval('JSON.stringify(buildPartialPlanContract(185, 185))');
    expect(JSON.parse(r)).toBeNull();
    const r2 = window.eval('JSON.stringify(buildPartialPlanContract(195, 185))');
    expect(JSON.parse(r2)).toBeNull();
  });

  test('returns the partial contract with correct missing-hours figure when below target', () => {
    const r = JSON.parse(window.eval('JSON.stringify(buildPartialPlanContract(144, 185))'));
    expect(r.leadLine).toContain('לא הצלחתי להגיע ל-185');
    expect(r.leadLine).toContain('חסרות 41 ש״ש');
    expect(r.partialTagLine).toContain('טיוטה חלקית');
    expect(r.applyLabel).toBe('החל טיוטה חלקית (לא מלאה)');
    expect(r.missing).toBe(41);
  });

  test('honors an explicit reached=false override even when hours alone look sufficient (category-incomplete case)', () => {
    const r = JSON.parse(window.eval('JSON.stringify(buildPartialPlanContract(128.5, 10, false))'));
    expect(r).not.toBeNull();
    expect(r.applyLabel).toBe('החל טיוטה חלקית (לא מלאה)');
  });

  test('honors an explicit reached=true override even when hours alone look insufficient', () => {
    const r = JSON.parse(window.eval('JSON.stringify(buildPartialPlanContract(5, 185, true))'));
    expect(r).toBeNull();
  });
});

describe('test_partial_plan_framing_in_activate_tentative_draft', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a below-target draft routed through activateTentativeDraft/buildPlanningFallback uses the partial-plan contract message', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);

    window.eval(`
      window.__done = false;
      (async function(){
        degreeHoursProfile = { completed_degree_hours: 60 };
        const pool = Object.values(courseMap).filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c)).map(c => c.course_id);
        _aiPickerState = { wanted: [], unwanted: pool, strongUnwanted: pool, shaarRuachAssessmentPref: null, _initialized: true };
        try {
          await requestPlanProposal({ action_type:'full_plan', strongly_avoided_course_ids: pool, unwanted_course_ids: pool }, 'full_plan');
        } catch(e) { window.__err = String(e); }
        window.__done = true;
      })();
    `);
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); if (window.eval('window.__done === true')) break; }

    const r = JSON.parse(window.eval(`(function(){
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const joined = msgs.join('\\n');
      const draftActive = !!(state.proposalDraft && state.proposalDraft.semesters);
      let reached = null;
      try { const dp = computeDegreeProgress({}, state, draftActive?{semesters:state.proposalDraft.semesters}:null); reached = dp.total_after >= dp.required; } catch(e){}
      return JSON.stringify({ joined, reached, draftActive });
    })()`));

    expect(r.draftActive).toBe(true);
    if (r.reached === false) {
      expect(r.joined).toContain('לא הצלחתי להגיע');
      expect(r.joined).toContain('טיוטה חלקית');
      // Missing-hours figure must be present somewhere in the message.
      expect(r.joined).toMatch(/חסרות \d+ ש״ש/);
    } else {
      throw new Error('expected a sub-185 plan for this hard-avoid-all scenario, got reached=' + r.reached);
    }
  });
});

describe('test_partial_plan_apply_label_in_fallback_draft', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('the persistent board-draft-apply banner reads the explicit partial label for a below-target draft', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);

    window.eval(`
      window.__done = false;
      (async function(){
        degreeHoursProfile = { completed_degree_hours: 60 };
        const pool = Object.values(courseMap).filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c)).map(c => c.course_id);
        _aiPickerState = { wanted: [], unwanted: pool, strongUnwanted: pool, shaarRuachAssessmentPref: null, _initialized: true };
        try {
          await requestPlanProposal({ action_type:'full_plan', strongly_avoided_course_ids: pool, unwanted_course_ids: pool }, 'full_plan');
        } catch(e) { window.__err = String(e); }
        window.__done = true;
      })();
    `);
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); if (window.eval('window.__done === true')) break; }

    const r = JSON.parse(window.eval(`(function(){
      const draftActive = !!(state.proposalDraft && state.proposalDraft.semesters);
      let reached = null;
      try { const dp = computeDegreeProgress({}, state, draftActive?{semesters:state.proposalDraft.semesters}:null); reached = dp.total_after >= dp.required; } catch(e){}
      const btn = document.getElementById('board-draft-apply');
      return JSON.stringify({ reached, draftActive, applyBtnText: btn ? btn.textContent : null });
    })()`));

    expect(r.draftActive).toBe(true);
    if (r.reached === false) {
      expect(r.applyBtnText).toBe('החל טיוטה חלקית (לא מלאה)');
    } else {
      throw new Error('expected a sub-185 plan for this hard-avoid-all scenario, got reached=' + r.reached);
    }
  });
});

describe('test_all_below_target_paths_share_partial_contract', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('deterministic replacement rescue path uses the shared contract (direct call)', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 60 };
      const pool = Object.values(courseMap).filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c)).map(c => c.course_id);
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: pool, unwanted_course_ids: pool } });
      const contract = buildPartialPlanContract(plan.totalHours, plan.targetHours, plan.reachedTarget);
      return JSON.stringify({ reachedTarget: plan.reachedTarget, hasContract: !!contract, applyLabel: contract ? contract.applyLabel : null });
    })()`));
    if (!r.reachedTarget) {
      expect(r.hasContract).toBe(true);
      expect(r.applyLabel).toBe('החל טיוטה חלקית (לא מלאה)');
    } else {
      throw new Error('expected the rescue plan to fall short of target for this hard-avoid-all scenario');
    }
  });

  test('activateTentativeDraft path uses the shared contract (already covered above) and the LLM-accepted postPlanChangeSummary path leads with it for a below-target proposal', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      degreeHoursProfile = { completed_degree_hours: 60 };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).toContain('לא הצלחתי להגיע ל-185');
    expect(r.joined).toContain('טיוטה חלקית');
  });

  // Other message-construction paths in this codebase (postStatusMessage callers
  // for "no eligible courses" / "no changes possible") describe a FAILED rebuild
  // with zero new courses, not a below-target DRAFT — there is no partial draft
  // to apply, so the partial-plan contract (which frames an applyable partial
  // draft) does not apply to those branches. They already say "לא הצלחתי
  // להוסיף/לשבץ קורסים חדשים" (covered by FAILURE_NO_ELIGIBLE_COURSES /
  // FAILURE_VALIDATION handling) and were not touched by this fix.
});

describe('regression: complete (>= target) plans keep the normal apply label', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a reached-target draft from activateTentativeDraft keeps "החל טיוטה" (not the partial label)', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 183 };
      const draft = {
        confirmedPlacements: [{ course_id: '0542-4220', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [],
      };
      activateTentativeDraft(draft, { balance: false });
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const joined = msgs.join('\\n');
      const btn = document.getElementById('board-draft-apply');
      return JSON.stringify({ joined, applyBtnText: btn ? btn.textContent : null });
    })()`));
    expect(r.joined).not.toContain('לא הצלחתי להגיע');
    expect(r.joined).not.toContain('טיוטה חלקית');
    expect(r.applyBtnText).toBe('החל טיוטה');
  });

  test('a reached-target deterministic replacement plan keeps the normal success opener and apply label', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      // The contract must honor the plan's OWN reachedTarget flag (which also
      // factors category-requirement satisfaction, not just raw hours) — not
      // re-derive completeness from a plain hours comparison.
      const contract = buildPartialPlanContract(plan.totalHours, plan.targetHours, plan.reachedTarget);
      return JSON.stringify({ reachedTarget: plan.reachedTarget, hasContract: !!contract, totalHours: plan.totalHours, gapReasons: plan.gapReasons });
    })()`));
    if (!r.reachedTarget) {
      throw new Error('expected this unconstrained scenario to reach target; got ' + JSON.stringify(r));
    }
    expect(r.hasContract).toBe(false);
  });
});

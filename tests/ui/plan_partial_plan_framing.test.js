/**
 * plan_partial_plan_framing.test.js
 *
 * A generated plan that cannot reach the 185-hour degree requirement is NOT a
 * successful completed plan and must not be framed as one. Production behavior
 * at 90711e4 led the not-reached message with "הגעתי ל-180/185 ש״ש" plus
 * per-domain ✓ marks, which reads like success. Required (A3): lead with
 * "לא הצלחתי להגיע ל-185 ש״ש תחת האילוצים הנוכחיים. חסרות N ש״ש." and label it
 * an explicit partial draft requiring a user decision; the exact figure is kept
 * only as a parenthetical.
 *
 * This drives the real requestPlanProposal fallback path: the AI endpoint is
 * stubbed to return an empty proposal (forcing the deterministic-replacement
 * rescue), and most of the elective pool is hard-avoided with a low completed
 * baseline so the plan genuinely cannot reach 185.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

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
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ semesters: [], warnings_he: [] }) });
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

describe('partial (<185) plan is framed as incomplete, not success', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a fallback plan that cannot reach 185 says "לא הצלחתי להגיע" and labels a partial draft', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);

    window.eval(`
      window.__done = false;
      (async function(){
        degreeHoursProfile = { completed_degree_hours: 60 };
        // Hard-avoid the whole elective pool so the rescue genuinely falls short of 185.
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
      return JSON.stringify({ joined, reached });
    })()`));

    // Only assert the framing when the plan genuinely did not reach target.
    if (r.reached === false) {
      expect(r.joined).toContain('לא הצלחתי להגיע ל-185');
      expect(r.joined).toContain('טיוטה חלקית');
      // Must NOT use the success opener for an incomplete plan.
      expect(r.joined).not.toContain('בניתי מערכת חלופית מתוך הקורסים שניתן לשבץ בוודאות');
    } else {
      // If the environment happened to reach target, the test scenario didn't
      // exercise the partial path — fail loudly so it's not a silent false-pass.
      throw new Error('expected a sub-185 plan for this hard-avoid-all scenario, got reached=' + r.reached);
    }
  });
});

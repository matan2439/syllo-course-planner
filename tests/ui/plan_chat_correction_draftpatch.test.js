/**
 * plan_chat_correction_draftpatch.test.js
 *
 * Commit C4 — chat-correction DraftPatch that actually mutates the draft.
 *
 * Classification (Part A/B)
 *   K01 "אל תשבץ יישומי אלמנטים סופיים" → hard_exclude_course, courseIds=[0542-4226]
 *   K05 "תוסיף מבוא לאלמנטים סופיים" → must_include_course, courseIds=[0542-4223]
 *   K09 "תעדיף יותר חוזק ותכן" → change_weight with domains
 *   K10 "תוריד עומס מסמסטר ג׳ א׳" → change_workload with semesterId
 *   K12 "למה הכנסת את הקורס הזה?" → explain_course_decision, requiresReplan=false
 *   K17 "בנה לי מערכת מלאה ל-185 ש״ש" → build_full_185, targetHours=185
 *
 * Apply (Part C/D)
 *   K02/03/04 hard_exclude adds to profile, removes from draft, does not reappear after replan
 *   K06/07 must_include adds to profile and places 0542-4223 in the draft
 *   K15 hard-excluded course never selected after a chat correction
 *   K16 must-include placed before generic completion (appears in draft)
 *   K11 a correction changes the draft (board), not only text
 *   K12b explain returns decisionTrace text and does NOT rebuild
 *
 * Panel removal (Part F)
 *   K13 openPlanPreviewModal renders NO detached panel
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

const FEM = '0542-4223';
const FEM_APP = '0542-4226';

describe('C4 — chat correction classification (DraftPatch)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  const classify = (t) => JSON.parse(window.eval(`JSON.stringify(classifyCorrectionIntentLocal(${JSON.stringify(t)}))`));

  test('K01 — "אל תשבץ יישומי אלמנטים סופיים" → hard_exclude_course [0542-4226]', () => {
    const p = classify('אל תשבץ את יישומי אלמנטים סופיים');
    expect(p.type).toBe('hard_exclude_course');
    expect(p.courseIds).toContain(FEM_APP);
    expect(p.requiresReplan).toBe(true);
  });
  test('K05 — "תוסיף מבוא לאלמנטים סופיים" → must_include_course [0542-4223]', () => {
    const p = classify('תוסיף מבוא לאלמנטים סופיים');
    expect(p.type).toBe('must_include_course');
    expect(p.courseIds).toContain(FEM);
    expect(p.requiresReplan).toBe(true);
  });
  test('K09 — "תעדיף יותר חוזק ותכן" → change_weight with domains', () => {
    const p = classify('תעדיף יותר חוזק ותכן');
    expect(p.type).toBe('change_weight');
    expect(p.domains.length).toBeGreaterThan(0);
  });
  test('K10 — "תוריד עומס מסמסטר ג׳ א׳" → change_workload with semesterId', () => {
    const p = classify('תוריד עומס מסמסטר ג׳ א׳');
    expect(p.type).toBe('change_workload');
    expect(p.semesterId).toBe('year_3_semester_a');
  });
  test('K12 — "למה הכנסת את הקורס הזה?" → explain_course_decision, no replan', () => {
    const p = classify('למה הכנסת את הקורס הזה?');
    expect(p.type).toBe('explain_course_decision');
    expect(p.requiresReplan).toBe(false);
  });
  test('K17 — "בנה לי מערכת מלאה ל-185 ש״ש" → build_full_185', () => {
    const p = classify('בנה לי מערכת מלאה ל-185 ש״ש');
    expect(p.type).toBe('build_full_185');
    expect(p.targetHours).toBe(185);
  });
});

describe('C4 — applying a DraftPatch mutates the draft', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  // Build a full-185 draft, then exercise patches against it.
  function buildDraft() {
    window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: '' };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      _aiPlanLastProposal = plan.proposal;
      _aiPlanLastDecisionTrace = plan.decisionTrace;
      _aiPlanLastGapBreakdown = plan.gapBreakdown;
      _aiUserIntentProfile = plan.userIntentProfile;
      activateProposalDraft(plan.proposal);
    })()`);
  }
  const draftIds = () => JSON.parse(window.eval('JSON.stringify(Object.values(state.proposalDraft.semesters).flat())'));

  test('K06/K07/K16 — must_include places 0542-4223 in the draft', () => {
    buildDraft();
    window.eval(`applyDraftPatchLocal(classifyCorrectionIntentLocal('תוסיף מבוא לאלמנטים סופיים'))`);
    const ids = draftIds();
    const must = JSON.parse(window.eval('JSON.stringify(_aiUserIntentProfile.mustIncludeCourseIds)'));
    expect(must).toContain(FEM);
    expect(ids).toContain(FEM);
  });

  test('K02/K03/K04/K15 — hard_exclude removes 0542-4226 and it never reappears', () => {
    buildDraft();
    // First force it in, then exclude it.
    window.eval(`applyDraftPatchLocal(classifyCorrectionIntentLocal('תוסיף יישומי אלמנטים סופיים'))`);
    window.eval(`applyDraftPatchLocal(classifyCorrectionIntentLocal('אל תשבץ את יישומי אלמנטים סופיים'))`);
    const excluded = JSON.parse(window.eval('JSON.stringify(_aiUserIntentProfile.hardExcludeCourseIds)'));
    expect(excluded).toContain(FEM_APP);
    expect(draftIds()).not.toContain(FEM_APP);
    // Rebuild again — still excluded.
    window.eval(`applyDraftPatchLocal({ type:'build_full_185', courseIds:[], domains:[], semesterId:null, reason_he:'', requiresReplan:true })`);
    expect(draftIds()).not.toContain(FEM_APP);
  });

  test('K11 — a correction changes the draft, not only text', () => {
    buildDraft();
    const before = draftIds().slice().sort().join(',');
    window.eval(`applyDraftPatchLocal(classifyCorrectionIntentLocal('תוסיף מבוא לאלמנטים סופיים'))`);
    const after = draftIds().slice().sort().join(',');
    expect(after).not.toBe(before);
  });

  test('K12b — explain_course_decision answers from trace and does NOT rebuild', () => {
    buildDraft();
    const before = draftIds().slice().sort().join(',');
    const placed = draftIds()[0];
    const res = JSON.parse(window.eval(`(function(){
      const msg = explainCourseDecisionLocal('${'' }' || null);
      return JSON.stringify({ msg: explainCourseDecisionLocal(${JSON.stringify(placed)}) });
    })()`));
    expect(typeof res.msg).toBe('string');
    expect(res.msg.length).toBeGreaterThan(0);
    // applying the explain patch must not change the draft
    window.eval(`applyDraftPatchLocal({ type:'explain_course_decision', courseIds:[${JSON.stringify(placed)}], domains:[], semesterId:null, reason_he:'', requiresReplan:false })`);
    expect(draftIds().slice().sort().join(',')).toBe(before);
  });

  test('K13 — openPlanPreviewModal renders NO detached panel', () => {
    buildDraft();
    window.eval(`(function(){
      try { openPlanPreviewModal({ semesters: [] }, ['x'], [], false, { incomplete: true, reasons: ['y'] }, [], []); } catch(_) {}
    })()`);
    // The legacy detached blocked panel must not exist anywhere in the document.
    expect(window.document.querySelector('[data-testid="blocked-compact-panel"]')).toBeFalsy();
    expect(window.document.querySelector('.ai-plan-quality')).toBeFalsy();
  });
});

/**
 * plan_trace_debug_panel.test.js
 *
 * Step 9 — read-only, debug-flag-gated planner trace panel fed by the
 * /api/ai/generate-plan `trace` field (no planner-run streaming). Verifies the
 * capture + gating + render + JSON download helpers, and that the panel is
 * injected into the AI tab only when the debug flag is on — without touching the
 * apply/reject draft flow (state.proposalDraft must be unaffected).
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

const SAMPLE_TRACE = [
  { step: 1, action: 'ADD_COURSE', courseId: '0542-4120', courseName: 'זורמים', semester: 'year_4_semester_a', reason: 'השלמת דרישת קטגוריה', beforeTotal: 100, afterTotal: 104, constraintsChecked: ['category'], validationAfterAction: 'pass', phase: 'CONSTRUCT_PLAN', by: 'greedy' },
  { step: 2, action: 'REJECT_COURSE', courseId: '0542-9999', reason: 'הקורס סומן כלא-זמין', beforeTotal: 104, afterTotal: 104, constraintsChecked: ['disallowed'], validationAfterAction: 'fail', phase: 'CONSTRUCT_PLAN', by: 'greedy' },
  { step: 3, action: 'STOP', reason: 'המטרה הושגה', beforeTotal: 104, afterTotal: 104, constraintsChecked: [], validationAfterAction: 'pass', phase: 'DONE', by: 'worker' },
];

describe('Step 9 — planner trace debug panel (read-only, debug-gated)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  beforeEach(() => {
    window.localStorage.removeItem('tau_planner_debug');
    window.eval('setPlannerTrace([])');
  });

  test('1 — setPlannerTrace stores the trace; non-array becomes []', () => {
    const r = JSON.parse(window.eval(`(function(){
      setPlannerTrace(${JSON.stringify(SAMPLE_TRACE)});
      const a = _aiPlanLastTrace.length;
      setPlannerTrace(null);
      const b = _aiPlanLastTrace.length;
      return JSON.stringify({ a, b });
    })()`));
    expect(r.a).toBe(3);
    expect(r.b).toBe(0);
  });

  test('2 — isPlannerDebugEnabled is false by default, true with the flag', () => {
    const off = window.eval('isPlannerDebugEnabled()');
    window.localStorage.setItem('tau_planner_debug', '1');
    const on = window.eval('isPlannerDebugEnabled()');
    expect(off).toBe(false);
    expect(on).toBe(true);
  });

  test('3 — renderPlannerTracePanel returns "" when debug off, markup when on + trace', () => {
    const r = JSON.parse(window.eval(`(function(){
      setPlannerTrace(${JSON.stringify(SAMPLE_TRACE)});
      const offHtml = renderPlannerTracePanel();
      localStorage.setItem('tau_planner_debug','1');
      const onHtml = renderPlannerTracePanel();
      return JSON.stringify({
        off: offHtml,
        onHasPanel: onHtml.indexOf('data-planner-trace') !== -1,
        onHasAdd: onHtml.indexOf('ADD_COURSE') !== -1,
        onHasReject: onHtml.indexOf('REJECT_COURSE') !== -1,
        onHasDownload: onHtml.indexOf('downloadPlannerTrace') !== -1,
      });
    })()`));
    expect(r.off).toBe('');
    expect(r.onHasPanel).toBe(true);
    expect(r.onHasAdd).toBe(true);
    expect(r.onHasReject).toBe(true);
    expect(r.onHasDownload).toBe(true);
  });

  test('4 — renderPlannerTracePanel returns "" when debug on but no trace', () => {
    const html = window.eval(`(function(){ localStorage.setItem('tau_planner_debug','1'); setPlannerTrace([]); return renderPlannerTracePanel(); })()`);
    expect(html).toBe('');
  });

  test('5 — buildPlannerTraceJson round-trips the trace as valid JSON', () => {
    const json = window.eval(`(function(){ setPlannerTrace(${JSON.stringify(SAMPLE_TRACE)}); return buildPlannerTraceJson(); })()`);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.actions)).toBe(true);
    expect(parsed.actions).toHaveLength(3);
    expect(parsed.actions[0].action).toBe('ADD_COURSE');
  });

  test('6 — renderAiTab injects the panel only when debug on, and never mutates the draft', () => {
    const r = JSON.parse(window.eval(`(function(){
      state.proposalDraft = null;
      setPlannerTrace(${JSON.stringify(SAMPLE_TRACE)});

      localStorage.removeItem('tau_planner_debug');
      renderAiTab();
      const offHas = document.getElementById('sb-panel-ai').innerHTML.indexOf('data-planner-trace') !== -1;
      const draftAfterOff = state.proposalDraft;

      localStorage.setItem('tau_planner_debug','1');
      renderAiTab();
      const onHas = document.getElementById('sb-panel-ai').innerHTML.indexOf('data-planner-trace') !== -1;
      const draftAfterOn = state.proposalDraft;

      return JSON.stringify({ offHas, onHas, draftUnchanged: draftAfterOff === null && draftAfterOn === null });
    })()`));
    expect(r.offHas).toBe(false);
    expect(r.onHas).toBe(true);
    expect(r.draftUnchanged).toBe(true);
  });
});

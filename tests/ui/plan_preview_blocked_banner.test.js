/**
 * Issue 3 — a proposal blocked by overload must NOT be presented as a valid
 * plan. openPlanPreviewModal must render the data-testid="overload-blocked-banner"
 * element with the Hebrew blocking text, and the Apply button must be disabled.
 *
 * Uses the same jsdom harness as semester_board_ai_chat.test.js.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

function loadPage() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const scriptSrc = scriptMatch[1];
  html = html.replace(scriptMatch[0], '');

  const dom = new JSDOM(html, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    if (u.includes('/api/')) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  };
  window.confirm = () => { throw new Error('confirm should not be called'); };
  window.alert = () => { throw new Error('alert should not be called'); };

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = scriptSrc;
  window.document.body.appendChild(scriptEl);
  return dom;
}

function waitForInit(window) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const ready = window.eval('typeof state !== "undefined" && !!state && !!state.semesters');
      if (ready) return resolve();
      if (Date.now() - start > 20000) return reject(new Error('init() did not complete in time'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('Issue 3 — overload-blocked plan preview', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  test('blocked validation renders the overload-blocked banner and disables Apply', () => {
    const overloadErr = 'חריגה בעומס: סמסטר אחד מגיע ל-27 ש"ש (מעל המגבלה).';
    window.eval(`_aiPlanLastValidation = { errors: ${JSON.stringify([overloadErr])}, warnings: [], blocked: true, overloadBlocked: true, completeness: { incomplete: true, reasons: ['עומס חורג'] } };`);

    // A minimal proposal — the exact contents don't matter for the banner/apply gate.
    window.eval(`
      const proposal = { semesters: (SEMESTERS || []).slice(0, 2).map(s => ({ semester_id: s.id, course_ids: [] })), warnings_he: [] };
      openPlanPreviewModal(proposal, ${JSON.stringify([overloadErr])}, [], false, { incomplete: true, reasons: ['עומס חורג'] }, [], []);
    `);

    const banner = document.querySelector('[data-testid="overload-blocked-banner"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('המערכת שנוצרה לא תקינה');
    expect(banner.textContent).toContain('חורג ממגבלת העומס');

    const applyBtn = document.getElementById('ai-plan-apply');
    expect(applyBtn).toBeTruthy();
    expect(applyBtn.hasAttribute('disabled')).toBe(true);
  });

  test('a clean (non-blocked) plan shows no blocked banner and Apply is enabled', () => {
    window.eval(`_aiPlanLastValidation = { errors: [], warnings: [], blocked: false, overloadBlocked: false, completeness: { incomplete: false, reasons: [] } };`);
    window.eval(`
      const proposal = { semesters: (SEMESTERS || []).slice(0, 2).map(s => ({ semester_id: s.id, course_ids: [] })), warnings_he: [] };
      openPlanPreviewModal(proposal, [], [], false, { incomplete: false, reasons: [] }, [], []);
    `);
    const banner = document.querySelector('[data-testid="overload-blocked-banner"]');
    expect(banner).toBeFalsy();
    const applyBtn = document.getElementById('ai-plan-apply');
    expect(applyBtn.hasAttribute('disabled')).toBe(false);
  });
});

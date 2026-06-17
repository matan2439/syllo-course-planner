/**
 * ITEM 1 — when a proposal is BLOCKED/incomplete, openPlanPreviewModal renders a
 * CLEAN COMPACT panel (title 'לא ניתן להציע מערכת חוקית', up to 3 short reasons,
 * a single main 'בנה מערכת מחדש' action + optional 'בקש שינויים') INSTEAD of the
 * verbose planQuality 'מדוע זו התוכנית שנבחרה?' / requirements / metrics dumps.
 *
 * ITEM 3 — board semester load bar denominator uses the user-defined preferred
 * max (getEffectiveMaxHoursPreferenceLocal), falling back to 20 with no pref.
 *
 * Uses the same jsdom harness as plan_preview_blocked_banner.test.js.
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

describe('ITEM 1 — compact blocked preview panel', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  test('blocked plan renders compact panel (title + short reasons + rebuild) and NO quality metrics', () => {
    const overloadErr = 'חריגה בעומס: סמסטר אחד מגיע ל-27 ש"ש (מעל המגבלה).';
    window.eval(`_aiPlanLastValidation = { errors: ${JSON.stringify([overloadErr])}, warnings: [], blocked: true, overloadBlocked: true, completeness: { incomplete: true, reasons: ['עומס חורג', 'חסר קורס חובה', 'קטגוריה לא הושלמה', 'reason4'] } };`);
    window.eval(`
      const proposal = { semesters: (SEMESTERS || []).slice(0, 2).map(s => ({ semester_id: s.id, course_ids: [] })), warnings_he: [] };
      openPlanPreviewModal(proposal, ${JSON.stringify([overloadErr])}, [], false, { incomplete: true, reasons: ['עומס חורג', 'חסר קורס חובה', 'קטגוריה לא הושלמה', 'reason4'] }, [], []);
    `);

    const panel = document.querySelector('[data-testid="blocked-compact-panel"]');
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.ai-plan-blocked-title').textContent).toContain('לא ניתן להציע מערכת חוקית');

    // up to 3 concise reasons
    const reasons = panel.querySelectorAll('.ai-plan-blocked-reasons li');
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(reasons.length).toBeGreaterThan(0);

    // single main rebuild action + optional ask-changes
    expect(document.getElementById('ai-plan-blocked-rebuild')).toBeTruthy();
    expect(document.getElementById('ai-plan-blocked-rebuild').textContent).toContain('בנה מערכת מחדש');
    expect(document.getElementById('ai-plan-blocked-ask-changes')).toBeTruthy();

    // verbose metrics block must NOT render when blocked
    const panelEl = document.getElementById('ai-plan-panel');
    expect(panelEl.innerHTML).not.toContain('מדוע זו התוכנית שנבחרה?');
    expect(panelEl.querySelector('.ai-plan-quality')).toBeFalsy();

    // Apply stays disabled (and hidden) when blocked
    const applyBtn = document.getElementById('ai-plan-apply');
    expect(applyBtn).toBeTruthy();
    expect(applyBtn.hasAttribute('disabled')).toBe(true);
  });

  test('non-blocked plan still shows full details + enabled Apply and no compact panel', () => {
    window.eval(`_aiPlanLastValidation = { errors: [], warnings: [], blocked: false, overloadBlocked: false, completeness: { incomplete: false, reasons: [] } };`);
    window.eval(`
      const proposal = { semesters: (SEMESTERS || []).slice(0, 2).map(s => ({ semester_id: s.id, course_ids: [] })), warnings_he: [] };
      openPlanPreviewModal(proposal, [], [], false, { incomplete: false, reasons: [] }, [], []);
    `);
    expect(document.querySelector('[data-testid="blocked-compact-panel"]')).toBeFalsy();
    const applyBtn = document.getElementById('ai-plan-apply');
    expect(applyBtn.hasAttribute('disabled')).toBe(false);
    // full preview still has the toggle-all-courses control
    expect(document.getElementById('ai-plan-toggle-all-courses')).toBeTruthy();
  });
});

describe('ITEM 3 — board semester load bar denominator = preferred max', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  function renderFirstSemBar() {
    // Render the board and return the first semester's load-bar row text + fill class.
    // Note: .semester-col no longer exists; headers are now direct children of .year-sems-headers.
    return window.eval(`
      (function(){
        renderBoard();
        const row = document.querySelector('.sem-hdr .wl-row');
        const fill = document.querySelector('.sem-hdr .wl-fill');
        return { rowText: row ? row.textContent : '', fillClass: fill ? fill.className : '' };
      })();
    `);
  }

  test('max_weekly_hours=24 renders /24 denominator', () => {
    window.eval(`_aiPlanLastPreferences = { max_weekly_hours: 24 };`);
    const out = renderFirstSemBar();
    expect(out.rowText).toContain('/24');
  });

  test('no preference falls back to /20', () => {
    window.eval(`_aiPlanLastPreferences = null;`);
    const out = renderFirstSemBar();
    expect(out.rowText).toContain('/20');
  });

  test('changing the preference updates the rendered bar', () => {
    window.eval(`_aiPlanLastPreferences = { max_weekly_hours: 24 };`);
    expect(renderFirstSemBar().rowText).toContain('/24');
    window.eval(`_aiPlanLastPreferences = { max_weekly_hours: 28 };`);
    expect(renderFirstSemBar().rowText).toContain('/28');
  });

  test('threshold classes: <=preferred normal/med, >preferred && <=26 over (warning), >26 blocked', () => {
    const out = window.eval(`
      (function(){
        const wlClsFor = (knownHrs, preferredMax) => (
          knownHrs > HARD_LOAD_CAP ? 'blocked'
          : knownHrs > preferredMax ? 'over'
          : knownHrs >= preferredMax * 0.5 ? 'med' : ''
        );
        return {
          underPref: wlClsFor(20, 24),     // <= preferred -> med/normal, not over
          overPref: wlClsFor(25, 24),      // > preferred, <= 26 -> over (warning)
          overHard: wlClsFor(27, 24),      // > 26 -> blocked
          low: wlClsFor(5, 24),            // small -> normal ''
          hardCap: HARD_LOAD_CAP,
        };
      })();
    `);
    expect(out.hardCap).toBe(26);
    expect(out.underPref).not.toBe('over');
    expect(out.underPref).not.toBe('blocked');
    expect(out.overPref).toBe('over');
    expect(out.overHard).toBe('blocked');
    expect(out.low).toBe('');
  });
});

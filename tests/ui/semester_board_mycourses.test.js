/**
 * jsdom harness for app/web/semester_board_viewer.html.
 *
 * Loads the real HTML (including its single inline <script>) into a jsdom
 * document, stubs fetch to serve the real board JSON fixture, runs main(),
 * and then drives the actual DOM (My Courses modal + AI panel) to prove:
 *  - the semester bulk-status popover menu items actually change statuses
 *    and persist to localStorage,
 *  - the "בנה מערכת" button actually triggers a build request.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

function loadPage({ fetchImpl } = {}) {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');

  // Extract the single inline <script> so we can run it AFTER seeding
  // localStorage/fetch — main() runs synchronously to its first await as
  // soon as the script executes, so it must see localStorage already set.
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

  // Pre-select the 2027 program so main() goes straight to loadProgram()
  // instead of opening the program-picker modal.
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');

  window.fetch = fetchImpl || ((url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    // audit_json / program_json / api/board — not available in this harness.
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  });

  // The app no longer relies on window.confirm()/confirm() for any critical
  // flow — it uses in-app confirmation cards (requestUserConfirmation).
  // Throw if confirm() is ever called, to prove these flows don't depend on it.
  window.confirm = () => { throw new Error('confirm should not be called'); };
  window.alert = () => {};

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = scriptSrc;
  window.document.body.appendChild(scriptEl);

  return dom;
}

/** YEAR_1_2_MANDATORY_COURSES is a top-level `const` (not on window). */
function getMandatoryCourses(window) {
  return window.eval('YEAR_1_2_MANDATORY_COURSES');
}

/** Wait until courseMap/state (top-level `let`, not on window) are populated
 * by main()/init(). Use window.eval to read script-scope bindings. */
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

describe('My Courses semester bulk-status menu', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => {
    dom.window.close();
  });

  test('opens My Courses, opens semester bulk menu, marks all Year 1 Sem A courses completed', () => {
    // Open the My Courses modal.
    window.openMyCoursesModal();

    const gridEl = document.getElementById('my-courses-grid');
    expect(gridEl).toBeTruthy();

    const hdr = gridEl.querySelector('[data-mc-sem-menu="year_1_semester_a"]');
    expect(hdr).toBeTruthy();

    // Click the semester header — should open the bulk-action popover.
    hdr.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const popover = gridEl.querySelector('.mc-sem-menu-popover');
    expect(popover).toBeTruthy();

    const completeBtn = [...popover.querySelectorAll('button')]
      .find(b => b.dataset.mcSemAction === 'completed');
    expect(completeBtn).toBeTruthy();

    // Click "סמן את כל הסמסטר כהושלם" — should render an in-app confirmation,
    // NOT call window.confirm.
    completeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const confirmCard = hdr.querySelector('.uc-confirm-card') || gridEl.querySelector('.uc-confirm-card');
    expect(confirmCard).toBeTruthy();
    expect(confirmCard.textContent).toContain('להחיל');

    const confirmBtn = confirmCard.querySelector('[data-uc-confirm]');
    expect(confirmBtn).toBeTruthy();
    confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const courses = getMandatoryCourses(window).filter(c => c.semester === 'year_1_semester_a');
    expect(courses.length).toBeGreaterThan(0);

    // 1. In-memory status store updated for every course in the semester.
    for (const c of courses) {
      expect(window.getUserStatus(c.course_id).status).toBe('completed');
    }

    // 2. Persisted to localStorage under the same key setUserStatus uses.
    const persisted = JSON.parse(window.localStorage.getItem('tau_user_course_statuses_v1'));
    for (const c of courses) {
      expect(persisted[c.course_id].status).toBe('completed');
    }

    // 3. Re-render reflects the new statuses on the chips.
    const refreshedGrid = document.getElementById('my-courses-grid');
    for (const c of courses) {
      const chip = refreshedGrid.querySelector(`[data-mc-grid-toggle="${c.course_id}"]`);
      expect(chip).toBeTruthy();
      expect(chip.className).toContain('mc-grid-status-done');
      expect(chip.querySelector('.mc-grid-chip-status').textContent).toBe('הושלם');
    }

    // Popover closed after the action.
    expect(document.querySelector('.mc-sem-menu-popover')).toBeFalsy();
  });

  test('clear-marks resets every course in the semester to not_taken', () => {
    window.openMyCoursesModal();
    const gridEl = document.getElementById('my-courses-grid');
    const courses = getMandatoryCourses(window).filter(c => c.semester === 'year_1_semester_b');

    // Pre-set everything to currently_taking.
    for (const c of courses) window.setUserStatus(c.course_id, 'currently_taking', null);

    const hdr = gridEl.querySelector('[data-mc-sem-menu="year_1_semester_b"]');
    hdr.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const popover = gridEl.querySelector('.mc-sem-menu-popover');
    const clearBtn = [...popover.querySelectorAll('button')].find(b => b.dataset.mcSemAction === '__clear__');
    clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const confirmCard = hdr.querySelector('.uc-confirm-card');
    confirmCard.querySelector('[data-uc-confirm]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    for (const c of courses) {
      expect(window.getUserStatus(c.course_id).status).toBe('not_taken');
    }
  });

  test('clicking "בטל" on the in-app confirmation does not change any status', () => {
    window.openMyCoursesModal();
    const gridEl = document.getElementById('my-courses-grid');
    const courses = getMandatoryCourses(window).filter(c => c.semester === 'year_1_semester_a');

    // Ensure a known starting status.
    for (const c of courses) window.setUserStatus(c.course_id, 'not_taken', null);

    const hdr = gridEl.querySelector('[data-mc-sem-menu="year_1_semester_a"]');
    hdr.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const popover = gridEl.querySelector('.mc-sem-menu-popover');
    const completeBtn = [...popover.querySelectorAll('button')].find(b => b.dataset.mcSemAction === 'completed');
    completeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const confirmCard = hdr.querySelector('.uc-confirm-card');
    expect(confirmCard).toBeTruthy();
    confirmCard.querySelector('[data-uc-cancel]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(hdr.querySelector('.uc-confirm-card')).toBeFalsy();
    for (const c of courses) {
      expect(window.getUserStatus(c.course_id).status).toBe('not_taken');
    }
  });

  test('not_taken and currently_taking bulk actions also apply to all courses', () => {
    window.openMyCoursesModal();
    const gridEl = document.getElementById('my-courses-grid');

    for (const [semId, action, expected] of [
      ['year_2_semester_a', 'not_taken', 'not_taken'],
      ['year_2_semester_b', 'currently_taking', 'currently_taking'],
    ]) {
      const hdr = gridEl.querySelector(`[data-mc-sem-menu="${semId}"]`);
      hdr.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const popover = gridEl.querySelector('.mc-sem-menu-popover');
      const btn = [...popover.querySelectorAll('button')].find(b => b.dataset.mcSemAction === action);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      const confirmCard = hdr.querySelector('.uc-confirm-card');
      confirmCard.querySelector('[data-uc-confirm]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      const courses = getMandatoryCourses(window).filter(c => c.semester === semId);
      for (const c of courses) {
        expect(window.getUserStatus(c.course_id).status).toBe(expected);
      }
    }
  });
});

describe('"בנה מערכת" build button', () => {
  let dom, window, document, fetchCalls;

  beforeEach(async () => {
    fetchCalls = [];
    dom = loadPage({
      fetchImpl: (url, opts) => {
        const u = String(url);
        fetchCalls.push({ url: u, opts });
        if (u.includes('mechanical_semester_board_2027.json')) {
          const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');
          return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
        }
        if (u.includes('/api/ai/generate-plan')) {
          // Simulate a network failure on the build endpoint.
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
      },
    });
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => {
    dom.window.close();
  });

  test('clicking the build button with an existing board renders an in-app confirmation card', () => {
    window.setSidebarTab('ai');
    const btn = document.getElementById('sidebar-build-from-scratch');
    expect(btn).toBeTruthy();

    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const confirmCard = document.getElementById('ai-build-confirm')?.querySelector('.uc-confirm-card');
    expect(confirmCard).toBeTruthy();
    expect(confirmCard.textContent).toContain('להמשיך');

    // No fetch to generate-plan yet — only after confirming.
    expect(fetchCalls.find(c => c.url.includes('/api/ai/generate-plan'))).toBeFalsy();
  });

  test('confirming the build confirmation card starts loading and calls the AI endpoint with action_type=full_plan', async () => {
    window.setSidebarTab('ai');
    const btn = document.getElementById('sidebar-build-from-scratch');
    expect(btn).toBeTruthy();

    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const confirmCard = document.getElementById('ai-build-confirm').querySelector('.uc-confirm-card');
    confirmCard.querySelector('[data-uc-confirm]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // Confirmation card removed.
    expect(document.getElementById('ai-build-confirm')).toBeFalsy();

    // Loading indicator shown synchronously (before the await resolves).
    const statusEl = document.getElementById('ai-build-status');
    expect(statusEl.hidden).toBe(false);
    expect(statusEl.textContent).toContain('בונה מערכת');
    expect(btn.disabled).toBe(true);

    // Let the (rejected) fetch settle.
    await new Promise(r => setTimeout(r, 50));

    const aiCall = fetchCalls.find(c => c.url.includes('/api/ai/generate-plan'));
    expect(aiCall).toBeTruthy();
    const body = JSON.parse(aiCall.opts.body);
    expect(body.preferences.action_type).toBe('full_plan');

    // Button re-enabled and loading indicator hidden after failure.
    expect(document.getElementById('sidebar-build-from-scratch').disabled).toBe(false);
    expect(document.getElementById('ai-build-status').hidden).toBe(true);
  });
});

/**
 * Tests for buildPlanningFallback — the conversational planning fallback
 * that fires when strict validation (gateProposalActivation) rejects a proposal.
 *
 * Requirements verified:
 *  1. Missing semester-offering data should not always produce NO_PLAN_POSSIBLE
 *  2. If some courses are safe, strict failure → PARTIAL_PLAN_NEEDS_CONFIRMATION
 *  3. Missing prerequisites → NEED_USER_INPUT with a targeted question
 *  4. Fallback response includes next-action chips, not only a failure message
 *  5. Tentative courses are NOT committed to the real board automatically
 *  6. No raw semester IDs appear in the fallback message
 *  7. Existing mandatory courses are NOT reported as newly added
 *  8. Only structural blockers (degree_completion, category) → returns null
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
  window.confirm = () => false;
  window.alert  = () => {};

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

// Call buildPlanningFallback via window.eval and return the result.
function callFallback(window, eligibleProposal, gateResult, ctxCourses) {
  window.__fp_proposal  = eligibleProposal;
  window.__fp_gate      = gateResult;
  window.__fp_ctx       = { courses: ctxCourses };
  return window.eval('buildPlanningFallback(window.__fp_proposal, window.__fp_gate, window.__fp_ctx)');
}

// Minimal gateResult shape for a blocked proposal
function blockedGate(blockers) {
  return { applicable: false, blockers, warnings: [], summary: 'blocked' };
}

describe('buildPlanningFallback — conversational fallback', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
    // Clear the committed board so tests start with a clean slate.
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = [];');
  });

  afterEach(() => { dom.window.close(); });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  test('missing offering data on NEW course → PARTIAL_PLAN_NEEDS_CONFIRMATION, not NO_PLAN_POSSIBLE', () => {
    const courses = { 'C1': { name_he: 'מכניקה מתקדמת', hours: 3 } };
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['C1'] }] };
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע סמסטר ודאיים למכניקה מתקדמת',
      course_ids: ['C1'],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    expect(result.outcome).toBe('PARTIAL_PLAN_NEEDS_CONFIRMATION');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  test('only structural blockers (degree_completion) → returns null, lets diagnoseBuildBlock handle', () => {
    const courses = { 'C1': { name_he: 'חשבון אינפינ׳', hours: 4 } };
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['C1'] }] };
    const gate = blockedGate([{
      cause: 'degree_completion',
      message_he: 'חסרות 10 ש״ש להשלמת התואר',
      course_ids: [],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).toBeNull();
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  test('prerequisite-blocked new course → NEED_USER_INPUT with named prereq', () => {
    const courses = {
      'C2': { name_he: 'רובוטיקה', hours: 3 },
      'P1': { name_he: 'מבוא לבקרה', hours: 3 },
    };
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['C2'] }] };
    const gate = blockedGate([{
      cause: 'prerequisite',
      message_he: 'לרובוטיקה חסרות דרישות קדם: מבוא לבקרה',
      course_ids: ['C2', 'P1'],
      detail: { unsatisfied: ['P1'] },
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    expect(result.outcome).toBe('NEED_USER_INPUT');
    expect(result.messageHe).toContain('רובוטיקה');
    expect(result.messageHe).toContain('מבוא לבקרה');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  test('fallback result includes next-action chips (not just a failure message)', () => {
    const courses = { 'C1': { name_he: 'דינמיקה', hours: 3 } };
    const proposal = { semesters: [{ semester_id: 'year_3_semester_b', course_ids: ['C1'] }] };
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע ל דינמיקה',
      course_ids: ['C1'],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    expect(Array.isArray(result.chips)).toBe(true);
    expect(result.chips.length).toBeGreaterThan(0);
    expect(result.chips.every(c => typeof c.label === 'string' && typeof c.action === 'string')).toBe(true);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  test('tentative courses are NOT committed to the real board after fallback', () => {
    const courses = { 'C1': { name_he: 'בקרה', hours: 3 } };
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['C1'] }] };
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע לבקרה',
      course_ids: ['C1'],
    }]);

    // Ensure proposalDraft is null before (simulating post-gate state)
    window.eval('state.proposalDraft = null;');
    callFallback(window, proposal, gate, courses);

    // Board must not contain C1
    const boardHasC1 = window.eval(
      'Object.values(state.semesters).flat().includes("C1")'
    );
    expect(boardHasC1).toBe(false);

    // proposalDraft must still be null — not auto-committed
    const draftIsNull = window.eval('state.proposalDraft === null');
    expect(draftIsNull).toBe(true);
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  test('no raw semester IDs (year_X_semester_Y or suffixed) appear in fallback message', () => {
    const courses = {
      'C1': { name_he: 'חוזק חומרים', hours: 3 },
      'C2': { name_he: 'זרימה', hours: 3 },
    };
    const proposal = { semesters: [
      { semester_id: 'year_3_semester_a',  course_ids: ['C1'] },
      { semester_id: 'year_3_semester_b2', course_ids: ['C2'] }, // accidental suffix
    ]};
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע',
      course_ids: ['C2'],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    // Must not contain raw IDs like year_3_semester_a or year_3_semester_b2
    expect(result.messageHe).not.toMatch(/year_\d+_semester_[ab]\d*/);
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  test('existing mandatory courses on board are NOT reported as newly added', () => {
    const courses = {
      'M1': { name_he: 'פיסיקה 1', hours: 4 },
      'C1': { name_he: 'חדשון', hours: 3 },
    };
    // M1 is already committed to the board
    window.eval('state.semesters["year_2_semester_a"] = ["M1"];');

    const proposal = { semesters: [
      { semester_id: 'year_2_semester_a', course_ids: ['M1'] }, // already on board
      { semester_id: 'year_3_semester_a', course_ids: ['C1'] }, // new
    ]};
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע לחדשון',
      course_ids: ['C1'],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    // M1 is already on the board — must NOT appear in confirmedPlacements
    expect(result.confirmedPlacements || []).not.toContain('M1');
    // M1 must not be in tentativeNew either
    expect(result.tentativePlacements || []).not.toContain('M1');
    // C1 is the only new course (and it's tentative due to missing offering)
    expect(result.tentativePlacements || []).toContain('C1');
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────
  test('mixed: confirmed new + missing-offering tentative → PARTIAL_PLAN with both sections', () => {
    const courses = {
      'SAFE': { name_he: 'קורס בטוח', hours: 3 },
      'TENT': { name_he: 'קורס לא ודאי', hours: 3 },
    };
    const proposal = { semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['SAFE', 'TENT'] },
    ]};
    // Only TENT has a missing_offering_data blocker; SAFE has none
    const gate = blockedGate([{
      cause: 'missing_offering_data',
      message_he: 'אין נתוני היצע לקורס לא ודאי',
      course_ids: ['TENT'],
    }]);

    const result = callFallback(window, proposal, gate, courses);
    expect(result).not.toBeNull();
    expect(result.outcome).toBe('PARTIAL_PLAN_NEEDS_CONFIRMATION');
    expect(result.confirmedPlacements).toContain('SAFE');
    expect(result.tentativePlacements).toContain('TENT');
    // Message should mention both sections
    expect(result.messageHe).toContain('שיבוץ בטוח');
    expect(result.messageHe).toContain('קורסים שדורשים אישור');
  });
});

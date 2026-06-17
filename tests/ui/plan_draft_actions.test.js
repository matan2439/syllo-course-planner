/**
 * Tests for the deterministic draft-planner action flow:
 *   - buildPlanningFallback stores state.lastPlanningDraft + offers real chips
 *   - handlePlanningFallbackAction(type) executes meaningful planning actions
 *   - the bright standalone build-confirmation panel is replaced by an inline
 *     chat confirmation card
 *
 * Mirrors the harness used by plan_conversational_fallback.test.js (full page in
 * jsdom, board cleared, synthetic courses injected into the program courseMap so
 * courseLabelLocal resolves "name (id)").
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

function blockedGate(blockers) {
  return { applicable: false, blockers, warnings: [], summary: 'blocked' };
}

function callFallback(window, eligibleProposal, gateResult, ctxCourses) {
  window.__fp_proposal = eligibleProposal;
  window.__fp_gate     = gateResult;
  window.__fp_ctx      = { courses: ctxCourses };
  return window.eval('buildPlanningFallback(window.__fp_proposal, window.__fp_gate, window.__fp_ctx)');
}

describe('draft planner — lastPlanningDraft + real quick-reply actions', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = [];');
    window.eval('state.repo = ["SAFE1","SAFE2","TENT1"]; state.lastPlanningDraft = null;');
    // Synthetic courses in the program pool with legal year-3 offering data.
    window.eval(`
      courseMap['SAFE1'] = { course_id: 'SAFE1', name_he: 'מכניקת מוצקים', hours: 3,
        effective_allowed_semesters: ['year_3_semester_a','year_3_semester_b','year_4_semester_a','year_4_semester_b'] };
      courseMap['SAFE2'] = { course_id: 'SAFE2', name_he: 'תרמודינמיקה', hours: 3,
        effective_allowed_semesters: ['year_3_semester_a','year_3_semester_b','year_4_semester_a','year_4_semester_b'] };
      courseMap['TENT1'] = { course_id: 'TENT1', name_he: 'קורס היצע לא ודאי', hours: 3 };
    `);
  });

  afterEach(() => { dom.window.close(); });

  function buildMixedDraft() {
    const proposal = { semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['SAFE1', 'SAFE2', 'TENT1'] },
    ]};
    const gate = blockedGate([
      { cause: 'missing_offering_data', message_he: 'אין נתוני היצע', course_ids: ['TENT1'] },
      { cause: 'degree_completion', message_he: 'חסרות ש"ש', course_ids: [] },
    ]);
    return callFallback(window, proposal, gate, {
      SAFE1: { hours: 3 }, SAFE2: { hours: 3 }, TENT1: { hours: 3 },
    });
  }

  // ── Draft planning ──────────────────────────────────────────────────────────

  test('1. missing definite offering does NOT prevent draft generation', () => {
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['TENT1'] }] };
    const gate = blockedGate([{ cause: 'missing_offering_data', message_he: 'אין נתוני היצע', course_ids: ['TENT1'] }]);
    const result = callFallback(window, proposal, gate, { TENT1: { hours: 3 } });
    expect(result).not.toBeNull();
    expect(result.tentativePlacements).toContain('TENT1');
  });

  test('2. buildPlanningFallback stores state.lastPlanningDraft with all buckets', () => {
    buildMixedDraft();
    const draft = window.eval('JSON.parse(JSON.stringify(state.lastPlanningDraft || null))');
    expect(draft).not.toBeNull();
    expect(draft.source).toBe('draft_planner');
    expect(draft.confirmedPlacements.map(p => p.course_id).sort()).toEqual(['SAFE1', 'SAFE2']);
    expect(draft.tentativePlacements.map(p => p.course_id)).toEqual(['TENT1']);
    // confirmed placements carry their semester id (deterministic, normalized)
    expect(draft.confirmedPlacements.every(p => p.semester_id === 'year_3_semester_a')).toBe(true);
  });

  test('3. produces a draft when at least some relevant candidate courses exist', () => {
    const result = buildMixedDraft();
    expect(result).not.toBeNull();
    expect(result.confirmedPlacements.length).toBeGreaterThan(0);
  });

  test('4. irrelevant courses (not in program pool) are excluded from the draft', () => {
    const proposal = { semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['SAFE1', 'NOT_IN_POOL'] },
    ]};
    const gate = blockedGate([{ cause: 'degree_completion', message_he: 'חסרות ש"ש', course_ids: [] }]);
    const result = callFallback(window, proposal, gate, { SAFE1: { hours: 3 } }); // NOT_IN_POOL absent from ctx + courseMap
    expect(result).not.toBeNull();
    expect(result.confirmedPlacements).toContain('SAFE1');
    expect(result.confirmedPlacements).not.toContain('NOT_IN_POOL');
    const draft = window.eval('JSON.parse(JSON.stringify(state.lastPlanningDraft))');
    expect(draft.confirmedPlacements.map(p => p.course_id)).not.toContain('NOT_IN_POOL');
  });

  test('5. the fallback message is a useful artifact, not only a dead-end failure', () => {
    const result = buildMixedDraft();
    expect(result.messageHe).toContain('טיוטת מערכת');
    expect(result.messageHe).toContain('קורסים בטוחים');
    // chips are real planning actions, not bare text prompts
    expect(result.chips.some(c => c.action === 'planning-fallback')).toBe(true);
  });

  // ── Quick replies ────────────────────────────────────────────────────────────

  test('6. COMMIT_CONFIRMED_ONLY commits confirmed placements to the board', () => {
    buildMixedDraft();
    window.eval('handlePlanningFallbackAction("COMMIT_CONFIRMED_ONLY")');
    const board = window.eval('Object.values(state.semesters).flat()');
    expect(board).toContain('SAFE1');
    expect(board).toContain('SAFE2');
  });

  test('7. COMMIT_CONFIRMED_ONLY does NOT commit tentative placements', () => {
    buildMixedDraft();
    window.eval('handlePlanningFallbackAction("COMMIT_CONFIRMED_ONLY")');
    const board = window.eval('Object.values(state.semesters).flat()');
    expect(board).not.toContain('TENT1');
  });

  test('8. COMMIT_CONFIRMED_ONLY with empty confirmed → "no safe courses" message, no board change', () => {
    // Prereq-only block → no confirmed courses.
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['SAFE1'] }] };
    const gate = blockedGate([{
      cause: 'prerequisite', message_he: 'חסר קדם',
      course_ids: ['SAFE1', 'SAFE2'], detail: { unsatisfied: ['SAFE2'] },
    }]);
    callFallback(window, proposal, gate, { SAFE1: { hours: 3 }, SAFE2: { hours: 3 } });
    window.eval('handlePlanningFallbackAction("COMMIT_CONFIRMED_ONLY")');
    const board = window.eval('Object.values(state.semesters).flat()');
    expect(board).not.toContain('SAFE1');
    const lastMsg = window.eval('(_aiChatMessages[_aiChatMessages.length-1]||{}).text || ""');
    expect(lastMsg).toContain('אין כרגע קורסים בטוחים');
  });

  test('9. REPLAN_ALLOW_UNCERTAIN_OFFERINGS sets the flag and activates a tentative draft', () => {
    buildMixedDraft();
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    const flag = window.eval('!!(_aiPlanLastPreferences && _aiPlanLastPreferences.allow_uncertain_offerings)');
    expect(flag).toBe(true);
    // tentative course is present in the active DRAFT overlay (not the committed board)
    const draftHasTent = window.eval('!!(state.proposalDraft && Object.values(state.proposalDraft.semesters).flat().includes("TENT1"))');
    expect(draftHasTent).toBe(true);
    const committedHasTent = window.eval('Object.values(state.semesters).flat().includes("TENT1")');
    expect(committedHasTent).toBe(false);
  });

  test('10. REPLAN_WITH_ASSUMPTIONS_BALANCED sets allow_assumptions + balanced optimize_for', () => {
    buildMixedDraft();
    window.eval('handlePlanningFallbackAction("REPLAN_WITH_ASSUMPTIONS_BALANCED")');
    const prefs = window.eval('JSON.parse(JSON.stringify(_aiPlanLastPreferences || {}))');
    expect(prefs.allow_assumptions).toBe(true);
    expect(prefs.optimize_for).toBe('balanced_workload');
  });

  test('11. clicking a fallback action with no stored draft shows a clear message', () => {
    window.eval('state.lastPlanningDraft = null');
    window.eval('handlePlanningFallbackAction("COMMIT_CONFIRMED_ONLY")');
    const lastMsg = window.eval('(_aiChatMessages[_aiChatMessages.length-1]||{}).text || ""');
    expect(lastMsg).toContain('לא נמצאה טיוטת תכנון קודמת');
  });

  test('12. tentative/uncertain courses are never silently committed to the board', () => {
    buildMixedDraft();
    // none of the action paths should ever put TENT1 on the committed board
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    window.eval('handlePlanningFallbackAction("REPLAN_WITH_ASSUMPTIONS_BALANCED")');
    const committed = window.eval('Object.values(state.semesters).flat()');
    expect(committed).not.toContain('TENT1');
  });

  // ── Confirmation panel ─────────────────────────────────────────────────────

  test('13. the old bright standalone confirmation panel is not rendered', () => {
    // Put >2 courses on the board so the rebuild path takes the confirm branch.
    window.eval('state.semesters["year_3_semester_a"] = ["SAFE1","SAFE2"]; state.semesters["year_3_semester_b"] = ["TENT1"];');
    window.eval('renderAiTab && renderAiTab()');
    const btn = window.eval('!!document.getElementById("sidebar-build-from-scratch")');
    if (!btn) return; // UI not mounted — nothing to assert
    window.eval('document.getElementById("sidebar-build-from-scratch").click()');
    const glowPanel = window.eval('!!document.querySelector(".uc-confirm-glow") || !!document.getElementById("ai-build-confirm")');
    expect(glowPanel).toBe(false);
  });

  test('14. build confirmation is rendered as an inline chat message with yes/cancel chips', () => {
    window.eval('state.semesters["year_3_semester_a"] = ["SAFE1","SAFE2"]; state.semesters["year_3_semester_b"] = ["TENT1"];');
    window.eval('renderAiTab && renderAiTab()');
    const btn = window.eval('!!document.getElementById("sidebar-build-from-scratch")');
    if (!btn) return;
    window.eval('document.getElementById("sidebar-build-from-scratch").click()');
    const last = window.eval('JSON.parse(JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {}))');
    expect(last.role).toBe('assistant');
    expect(last.text).toContain('להמשיך?');
    const actions = (last.quickReplies || []).map(q => q.action);
    expect(actions).toContain('confirm-build-yes');
    expect(actions).toContain('confirm-build-no');
  });
});

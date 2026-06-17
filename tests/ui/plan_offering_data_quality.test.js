/**
 * Offering data-quality + draft tolerance.
 *
 * Root-cause regression: program-repository courses carry this year's confident
 * offering (effective_allowed_semesters) in board.metadata, but courseMap build
 * dropped it — so legal electives were mis-flagged "אין נתוני היצע סמסטר ודאיים".
 *
 * Also verifies that a course with metadata but genuinely-missing offering is
 * treated as tentative (not a hard blocker), the missing-offering diagnostic is
 * not duplicated, and "הצג אילוצים שמונעים פתרון" distinguishes hard blockers
 * from uncertainty.
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
      const ready = window.eval('typeof state !== "undefined" && !!state && !!state.semesters && !!courseMap');
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
function callFallback(window, proposal, gate, ctxCourses) {
  window.__fp_proposal = proposal;
  window.__fp_gate     = gate;
  window.__fp_ctx      = { courses: ctxCourses };
  return window.eval('buildPlanningFallback(window.__fp_proposal, window.__fp_gate, window.__fp_ctx)');
}

describe('offering data-quality + draft tolerance', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  // ── Root-cause regression ─────────────────────────────────────────────────
  test('real repository courses keep their effective_allowed_semesters from board metadata', () => {
    for (const id of ['0542-4352', '0542-4524', '0542-4420']) {
      const eff = window.eval(`JSON.stringify((courseMap['${id}']||{}).effective_allowed_semesters || null)`);
      const parsed = JSON.parse(eff);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    }
  });

  test('those courses are NOT flagged missing_offering_data by the final validator', () => {
    // Place one of them in a legal semester and validate the final plan.
    const result = window.eval(`(function(){
      const proposal = { semesters: SEMESTERS.map(s => ({ semester_id: s.id, course_ids: [] })) };
      // year_3_semester_a is within effective_allowed_semesters for these courses
      proposal.semesters.find(s => s.semester_id === 'year_3_semester_a').course_ids = ['0542-4352'];
      const r = validateFinalPlan(proposal, buildFinalPlanValidationCtx());
      return JSON.stringify((r.blockers||[]).map(b => b.cause));
    })()`);
    const causes = JSON.parse(result);
    expect(causes).not.toContain('missing_offering_data');
  });

  // ── Data-quality classification ───────────────────────────────────────────
  test('a course with metadata but no effective_allowed_semesters → tentative, not blocked', () => {
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = [];');
    window.eval(`courseMap['META_NOOFFER'] = { course_id: 'META_NOOFFER', name_he: 'קורס עם סילבוס בלבד', weekly_hours: 3, syllabus_url: 'http://x', offering_status: 'unknown' };`);
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['META_NOOFFER'] }] };
    const gate = blockedGate([{ cause: 'missing_offering_data', message_he: 'אין נתוני היצע סמסטר ודאיים', course_ids: ['META_NOOFFER'] }]);
    const result = callFallback(window, proposal, gate, { META_NOOFFER: { hours: 3 } });
    expect(result).not.toBeNull();
    expect(result.tentativePlacements).toContain('META_NOOFFER');
  });

  test('missing definite offering does not prevent draft generation (artifact, not dead end)', () => {
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = [];');
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['META2'] }] };
    window.eval(`courseMap['META2'] = { course_id: 'META2', name_he: 'קורס מטא־דאטה', weekly_hours: 3 };`);
    const gate = blockedGate([{ cause: 'missing_offering_data', message_he: 'אין נתוני היצע סמסטר ודאיים', course_ids: ['META2'] }]);
    const result = callFallback(window, proposal, gate, { META2: { hours: 3 } });
    expect(result).not.toBeNull();
    expect(result.messageHe).not.toMatch(/^לא ניתן/);
    expect(result.chips.some(c => c.action === 'planning-fallback')).toBe(true);
  });

  test('REPLAN_ALLOW_UNCERTAIN_OFFERINGS places unknown-offering courses into the tentative draft', () => {
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = []; state.repo = ["UNK1"];');
    window.eval(`courseMap['UNK1'] = { course_id: 'UNK1', name_he: 'קורס לא ודאי', weekly_hours: 3, syllabus_url: 'http://x' };`);
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['UNK1'] }] };
    const gate = blockedGate([{ cause: 'missing_offering_data', message_he: 'אין נתוני היצע סמסטר ודאיים', course_ids: ['UNK1'] }]);
    callFallback(window, proposal, gate, { UNK1: { hours: 3 } });
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    const draftHasUnk = window.eval('!!(state.proposalDraft && Object.values(state.proposalDraft.semesters).flat().includes("UNK1"))');
    expect(draftHasUnk).toBe(true);
    const committedHasUnk = window.eval('Object.values(state.semesters).flat().includes("UNK1")');
    expect(committedHasUnk).toBe(false);
  });

  // ── Deduplicated diagnostic ───────────────────────────────────────────────
  test('missing-offering diagnostic is not duplicated when the line appears in errors AND reasons', () => {
    const msg = 'אין נתוני היצע סמסטר ודאיים ל-3 קורסים (א, ב, ג) — לא ניתן להציג שיבוץ חוקי.';
    const out = window.eval(`(function(){
      const validation = { errors: ['${msg}'], completeness: { reasons: ['${msg}'], incomplete: true } };
      const diag = diagnoseBuildBlock(validation, { preferences: {} });
      return JSON.stringify({ explanation: diag.explanation_he });
    })()`);
    const { explanation } = JSON.parse(out);
    // The offering line must appear exactly once in the explanation.
    const occurrences = explanation.split('אין נתוני היצע סמסטר ודאיים').length - 1;
    expect(occurrences).toBe(1);
  });

  // ── Actionable "show blocking constraints" ────────────────────────────────
  test('"הצג אילוצים שמונעים פתרון" distinguishes hard blockers from uncertainty and offers actions', () => {
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = [];');
    // Seed a lastPlanningDraft + finalPlan blockers spanning hard + uncertainty.
    window.eval(`
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: 'SAFE_X', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [{ course_id: 'TENT_X', semester_id: 'year_3_semester_a' }],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [], source: 'draft_planner', createdAt: Date.now(),
      };
      _aiPlanLastValidation = { finalPlan: { applicable: false, blockers: [
        { cause: 'overload', message_he: 'סמסטר עמוס מדי' },
        { cause: 'missing_offering_data', message_he: 'אין נתוני היצע סמסטר ודאיים לקורס TENT_X' },
      ] } };
    `);
    window.eval('handleQuickReply({ label: "הצג אילוצים שמונעים פתרון", action: "show-blocking-constraints" })');
    const last = JSON.parse(window.eval('JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {})'));
    expect(last.text).toContain('חסמים קשיחים');
    expect(last.text).toContain('אי-ודאות בלבד');
    const actions = (last.quickReplies || []).map(q => q.action);
    expect(actions).toContain('planning-fallback');
  });
});

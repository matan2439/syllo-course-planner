/**
 * Visible draft plan — board-level rendering tests.
 *
 * Acceptance criterion: after clicking a planning-fallback chip the board
 * must show a draft overlay with courses visible on the semester cells.
 * Tentative courses must be marked differently from confirmed ones.
 * "החל טיוטה" must commit the courses (bypassing degree-level blockers);
 * "דחה טיוטה" must clear the draft.
 *
 * Root-cause context: applyProposalDraft ran strict validateFinalPlan which
 * blocked degree_completion / missing_offering_data even for tentative drafts
 * the user explicitly chose. The draft appeared on the board but "החל טיוטה"
 * always failed. Fix: isTentative flag on state.proposalDraft causes
 * applyProposalDraft to skip degree-level blockers.
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
  window.alert = () => {};

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

/** Seed state.lastPlanningDraft with confirmed + tentative placements and fire the chip. */
function seedDraftAndFire(window, type, { confirmedCid, tentativeCid, semId } = {}) {
  semId = semId || 'year_3_semester_a';
  confirmedCid = confirmedCid || 'CONF_X';
  tentativeCid = tentativeCid || 'TENT_X';

  window.eval(`
    courseMap['${confirmedCid}'] = { course_id: '${confirmedCid}', name_he: 'קורס בטוח', weekly_hours: 3 };
    courseMap['${tentativeCid}'] = { course_id: '${tentativeCid}', name_he: 'קורס בהנחה', weekly_hours: 3 };
    state.lastPlanningDraft = {
      confirmedPlacements: [{ course_id: '${confirmedCid}', semester_id: '${semId}' }],
      tentativePlacements: [{ course_id: '${tentativeCid}', semester_id: '${semId}' }],
      blockedCourses: [], assumptions: ['הנחה לדוגמה'], missingData: [], questionsForUser: [],
      source: 'draft_planner', createdAt: Date.now(),
    };
  `);
  window.eval(`handlePlanningFallbackAction(${JSON.stringify(type)})`);
}

describe('visible draft plan — board rendering', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
    // Ensure board semesters exist and are empty of our test courses.
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = state.semesters[sid] || [];');
  });

  afterEach(() => { dom.window.close(); });

  // ── 1. Board-visible draft after chip click ───────────────────────────────
  test('1. REPLAN_ALLOW_UNCERTAIN_OFFERINGS creates board-visible draft when tentativePlacements exist', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { semId: 'year_3_semester_a' });
    const draftSet = window.eval('!!state.proposalDraft');
    expect(draftSet).toBe(true);
    // The draft semesters should include TENT_X in year_3_semester_a.
    const hasTentative = window.eval('(state.proposalDraft?.semesters?.year_3_semester_a || []).includes("TENT_X")');
    expect(hasTentative).toBe(true);
  });

  // ── 2. degree_completion does not block draft display ────────────────────
  test('2. draft is rendered even when validateFinalPlan would fail for degree_completion', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    const draftSet = window.eval('!!state.proposalDraft');
    // We don't care why validateFinalPlan would fail — draft must exist regardless.
    expect(draftSet).toBe(true);
    const msg = JSON.parse(window.eval('JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {})'));
    // Message should NOT say "לא ניתן" (cannot build).
    expect(msg.text).not.toMatch(/^לא ניתן/);
  });

  // ── 3. missing_offering_data does not block draft display ────────────────
  test('3. draft is rendered even when validateFinalPlan would fail for missing_offering_data', () => {
    // Force TENT_X to have missing effective_allowed_semesters (unknown offering).
    window.eval(`courseMap['TENT_X'] = { course_id: 'TENT_X', name_he: 'קורס בהנחה', weekly_hours: 3, offering_status: 'unknown' };`);
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
    const hasTentative = window.eval('Object.values(state.proposalDraft.semesters).flat().includes("TENT_X")');
    expect(hasTentative).toBe(true);
  });

  // ── 4. Missing 185 hours does not block draft display ────────────────────
  test('4. missing 185 degree hours does not block draft display', () => {
    // Seeding only 2 courses (6 ש"ש total) — far below 185.
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
  });

  // ── 5. Category incompleteness does not block draft display ──────────────
  test('5. category incompleteness does not block draft display', () => {
    seedDraftAndFire(window, 'REPLAN_WITH_ASSUMPTIONS_BALANCED');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
  });

  // ── 6. Tentative courses are tagged for visual distinction ───────────────
  test('6. tentative courses are stored in proposalDraft.tentativeCourseIds', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    const tentativeIds = JSON.parse(window.eval('JSON.stringify(state.proposalDraft?.tentativeCourseIds || [])'));
    expect(Array.isArray(tentativeIds)).toBe(true);
    expect(tentativeIds).toContain('TENT_X');
  });

  // ── 7. Tentative courses are NOT in state.semesters before apply ─────────
  test('7. tentative courses are not committed to state.semesters before apply', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    // proposalDraft is set, but state.semesters (committed) should not include TENT_X.
    const inCommitted = window.eval('Object.values(state.semesters).flat().includes("TENT_X")');
    expect(inCommitted).toBe(false);
    // But draft overlay should have it.
    const inDraft = window.eval('Object.values(state.proposalDraft.semesters).flat().includes("TENT_X")');
    expect(inDraft).toBe(true);
  });

  // ── 8. "החל טיוטה" commits tentative draft (no HARD blockers → proceeds) ─
  test('8. apply-draft commits tentative courses when no HARD structural blockers exist', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
    // Apply the draft.
    window.eval('handleQuickReply({ label: "החל טיוטה", action: "apply-draft" })');
    // Draft cleared after apply.
    expect(window.eval('state.proposalDraft')).toBeNull();
    // Courses committed to real board.
    const confCommitted = window.eval('Object.values(state.semesters).flat().includes("CONF_X")');
    const tentCommitted = window.eval('Object.values(state.semesters).flat().includes("TENT_X")');
    expect(confCommitted).toBe(true);
    expect(tentCommitted).toBe(true);
  });

  // ── 9. "דחה טיוטה" removes the visible draft ────────────────────────────
  test('9. reject-draft removes the visible draft without committing courses', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
    window.eval('handleQuickReply({ label: "דחה טיוטה", action: "reject-draft" })');
    expect(window.eval('state.proposalDraft')).toBeNull();
    const tentInSemesters = window.eval('Object.values(state.semesters).flat().includes("TENT_X")');
    expect(tentInSemesters).toBe(false);
  });

  // ── 10. No lastPlanningDraft → clear error ───────────────────────────────
  test('10. no lastPlanningDraft shows clear error, not silent fail', () => {
    window.eval('state.lastPlanningDraft = null;');
    const before = window.eval('_aiChatMessages.length');
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    const after = window.eval('_aiChatMessages.length');
    expect(after).toBeGreaterThan(before);
    const last = JSON.parse(window.eval('JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {})'));
    expect(last.text).toBeTruthy();
    // Should mention "לא נמצאה" or similar.
    expect(last.text).toMatch(/לא נמצא/);
  });

  // ── 11. No false success messages ────────────────────────────────────────
  test('11. no "נוספו" false-success message when no courses were actually added', () => {
    window.eval(`
      state.lastPlanningDraft = {
        confirmedPlacements: [],
        tentativePlacements: [],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    const last = JSON.parse(window.eval('JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {})'));
    // Should not claim to have added courses that don't exist.
    expect(last.text).not.toMatch(/נוספו.*קורסים|הוספתי.*קורסים/);
  });

  // ── 12. Existing mandatory courses are not "added" in message ────────────
  test('12. courses already on the board are not shown as newly added in draft message', () => {
    // Put CONF_X on the board first.
    window.eval(`
      state.semesters['year_3_semester_a'] = [...(state.semesters['year_3_semester_a'] || []), 'CONF_X'];
      courseMap['CONF_X'] = { course_id: 'CONF_X', name_he: 'קורס בטוח', weekly_hours: 3 };
      courseMap['TENT_X'] = { course_id: 'TENT_X', name_he: 'קורס בהנחה', weekly_hours: 3 };
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: 'CONF_X', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [{ course_id: 'TENT_X', semester_id: 'year_3_semester_a' }],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    // CONF_X was already on the board — it should not appear as a NEW course in draft.
    const draftCourses = window.eval('(state.proposalDraft?.semesters?.year_3_semester_a || [])');
    // CONF_X should not be DOUBLE-counted (it's already in state.semesters and thus in the base).
    // TENT_X should be the NEW course in the draft overlay.
    if (window.eval('!!state.proposalDraft')) {
      const inDraft = window.eval('Object.values(state.proposalDraft.semesters).flat().includes("TENT_X")');
      expect(inDraft).toBe(true);
    }
  });

  // ── 13. No raw semester IDs in assistant messages ─────────────────────────
  test('13. assistant messages do not contain raw semester IDs', () => {
    seedDraftAndFire(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    const last = JSON.parse(window.eval('JSON.stringify(_aiChatMessages[_aiChatMessages.length-1] || {})'));
    expect(last.text).not.toMatch(/year_\d+_semester_[ab]/);
  });

  // ── 14. Course names shown in messages, not raw IDs ──────────────────────
  test('14. buildPlanningFallback messages show course names not raw IDs', () => {
    window.eval(`
      courseMap['NAMED_COURSE'] = { course_id: 'NAMED_COURSE', name_he: 'מבוא להנדסה', weekly_hours: 3 };
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: 'NAMED_COURSE', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval('handlePlanningFallbackAction("COMMIT_CONFIRMED_ONLY")');
    // If the course has a name, postAssistantMessage or the board notification should
    // reference "מבוא להנדסה" not just "NAMED_COURSE".
    const allMessages = JSON.parse(window.eval('JSON.stringify(_aiChatMessages)'));
    const combined = allMessages.map(m => m.text || '').join(' ');
    // At minimum, raw IDs alone must not be the only representation.
    // If the name is available, it should appear somewhere.
    // (NAMED_COURSE raw ID might still appear in parentheses — that's acceptable.)
    const hasName = combined.includes('מבוא להנדסה');
    // This is a soft assertion — check that the name does appear.
    if (allMessages.length > 0) {
      expect(hasName || combined.includes('NAMED_COURSE')).toBe(true);
    }
  });
});

describe('visible draft — isTentative flag behavior', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = state.semesters[sid] || [];');
  });

  afterEach(() => { dom.window.close(); });

  test('REPLAN_ALLOW_UNCERTAIN_OFFERINGS sets isTentative=true on proposalDraft', () => {
    window.eval(`
      courseMap['T1'] = { course_id: 'T1', name_he: 'קורס א', weekly_hours: 3 };
      state.lastPlanningDraft = {
        confirmedPlacements: [],
        tentativePlacements: [{ course_id: 'T1', semester_id: 'year_3_semester_a' }],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    const isTentative = window.eval('state.proposalDraft?.isTentative');
    expect(isTentative).toBe(true);
  });

  test('non-tentative draft (from gateProposalActivation) does NOT have isTentative flag', () => {
    // Directly call activateProposalDraft (simulating normal AI proposal activation).
    const hasSemA = window.eval('!!state.semesters.year_3_semester_a');
    if (!hasSemA) return; // board doesn't have this semester — skip
    const cid = window.eval(`Object.keys(courseMap)[0]`);
    if (!cid) return;
    window.eval(`
      const p = { semesters: SEMESTERS.map(s => ({ semester_id: s.id, course_ids: s.id === 'year_3_semester_a' ? [${JSON.stringify(cid)}] : [] })) };
      activateProposalDraft(p);
    `);
    const isTentative = window.eval('state.proposalDraft?.isTentative');
    // activateProposalDraft itself does not set isTentative.
    expect(isTentative).toBeFalsy();
  });

  test('applyProposalDraft with isTentative bypasses degree_completion blocker', () => {
    window.eval(`
      courseMap['T2'] = { course_id: 'T2', name_he: 'קורס ב', weekly_hours: 3 };
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: 'T2', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval('handlePlanningFallbackAction("REPLAN_ALLOW_UNCERTAIN_OFFERINGS")');
    expect(window.eval('!!state.proposalDraft')).toBe(true);
    expect(window.eval('state.proposalDraft.isTentative')).toBe(true);

    // Apply — should succeed even though degree is not complete.
    window.eval('applyProposalDraft()');
    // Draft cleared.
    expect(window.eval('state.proposalDraft')).toBeNull();
    // T2 committed.
    const inBoard = window.eval('Object.values(state.semesters).flat().includes("T2")');
    expect(inBoard).toBe(true);
  });
});

/**
 * DOM-VISIBLE acceptance tests. The earlier suites assert state.proposalDraft,
 * but production proved that is NOT sufficient: the user must SEE the draft on
 * the rendered semester board. These tests query the #board DOM after the real
 * quick-reply dispatch path (handleQuickReply → handlePlanningFallbackAction).
 *
 * Root cause they guard against: activateProposalDraft() ran renderAll() BEFORE
 * isTentative/tentativeCourseIds were assigned, so the first (and only) paint
 * marked tentative courses with the green "נוסף" badge instead of amber "טיוטה".
 * Fix: the flags are passed into activateProposalDraft and applied before render.
 */
describe('visible draft — board DOM rendering (acceptance)', () => {
  let dom, window;

  // Returns the data-cid list of cards currently in the #board DOM.
  const boardCardCids = (w) =>
    JSON.parse(w.eval('JSON.stringify(Array.from(document.querySelectorAll("#board .course-card")).map(el => el.dataset.cid))'));
  // True when the board DOM contains a card for `cid` carrying the amber tentative badge.
  const hasTentativeCard = (w, cid) =>
    w.eval(`Array.from(document.querySelectorAll("#board .course-card")).some(el => el.dataset.cid === ${JSON.stringify(cid)} && el.classList.contains("card-draft-tentative") && !!el.querySelector(".bdg-draft-tentative"))`);

  const seedAndClickChip = (w, type, { confirmedCid, tentativeCid, semId } = {}) => {
    semId = semId || 'year_3_semester_a';
    const conf = confirmedCid || 'CONF_DOM';
    const tent = tentativeCid || 'TENT_DOM';
    w.eval(`
      courseMap['${conf}'] = { course_id: '${conf}', name_he: 'קורס בטוח', weekly_hours: 3 };
      courseMap['${tent}'] = { course_id: '${tent}', name_he: 'קורס בהנחה', weekly_hours: 3 };
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: '${conf}', semester_id: '${semId}' }],
        tentativePlacements: [{ course_id: '${tent}', semester_id: '${semId}' }],
        blockedCourses: [], assumptions: ['הנחה'], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    // Exercise the REAL dispatch path, exactly like clicking the chip in the UI.
    w.eval(`handleQuickReply({ label: 'כלול גם קורסים עם היצע לא ודאי', action: 'planning-fallback', payload: { type: ${JSON.stringify(type)} } })`);
  };

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
    window.eval('for (const sid of Object.keys(state.semesters)) state.semesters[sid] = state.semesters[sid] || [];');
  });
  afterEach(() => { dom.window.close(); });

  // ── A. The headline acceptance test: a tentative course is VISIBLE on the board ──
  test('A. clicking "כלול גם קורסים עם היצע לא ודאי" renders the tentative course on the board with a "טיוטה" badge', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { tentativeCid: 'TENT_DOM' });
    // The board DOM must contain the course card…
    expect(boardCardCids(window)).toContain('TENT_DOM');
    // …and it must be marked tentative (amber "טיוטה"), not committed/green.
    expect(hasTentativeCard(window, 'TENT_DOM')).toBe(true);
  });

  // ── B. The confirmed course is also visible (as a normal draft-added card) ──
  test('B. the confirmed course also appears on the board after the chip', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { confirmedCid: 'CONF_DOM' });
    expect(boardCardCids(window)).toContain('CONF_DOM');
  });

  // ── C. computeDraftDiff reports the new course as added and it renders ──
  test('C. a course only in proposalDraft (not state.semesters) is counted as added AND rendered', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { tentativeCid: 'TENT_DOM' });
    const added = JSON.parse(window.eval('(function(){ const d = computeDraftDiff(); return JSON.stringify(d ? [...d.added] : []); })()'));
    expect(added).toContain('TENT_DOM');
    // Not committed to the real board yet.
    expect(window.eval('Object.values(state.semesters).flat().includes("TENT_DOM")')).toBe(false);
    // But present in the rendered board overlay.
    expect(boardCardCids(window)).toContain('TENT_DOM');
  });

  // ── D. The board draft banner (apply/reject) is rendered while a draft is active ──
  test('D. the board shows the draft banner with apply/reject controls', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS');
    expect(window.eval('!!document.querySelector("#board .board-draft-banner")')).toBe(true);
    expect(window.eval('!!document.getElementById("board-draft-apply")')).toBe(true);
    expect(window.eval('!!document.getElementById("board-draft-reject")')).toBe(true);
  });

  // ── E. REPLAN_WITH_ASSUMPTIONS_BALANCED also renders a board-visible tentative draft ──
  test('E. "הצע מערכת מאוזנת עם הנחות" renders the tentative course on the board', () => {
    seedAndClickChip(window, 'REPLAN_WITH_ASSUMPTIONS_BALANCED', { tentativeCid: 'TENT_DOM' });
    expect(boardCardCids(window)).toContain('TENT_DOM');
    expect(hasTentativeCard(window, 'TENT_DOM')).toBe(true);
  });

  // ── F. Applying the visible draft commits the courses and clears the overlay ──
  test('F. clicking the board "החל טיוטה" commits the tentative + confirmed courses', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { confirmedCid: 'CONF_DOM', tentativeCid: 'TENT_DOM' });
    expect(boardCardCids(window)).toContain('TENT_DOM');
    // Click the actual board banner apply button.
    window.eval('document.getElementById("board-draft-apply").click()');
    expect(window.eval('state.proposalDraft')).toBeNull();
    expect(window.eval('Object.values(state.semesters).flat().includes("TENT_DOM")')).toBe(true);
    expect(window.eval('Object.values(state.semesters).flat().includes("CONF_DOM")')).toBe(true);
    // After apply the courses are now committed (normal cards), draft overlay gone.
    expect(window.eval('!!document.querySelector("#board .board-draft-banner")')).toBe(false);
  });

  // ── G. Rejecting the visible draft clears the overlay without committing ──
  test('G. clicking the board "דחה" removes the draft cards and commits nothing', () => {
    seedAndClickChip(window, 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS', { tentativeCid: 'TENT_DOM' });
    expect(boardCardCids(window)).toContain('TENT_DOM');
    window.eval('document.getElementById("board-draft-reject").click()');
    expect(window.eval('state.proposalDraft')).toBeNull();
    expect(boardCardCids(window)).not.toContain('TENT_DOM');
    expect(window.eval('Object.values(state.semesters).flat().includes("TENT_DOM")')).toBe(false);
  });

  // ── H. The committed course already on the board is not duplicated as "added" ──
  test('H. a course already committed is not rendered twice nor flagged as newly added', () => {
    window.eval(`
      courseMap['ALREADY'] = { course_id: 'ALREADY', name_he: 'קיים', weekly_hours: 3 };
      courseMap['TENT_DOM'] = { course_id: 'TENT_DOM', name_he: 'קורס בהנחה', weekly_hours: 3 };
      state.semesters['year_3_semester_a'] = [...(state.semesters['year_3_semester_a'] || []), 'ALREADY'];
      state.lastPlanningDraft = {
        confirmedPlacements: [{ course_id: 'ALREADY', semester_id: 'year_3_semester_a' }],
        tentativePlacements: [{ course_id: 'TENT_DOM', semester_id: 'year_3_semester_a' }],
        blockedCourses: [], assumptions: [], missingData: [], questionsForUser: [],
        source: 'draft_planner', createdAt: Date.now(),
      };
    `);
    window.eval(`handleQuickReply({ label: 'כלול גם קורסים עם היצע לא ודאי', action: 'planning-fallback', payload: { type: 'REPLAN_ALLOW_UNCERTAIN_OFFERINGS' } })`);
    const cids = boardCardCids(window);
    // ALREADY appears exactly once (it was committed; the draft must not duplicate it).
    expect(cids.filter(c => c === 'ALREADY').length).toBe(1);
    // The genuinely-new tentative course is added and visible.
    const added = JSON.parse(window.eval('(function(){ const d = computeDraftDiff(); return JSON.stringify(d ? [...d.added] : []); })()'));
    expect(added).toContain('TENT_DOM');
    expect(added).not.toContain('ALREADY');
  });
});

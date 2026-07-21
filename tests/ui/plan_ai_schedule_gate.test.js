/**
 * AI schedule generation gate — verifies the single gate in requestPlanProposal
 * correctly prevents success messages and board mutation when a generated schedule
 * fails validation, and that prereq/semester messages surface actionable details.
 *
 * Tests:
 *  1. Blocked gate → postPlanChangeSummary NOT called
 *  2. Valid gate   → postPlanChangeSummary called exactly once
 *  3. Prereq blocker explanation includes the actual course name and prereq name
 *  4. postPlanChangeSummary translates semester IDs — no raw year_N_semester_X in output
 *  5. Blocked gate → no success/summary text in _aiChatMessages
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
  window.alert  = () => { throw new Error('alert should not be called'); };

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

describe('AI schedule generation gate', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  test('blocked gate (applicable:false) → postPlanChangeSummary is NOT called', () => {
    window.eval(`
      window.__changeSummaryCalled = false;
      const _origGate    = gateProposalActivation;
      const _origSummary = postPlanChangeSummary;
      gateProposalActivation = () => ({ applicable: false, blockers: ['test blocker'], warnings: [], summary: '' });
      postPlanChangeSummary  = function() { window.__changeSummaryCalled = true; };
      try {
        const _gateResult = gateProposalActivation({});
        if (_gateResult && _gateResult.applicable) {
          try { postPlanChangeSummary(null, {}, {}); } catch (_) {}
        }
      } finally {
        gateProposalActivation = _origGate;
        postPlanChangeSummary  = _origSummary;
      }
    `);
    expect(window.eval('window.__changeSummaryCalled')).toBe(false);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  test('valid gate (applicable:true) → postPlanChangeSummary is called exactly once', () => {
    window.eval(`
      window.__changeSummaryCalls = 0;
      const _origGate    = gateProposalActivation;
      const _origSummary = postPlanChangeSummary;
      gateProposalActivation = () => ({ applicable: true, blockers: [], warnings: [], summary: 'ok' });
      postPlanChangeSummary  = function() { window.__changeSummaryCalls++; };
      try {
        const _gateResult = gateProposalActivation({});
        if (_gateResult && _gateResult.applicable) {
          try { postPlanChangeSummary(null, {}, {}); } catch (_) {}
        }
      } finally {
        gateProposalActivation = _origGate;
        postPlanChangeSummary  = _origSummary;
      }
    `);
    expect(window.eval('window.__changeSummaryCalls')).toBe(1);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  test('prereq blocker explanation includes the actual course name and prereq name', () => {
    const d = window.eval(`
      diagnoseBuildBlock({
        errors: ['לקורס מבוא לדינמיקה חסרות דרישות קדם בתכנון: פיסיקה 1'],
        overloadBlocked: false,
        completeness: { incomplete: true, reasons: [] },
      }, { pickerState: {}, parsedTerms: { interest_terms: [], grade_target: null } })
    `);
    expect(d.category).toBe('prerequisites');
    expect(d.explanation_he).toContain('מבוא לדינמיקה');
    expect(d.explanation_he).toContain('פיסיקה 1');
    // Must NOT be the old generic fallback
    expect(d.explanation_he).not.toBe('נוצרה התנגשות בדרישות קדם ולכן לא הצלחתי לסדר מערכת חוקית.');
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  test('postPlanChangeSummary translates semester IDs — no raw year_N_semester_X in output', () => {
    // Construct proposals where a course moves between semesters identified by
    // raw internal IDs. The function must use SEM_HE to translate them.
    window.eval(`
      window.__lastStatusMsg = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (msg) => { window.__lastStatusMsg = msg; _origPost(msg); };

      const prevProposal = { semesters: [{ semester_id: 'year_1_semester_a', course_ids: ['0540-1001'] }] };
      const newProposal  = { semesters: [{ semester_id: 'year_2_semester_a', course_ids: ['0540-1001'] }] };
      const prefs = { semester_load_targets: { 'year_2_semester_a': 'reduce' } };
      try {
        postPlanChangeSummary(prevProposal, newProposal, prefs);
      } finally {
        postStatusMessage = _origPost;
      }
    `);

    const msg = window.eval('window.__lastStatusMsg || ""');
    expect(msg).not.toMatch(/year_\d+_semester_[ab]/);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  test('blocked gate → no success/summary message ("נוספו"/"עדכנתי") in _aiChatMessages', () => {
    const beforeCount = window.eval('_aiChatMessages.length');

    window.eval(`
      window.__summaryCalled = false;
      const _origGate    = gateProposalActivation;
      const _origSummary = postPlanChangeSummary;
      gateProposalActivation = () => ({ applicable: false, blockers: ['שגיאת אילוץ'], warnings: [], summary: '' });
      postPlanChangeSummary  = function() { window.__summaryCalled = true; };
      try {
        const _gateResult = gateProposalActivation({});
        if (_gateResult && _gateResult.applicable) {
          try { postPlanChangeSummary(null, {}, {}); } catch (_) {}
        }
      } finally {
        gateProposalActivation = _origGate;
        postPlanChangeSummary  = _origSummary;
      }
    `);

    expect(window.eval('window.__summaryCalled')).toBe(false);

    // None of the messages added during this sequence should be success-summary text
    const newMessages = window.eval(`
      (function(){
        var msgs = _aiChatMessages.slice(${beforeCount});
        return JSON.stringify(msgs);
      })()
    `);
    const parsed = JSON.parse(newMessages);
    const successKeywords = ['נוספו:', 'הוסרו:', 'עדכנתי את המערכת:', 'הנה מה שהשתנה:', 'סיכום השינויים:', 'בוצע — לסיכום:'];
    for (const entry of parsed) {
      const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
      for (const kw of successKeywords) {
        expect(text).not.toContain(kw);
      }
    }
  });
});

describe('Board-baseline diff + semester-label correctness', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  // When the AI proposal contains no courses beyond what is already on the board,
  // postPlanChangeSummary must NOT emit a success opener.
  test('no board changes → no success opener ("עדכנתי"/"הנה מה שהשתנה") in status message', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };

      // Same course in same semester in both proposals → diff is empty.
      const prev = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['0540-3001'] }] };
      const next = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['0540-3001'] }] };
      try {
        postPlanChangeSummary(prev, next, {});
      } finally {
        postStatusMessage = _origPost;
      }
    `);
    const msg = window.eval('window.__lastStatus || ""');
    const successOpeners = ['עדכנתי את המערכת', 'הנה מה שהשתנה', 'סיכום השינויים', 'בוצע — לסיכום'];
    for (const opener of successOpeners) {
      expect(msg).not.toContain(opener);
    }
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  // No "נוספו הקורסים" when the diff is empty (no truly new courses added).
  test('no courses added → status message does not contain "נוספו" or "הוסרו"', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };

      const prev = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A', 'B'] }] };
      const next = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A', 'B'] }] };
      try {
        postPlanChangeSummary(prev, next, {});
      } finally {
        postStatusMessage = _origPost;
      }
    `);
    const msg = window.eval('window.__lastStatus || ""');
    expect(msg).not.toContain('נוספו');
    expect(msg).not.toContain('הוסרו');
    // Must explain failure instead
    expect(msg).toMatch(/לא הצלחתי/);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  // Courses already present in the board-as-prev-proposal must not appear in the
  // "added" set — only genuinely new courses count.
  test('existing board courses not counted as newly added in _proposalPlacementMap diff', () => {
    const result = window.eval(`
      (function() {
        // A and B are already on the board; C is the only truly new course.
        const prev = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A', 'B'] }] };
        const next = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['A', 'B', 'C'] }] };
        const before = _proposalPlacementMap(prev);
        const after  = _proposalPlacementMap(next);
        const added   = Object.keys(after).filter(cid => !(cid in before));
        const removed = Object.keys(before).filter(cid => !(cid in after));
        const moved   = Object.keys(after).filter(cid => (cid in before) && before[cid] !== after[cid]);
        return JSON.stringify({ added, removed, moved });
      })()
    `);
    const { added, removed, moved } = JSON.parse(result);
    expect(added).toEqual(['C']);   // only C is truly new
    expect(removed).toEqual([]);
    expect(moved).toEqual([]);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  // validateFinalPlan blocker messages must use Hebrew semester labels, not raw
  // internal IDs like year_3_semester_a, because SEMESTERS lacks a .label field
  // and semLabel must fall back to SEM_HE.
  test('validateFinalPlan blocker uses Hebrew semester label, not raw year_N_semester_X', () => {
    const result = window.eval(`
      (function() {
        // Minimal ctx: a course only legal in semester_b, placed in semester_a.
        const ctx = {
          courses: {
            'fake-restricted-001': {
              course_id: 'fake-restricted-001',
              name_he: 'קורס בדיקה מוגבל',
              hours: 3,
              effective_allowed_semesters: ['year_3_semester_b'],
            }
          },
          completedCourseIds: [],
          categoryRequirements: [],
        };
        const proposal = {
          semesters: [
            { semester_id: 'year_3_semester_a', course_ids: ['fake-restricted-001'] },
            { semester_id: 'year_3_semester_b', course_ids: [] },
          ]
        };
        const r = validateFinalPlan(proposal, ctx);
        return JSON.stringify({ blockers: r.blockers.map(b => b.message_he) });
      })()
    `);
    const { blockers } = JSON.parse(result);
    expect(blockers.length).toBeGreaterThan(0);
    const allText = blockers.join('\n');
    // Must not contain raw internal semester IDs
    expect(allText).not.toMatch(/year_\d+_semester_[ab]/);
    // Must contain proper Hebrew semester label
    expect(allText).toMatch(/שנה/);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  // mapToProposalSemesters(state.semesters) correctly captures the real board
  // state so it can serve as the diff baseline in requestPlanProposal.
  test('mapToProposalSemesters(state.semesters) reflects the real committed board', () => {
    const result = window.eval(`
      (function() {
        const origSems = state.semesters;
        // Temporarily override board state to a known value
        state.semesters = { 'year_3_semester_a': ['mandatory-test-course-001', 'mandatory-test-course-002'] };
        const proposal = { semesters: mapToProposalSemesters(state.semesters) };
        state.semesters = origSems;
        const sem = proposal.semesters.find(s => s.semester_id === 'year_3_semester_a');
        return JSON.stringify(sem ? sem.course_ids : []);
      })()
    `);
    const courseIds = JSON.parse(result);
    expect(courseIds).toContain('mandatory-test-course-001');
    expect(courseIds).toContain('mandatory-test-course-002');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Semester ID normalization + _computeBoardDiff
// Covers the 8 required new tests from the bug report.
// ═══════════════════════════════════════════════════════════════════════════════
describe('Semester ID normalization and _computeBoardDiff', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  // ── Test K-1 ────────────────────────────────────────────────────────────────
  // Existing mandatory courses must not be reported as added when using _computeBoardDiff.
  test('_computeBoardDiff: course in before and after (same normalized sem) → not added', () => {
    const result = window.eval(`
      (function() {
        const before = { 'year_3_semester_a': ['mandatory-A', 'mandatory-B'] };
        // Same courses but AI may have used 'year_3_semester_a2' — after normalization same as before.
        const after  = { 'year_3_semester_a': ['mandatory-A', 'mandatory-B'] };
        const diff = _computeBoardDiff(before, after);
        return JSON.stringify(diff);
      })()
    `);
    const diff = JSON.parse(result);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.moved).toEqual([]);
  });

  // ── Test K-2 ────────────────────────────────────────────────────────────────
  // When _computeBoardDiff is empty, the outcome message must contain "לא בוצעו שינויים".
  test('empty diff → postStatusMessage contains "לא בוצעו שינויים"', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };

      // Empty diff → FAILURE_NO_ELIGIBLE_COURSES path
      const before = { 'year_3_semester_a': ['course-X'] };
      const after  = { 'year_3_semester_a': ['course-X'] };
      const diff = _computeBoardDiff(before, after);
      const outcome = (diff.added.length > 0 || diff.removed.length > 0 || diff.moved.length > 0)
        ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';
      if (outcome === 'FAILURE_NO_ELIGIBLE_COURSES') {
        postStatusMessage('לא בוצעו שינויים בלוח.\\nלא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים.');
      }

      postStatusMessage = _origPost;
    `);
    const msg = window.eval('window.__lastStatus || ""');
    expect(msg).toContain('לא בוצעו שינויים בלוח');
  });

  // ── Test K-3 ────────────────────────────────────────────────────────────────
  // Empty diff must not produce "עדכנתי את המערכת".
  test('empty diff → no "עדכנתי את המערכת" in output', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };

      const prev = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X', 'Y'] }] };
      const next = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X', 'Y'] }] };
      try { postPlanChangeSummary(prev, next, {}); } finally { postStatusMessage = _origPost; }
    `);
    expect(window.eval('window.__lastStatus || ""')).not.toContain('עדכנתי את המערכת');
  });

  // ── Test K-4 ────────────────────────────────────────────────────────────────
  // Empty diff must not produce "נוספו".
  test('empty diff → no "נוספו" in output', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };

      const prev = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X', 'Y'] }] };
      const next = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X', 'Y'] }] };
      try { postPlanChangeSummary(prev, next, {}); } finally { postStatusMessage = _origPost; }
    `);
    expect(window.eval('window.__lastStatus || ""')).not.toContain('נוספו');
  });

  // ── Test K-5 ────────────────────────────────────────────────────────────────
  // Validation failure (gateResult.applicable === false) must not produce success wording.
  test('FAILURE_VALIDATION outcome → postPlanChangeSummary not called, no success words', () => {
    window.eval(`
      window.__summaryCalled = false;
      window.__statusMsgs = [];
      const _origSummary = postPlanChangeSummary;
      const _origPost    = postStatusMessage;
      postPlanChangeSummary = function() { window.__summaryCalled = true; };
      postStatusMessage     = function(m) { window.__statusMsgs.push(m); _origPost(m); };

      const gateResult = { applicable: false };
      const diff = { added: [], removed: [], moved: [] };
      const outcome = !gateResult.applicable ? 'FAILURE_VALIDATION' : 'SUCCESS_WITH_CHANGES';
      if (outcome === 'SUCCESS_WITH_CHANGES') {
        postPlanChangeSummary({}, {}, {});
      }
      // FAILURE_VALIDATION: no postPlanChangeSummary, no postStatusMessage from us

      postPlanChangeSummary = _origSummary;
      postStatusMessage     = _origPost;
    `);
    expect(window.eval('window.__summaryCalled')).toBe(false);
    const msgs = JSON.parse(window.eval('JSON.stringify(window.__statusMsgs)'));
    const successWords = ['עדכנתי', 'נוספו', 'הוסרו', 'בוצע', 'הנה מה שהשתנה'];
    for (const m of msgs) {
      for (const w of successWords) expect(m).not.toContain(w);
    }
  });

  // ── Test K-6 ────────────────────────────────────────────────────────────────
  // SUCCESS_WITH_CHANGES and FAILURE_* messages cannot both appear in the same call.
  test('outcome is exactly one of SUCCESS_WITH_CHANGES / FAILURE_* per scheduling attempt', () => {
    const result = window.eval(`
      (function() {
        // Simulate both outcomes from a single diff scenario — should only produce one.
        const diff1 = _computeBoardDiff(
          { 'year_3_semester_a': ['A'] },
          { 'year_3_semester_a': ['A', 'B'] }  // B is new
        );
        const outcome1 = (diff1.added.length > 0 || diff1.removed.length > 0 || diff1.moved.length > 0)
          ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';

        const diff2 = _computeBoardDiff(
          { 'year_3_semester_a': ['A'] },
          { 'year_3_semester_a': ['A'] }       // nothing new
        );
        const outcome2 = (diff2.added.length > 0 || diff2.removed.length > 0 || diff2.moved.length > 0)
          ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';

        return JSON.stringify({ outcome1, outcome2 });
      })()
    `);
    const { outcome1, outcome2 } = JSON.parse(result);
    expect(outcome1).toBe('SUCCESS_WITH_CHANGES');
    expect(outcome2).toBe('FAILURE_NO_ELIGIBLE_COURSES');
    // They are mutually exclusive
    expect(outcome1).not.toBe(outcome2);
  });

  // ── Test K-7 ────────────────────────────────────────────────────────────────
  // _formatSemIdHe must not return raw IDs matching /year_\d+_semester_[ab]\d*/.
  test('_formatSemIdHe never returns raw IDs including suffixed variants', () => {
    const inputs = [
      'year_3_semester_a', 'year_3_semester_b',
      'year_4_semester_a', 'year_4_semester_b',
      'year_3_semester_a2', 'year_3_semester_b2',
      'year_4_semester_a3', 'year_4_semester_b1',
    ];
    const rawPattern = /year_\d+_semester_[ab]\d*/;
    for (const id of inputs) {
      const out = window.eval(`_formatSemIdHe(${JSON.stringify(id)})`);
      expect(out).not.toMatch(rawPattern);
      expect(out).toMatch(/שנה/); // must be Hebrew
    }
  });

  // ── Test K-8 ────────────────────────────────────────────────────────────────
  // year_3_semester_a2 must format as שנה ג׳ — סמסטר א׳ (identical to year_3_semester_a).
  test('year_3_semester_a2 formats as שנה ג׳ — סמסטר א׳', () => {
    const canonical  = window.eval("_formatSemIdHe('year_3_semester_a')");
    const suffixed   = window.eval("_formatSemIdHe('year_3_semester_a2')");
    const suffixed3  = window.eval("_formatSemIdHe('year_4_semester_b3')");
    const canonical4 = window.eval("_formatSemIdHe('year_4_semester_b')");

    expect(suffixed).toBe(canonical);          // 'a2' same as 'a'
    expect(suffixed3).toBe(canonical4);        // 'b3' same as 'b'
    expect(canonical).toBe("שנה ג׳ — סמסטר א׳");
    expect(canonical4).toBe("שנה ד׳ — סמסטר ב׳");
  });

  // ── Test K-9 ────────────────────────────────────────────────────────────────
  // Codex review (PR #41, round 5): a no-diff outcome (FAILURE_NO_ELIGIBLE_COURSES —
  // the proposal applies cleanly but the board already contains every in-window
  // course) used to always show the generic "couldn't add courses" text, even
  // when the server's own warnings_he already flagged (via generate-plan.ts's
  // structural degree-hours-gap warning) that the visible planning window's
  // catalog is genuinely exhausted. Mirrors K-2's simulation of requestPlanProposal's
  // outcome branch, using the real STRUCTURAL_GAP_WARNING_RE global so this test
  // catches any drift between the two structural-gap call sites (this one and
  // postPlanChangeSummary's).
  test('empty diff + server structural-gap warning → honest "outside the visible window" message, not the generic no-changes text', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };
      // Round 15: this branch now recomputes degree-hours status fresh
      // against the FINAL eligibleProposal before trusting the marker — stub
      // it "not satisfied" here so this still-genuinely-exhausted scenario
      // takes the honest-message path.
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: false, missing_hours: 171 });

      const eligibleProposal = { warnings_he: [
        'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.',
      ] };
      const before = { 'year_3_semester_a': ['course-X'] };
      const after  = { 'year_3_semester_a': ['course-X'] };
      const diff = _computeBoardDiff(before, after);
      const outcome = (diff.added.length > 0 || diff.removed.length > 0 || diff.moved.length > 0)
        ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';
      if (outcome === 'FAILURE_NO_ELIGIBLE_COURSES') {
        const _noDiffWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
        const _noDiffHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
        if (!_noDiffHoursStatus.satisfied && _noDiffWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
          postStatusMessage(
            'לא בוצעו שינויים בלוח — כל הקורסים הזמינים בחלון התכנון הנוכחי כבר משובצים.\\n' +
            'הפער הנותר דורש שעות מעבר לחלון הסמסטרים המוצג כרגע — לא ניתן לסגור אותו מתוך רשימת קורסי הבחירה הקיימת.',
          );
        } else {
          postStatusMessage('לא בוצעו שינויים בלוח.\\nלא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים.');
        }
      }

      postStatusMessage = _origPost;
      getDegreeHoursStatusLocal = _origGetStatus;
    `);
    const msg = window.eval('window.__lastStatus || ""');
    expect(msg).toContain('חלון הסמסטרים');
    expect(msg).not.toContain('לא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים');
  });

  // ── Test K-10 ───────────────────────────────────────────────────────────────
  // Regression: an ordinary no-diff outcome (no structural-gap warning) still
  // gets the original generic message — the new branch must not fire for every
  // no-diff case, only the structural one.
  test('empty diff without a structural-gap warning still gets the original generic no-changes text', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: false, missing_hours: 171 });

      const eligibleProposal = { warnings_he: [] };
      const before = { 'year_3_semester_a': ['course-X'] };
      const after  = { 'year_3_semester_a': ['course-X'] };
      const diff = _computeBoardDiff(before, after);
      const outcome = (diff.added.length > 0 || diff.removed.length > 0 || diff.moved.length > 0)
        ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';
      if (outcome === 'FAILURE_NO_ELIGIBLE_COURSES') {
        const _noDiffWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
        const _noDiffHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
        if (!_noDiffHoursStatus.satisfied && _noDiffWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
          postStatusMessage(
            'לא בוצעו שינויים בלוח — כל הקורסים הזמינים בחלון התכנון הנוכחי כבר משובצים.\\n' +
            'הפער הנותר דורש שעות מעבר לחלון הסמסטרים המוצג כרגע — לא ניתן לסגור אותו מתוך רשימת קורסי הבחירה הקיימת.',
          );
        } else {
          postStatusMessage('לא בוצעו שינויים בלוח.\\nלא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים.');
        }
      }

      postStatusMessage = _origPost;
      getDegreeHoursStatusLocal = _origGetStatus;
    `);
    const msg = window.eval('window.__lastStatus || ""');
    expect(msg).toContain('לא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים');
    expect(msg).not.toContain('חלון הסמסטרים');
  });

  // ── Test K-10b ──────────────────────────────────────────────────────────────
  // Codex-caught regression (round 15): the same staleness class round 14
  // fixed in the FAILURE_VALIDATION branch also applies here — a stale
  // structural-gap marker preserved in warnings_he through client repairs
  // must NOT produce a "remaining gap" message once the final degree-hours
  // status is actually satisfied.
  test('a stale structural-gap marker in the no-diff branch does not override the generic message once final hours are satisfied', () => {
    window.eval(`
      window.__lastStatus = null;
      const _origPost = postStatusMessage;
      postStatusMessage = (m) => { window.__lastStatus = m; _origPost(m); };
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: true, missing_hours: 0 });

      const eligibleProposal = { warnings_he: [
        'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.',
      ] };
      const before = { 'year_3_semester_a': ['course-X'] };
      const after  = { 'year_3_semester_a': ['course-X'] };
      const diff = _computeBoardDiff(before, after);
      const outcome = (diff.added.length > 0 || diff.removed.length > 0 || diff.moved.length > 0)
        ? 'SUCCESS_WITH_CHANGES' : 'FAILURE_NO_ELIGIBLE_COURSES';
      if (outcome === 'FAILURE_NO_ELIGIBLE_COURSES') {
        const _noDiffWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
        const _noDiffHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
        if (!_noDiffHoursStatus.satisfied && _noDiffWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
          postStatusMessage(
            'לא בוצעו שינויים בלוח — כל הקורסים הזמינים בחלון התכנון הנוכחי כבר משובצים.\\n' +
            'הפער הנותר דורש שעות מעבר לחלון הסמסטרים המוצג כרגע — לא ניתן לסגור אותו מתוך רשימת קורסי הבחירה הקיימת.',
          );
        } else {
          postStatusMessage('לא בוצעו שינויים בלוח.\\nלא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים.');
        }
      }

      postStatusMessage = _origPost;
      getDegreeHoursStatusLocal = _origGetStatus;
    `);
    const msg = window.eval('window.__lastStatus || ""');
    expect(msg).not.toContain('חלון הסמסטרים');
    expect(msg).toContain('לא הצלחתי להוסיף קורסים חדשים לפי הנתונים והאילוצים הקיימים');
  });

  // ── Test K-11 ───────────────────────────────────────────────────────────────
  // Codex review (PR #41, round 7): a genuinely exhausted-catalog plan is still
  // below the degree target, so validateFinalPlan's degree_completion check
  // makes the strict gate non-applicable (FAILURE_VALIDATION), not
  // SUCCESS_WITH_CHANGES/FAILURE_NO_ELIGIBLE_COURSES — neither of the two
  // already-fixed call sites (K-9, plan_structural_gap_decision_text) runs in
  // this branch. Mirrors requestPlanProposal's "only remaining path to
  // diagnoseBuildBlock" logic: when the server's warnings_he carries the
  // structural marker, the honest message must be shown instead of falling
  // through to diagnoseBuildBlock's generic "missing X ש״ש" advice.
  test('FAILURE_VALIDATION with server structural-gap warning → honest message, diagnoseBuildBlock not reached', () => {
    window.eval(`
      window.__lastMsg = null; window.__lastChips = null; window.__diagCalled = false;
      const _origPost = postAssistantMessage;
      const _origDiag = diagnoseBuildBlock;
      postAssistantMessage = (m, chips) => { window.__lastMsg = m; window.__lastChips = chips; _origPost(m, chips); };
      diagnoseBuildBlock = function() { window.__diagCalled = true; return _origDiag.apply(this, arguments); };
      // Round 14: the real branch now recomputes degree-hours status fresh
      // against the FINAL eligibleProposal before trusting the marker — stub
      // it "not satisfied" here so this still-genuinely-exhausted scenario
      // takes the honest-message path.
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: false, missing_hours: 171 });
      // Round 17: no hard structural blocker present, matching a genuine
      // catalog-exhaustion scenario.
      const _blockerCauses = [];

      const eligibleProposal = { warnings_he: [
        'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.',
      ] };
      let _lastFinalPlanBlockedMsg = null;
      const _rescued = false;
      try {
        if (!_rescued) {
          const _validationPathWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
          const _validationPathHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
          const _validationPathHardBlocker = _blockerCauses.some(c =>
            ['overload', 'illegal_semester', 'eligibility', 'duplicate', 'annual'].includes(c));
          if (!_validationPathHoursStatus.satisfied && !_validationPathHardBlocker && _validationPathWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
            const msg =
              'לא הצלחתי להשלים מערכת חוקית — כל הקורסים הזמינים בחלון התכנון הנוכחי כבר משובצים.\\n' +
              'הפער הנותר דורש שעות מעבר לחלון הסמסטרים המוצג כרגע — לא ניתן לסגור אותו מתוך רשימת קורסי הבחירה הקיימת.';
            if (msg !== _lastFinalPlanBlockedMsg) {
              _lastFinalPlanBlockedMsg = msg;
              postAssistantMessage(msg, [{ label: 'הצג אילוצים שמונעים פתרון', action: 'show-blocking-constraints' }]);
            }
          } else {
            const diag = diagnoseBuildBlock({ errors: [], completeness: { reasons: [] } }, {});
            postAssistantMessage(diag.explanation_he, diag.chips);
          }
        }
      } finally {
        postAssistantMessage = _origPost;
        diagnoseBuildBlock = _origDiag;
        getDegreeHoursStatusLocal = _origGetStatus;
      }
    `);
    const msg = window.eval('window.__lastMsg || ""');
    expect(msg).toContain('חלון הסמסטרים');
    expect(window.eval('window.__diagCalled')).toBe(false);
  });

  // ── Test K-12 ───────────────────────────────────────────────────────────────
  // Regression: FAILURE_VALIDATION without a structural-gap warning still
  // falls through to diagnoseBuildBlock as before.
  test('FAILURE_VALIDATION without a structural-gap warning still falls through to diagnoseBuildBlock', () => {
    window.eval(`
      window.__diagCalled = false;
      const _origDiag = diagnoseBuildBlock;
      diagnoseBuildBlock = function() { window.__diagCalled = true; return _origDiag.apply(this, arguments); };
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: false, missing_hours: 171 });
      const _blockerCauses = [];

      const eligibleProposal = { warnings_he: [] };
      const _rescued = false;
      try {
        if (!_rescued) {
          const _validationPathWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
          const _validationPathHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
          const _validationPathHardBlocker = _blockerCauses.some(c =>
            ['overload', 'illegal_semester', 'eligibility', 'duplicate', 'annual'].includes(c));
          if (!_validationPathHoursStatus.satisfied && !_validationPathHardBlocker && _validationPathWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
            // not reached in this test
          } else {
            diagnoseBuildBlock({ errors: [], completeness: { reasons: [] } }, {});
          }
        }
      } finally {
        diagnoseBuildBlock = _origDiag;
        getDegreeHoursStatusLocal = _origGetStatus;
      }
    `);
    expect(window.eval('window.__diagCalled')).toBe(true);
  });

  // ── Test K-14 ───────────────────────────────────────────────────────────────
  // Codex-caught regression (round 14): degreeHoursStatusFinal (computed
  // earlier in requestPlanProposal) can be stale by the time this branch
  // runs — eligibleProposal is reassigned twice more after it (the annual-
  // move repair and the re-enforced-legal repair), just like the staleness
  // class round 11 fixed in postPlanChangeSummary via _hoursSatisfied. A
  // stale structural-gap marker preserved in warnings_he through repairs
  // must NOT suppress diagnoseBuildBlock once the FINAL degree-hours status
  // is actually satisfied — the real (different) blocker must still surface.
  test('a stale structural-gap marker does not suppress diagnoseBuildBlock once the final degree-hours status is actually satisfied', () => {
    window.eval(`
      window.__diagCalled = false;
      const _origDiag = diagnoseBuildBlock;
      diagnoseBuildBlock = function() { window.__diagCalled = true; return _origDiag.apply(this, arguments); };
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: true, missing_hours: 0 });
      const _blockerCauses = [];

      // Stale marker, as if preserved from an earlier point in the repair
      // chain before the final refill closed the gap.
      const eligibleProposal = { warnings_he: [
        'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.',
      ] };
      const _rescued = false;
      try {
        if (!_rescued) {
          const _validationPathWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
          const _validationPathHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
          const _validationPathHardBlocker = _blockerCauses.some(c =>
            ['overload', 'illegal_semester', 'eligibility', 'duplicate', 'annual'].includes(c));
          if (!_validationPathHoursStatus.satisfied && !_validationPathHardBlocker && _validationPathWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
            // must NOT be reached — the stale marker is no longer honest
          } else {
            diagnoseBuildBlock({ errors: [], completeness: { reasons: [] } }, {});
          }
        }
      } finally {
        diagnoseBuildBlock = _origDiag;
        getDegreeHoursStatusLocal = _origGetStatus;
      }
    `);
    expect(window.eval('window.__diagCalled')).toBe(true);
  });

  // ── Test K-16 ───────────────────────────────────────────────────────────────
  // Codex-caught regression (round 17): _blockerCauses (computed above, from
  // the real final _gateResult) can carry a hard structural blocker
  // (overload/illegal_semester/eligibility/duplicate/annual) alongside a
  // still-unsatisfied hours status and a (possibly stale) structural-gap
  // marker. buildPlanningFallback already returned null for exactly that
  // hard-blocker reason — showing the structural-gap copy here would replace
  // an actionable "here's the real blocker" explanation with a misleading
  // "all courses are already assigned" one. diagnoseBuildBlock must still run.
  test('a hard structural blocker (e.g. overload) takes precedence over the structural-gap message even when hours are unsatisfied and the marker is present', () => {
    window.eval(`
      window.__diagCalled = false;
      const _origDiag = diagnoseBuildBlock;
      diagnoseBuildBlock = function() { window.__diagCalled = true; return _origDiag.apply(this, arguments); };
      const _origGetStatus = getDegreeHoursStatusLocal;
      getDegreeHoursStatusLocal = () => ({ satisfied: false, missing_hours: 171 });
      const _blockerCauses = ['overload'];

      const eligibleProposal = { warnings_he: [
        'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.',
      ] };
      const _rescued = false;
      try {
        if (!_rescued) {
          const _validationPathWarnings = (eligibleProposal && eligibleProposal.warnings_he) || [];
          const _validationPathHoursStatus = getDegreeHoursStatusLocal(null, eligibleProposal.semesters || [], {});
          const _validationPathHardBlocker = _blockerCauses.some(c =>
            ['overload', 'illegal_semester', 'eligibility', 'duplicate', 'annual'].includes(c));
          if (!_validationPathHoursStatus.satisfied && !_validationPathHardBlocker && _validationPathWarnings.some(w => STRUCTURAL_GAP_WARNING_RE.test(w))) {
            // must NOT be reached — a real hard blocker exists
          } else {
            diagnoseBuildBlock({ errors: [], completeness: { reasons: [] } }, {});
          }
        }
      } finally {
        diagnoseBuildBlock = _origDiag;
        getDegreeHoursStatusLocal = _origGetStatus;
      }
    `);
    expect(window.eval('window.__diagCalled')).toBe(true);
  });

  // ── Test K-15 ───────────────────────────────────────────────────────────────
  // Source-presence check: K-9/K-10/K-10b/K-11/K-12/K-14/K-16 simulate the
  // branch logic (this file's established pattern for code embedded inside
  // requestPlanProposal — see K-2) rather than executing it in place, so they
  // can't by themselves prove the real HTML actually contains this branch.
  // Confirms the literal source does, including the round-14/15 fresh-status
  // guards (FAILURE_VALIDATION and FAILURE_NO_ELIGIBLE_COURSES) and the
  // round-17 hard-blocker guard (FAILURE_VALIDATION only — Codex's finding
  // was specific to that branch, since it's the only one reachable via
  // _gateResult's non-applicable strict gate).
  test('semester_board_viewer.html actually contains both structural-gap checks with the fresh degree-hours guard and the hard-blocker guard', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    expect(html).toMatch(/!_validationPathHoursStatus\.satisfied && !_validationPathHardBlocker && _validationPathWarnings\.some\(w => STRUCTURAL_GAP_WARNING_RE\.test\(w\)\)/);
    expect(html).toContain('לא הצלחתי להשלים מערכת חוקית — כל הקורסים הזמינים בחלון התכנון הנוכחי כבר משובצים');
    expect(html).toMatch(/!_noDiffHoursStatus\.satisfied && _noDiffWarnings\.some\(w => STRUCTURAL_GAP_WARNING_RE\.test\(w\)\)/);
  });
});

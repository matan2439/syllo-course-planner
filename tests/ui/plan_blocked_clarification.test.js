/**
 * Blocked-build clarification — when a plan build cannot produce a LEGAL /
 * complete proposal, the assistant turns the failure into an interactive
 * clarification step: explanation + targeted Hebrew questions + actionable
 * relax/clarify chips. Apply stays disabled. Relax chips adjust prefs and
 * rebuild ONLY via the explicit build entry (שלח-never-builds preserved).
 *
 * Uses the same jsdom harness as plan_chat_no_autobuild.test.js.
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

describe('diagnoseBuildBlock — pure categorization', () => {
  let dom, window;
  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });
  afterEach(() => { dom.window.close(); });

  function diagnose(validation, opts) {
    window.__v = validation;
    window.__o = opts || {};
    return window.eval('diagnoseBuildBlock(window.__v, window.__o)');
  }

  test('overload error → category "overload", 26 ש"ש question, relax-overload-26 chip', () => {
    const d = diagnose({
      errors: ['בסמסטר א\' יש 32 שעות שבועיות — חריגה מהמגבלה הקשיחה (30 ש"ש). נדרש אישור חריגה מפורש.'],
      overloadBlocked: true,
      completeness: { incomplete: true, reasons: [] },
    });
    expect(d.category).toBe('overload');
    expect(d.questions.join(' ')).toMatch(/26/);
    expect(d.questions.join(' ')).toMatch(/ש"ש/);
    expect(d.chips.some(c => c.action === 'relax-overload-26')).toBe(true);
    expect(d.chips.some(c => c.action === 'rebuild-relaxed')).toBe(true);
  });

  test('no-candidate-in-category + avoid prefs → "electives_after_avoid" with relax-avoid chip', () => {
    const d = diagnose(
      { errors: [], overloadBlocked: false, completeness: { incomplete: true, reasons: ['אין קורס מועמד זמין בקטגוריה "בחירה הנדסית".'] } },
      { pickerState: { strongUnwanted: ['0540'], unwanted: ['0540'] }, parsedTerms: { interest_terms: [], grade_target: null } }
    );
    expect(d.category).toBe('electives_after_avoid');
    expect(d.chips.some(c => c.action === 'relax-avoid-soft')).toBe(true);
  });

  test('grade target + shortfall → "grade_target" with keep/relax chips', () => {
    const d = diagnose(
      { errors: [], overloadBlocked: false, completeness: { incomplete: true, reasons: ['חסרים 2 קורסים מקטגוריית "בחירה".'] } },
      { pickerState: {}, parsedTerms: { interest_terms: [], grade_target: 85 } }
    );
    expect(d.category).toBe('grade_target');
    expect(d.chips.some(c => c.action === 'keep-grade')).toBe(true);
    expect(d.chips.some(c => c.action === 'relax-grade')).toBe(true);
    expect(d.questions.join(' ')).toMatch(/85/);
  });

  test('unknown reason → fallback with rebuild-relaxed chip only', () => {
    const d = diagnose(
      { errors: ['משהו לא צפוי קרה.'], overloadBlocked: false, completeness: { incomplete: true, reasons: [] } },
      { pickerState: {}, parsedTerms: { interest_terms: [], grade_target: null } }
    );
    expect(d.category).toBe('unknown');
    expect(d.chips.some(c => c.action === 'rebuild-relaxed')).toBe(true);
  });

  test('multiple interest topics + category shortfall → prioritize-topic chip derived from parsed terms', () => {
    const d = diagnose(
      { errors: [], overloadBlocked: false, completeness: { incomplete: true, reasons: ['חסרים 2 קורסים מקטגוריית "בחירה".'] } },
      { pickerState: {}, parsedTerms: { interest_terms: ['חוזק', 'ויברציות', 'זרימה'], grade_target: null } }
    );
    expect(d.category).toBe('category_requirements');
    const prio = d.chips.find(c => c.action === 'prioritize-topic');
    expect(prio).toBeTruthy();
    expect(prio.payload.terms).toContain('חוזק');
    // Derived from user's OWN parsed terms, not hardcoded.
    expect(d.questions.join(' ')).toMatch(/חוזק/);
  });
});

describe('blocked-build messaging + relax chip rebuild', () => {
  let dom, window, document;
  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
    window.setSidebarTab('ai');
  });
  afterEach(() => { dom.window.close(); });

  test('blocked outcome posts explanation + targeted question + chips; Apply stays disabled', () => {
    // Simulate a blocked build outcome: set validation + a draft, then drive
    // the post-build messaging path directly (the .then body of runBuildFromScratch).
    window.eval(`
      _aiPlanLastValidation = {
        errors: ['בסמסטר א\\' יש 32 ש"ש — חריגה מהמגבלה הקשיחה (30 ש"ש). נדרש אישור חריגה מפורש.'],
        warnings: [], overloadBlocked: true, blocked: true,
        completeness: { incomplete: true, reasons: [] },
      };
      const v = _aiPlanLastValidation;
      const diag = diagnoseBuildBlock(v);
      const lines = [diag.explanation_he, ...diag.questions].filter(Boolean);
      postAssistantMessage(lines.join('\\n'), diag.chips);
    `);
    const logEl = document.getElementById('ai-chat-log');
    const bubbles = Array.from(logEl.querySelectorAll('.ai-chat-bubble.assistant')).map(b => b.textContent);
    expect(bubbles.some(t => /חריג|עומס/.test(t))).toBe(true);
    expect(bubbles.some(t => /26/.test(t))).toBe(true);
    const chips = Array.from(logEl.querySelectorAll('.ai-quick-reply, button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('עומס עד 26'))).toBe(true);

    // Apply gating: a blocked plan is NOT applyable.
    const applyable = window.eval('isPlanApplyableLocal(_aiPlanLastValidation.errors, _aiPlanLastValidation.completeness)');
    expect(applyable).toBe(false);
  });

  test("'relax-overload-26' sets prefs and triggers explicit build path (not a chat-send build)", () => {
    // Spy on the explicit build entry (button click) and on the chat-send path.
    window.eval(`
      window.__buildClicks = 0;
      const __btn = document.getElementById('sidebar-build-from-scratch');
      __btn.addEventListener('click', () => { window.__buildClicks++; }, true);
      window.__chatSendCalls = 0;
      handleSidebarChatSend = function(){ window.__chatSendCalls++; };
      _aiPlanLastPreferences = { extra_request_he: 'בחירה', action_type: 'full_plan' };
    `);

    window.eval(`handleQuickReply({ label: 'אפשר עומס עד 26 ש"ש', action: 'relax-overload-26' })`);

    expect(window.eval('_aiPlanLastPreferences.max_weekly_hours')).toBe(26);
    expect(window.eval('_aiPlanLastPreferences.overload_accepted')).toBe(true);
    expect(window.eval('typeof _aiPlanLastPreferences.overload_confirmed_at === "number"')).toBe(true);
    // Explicit build entry invoked …
    expect(window.eval('window.__buildClicks')).toBeGreaterThanOrEqual(1);
    // … and NOT a silent chat-send build.
    expect(window.eval('window.__chatSendCalls')).toBe(0);
  });

  test("'relax-avoid-soft' downgrades strong avoids to soft then rebuilds via explicit entry", () => {
    window.eval(`
      window.__buildClicks = 0;
      document.getElementById('sidebar-build-from-scratch').addEventListener('click', () => { window.__buildClicks++; }, true);
      _aiPickerState = { wanted: [], unwanted: ['0540','0660'], strongUnwanted: ['0540'], _initialized: true };
    `);
    window.eval(`handleQuickReply({ label: 'אפשר בחירה פחות קשורה', action: 'relax-avoid-soft' })`);
    expect(window.eval('JSON.stringify(_aiPickerState.strongUnwanted)')).toBe('[]');
    expect(window.eval('_aiPickerState.softUnwanted.indexOf("0540") >= 0')).toBe(true);
    expect(window.eval('window.__buildClicks')).toBeGreaterThanOrEqual(1);
  });

  test("'relax-grade' strips grade phrase from extra_request_he then rebuilds", () => {
    window.eval(`
      window.__buildClicks = 0;
      document.getElementById('sidebar-build-from-scratch').addEventListener('click', () => { window.__buildClicks++; }, true);
      _aiPlanLastPreferences = { extra_request_he: 'אני רוצה חוזק, ממוצע מעל 85', action_type: 'full_plan' };
    `);
    window.eval(`handleQuickReply({ label: 'רכך יעד ממוצע', action: 'relax-grade' })`);
    expect(window.eval('_aiPlanLastPreferences.extra_request_he')).not.toMatch(/ממוצע\s*85|85/);
    expect(window.eval('_aiPlanLastPreferences.relax_grade_target')).toBe(true);
    expect(window.eval('window.__buildClicks')).toBeGreaterThanOrEqual(1);
  });
});

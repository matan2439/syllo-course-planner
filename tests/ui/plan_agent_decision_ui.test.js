/**
 * plan_agent_decision_ui.test.js
 *
 * Agent-Runtime UI wiring slice — wires the legacy planner's AI/interest flow
 * to the opt-in Academic Decision Agent runtime (use_academic_decision_agent)
 * and renders the returned academicDecision as a Hebrew RTL advisor section.
 *
 * Two pure, hoisted helpers carry the testable logic (mirroring the
 * interest-evaluation slice), so they run without the ~20s board init:
 *   - buildAgentPlanRequestFields(interests) → the additive generate-plan body
 *     fragment. {} when the user expressed nothing (default request unchanged);
 *     otherwise the existing interest fields PLUS use_academic_decision_agent:true.
 *   - academicDecisionHtml(academicDecision) → the Hebrew RTL "החלטת הסוכן
 *     האקדמי" section (explanation lists, clarification questions, compact
 *     validation), or '' when absent. Dynamic text is escaped; nothing invented.
 *
 * Board-independent loader: the pure helpers need no board state, so the board
 * fetch is stubbed with {} (this worktree does not carry the gitignored prod
 * board fixture the fuller planner suites read).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function loadPlannerGlobals() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const vc = new VirtualConsole();
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert = () => {};
  // Board-independent: pure helpers under test need no board data.
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window };
}

function ev(window, expr) {
  return JSON.parse(window.eval(`JSON.stringify(${expr})`));
}

let dom, window;
beforeAll(() => { ({ dom, window } = loadPlannerGlobals()); });
afterAll(() => { try { dom.window.close(); } catch (_) {} });

// ─────────────────────────────────────────────────────────────────────────────
// Request wiring — buildAgentPlanRequestFields
// ─────────────────────────────────────────────────────────────────────────────
describe('buildAgentPlanRequestFields — additive generate-plan body fragment', () => {
  test('1. no selections → empty fragment, no agent flag (default request unchanged)', () => {
    const r = ev(window, `buildAgentPlanRequestFields({ focusAreas:[], avoidAreas:[], courseStyles:[], priorities:[], careerGoals:'' })`);
    expect(r).toEqual({});
  });

  test('2. interest selection still opts into include_interest_evaluation', () => {
    const r = ev(window, `buildAgentPlanRequestFields({ focusAreas:['finite_elements'] })`);
    expect(r.include_interest_evaluation).toBe(true);
  });

  test('3. interest/AI flow adds use_academic_decision_agent:true', () => {
    const r = ev(window, `buildAgentPlanRequestFields({ focusAreas:['finite_elements'] })`);
    expect(r.use_academic_decision_agent).toBe(true);
  });

  test('4. preserves academic_interest_profile stable IDs', () => {
    const r = ev(window, `buildAgentPlanRequestFields({ focusAreas:['finite_elements','mechanical_design'], avoidAreas:['biomechanics'] })`);
    expect(r.academic_interest_profile.focusAreas).toEqual([{ area: 'finite_elements' }, { area: 'mechanical_design' }]);
    expect(r.academic_interest_profile.avoidAreas).toEqual([{ area: 'biomechanics' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendering — academicDecisionHtml
// ─────────────────────────────────────────────────────────────────────────────
const FULL_DECISION = {
  clarification: { needsClarification: false, missingInputs: [], questions: [] },
  validation: { valid: true, errors: [], warnings_he: [], requirementsSatisfied: true },
  evaluation: { requirementCoverage: [], workloadNotes: [], missingDataNotes: [] },
  decision: { selectedPlan: 'generated', rationale: 'נבחרה התוכנית היחידה שנוצרה.', tradeoffs: [] },
  explanation: {
    mainRecommendation: 'נבחרה תוכנית עם 8 קורסים על פני 4 סמסטרים.',
    whyThisPlan: ['התוכנית מכסה את כל דרישות החובה שנבדקו.', 'התוכנית עברה את בדיקות החוקיות והעומס.'],
    risksAndTradeoffs: ['עומס שיא בתוכנית: 22 ש"ש בסמסטר.'],
    missingData: ['לא סופק פרופיל תחומי עניין — לא בוצעה הערכת התאמה.'],
    suggestedNextActions: ['ספק/י את רשימת הקורסים שכבר השלמת כדי לחדד את בדיקת הקדם-דרישות.'],
  },
};

function html(decision) {
  return window.eval(`academicDecisionHtml(${JSON.stringify(decision)})`);
}

describe('academicDecisionHtml — Hebrew RTL academic-agent section', () => {
  test('11. renders nothing when academicDecision is absent (old rendering unaffected)', () => {
    expect(window.eval(`academicDecisionHtml(null)`)).toBe('');
    expect(window.eval(`academicDecisionHtml(undefined)`)).toBe('');
  });

  test('has the Hebrew section title', () => {
    expect(html(FULL_DECISION)).toContain('החלטת הסוכן האקדמי');
  });

  test('5. mainRecommendation renders in the advisor section', () => {
    expect(html(FULL_DECISION)).toContain('נבחרה תוכנית עם 8 קורסים על פני 4 סמסטרים.');
  });

  test('6. whyThisPlan renders as a list', () => {
    const out = html(FULL_DECISION);
    expect(out).toContain('למה התוכנית הזו');
    expect(out).toContain('<li>התוכנית מכסה את כל דרישות החובה שנבדקו.</li>');
    expect(out).toContain('<li>התוכנית עברה את בדיקות החוקיות והעומס.</li>');
  });

  test('7. risksAndTradeoffs renders as a list', () => {
    const out = html(FULL_DECISION);
    expect(out).toContain('סיכונים ופשרות');
    // ש"ש contains a double-quote → esc() renders it as &quot; (see escaping test),
    // so assert the quote-free portion of the risk line.
    expect(out).toContain('עומס שיא בתוכנית: 22');
  });

  test('8. missingData renders as a list', () => {
    const out = html(FULL_DECISION);
    expect(out).toContain('מידע חסר');
    expect(out).toContain('לא סופק פרופיל תחומי עניין — לא בוצעה הערכת התאמה.');
  });

  test('9. suggestedNextActions renders as a list', () => {
    const out = html(FULL_DECISION);
    expect(out).toContain('צעדים מומלצים להמשך');
    expect(out).toContain('ספק/י את רשימת הקורסים שכבר השלמת כדי לחדד את בדיקת הקדם-דרישות.');
  });

  test('5b. validation status renders compactly (non-scary) when valid', () => {
    expect(html(FULL_DECISION)).toContain('התוכנית עברה בדיקת חוקיות');
  });

  test('validation status when the plan needs adjustment', () => {
    const blocked = JSON.parse(JSON.stringify(FULL_DECISION));
    blocked.validation.valid = false;
    blocked.validation.requirementsSatisfied = false;
    expect(html(blocked)).toContain('התוכנית דורשת התאמות לפני החלה');
  });

  test('10. clarification questions render when needsClarification is true', () => {
    const clar = {
      clarification: {
        needsClarification: true,
        missingInputs: [{ field: 'completedCourses', critical: true, message: 'x' }],
        questions: [
          { id: 'completed_courses', inputKey: 'completedCourseIds', required: true, critical: true, answerType: 'course_id_list', question: 'Which courses have you already completed?' },
        ],
      },
      explanation: {
        mainRecommendation: 'דרוש מידע נוסף לפני בניית תוכנית.',
        whyThisPlan: [],
        risksAndTradeoffs: [],
        missingData: ['חסר מידע: קורסים שהושלמו.'],
        suggestedNextActions: ['נא לספק: קורסים שהושלמו.'],
      },
    };
    const out = html(clar);
    expect(out).toContain('שאלות הבהרה');
    expect(out).toContain('Which courses have you already completed?');
    expect(out).toContain('דרוש מידע נוסף לפני בניית תוכנית.');
  });

  test('13. dynamic explanation text is HTML-escaped, not injected', () => {
    const evil = JSON.parse(JSON.stringify(FULL_DECISION));
    evil.explanation.mainRecommendation = '<img src=x onerror=alert(1)> נסה שוב';
    const out = html(evil);
    expect(out).toContain('נסה שוב');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  test('empty explanation lists are omitted (no empty headings), no crash', () => {
    const minimal = { explanation: { mainRecommendation: 'רק המלצה.', whyThisPlan: [], risksAndTradeoffs: [], missingData: [], suggestedNextActions: [] } };
    const out = window.eval(`academicDecisionHtml(${JSON.stringify(minimal)})`);
    expect(typeof out).toBe('string');
    expect(out).toContain('רק המלצה.');
    expect(out).not.toContain('למה התוכנית הזו');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Render safety — renderAcademicDecision must not crash without its container
// ─────────────────────────────────────────────────────────────────────────────
describe('renderAcademicDecision — container guard', () => {
  test('does not throw when the panel container is absent', () => {
    const r = window.eval(`(function(){
      try {
        var el = document.getElementById('ai-academic-decision');
        if (el) el.remove();
        _aiPlanLastAcademicDecision = ${JSON.stringify(FULL_DECISION)};
        renderAcademicDecision();
        return 'ok';
      } catch (e) { return 'threw: ' + e.message; }
    })()`);
    expect(r).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level wiring guard — the fetch request routes through the agent helper
// ─────────────────────────────────────────────────────────────────────────────
describe('request wiring is routed through buildAgentPlanRequestFields', () => {
  test('the generate-plan fetch spreads buildAgentPlanRequestFields', () => {
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    // The interest-only helper must no longer be the request spread (agent helper wraps it).
    expect(src).toContain('...buildAgentPlanRequestFields(_aiPickerState.interests)');
  });
});

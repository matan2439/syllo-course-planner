/**
 * plan_interest_evaluation_ui.test.js
 *
 * Interest-Evaluation UI slice — the opt-in academic-interest layer wired into
 * the legacy planner's AI panel (app/web/semester_board_viewer.html).
 *
 * Two pure, hoisted helpers carry the testable logic so they can be exercised
 * without the ~20s board init the fuller planner suites require:
 *   - buildInterestRequestFields(interests) → the additive generate-plan body
 *     fragment ({} when the user expressed nothing meaningful; otherwise
 *     include_interest_evaluation:true + a machine-readable academic_interest_
 *     profile using the backend's stable enum IDs).
 *   - interestScorecardHtml(evaluation, labelFor) → the Hebrew RTL scorecard
 *     for a generate-plan response's additive `interestEvaluation`, or '' when
 *     absent. courseId stays LTR; names are optional via labelFor.
 *
 * These lock the request/response contract against the verified backend shape
 * (academic_interest_profile.focusAreas:[{area}], response.interestEvaluation.
 * scorecard.{summaryLevel,matchedFocusAreas,...}). Planner scoring is untouched.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

// Load the inline planner script into a JSDOM global so the hoisted pure
// helpers are reachable via window.eval. We deliberately do NOT wait for board
// init — the helpers under test are pure and depend on no board state.
function loadPlannerGlobals() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert = () => {};
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window };
}

// Evaluate an expression in the planner's global scope, JSON round-tripped.
function ev(window, expr) {
  return JSON.parse(window.eval(`JSON.stringify(${expr})`));
}

let dom, window;
beforeAll(() => { ({ dom, window } = loadPlannerGlobals()); });
afterAll(() => { try { dom.window.close(); } catch (_) {} });

// ─────────────────────────────────────────────────────────────────────────────
// Request wiring — buildInterestRequestFields
// ─────────────────────────────────────────────────────────────────────────────
describe('buildInterestRequestFields — additive generate-plan body fragment', () => {
  test('1. no selections → empty fragment (backward compatible)', () => {
    const r = ev(window, `buildInterestRequestFields({ focusAreas:[], avoidAreas:[], courseStyles:[], priorities:[], careerGoals:'' })`);
    expect(r).toEqual({});
  });

  test('2. a focus area selected → include_interest_evaluation:true', () => {
    const r = ev(window, `buildInterestRequestFields({ focusAreas:['finite_elements'] })`);
    expect(r.include_interest_evaluation).toBe(true);
  });

  test('3. focusAreas sent as stable-ID objects', () => {
    const r = ev(window, `buildInterestRequestFields({ focusAreas:['finite_elements','mechanical_design'] })`);
    expect(r.academic_interest_profile.focusAreas).toEqual([
      { area: 'finite_elements' },
      { area: 'mechanical_design' },
    ]);
  });

  test('4. avoidAreas sent as academic_interest_profile.avoidAreas', () => {
    const r = ev(window, `buildInterestRequestFields({ avoidAreas:['biomechanics'] })`);
    expect(r.academic_interest_profile.avoidAreas).toEqual([{ area: 'biomechanics' }]);
  });

  test('5. course styles sent as courseStylePreferences', () => {
    const r = ev(window, `buildInterestRequestFields({ courseStyles:['project_based','math_heavy'] })`);
    expect(r.academic_interest_profile.courseStylePreferences).toEqual([
      { style: 'project_based' },
      { style: 'math_heavy' },
    ]);
  });

  test('6. optimization priorities sent as optimizationPriorities', () => {
    const r = ev(window, `buildInterestRequestFields({ priorities:['low_peak_load'] })`);
    expect(r.academic_interest_profile.optimizationPriorities).toEqual([{ priority: 'low_peak_load' }]);
  });

  test('7. career goals text is trimmed and sent as a string array', () => {
    const r = ev(window, `buildInterestRequestFields({ careerGoals:'   מהנדס תרמי בתעשייה   ' })`);
    expect(r.include_interest_evaluation).toBe(true);
    expect(r.academic_interest_profile.careerGoals).toEqual(['מהנדס תרמי בתעשייה']);
  });

  test('8. whitespace-only / unknown selections do not send misleading profile data', () => {
    const r = ev(window, `buildInterestRequestFields({ focusAreas:['not_a_real_area'], careerGoals:'   ' })`);
    expect(r).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response rendering — interestScorecardHtml
// ─────────────────────────────────────────────────────────────────────────────
const FULL_EVAL = {
  hasMeaningfulAcademicInterests: true,
  evaluatedCourseIds: ['0542-4223', '0542-1820'],
  unmatchedCourseIds: ['0000-0000'],
  notes: ['הערכה מבוססת על נושאי הקורסים שזוהו בתוכנית.'],
  scorecard: {
    interestAlignmentScore: 0.72,
    summaryLevel: 'high',
    topAlignedCourses: [
      { courseId: '0542-4223', interestFitScore: 0.9, focusMatchScore: 0.9, styleMatchScore: 0.5, avoidPenalty: 0 },
    ],
    avoidRiskCourses: [
      { courseId: '0542-1820', interestFitScore: -0.3, focusMatchScore: 0, styleMatchScore: 0, avoidPenalty: 0.4 },
    ],
    matchedFocusAreas: [
      { area: 'finite_elements', contribution: 0.8, courseIds: ['0542-4223'] },
    ],
    matchedStyles: [
      { style: 'project_based', contribution: 0.5, courseIds: ['0542-4223'] },
    ],
    unmatchedCourseIds: ['0000-0000'],
    notes: ['שני קורסים תרמו להתאמה גבוהה.'],
  },
};

function html(evalObj, labelExpr) {
  const arg = JSON.stringify(evalObj);
  const label = labelExpr || 'undefined';
  return window.eval(`interestScorecardHtml(${arg}, ${label})`);
}

describe('interestScorecardHtml — Hebrew RTL scorecard for interestEvaluation', () => {
  test('9. renders nothing when evaluation is absent', () => {
    expect(window.eval(`interestScorecardHtml(null)`)).toBe('');
    expect(window.eval(`interestScorecardHtml(undefined)`)).toBe('');
  });

  test('10. summary level renders in Hebrew', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('התאמה גבוהה');
  });

  test('11. matched focus areas render (Hebrew label)', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('אלמנטים סופיים / FEA');
  });

  test('12. matched course styles render (Hebrew label)', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('מבוסס פרויקט');
  });

  test('13. top aligned courses render with LTR courseId', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('0542-4223');
  });

  test('14. avoid-risk courses render', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('0542-1820');
    // Hebrew section heading for avoid-risk courses
    expect(out).toContain('להימנע');
  });

  test('15. unmatched / needs-review course ids surface a note', () => {
    const out = html(FULL_EVAL);
    expect(out).toContain('0000-0000');
  });

  test('16. notes render (and are HTML-escaped, not injected)', () => {
    const evil = JSON.parse(JSON.stringify(FULL_EVAL));
    evil.scorecard.notes = ['<img src=x onerror=alert(1)> נסה שוב'];
    const out = html(evil);
    expect(out).toContain('נסה שוב');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  test('17. missing optional scorecard fields do not crash (empty arrays/undefined)', () => {
    const minimal = { scorecard: { summaryLevel: 'low' } };
    const out = window.eval(`interestScorecardHtml(${JSON.stringify(minimal)})`);
    expect(typeof out).toBe('string');
    expect(out).toContain('התאמה נמוכה');
  });

  test('18. course names are shown when a labelFor is provided, courseId preserved', () => {
    const out = html(FULL_EVAL, `(function(cid){ return cid==='0542-4223' ? 'מבוא לאלמנטים סופיים' : cid; })`);
    expect(out).toContain('מבוא לאלמנטים סופיים');
    expect(out).toContain('0542-4223');
  });

  test('honest low-confidence messaging when nothing meaningful matched', () => {
    const lowConf = {
      hasMeaningfulAcademicInterests: true,
      evaluatedCourseIds: [],
      unmatchedCourseIds: ['0542-4223'],
      notes: [],
      scorecard: {
        interestAlignmentScore: 0,
        summaryLevel: 'none',
        topAlignedCourses: [],
        avoidRiskCourses: [],
        matchedFocusAreas: [],
        matchedStyles: [],
        unmatchedCourseIds: ['0542-4223'],
        notes: [],
      },
    };
    const out = window.eval(`interestScorecardHtml(${JSON.stringify(lowConf)})`);
    expect(typeof out).toBe('string');
    // Does not fabricate a high-confidence explanation.
    expect(out).not.toContain('התאמה גבוהה');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real panel wiring — renderAiTab chips → _aiPickerState.interests → request,
// and renderInterestScorecard → the panel container. Uses the full board-init
// harness the other planner suites use.
// ─────────────────────────────────────────────────────────────────────────────
function createInitedPage() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  h = h.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  const d = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window: w } = d;
  w.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  w.confirm = () => false;
  w.alert = () => {};
  w.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = w.document.createElement('script');
  s.textContent = src;
  w.document.body.appendChild(s);
  return { dom: d, window: w };
}

function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe('panel wiring — interest chips and scorecard container', () => {
  let d2, w2;
  beforeAll(async () => { ({ dom: d2, window: w2 } = createInitedPage()); await waitForInit(w2); });
  afterAll(() => { try { d2.window.close(); } catch (_) {} });

  test('fresh panel sends no interest fields (default request unchanged)', () => {
    const r = JSON.parse(w2.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      renderAiTab();
      return JSON.stringify(buildInterestRequestFields(_aiPickerState.interests));
    })()`));
    expect(r).toEqual({});
  });

  test('clicking a focus chip opts in with a stable-ID profile', () => {
    const r = JSON.parse(w2.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      renderAiTab();
      const chip = document.querySelector('#ai-interest-focus .interest-chip[data-interest-id="finite_elements"]');
      chip.click();
      return JSON.stringify({
        pressed: chip.getAttribute('aria-pressed'),
        onClass: chip.classList.contains('is-on'),
        fields: buildInterestRequestFields(_aiPickerState.interests),
      });
    })()`));
    expect(r.pressed).toBe('true');
    expect(r.onClass).toBe(true);
    expect(r.fields.include_interest_evaluation).toBe(true);
    expect(r.fields.academic_interest_profile.focusAreas).toEqual([{ area: 'finite_elements' }]);
  });

  test('toggling the same chip off clears the opt-in', () => {
    const r = JSON.parse(w2.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      renderAiTab();
      const chip = document.querySelector('#ai-interest-focus .interest-chip[data-interest-id="robotics"]');
      chip.click(); chip.click();
      return JSON.stringify(buildInterestRequestFields(_aiPickerState.interests));
    })()`));
    expect(r).toEqual({});
  });

  test('renderInterestScorecard fills the container when an evaluation is captured', () => {
    const evalArg = JSON.stringify(FULL_EVAL);
    const r = JSON.parse(w2.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      renderAiTab();
      _aiPlanLastInterestEvaluation = ${evalArg};
      renderInterestScorecard();
      const el = document.getElementById('ai-interest-scorecard');
      return JSON.stringify({ hidden: el.hidden, html: el.innerHTML });
    })()`));
    expect(r.hidden).toBe(false);
    expect(r.html).toContain('התאמה לתחומי העניין');
    expect(r.html).toContain('אלמנטים סופיים / FEA');
  });

  test('scorecard container stays empty/hidden with no evaluation', () => {
    const r = JSON.parse(w2.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      _aiPlanLastInterestEvaluation = null;
      renderAiTab();
      const el = document.getElementById('ai-interest-scorecard');
      return JSON.stringify({ hidden: el.hidden, html: el.innerHTML });
    })()`));
    expect(r.hidden).toBe(true);
    expect(r.html).toBe('');
  });
});

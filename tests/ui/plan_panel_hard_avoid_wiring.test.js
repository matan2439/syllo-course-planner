/**
 * plan_panel_hard_avoid_wiring.test.js
 *
 * THE blind spot of the previous Planner Reliability Sprint: every hard-avoid
 * test injected `strongly_avoided_course_ids` directly into prefs (or pre-set
 * `_aiPickerState.strongUnwanted`), so they exercised the planner with the
 * hard-exclude ALREADY populated. None of them exercised the actual UI wiring
 * — the right-side "קורסים שאני רוצה להימנע מהם" picker chip. That chip's click
 * handler (setupCoursePicker) only pushes the id into `_aiPickerState.unwanted`
 * (a SOFT scoring signal); `strongUnwanted` (the hard-exclude source read by
 * sidebarQuickActionPrefs → strongly_avoided_course_ids) stayed empty unless the
 * user took a SECOND, non-obvious action (clicking the chip to toggle 🚫).
 *
 * Result in production: a course the user explicitly red-chip-avoided was only a
 * soft penalty, so an LLM proposal that placed it survived, and the summary even
 * reported it as "✓ … שובצו …". This suite drives the REAL picker DOM and the
 * REAL sidebarQuickActionPrefs/rebuild path, so the regression cannot return.
 *
 * Also locks the workload-cap summary-integrity invariant: a plan that exceeds
 * the user's selected max weekly load must never be presented as a clean full
 * success, and must explain whether fixed-mandatory or movable courses drive it.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const THERMO     = '0542-4120'; // תרמודינמיקה (2) — elective, the reported avoid course
const VIBRATIONS = '0542-4220'; // תורת התנודות — a wanted course
const FEM        = '0542-4223'; // מבוא לאלמנטים סופיים — a wanted course

function createPage() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  try { vc.forwardTo(console); } catch (_) {}

  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert  = () => {};
  window.fetch  = (url) => {
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

function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval(
          'typeof state!=="undefined"&&!!state&&!!state.semesters' +
          '&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0',
        )) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — the real picker chip wiring: an avoid chip IS a hard exclusion
// ─────────────────────────────────────────────────────────────────────────────
describe('panel avoid chip → hard exclusion (real wiring)', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('clicking a result in the "להימנע" picker makes it a hard exclude in sidebarQuickActionPrefs', () => {
    const r = JSON.parse(window.eval(`(function(){
      // Render the real AI tab so the real picker inputs/handlers exist.
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      renderAiTab();
      // Drive the REAL avoid picker exactly as a user does: type, then click the
      // matching result row. This is the only UI action the user performs — no
      // secondary 🚫 toggle.
      const search = document.getElementById('ai-pref-unwanted-search');
      search.value = 'תרמודינמיקה';
      search.dispatchEvent(new window.Event('input'));
      const row = document.querySelector('#ai-pref-unwanted-results .ai-course-picker-result[data-cid="${THERMO}"]');
      if (row) row.click();
      const prefs = sidebarQuickActionPrefs();
      return JSON.stringify({
        rowFound: !!row,
        unwanted: _aiPickerState.unwanted,
        strongUnwanted: _aiPickerState.strongUnwanted || [],
        strongly_avoided: prefs.strongly_avoided_course_ids,
        unwanted_pref: prefs.unwanted_course_ids,
      });
    })()`));
    expect(r.rowFound).toBe(true);
    expect(r.unwanted).toContain(THERMO);
    // The bug: the chip went into `unwanted` only; strongUnwanted stays empty
    // and the user never clicked 🚫. The FIX makes the panel avoid a HARD
    // exclusion regardless, so the hard-exclude list must include it.
    expect(r.strongly_avoided).toContain(THERMO);
  });

  test('a soft-downgraded avoid (softUnwanted) is NOT promoted back to a hard exclude', () => {
    const r = JSON.parse(window.eval(`(function(){
      // User added two avoid chips, then accepted "אפשר בחירה פחות קשורה" for one,
      // which moves it to softUnwanted (deliberately soft). It must stay soft.
      _aiPickerState = { wanted: [], unwanted: ['${THERMO}', '0581-4131'], strongUnwanted: [], softUnwanted: ['0581-4131'], shaarRuachAssessmentPref: null, _initialized: true };
      const prefs = sidebarQuickActionPrefs();
      return JSON.stringify({ strongly_avoided: prefs.strongly_avoided_course_ids });
    })()`));
    expect(r.strongly_avoided).toContain(THERMO);          // a normal avoid chip → hard
    expect(r.strongly_avoided).not.toContain('0581-4131'); // deliberately downgraded → soft
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — a panel-avoided course is absent from a rebuild + its summary
// ─────────────────────────────────────────────────────────────────────────────
describe('rebuild from panel state honors the avoid chip end-to-end', () => {
  let dom, window, r;
  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      // EXACTLY what the UI leaves after a user adds an avoid chip + two wanted
      // chips + the שער-רוח dropdown: unwanted set, strongUnwanted EMPTY.
      _aiPickerState = { wanted: ['${VIBRATIONS}', '${FEM}'], unwanted: ['${THERMO}'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      _aiPlanLastPreferences = { max_weekly_hours: 25 };
      _aiUserIntentProfile = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const summary = formatFull185SummaryLocal(plan);
      const placed = (plan.proposal.semesters||[]).flatMap(s => s.course_ids||[]);
      const placedLines = summary.split('\\n').filter(l => l.includes('נוספו') || l.includes('שובצו') || l.includes('שובץ'));
      return JSON.stringify({
        thermoInDraft: placed.includes('${THERMO}'),
        hardExclude: (plan.userIntentProfile && plan.userIntentProfile.hardExcludeCourseIds) || [],
        summaryMentionsThermo: summary.includes('תרמודינמיקה'),
        placedLinesJoined: placedLines.join(' || '),
      });
    })()`));
  });
  afterAll(() => dom.window.close());

  test('the panel-avoided course is hard-excluded by the rebuild', () => {
    expect(r.hardExclude).toContain(THERMO);
  });
  test('the panel-avoided course is absent from the final draft', () => {
    expect(r.thermoInDraft).toBe(false);
  });
  test('the panel-avoided course is never named in a placement/focus success line', () => {
    expect(r.placedLinesJoined).not.toContain('תרמודינמיקה (2)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — workload-cap summary integrity
// ─────────────────────────────────────────────────────────────────────────────
describe('summary integrity — user max workload is never presented as clean success when exceeded', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('a draft with a semester over the user max (25) is NOT labeled "מערכת חוקית מלאה" and is caveated', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      _aiPlanLastPreferences = { max_weekly_hours: 25 };
      _aiUserIntentProfile = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const summary = formatFull185SummaryLocal(plan);
      const semHours = Object.entries((state.proposalDraft||{semesters:{}}).semesters).map(([sid, ids]) => ({
        sid, h: (ids||[]).reduce((t,cid)=>t+(hoursForCourseId(cid)||0),0),
      }));
      return JSON.stringify({
        summary,
        overCap: semHours.filter(s => s.h > 25),
      });
    })()`));
    // Precondition: the ME 2027 board's year-3-sem-a fixed-mandatory load is 26h,
    // which exceeds the requested 25. If the fixture ever changes so nothing is
    // over-cap, this assertion is vacuously satisfied — guard it.
    expect(r.overCap.length).toBeGreaterThan(0);
    // It must NOT claim a clean full system.
    expect(r.summary).not.toContain('מערכת חוקית מלאה');
    // It must mention the exceeded user cap explicitly.
    expect(r.summary).toContain('25');
    expect(r.summary).toContain('מעל המקסימום שביקשת');
  });

  test('when the over-cap semester is only fixed-mandatory courses, the summary says so', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      _aiPlanLastPreferences = { max_weekly_hours: 25 };
      _aiUserIntentProfile = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const summary = formatFull185SummaryLocal(plan);
      return JSON.stringify({ summary });
    })()`));
    // The year-3-sem-a overload on the ME 2027 fixture is purely fixed mandatory.
    expect(r.summary).toContain('חובה');
  });
});

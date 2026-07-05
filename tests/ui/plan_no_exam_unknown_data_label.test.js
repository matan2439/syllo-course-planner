/**
 * plan_no_exam_unknown_data_label.test.js
 *
 * Bug: when the user sets shaarRuachAssessmentPref='prefer_no_exam' and the
 * only available שער-רוח candidates have unknown exam/assessment data (no
 * syllabus, has_exam===null), the planner adds them anyway (correctly — they
 * still rank above a known-exam course, see _shaarRuachAssessmentScoreLocal),
 * but the warning text only said "closest alternatives were chosen" without
 * naming which specific course has unverified data — silently implying the
 * preference was satisfied. Required: unknown data must never be presented as
 * a clean match; each such course must be named with an explicit "מידע חסר /
 * דורש אישור" note (fix in repairAddGeneralCoursesLocal).
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

// Real courses confirmed (via direct probe against the prod board) to be
// שער-רוח with genuinely unknown exam data: has_exam === null, no syllabus.
const UNKNOWN_EXAM_COURSE_ID = '0609-1005'; // תולדות האנושות - 3,000 השנים הראשונות

function loadProdBoard() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  h = h.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
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
  return dom;
}

function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe('no-final-exam preference: unknown-data courses are never presented as a clean match', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('verified that the test fixture course really has unknown exam data', () => {
    const r = JSON.parse(window.eval(`(function(){
      const c = courseMap['${UNKNOWN_EXAM_COURSE_ID}'];
      return JSON.stringify({ exists: !!c, isShaarRuach: c ? _isShaarRuachLocal(c) : null, hasExamUnknown: c ? (_hasFinalExamLocal(c) == null) : null });
    })()`));
    expect(r.exists).toBe(true);
    expect(r.isShaarRuach).toBe(true);
    expect(r.hasExamUnknown).toBe(true);
  });

  test('adding an unknown-exam-data course under prefer_no_exam names it explicitly with "מידע חסר / דורש אישור"', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiPickerState = { wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const proposal = { semesters: [], warnings_he: [] };
      const analysis = {
        hours: { completed_general_hours: 0 },
        general_requirement: {
          required: 2, placed: 0,
          candidates: [{ course_id: '${UNKNOWN_EXAM_COURSE_ID}', hours: 2, has_exam: null }],
        },
      };
      const opts = {
        courses: { '${UNKNOWN_EXAM_COURSE_ID}': { hours: 2, effective_allowed_semesters: ['year_3_semester_a'] } },
        knownSemesterIds: ['year_3_semester_a'],
        maxHoursPerSemester: 20,
        requiredHours: 999, // far above target so the global cap never blocks this add
      };
      const result = repairAddGeneralCoursesLocal(proposal, analysis, opts);
      return JSON.stringify({
        addedIds: result.added.map(a => a.course_id),
        warnings: result.proposal.warnings_he || [],
      });
    })()`));
    expect(r.addedIds).toContain(UNKNOWN_EXAM_COURSE_ID);
    const hasMissingDataWarning = r.warnings.some(w => w.includes('מידע חסר') && w.includes('תולדות האנושות'));
    expect(hasMissingDataWarning).toBe(true);
  });

  test('regression: the chat "שים לב" summary note flags unknown-exam שער-רוח placements regardless of which fill stage added them', () => {
    // Found via live browser QA: formatFull185SummaryLocal's note only scanned
    // plan.completionAdded (the completion-fill step), so a שער-רוח course that
    // reached the board via must-include / mandatory-category fill / the initial
    // seed was invisible to the check — the note then falsely declared the
    // no-exam preference fully satisfied even though the only שער-רוח courses
    // placed had unknown assessment data.
    const r = JSON.parse(window.eval(`(function(){
      const plan = { proposal: { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['${UNKNOWN_EXAM_COURSE_ID}'] }] },
        userIntentProfile: { shaarRuachAssessmentPref: 'prefer_no_exam' }, completionAdded: [] };
      const summary = formatFull185SummaryLocal(plan);
      return JSON.stringify({ noteLine: summary.split('\\n').find(l => l.includes('שער רוח')) || '' });
    })()`));
    expect(r.noteLine).toContain('לא נמצאו מספיק');
    expect(r.noteLine).not.toContain('ככל שהיה מידע זמין');
  });
});

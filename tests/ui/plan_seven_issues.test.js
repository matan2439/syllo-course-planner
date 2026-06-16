/**
 * Coverage for the seven production issues:
 *  1. Annual course spans A+B: counted once for degree hours, load in both
 *     semesters, locked (not independently movable).
 *  2. Course-details difficulty falls back to the planner estimate, not "לא ידוע".
 *  4. A proposal below the required degree hours is blocking (not applicable).
 *  6. No chip labelled "תעדף עיקר"; stopwords never become prioritize topics.
 *  7. diagnoseBuildBlock classifies the specific blocking cause with targeted chips.
 *
 * Each helper is grabbed from the HTML in isolation (matching the repo's
 * existing UI-test convention) so we test the real shipped logic.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function grab(name) {
  const decl = `function ${name}(`;
  const start = html.indexOf(decl);
  if (start < 0) throw new Error(`${name} not found`);
  const braceOpen = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name}: unbalanced braces`);
}

describe('Issue 1 — annual course accounting', () => {
  // isAnnualCourse + getSemesterLoadLocal + isLocked, loaded together.
  const factory = new Function(
    `${grab('isAnnualCourse')}\n${grab('getSemesterLoadLocal')}\n${grab('isLocked')}\n` +
    `return { isAnnualCourse, getSemesterLoadLocal, isLocked };`,
  );
  const { isAnnualCourse, getSemesterLoadLocal, isLocked } = factory();

  const annual = {
    course_id: '0542-3792', is_annual: true, placement_policy: 'annual',
    hours: 4, semester_load_hours_by_semester: { year_3_semester_a: 4, year_3_semester_b: 4 },
  };

  test('detected as annual', () => {
    expect(isAnnualCourse(annual)).toBe(true);
    expect(isAnnualCourse({ placement_policy: 'flexible' })).toBe(false);
  });

  test('load counted in BOTH semesters via semester_load_hours_by_semester', () => {
    const courses = { '0542-3792': annual };
    const semA = { semester_id: 'year_3_semester_a', course_ids: ['0542-3792'] };
    const semB = { semester_id: 'year_3_semester_b', course_ids: ['0542-3792'] };
    expect(getSemesterLoadLocal(semA, courses)).toBe(4);
    expect(getSemesterLoadLocal(semB, courses)).toBe(4);
  });

  test('falls back to weekly hours when no per-semester map', () => {
    const c = { course_id: 'x', hours: 3 };
    const sem = { semester_id: 'year_3_semester_a', course_ids: ['x'] };
    expect(getSemesterLoadLocal(sem, { x: c })).toBe(3);
  });

  test('locked — not independently movable (like fixed)', () => {
    expect(isLocked(annual)).toBe(true);
    expect(isLocked({ placement_policy: 'flexible' })).toBe(false);
  });
});

describe('Issue 4 — below-185 proposal is not applicable', () => {
  const isApplyable = new Function(
    `${grab('isPlanApplyableLocal')}\nreturn isPlanApplyableLocal;`,
  )();

  test('not applicable when completeness.incomplete (hours short)', () => {
    expect(isApplyable([], { incomplete: true, reasons: ['חסרות 56.5 ש״ש להשלמת התואר.'] })).toBe(false);
  });

  test('applicable only when no errors and complete', () => {
    expect(isApplyable([], { incomplete: false, reasons: [] })).toBe(true);
    expect(isApplyable(['some error'], { incomplete: false })).toBe(false);
  });

  test('build path makes total<required an unconditional blocking reason', () => {
    expect(html).toContain('!degreeHoursStatus.satisfied && degreeHoursStatus.missing_hours > 0');
    expect(html).toContain('ש״ש להשלמת התואר');
  });
});

describe('Issue 2 — course-details difficulty estimate fallback', () => {
  const estimate = new Function(
    `${grab('estimateCourseDifficultyLocal')}\nreturn estimateCourseDifficultyLocal;`,
  )();

  test('estimate returns a value for a mandatory course with hours+syllabus (e.g. 0542-3620)', () => {
    const c = {
      course_id: '0542-3620', name_he: 'מעבר חום', weekly_hours: 4,
      difficulty_level: null, difficulty_score: null,
      syllabus_summary_he: 'מבוא למעבר חום, הולכה, הסעה וקרינה.',
      prerequisites: ['0542-3500'],
    };
    const est = estimate(c);
    expect(est).not.toBeNull();
    expect(typeof est).toBe('number');
    expect(est).toBeGreaterThan(0);
  });

  test('estimate genuinely null when no hours/syllabus/prereqs', () => {
    const est = estimate({ course_id: 'x', weekly_hours: null, semester_hours: null });
    expect(est == null).toBe(true);
  });

  test('details panel wires the estimate + "(הערכה)" marker and annual lines', () => {
    // The details render path must use the estimate (not only c.difficulty_level)
    // and must not fall straight to "לא ידוע" when an estimate exists.
    expect(html).toContain('detailEstDiff = estimateCourseDifficultyLocal(c)');
    expect(html).toContain('(הערכה)');
    expect(html).toContain('קורס שנתי — פעיל בסמסטר א׳ ובסמסטר ב׳');
    expect(html).toContain('נספר פעם אחת לשעות התואר');
  });
});

describe('Issue 6 / 7 — diagnoseBuildBlock chips & classification', () => {
  function loadDiagnose(stubTerms) {
    const factory = new Function(
      'courseMap', '_aiPickerState', 'extractPreferenceTermsLocal', '_aiPlanLastPreferences',
      `${grab('diagnoseBuildBlock')}\nreturn diagnoseBuildBlock;`,
    );
    return factory({}, { strongUnwanted: [], unwanted: [] }, () => stubTerms, {});
  }

  test('Issue 6 — stopword "עיקר" never produces a "תעדף עיקר" chip', () => {
    const diag = loadDiagnose({ interest_terms: ['עיקר'], grade_target: null })(
      { errors: [], completeness: { incomplete: true, reasons: ['חסר קורס אחד מקורסי הקטגוריה "מערכות".'] } }, {},
    );
    const labels = diag.chips.map(c => c.label);
    expect(labels).not.toContain('תעדף עיקר');
    for (const l of labels) expect(l).not.toMatch(/עיקר/);
  });

  test('Issue 6 — prioritize chip only with >=2 real topics, meaningful label', () => {
    const diag = loadDiagnose({ interest_terms: ['חוזק', 'זרימה'], grade_target: null })(
      { errors: [], completeness: { incomplete: true, reasons: ['חסר קורס אחד מקורסי הקטגוריה "מערכות".'] } }, {},
    );
    const prio = diag.chips.find(c => c.action === 'prioritize-topic');
    expect(prio).toBeTruthy();
    expect(prio.label).toBe('העדף חוזק על פני זרימה');
    expect(prio.label).not.toMatch(/^תעדף/);
  });

  test('Issue 7 — insufficient hours: exact missing ש"ש + fill chip', () => {
    const diag = loadDiagnose({ interest_terms: [], grade_target: null })(
      { errors: [], completeness: { incomplete: true, reasons: ['חסרות 56.5 ש״ש להשלמת התואר.'] } }, {},
    );
    expect(diag.category).toBe('insufficient_hours');
    expect(diag.explanation_he).toContain('56.5');
    expect(diag.chips.map(c => c.action)).toContain('fill-remaining-hours');
  });

  test('Issue 7 — missing mandatory names the course', () => {
    const diag = loadDiagnose({ interest_terms: [], grade_target: null })(
      { errors: [], completeness: { incomplete: true, reasons: ['חסרים קורסי חובה: מעבר חום, תרמודינמיקה.'] } }, {},
    );
    expect(diag.category).toBe('missing_mandatory');
    expect(diag.explanation_he).toContain('מעבר חום');
  });

  test('Issue 7 — illegal offering names course + only-legal semester', () => {
    const diag = loadDiagnose({ interest_terms: [], grade_target: null })(
      { errors: ['מבוא לאלמנטים סופיים מוצע רק בסמסטר א׳.'], completeness: { incomplete: true, reasons: [] } }, {},
    );
    expect(diag.category).toBe('legality');
    expect(diag.explanation_he).toContain('מבוא לאלמנטים סופיים');
  });

  test('Issue 7 — every cause yields a show-constraints chip and no empty chip labels', () => {
    const diag = loadDiagnose({ interest_terms: [], grade_target: null })(
      { errors: [], completeness: { incomplete: true, reasons: ['חסרות 12 ש״ש להשלמת התואר.'] } }, {},
    );
    expect(diag.chips.every(c => c.label && c.label.trim().length > 0)).toBe(true);
    expect(diag.chips.map(c => c.action)).toContain('show-blocking-constraints');
  });
});

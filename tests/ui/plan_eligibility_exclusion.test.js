/**
 * Issue 1 (client mirror) — course eligibility / exclusion layer, and
 * Issue 4 (client mirror) — difficulty estimator + workload balance weight.
 *
 * Extracts the relevant top-level helpers from the viewer source and runs them
 * in isolation (no jsdom), asserting:
 *   - honors ("מצטיינים") courses are ineligible unless is_honors_student,
 *   - the pattern generalizes to a SECOND מצטיינים-named course,
 *   - the explicit excluded name is ineligible for everyone,
 *   - the FINAL eligibility post-filter removes an ineligible ELECTIVE returned
 *     by the LLM, keeps a mandatory one, and an eligible alternative survives,
 *   - estimateCourseDifficultyLocal returns a bounded >0 estimate for a
 *     mandatory course with no explicit difficulty/workload,
 *   - _balanceWeight picks up the effective estimate when real scores are null.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function grab(html, name) {
  const decl = `function ${name}(`;
  const start = html.indexOf(decl);
  if (start === -1) throw new Error(`${name} not found in viewer`);
  const braceOpen = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name}: unbalanced braces`);
}

function load(courseMap) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const patterns = "const EXCLUDED_COURSE_NAME_PATTERNS = ['מצטיינים'];";
  const names = "const EXCLUDED_COURSE_NAMES = ['פרויקט יישומי בהנדסה מכנית'];";
  const src = [
    patterns,
    names,
    grab(html, '_normalizeCourseNameLocal'),
    grab(html, 'isCourseEligibleLocal'),
    grab(html, 'resolveIneligibleCourseIdsLocal'),
    grab(html, 'estimateCourseDifficultyLocal'),
    grab(html, 'effectiveCourseDifficultyLocal'),
    grab(html, '_isElectiveLike'),
    grab(html, '_isFlexibleMandatory'),
    grab(html, '_balanceWeight'),
    grab(html, 'applyEligibilityPostFilterLocal'),
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function('courseMap', `${src}\nreturn { isCourseEligibleLocal, resolveIneligibleCourseIdsLocal, estimateCourseDifficultyLocal, effectiveCourseDifficultyLocal, _balanceWeight, applyEligibilityPostFilterLocal };`);
  return factory(courseMap);
}

const courseMap = {
  '0542-4011': { course_id: '0542-4011', name_he: 'פרויקט מחקר למצטיינים (1)' },
  '0542-4012': { course_id: '0542-4012', name_he: 'פרוייקט מחקר למצטיינים (2)' },
  '0542-3112': { course_id: '0542-3112', name_he: 'פרויקט יישומי בהנדסה מכנית' },
  GOOD: { course_id: 'GOOD', name_he: 'מבוא למוצקים' },
  MAND: { course_id: 'MAND', name_he: 'פרויקט מחקר למצטיינים (לחובה)', course_type: 'mandatory' },
};

describe('Issue 1 — client eligibility (general, name-driven)', () => {
  const api = load(courseMap);

  test('honors course ineligible unless is_honors_student; second מצטיינים course too', () => {
    expect(api.isCourseEligibleLocal(courseMap['0542-4011'], { is_honors_student: false })).toBe(false);
    expect(api.isCourseEligibleLocal(courseMap['0542-4012'], { is_honors_student: false })).toBe(false);
    expect(api.isCourseEligibleLocal(courseMap['0542-4012'], { is_honors_student: true })).toBe(true);
  });

  test('explicit excluded name ineligible for everyone', () => {
    expect(api.isCourseEligibleLocal(courseMap['0542-3112'], { is_honors_student: true })).toBe(false);
  });

  test('resolveIneligibleCourseIdsLocal finds all ineligible ids', () => {
    const ids = api.resolveIneligibleCourseIdsLocal(courseMap, { is_honors_student: false });
    expect(ids.has('0542-4011')).toBe(true);
    expect(ids.has('0542-4012')).toBe(true);
    expect(ids.has('0542-3112')).toBe(true);
    expect(ids.has('GOOD')).toBe(false);
  });

  test('post-filter removes ineligible ELECTIVE, keeps eligible + mandatory', () => {
    const proposal = {
      semesters: [{ semester_id: 's1', course_ids: ['0542-4012', 'GOOD', 'MAND'] }],
    };
    const ctxCourses = { MAND: { is_mandatory: true } };
    const { proposal: out, removed, keptMandatory } =
      api.applyEligibilityPostFilterLocal(proposal, { is_honors_student: false }, ctxCourses);
    const ids = out.semesters[0].course_ids;
    expect(ids).not.toContain('0542-4012'); // ineligible elective removed
    expect(ids).toContain('GOOD');          // eligible alternative survives
    expect(ids).toContain('MAND');          // mandatory never removed
    expect(removed).toContain('0542-4012');
    expect(keptMandatory).toContain('MAND');
  });
});

describe('Issue 4 — client difficulty estimator + balance weight', () => {
  const api = load(courseMap);

  test('mandatory course w/o explicit score gets a bounded >0 estimate', () => {
    const c = { weekly_hours: 14, syllabus_summary_he: 'מעבדה פרויקט גמר מבחן', prerequisite_course_ids: ['a', 'b'] };
    const est = api.estimateCourseDifficultyLocal(c);
    expect(est).not.toBeNull();
    expect(est).toBeGreaterThan(0);
    expect(est).toBeLessThanOrEqual(5);
  });

  test('_balanceWeight uses the effective estimate when real scores are null', () => {
    const info = {
      workload_score: null, conceptual_complexity_score: null, difficulty_score: null,
      effective_workload_score: 3.2, effective_difficulty_score: 3.2,
    };
    expect(api._balanceWeight(info)).toBe(3.2);
  });

  test('heavier estimated course outranks a lighter one for the move', () => {
    const heavy = { workload_score: null, difficulty_score: null, effective_workload_score: api.estimateCourseDifficultyLocal({ weekly_hours: 16, syllabus_summary_he: 'מעבדה פרויקט גמר '.repeat(15), prerequisite_course_ids: ['a','b','c'] }) };
    const light = { workload_score: null, difficulty_score: null, effective_workload_score: api.estimateCourseDifficultyLocal({ weekly_hours: 2 }) };
    expect(api._balanceWeight(heavy)).toBeGreaterThan(api._balanceWeight(light));
  });
});

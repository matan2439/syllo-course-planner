/**
 * Phase 1 — offering/draft TIER on validateFinalPlan (ctx.mode).
 *
 * Root cause this guards: the solver places syllabus-backed electives whose
 * semester offering is not yet confirmed (to reach the 185 ש"ש target), but the
 * gate treated `missing_offering_data` as a hard blocker, so the whole plan was
 * rejected and the user never saw a plan. The fix separates the two axes:
 *   - 'strict' (default) — confirmed final plan: offering uncertainty + degree
 *     incompleteness block. (Existing behavior; all prior tests still pass.)
 *   - 'draft' — plan-with-assumptions: a syllabus-backed course is USABLE for
 *     planning even with uncertain offering. Soft causes become warnings; only
 *     HARD structural violations still block.
 *
 * Tested in isolation via the same grab() harness as final_plan_validator.test.js.
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

const validate = new Function(
  `function _normalizeSemId(id) { return (id || '').replace(/(_[ab])\\d+$/, '$1'); }\n` +
  `function _formatSemIdHe(id) { return _normalizeSemId(id); }\n` +
  `${grab('prereqIdsOf')}\n${grab('isAnnualCourse')}\n${grab('validateFinalPlan')}\n` +
  `return validateFinalPlan;`,
)();

const SEMESTERS = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ סמסטר ב׳' },
  { id: 'year_4_semester_a', label: 'שנה ד׳ סמסטר א׳' },
  { id: 'year_4_semester_b', label: 'שנה ד׳ סמסטר ב׳' },
];

function progressStub(total) {
  return () => ({ required: 185, total_after_proposal: total });
}

function baseCtx(courses, overrides = {}) {
  return Object.assign({
    courses,
    SEMESTERS,
    completedCourseIds: [],
    categoryRequirements: [],
    requiredMandatoryCourseIds: [],
    preferences: {},
    userCourseStatuses: {},
    hardLoadCap: 26,
    absoluteMax: 30,
    helpers: { computeDegreeProgress: progressStub(185) },
  }, overrides);
}

function semProposal(map) {
  return { semesters: SEMESTERS.map(s => ({ semester_id: s.id, course_ids: map[s.id] || [] })) };
}

const causesOf = r => r.blockers.map(b => b.cause);
const warnCausesOf = r => r.warnings.map(w => w.cause);

describe('offering tier — missing_offering_data', () => {
  // A course with a syllabus but NO confident offering data.
  const courses = {
    'syl-no-offering': {
      course_id: 'syl-no-offering', name_he: 'זרימה דחיסה',
      syllabus_summary_he: 'גלי הלם, זרימה על-קולית', weekly_hours: 3,
      // NOTE: no effective_allowed_semesters → missing_offering_data
    },
  };

  test('strict (default) → missing_offering_data BLOCKS', () => {
    const r = validate(semProposal({ year_3_semester_a: ['syl-no-offering'] }), baseCtx(courses));
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('missing_offering_data');
  });

  test('draft mode → downgraded to WARNING, plan applicable, course flagged assumed', () => {
    const ctx = baseCtx(courses, { mode: 'draft' });
    const r = validate(semProposal({ year_3_semester_a: ['syl-no-offering'] }), ctx);
    expect(r.applicable).toBe(true);
    expect(causesOf(r)).not.toContain('missing_offering_data');
    expect(warnCausesOf(r)).toContain('missing_offering_data');
    expect(r.assumedOfferingCourseIds).toContain('syl-no-offering');
  });
});

describe('offering tier — degree incompleteness', () => {
  const courses = { 'x': { course_id: 'x', name_he: 'קורס', effective_allowed_semesters: SEMESTERS.map(s => s.id) } };

  test('strict → degree_completion (128.5/185) BLOCKS', () => {
    const ctx = baseCtx(courses, { helpers: { computeDegreeProgress: progressStub(128.5) } });
    const r = validate(semProposal({ year_3_semester_a: ['x'] }), ctx);
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('degree_completion');
  });

  test('draft mode → degree_completion downgraded to warning, plan still presentable', () => {
    const ctx = baseCtx(courses, { mode: 'draft', helpers: { computeDegreeProgress: progressStub(128.5) } });
    const r = validate(semProposal({ year_3_semester_a: ['x'] }), ctx);
    expect(r.applicable).toBe(true);
    expect(causesOf(r)).not.toContain('degree_completion');
    expect(warnCausesOf(r)).toContain('degree_completion');
  });
});

describe('offering tier — HARD structural violations STILL block in draft mode', () => {
  test('overload over the hard cap still blocks in draft mode', () => {
    const courses = {
      'big': { course_id: 'big', name_he: 'כבד', hours: 28, effective_allowed_semesters: SEMESTERS.map(s => s.id) },
    };
    const ctx = baseCtx(courses, { mode: 'draft' });
    const r = validate(semProposal({ year_3_semester_a: ['big'] }), ctx);
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('overload');
  });

  test('illegal_semester still blocks in draft mode', () => {
    const courses = {
      'r': { course_id: 'r', name_he: 'קורס מוגבל', effective_allowed_semesters: ['year_3_semester_a'] },
    };
    const ctx = baseCtx(courses, { mode: 'draft' });
    const r = validate(semProposal({ year_4_semester_b: ['r'] }), ctx);
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('illegal_semester');
  });
});

describe('offering tier — a fully legal plan is applicable in BOTH modes', () => {
  const courses = {
    'ok': { course_id: 'ok', name_he: 'תקין', weekly_hours: 3, effective_allowed_semesters: SEMESTERS.map(s => s.id) },
  };
  test('strict', () => {
    expect(validate(semProposal({ year_3_semester_a: ['ok'] }), baseCtx(courses)).applicable).toBe(true);
  });
  test('draft', () => {
    expect(validate(semProposal({ year_3_semester_a: ['ok'] }), baseCtx(courses, { mode: 'draft' })).applicable).toBe(true);
  });
});

describe('offering tier — mixed soft + hard: only hard remains a blocker in draft mode', () => {
  const courses = {
    'syl-no-offering': { course_id: 'syl-no-offering', name_he: 'זרימה', syllabus_summary_he: 'גלי הלם', weekly_hours: 3 },
    'big': { course_id: 'big', name_he: 'כבד', hours: 28, effective_allowed_semesters: SEMESTERS.map(s => s.id) },
  };
  test('draft mode keeps overload, drops missing_offering_data', () => {
    const ctx = baseCtx(courses, { mode: 'draft' });
    const r = validate(semProposal({
      year_3_semester_a: ['big'],
      year_3_semester_b: ['syl-no-offering'],
    }), ctx);
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('overload');
    expect(causesOf(r)).not.toContain('missing_offering_data');
    expect(warnCausesOf(r)).toContain('missing_offering_data');
  });
});

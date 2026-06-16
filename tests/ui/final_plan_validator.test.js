/**
 * Golden / regression coverage for the CENTRAL authoritative FINAL-PLAN
 * VALIDATOR (validateFinalPlan) in app/web/semester_board_viewer.html.
 *
 * The validator is the single, un-bypassable gate that every proposal path
 * funnels through. These tests construct realistic ME-2027 final boards and
 * assert the nine checks + the A–G golden scenarios from the spec.
 *
 * The real shipped function is grabbed from the HTML in isolation (matching the
 * repo convention). validateFinalPlan resolves its dependencies from
 * ctx.helpers first, so we inject the real prereq/legality helpers and stub the
 * heavier ones (computeDegreeProgress) per test.
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

// validateFinalPlan grabbed with the real prereq + annual helpers folded in so
// the union/timing logic is the genuine shipped logic.
const validate = new Function(
  `${grab('prereqIdsOf')}\n${grab('isAnnualCourse')}\n${grab('validateFinalPlan')}\n` +
  `return validateFinalPlan;`,
)();

// diagnoseBuildBlock + the blocker→shape mapper, for the recovery-message tests.
const blockersToShape = new Function(`${grab('blockersToValidationShape')}\nreturn blockersToValidationShape;`)();
const diagnose = new Function(
  'courseMap', '_aiPickerState', 'extractPreferenceTermsLocal', '_aiPlanLastPreferences',
  `${grab('diagnoseBuildBlock')}\nreturn diagnoseBuildBlock;`,
)({}, { strongUnwanted: [], unwanted: [] }, () => ({ interest_terms: [], grade_target: null }), {});

const SEMESTERS = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ סמסטר ב׳' },
  { id: 'year_4_semester_a', label: 'שנה ד׳ סמסטר א׳' },
  { id: 'year_4_semester_b', label: 'שנה ד׳ סמסטר ב׳' },
];

// A degree-progress stub that reports a configurable total against 185.
function progressStub(total) {
  return () => ({ required: 185, total_after_proposal: total });
}

// Base ctx: helpers + SEMESTERS injected. By default the degree total reaches
// 185 so degree_completion does not fire unless a test overrides it.
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

describe('A — illegal_semester for 0542-4223 (B-only courses)', () => {
  const courses = {
    '0542-4223': { course_id: '0542-4223', name_he: 'בקרה אוטומטית',
      effective_allowed_semesters: ['year_3_semester_a', 'year_4_semester_a'] },
  };

  test('placed in a Semester B → not applicable, cause illegal_semester', () => {
    const r = validate(semProposal({ year_3_semester_b: ['0542-4223'] }), baseCtx(courses));
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('illegal_semester');
  });

  test('accepted in year_3_a and year_4_a', () => {
    for (const sid of ['year_3_semester_a', 'year_4_semester_a']) {
      const r = validate(semProposal({ [sid]: ['0542-4223'] }), baseCtx(courses));
      expect(causesOf(r)).not.toContain('illegal_semester');
    }
  });
});

describe('B — robotics lab 0542-4624 prereq 0542-4621', () => {
  const courses = {
    '0542-4621': { course_id: '0542-4621', name_he: 'בקרה', effective_allowed_semesters: SEMESTERS.map(s => s.id) },
    '0542-4624': { course_id: '0542-4624', name_he: 'מעבדה ברובוטיקה ובקרה',
      effective_allowed_semesters: SEMESTERS.map(s => s.id),
      // prereq carried ONLY on missing_prerequisites (audit-resolved).
      missing_prerequisites: ['0542-4621'] },
  };

  test('without prereq → prerequisite blocker naming it', () => {
    const r = validate(semProposal({ year_3_semester_a: ['0542-4624'] }), baseCtx(courses));
    expect(r.applicable).toBe(false);
    const b = r.blockers.find(x => x.cause === 'prerequisite');
    expect(b).toBeTruthy();
    // names the missing prereq (by display name in the message + id in course_ids)
    expect(b.message_he).toContain('בקרה');
    expect(b.course_ids).toContain('0542-4621');
    expect(b.detail.unsatisfied).toContain('0542-4621');
  });

  test('prereq in a strictly earlier semester → prereq check passes', () => {
    const r = validate(
      semProposal({ year_3_semester_a: ['0542-4621'], year_3_semester_b: ['0542-4624'] }),
      baseCtx(courses),
    );
    expect(causesOf(r)).not.toContain('prerequisite');
  });

  test('same-semester → rejected', () => {
    const r = validate(
      semProposal({ year_3_semester_a: ['0542-4621', '0542-4624'] }),
      baseCtx(courses),
    );
    expect(causesOf(r)).toContain('prerequisite');
  });
});

describe('C — annual course 0542-3792 spans', () => {
  const courses = {
    '0542-3792': { course_id: '0542-3792', name_he: 'פרויקט שנתי', is_annual: true,
      placement_policy: 'annual',
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'],
      spans_semesters: ['year_3_semester_a', 'year_3_semester_b'] },
  };

  test('present in both spans → no annual blocker', () => {
    const r = validate(
      semProposal({ year_3_semester_a: ['0542-3792'], year_3_semester_b: ['0542-3792'] }),
      baseCtx(courses),
    );
    expect(causesOf(r)).not.toContain('annual');
    expect(causesOf(r)).not.toContain('illegal_semester');
  });

  test('half-only (one span) → annual blocker', () => {
    const r = validate(semProposal({ year_3_semester_a: ['0542-3792'] }), baseCtx(courses));
    expect(causesOf(r)).toContain('annual');
  });
});

describe('D — degree below 185', () => {
  const courses = { 'x': { course_id: 'x', name_he: 'קורס', effective_allowed_semesters: SEMESTERS.map(s => s.id) } };

  test('128.5 total → degree_completion blocker with exact missing hours', () => {
    const ctx = baseCtx(courses, { helpers: { computeDegreeProgress: progressStub(128.5) } });
    const r = validate(semProposal({ year_3_semester_a: ['x'] }), ctx);
    expect(r.applicable).toBe(false);
    const b = r.blockers.find(x => x.cause === 'degree_completion');
    expect(b).toBeTruthy();
    expect(b.message_he).toContain('56.5'); // 185 - 128.5
  });
});

describe('E — honors/מצטיינים course with non-honors student', () => {
  // isCourseEligibleLocal is grabbed with its name-normalizer dependency.
  const isEligible = new Function(
    `const EXCLUDED_COURSE_NAME_PATTERNS = ['מצטיינים'];\n` +
    `const EXCLUDED_COURSE_NAMES = ['פרויקט יישומי בהנדסה מכנית'];\n` +
    `${grab('_normalizeCourseNameLocal')}\n${grab('isCourseEligibleLocal')}\n` +
    `return isCourseEligibleLocal;`,
  )();
  const courses = {
    'h': { course_id: 'h', name_he: 'אלגוריתמים למצטיינים', effective_allowed_semesters: SEMESTERS.map(s => s.id) },
  };

  test('present with is_honors_student=false → eligibility blocker', () => {
    const ctx = baseCtx(courses, {
      preferences: { is_honors_student: false },
      helpers: { computeDegreeProgress: progressStub(185), isCourseEligibleLocal: isEligible },
    });
    const r = validate(semProposal({ year_3_semester_a: ['h'] }), ctx);
    expect(r.applicable).toBe(false);
    const b = r.blockers.find(x => x.cause === 'eligibility');
    expect(b).toBeTruthy();
    expect(b.course_ids).toContain('h');
  });

  test('honors student → no eligibility blocker', () => {
    const ctx = baseCtx(courses, {
      preferences: { is_honors_student: true },
      helpers: { computeDegreeProgress: progressStub(185), isCourseEligibleLocal: isEligible },
    });
    const r = validate(semProposal({ year_3_semester_a: ['h'] }), ctx);
    expect(causesOf(r)).not.toContain('eligibility');
  });
});

describe('F — repair/fill relocates a course outside its offering', () => {
  const courses = {
    'r': { course_id: 'r', name_he: 'קורס מוגבל', effective_allowed_semesters: ['year_3_semester_a'] },
  };

  test('final board with out-of-offering placement → illegal_semester', () => {
    // Simulate a final board where a repair pass moved "r" to year_4_b.
    const r = validate(semProposal({ year_4_semester_b: ['r'] }), baseCtx(courses));
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('illegal_semester');
  });
});

describe('missing_offering_data — presented course without effective offering', () => {
  test('no effective_allowed_semesters → missing_offering_data blocker (not silently legal)', () => {
    const courses = { 'm': { course_id: 'm', name_he: 'קורס ללא נתונים', program_allowed_semesters: SEMESTERS.map(s => s.id) } };
    const r = validate(semProposal({ year_3_semester_a: ['m'] }), baseCtx(courses));
    expect(r.applicable).toBe(false);
    expect(causesOf(r)).toContain('missing_offering_data');
  });
});

describe('mandatory + category + overload checks', () => {
  test('missing required mandatory course → mandatory blocker naming it', () => {
    const courses = { 'p': { course_id: 'p', name_he: 'נוכח', effective_allowed_semesters: SEMESTERS.map(s => s.id) } };
    const ctx = baseCtx(courses, { requiredMandatoryCourseIds: ['MAND1'] });
    ctx.courses['MAND1'] = { course_id: 'MAND1', name_he: 'מכניקה אנליטית' };
    const r = validate(semProposal({ year_3_semester_a: ['p'] }), ctx);
    const b = r.blockers.find(x => x.cause === 'mandatory');
    expect(b).toBeTruthy();
    expect(b.message_he).toContain('מכניקה אנליטית');
  });

  test('unsatisfied elective category → category_requirements blocker naming it', () => {
    const courses = { 'p': { course_id: 'p', name_he: 'נוכח', effective_allowed_semesters: SEMESTERS.map(s => s.id) } };
    const ctx = baseCtx(courses, {
      categoryRequirements: [{ name: 'אנרגיה', required: 1, availableElectiveIds: ['E1', 'E2'] }],
    });
    const r = validate(semProposal({ year_3_semester_a: ['p'] }), ctx);
    const b = r.blockers.find(x => x.cause === 'category_requirements');
    expect(b).toBeTruthy();
    expect(b.message_he).toContain('אנרגיה');
  });

  test('semester over HARD_LOAD_CAP without acceptance → overload blocker', () => {
    const courses = {
      'big': { course_id: 'big', name_he: 'כבד', hours: 28, effective_allowed_semesters: SEMESTERS.map(s => s.id) },
    };
    const r = validate(semProposal({ year_3_semester_a: ['big'] }), baseCtx(courses));
    const b = r.blockers.find(x => x.cause === 'overload');
    expect(b).toBeTruthy();
    expect(b.semester_id).toBe('year_3_semester_a');
  });

  test('overload accepted+confirmed → 28h is allowed (no overload blocker, > absolute still blocks)', () => {
    const courses = {
      'big': { course_id: 'big', name_he: 'כבד', hours: 28, effective_allowed_semesters: SEMESTERS.map(s => s.id) },
    };
    const ctx = baseCtx(courses, { overloadAccepted: true, overloadConfirmedAt: '2026-01-01' });
    const r = validate(semProposal({ year_3_semester_a: ['big'] }), ctx);
    expect(causesOf(r)).not.toContain('overload');
  });
});

describe('difficulty_sanity — warning, not a blocker', () => {
  const estimate = new Function(`${grab('estimateCourseDifficultyLocal')}\nreturn estimateCourseDifficultyLocal;`)();

  test('mandatory course without explicit difficulty → warning, still applicable', () => {
    const courses = {
      'md': { course_id: 'md', name_he: 'מעבר חום', course_type: 'mandatory', weekly_hours: 4,
        syllabus_summary_he: 'הולכה והסעה', effective_allowed_semesters: SEMESTERS.map(s => s.id) },
    };
    const ctx = baseCtx(courses, { helpers: { computeDegreeProgress: progressStub(185), estimateCourseDifficultyLocal: estimate } });
    const r = validate(semProposal({ year_3_semester_a: ['md'] }), ctx);
    expect(r.applicable).toBe(true); // difficulty is a sanity WARNING, not a blocker
    expect(r.warnings.some(w => w.cause === 'difficulty_sanity')).toBe(true);
  });
});

describe('G — multiple blockers + specific recovery message', () => {
  const isEligible = new Function(
    `const EXCLUDED_COURSE_NAME_PATTERNS = ['מצטיינים'];\n` +
    `const EXCLUDED_COURSE_NAMES = ['פרויקט יישומי בהנדסה מכנית'];\n` +
    `${grab('_normalizeCourseNameLocal')}\n${grab('isCourseEligibleLocal')}\nreturn isCourseEligibleLocal;`,
  )();
  const courses = {
    '0542-4223': { course_id: '0542-4223', name_he: 'בקרה אוטומטית',
      effective_allowed_semesters: ['year_3_semester_a', 'year_4_semester_a'] },
    '0542-4624': { course_id: '0542-4624', name_he: 'מעבדה ברובוטיקה ובקרה',
      effective_allowed_semesters: SEMESTERS.map(s => s.id), missing_prerequisites: ['0542-4621'] },
  };

  test('board with illegal semester + missing prereq + missing hours → distinct causes', () => {
    const ctx = baseCtx(courses, {
      helpers: { computeDegreeProgress: progressStub(128.5), isCourseEligibleLocal: isEligible },
    });
    const r = validate(
      semProposal({ year_3_semester_b: ['0542-4223'], year_3_semester_a: ['0542-4624'] }),
      ctx,
    );
    expect(r.applicable).toBe(false);
    const causes = new Set(causesOf(r));
    expect(causes.has('illegal_semester')).toBe(true);
    expect(causes.has('prerequisite')).toBe(true);
    expect(causes.has('degree_completion')).toBe(true);
  });

  test('recovery message is specific (not a generic repeated string)', () => {
    const blockers = [
      { cause: 'degree_completion', message_he: 'חסרות 56.5 ש״ש להשלמת התואר (128.5 מתוך 185).' },
      { cause: 'illegal_semester', message_he: 'בקרה אוטומטית מותר רק בסמסטר שנה ג׳ סמסטר א׳.' },
    ];
    const shape = blockersToShape({ applicable: false, blockers });
    const diag = diagnose(shape);
    expect(diag.category).not.toBe('unknown');
    expect(diag.explanation_he.length).toBeGreaterThan(0);
    expect(diag.chips.length).toBeGreaterThan(0);
  });

  test('eligibility cause maps to a targeted recovery (not generic)', () => {
    const shape = blockersToShape({
      applicable: false,
      blockers: [{ cause: 'eligibility', message_he: 'אלגוריתמים אינו זמין לפרופיל הנוכחי (קורס מצטיינים/מוחרג).' }],
    });
    const diag = diagnose(shape);
    expect(diag.category).toBe('eligibility');
  });
});

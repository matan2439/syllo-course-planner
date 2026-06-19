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

  test('build path makes total<required an unconditional blocking reason (after exhaustive refill)', () => {
    // Issue 2 — the missing-hours blocker is now computed on the FINAL
    // post-refill proposal (degreeHoursStatusFinal), not the pre-filter status.
    expect(html).toContain('!degreeHoursStatusFinal.satisfied && degreeHoursStatusFinal.missing_hours > 0');
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

// ─────────────────────────────────────────────────────────────────────────
// NEW coverage for the four production issues in this task.
// ─────────────────────────────────────────────────────────────────────────

describe('Issue 1 — annual course renders as ONE spanning block', () => {
  const SEM_HE = { year_3_semester_a: 'שנה ג׳ — סמסטר א׳', year_3_semester_b: 'שנה ג׳ — סמסטר ב׳' };
  const annualBandHtml = new Function('esc', 'SEM_HE', 'showCourseDetail',
    `${grab('annualBandHtml')}\nreturn annualBandHtml;`,
  )(x => String(x), SEM_HE, () => {});

  const annual = {
    course_id: '0542-3792', name_he: 'הנדסת ניסויים ומדידות - מעבדה', weekly_hours: 4,
    is_annual: true, placement_policy: 'annual',
    spans_semesters: ['year_3_semester_a', 'year_3_semester_b'],
    semester_load_hours_by_semester: { year_3_semester_a: 4, year_3_semester_b: 4 },
  };

  test('renders a SINGLE spanning element with data-annual-span (not two cards)', () => {
    const out = annualBandHtml(annual);
    expect(out).toContain('data-annual-span="year_3_semester_a,year_3_semester_b"');
    expect(out).toContain('data-course="0542-3792"');
    expect((out.match(/class="annual-band"/g) || []).length).toBe(1);
    expect(out).toContain(annual.name_he);
  });

  test('uses NORMAL mandatory styling — no striped/hatched .card-annual class', () => {
    const out = annualBandHtml(annual);
    // No striped/hatched special card class on the spanning element.
    expect(out).not.toContain('card-annual');
    // Keeps a normal-style "שנתי (א׳+ב׳)" badge.
    expect(out).toContain('bdg-annual');
    // The source no longer applies the striped card-annual class to any card,
    // and the striped .card-annual CSS rule is gone.
    expect(html).not.toContain("cls += ' card-annual'");
    expect(html).not.toMatch(/\.card-annual\s*\{/);
    // The .annual-band element is styled with the normal mandatory accent /
    // lock background and a hatch-free background.
    expect(html).toMatch(/\.annual-band\s*\{[^}]*var\(--mand-accent\)/);
    expect(html).toMatch(/\.annual-band\s*\{[^}]*var\(--mand-lock-bg\)/);
    expect(html).not.toMatch(/\.annual-band\s*\{[^}]*repeating-linear-gradient/);
  });

  test('spans both semester columns via grid-column inside the course-card grid', () => {
    // grid-column: 1 / -1 makes the single block span both columns.
    expect(html).toMatch(/\.annual-band\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    // The hosting container (.year-sems-cards) is a CSS grid (so the span is honored).
    expect(html).toMatch(/\.year-sems-cards\s*\{[^}]*display:\s*grid/);
  });

  test('semColHtml excludes annual courses from per-column cards (no duplicate card)', () => {
    // The column builder filters annual ids out of its card list.
    expect(html).toContain('.filter(id => !isAnnualCourse(courseMap[id]))');
  });

  test('renderBoard places annual band inside the course-card area, below headers', () => {
    // Issue 1 — the annual block is now inside .year-sems-cards (course-card area),
    // AFTER the headers, with annual band spanning both columns BEFORE normal courses.
    // The structure is: headers row, then cards row with annual band + zones.
    expect(html).toContain('annualCoursesForYear(yg.sems).map(annualBandHtml)');
    expect(html).toContain('.year-sems-headers');
    expect(html).toContain('.year-sems-cards');
    expect(html).toContain('semHeaderHtml');
    expect(html).toContain('semZoneHtml');
    // Annual band is inside .year-sems-cards (the course-card container), not outside.
    expect(html).toContain('${annualBands}${zones}');
  });

  test('annual band uses normal card height (compact single-row, note collapsed)', () => {
    // The .annual-band gets a card box-shadow and a 5px accent border like a
    // locked/mandatory course card; the explanatory note is collapsed (display:none) so
    // the block keeps a normal single-row card height (not a tall banner).
    expect(html).toMatch(/\.annual-band\s*\{[^}]*box-shadow:\s*var\(--shadow\)/);
    expect(html).toMatch(/\.annual-band\s*\{[^}]*border-inline-start:\s*5px/);
    expect(html).toMatch(/\.annual-band\s\.annual-band-note\s*\{\s*display:\s*none/);
  });

  test('annual band is movable ONLY as a whole unit and only if a legal alternative span exists', () => {
    // A single allowed span pair (the 3792 case) → no alternative → locked.
    const annualBandHtml2 = new Function('esc', 'SEM_HE', 'showCourseDetail', 'annualAlternativeSpanLocal',
      `${grab('annualBandHtml')}\nreturn annualBandHtml;`,
    )(x => String(x), SEM_HE, () => {}, () => null);
    const locked = annualBandHtml2(annual);
    expect(locked).toContain('data-locked="1"');
    expect(locked).not.toContain('data-annual-movable="1"');
    // No per-column halves: a single spanning element only.
    expect((locked.match(/class="annual-band"/g) || []).length).toBe(1);

    // When an alternative legal span pair exists, the WHOLE block is movable.
    const annualBandHtml3 = new Function('esc', 'SEM_HE', 'showCourseDetail', 'annualAlternativeSpanLocal',
      `${grab('annualBandHtml')}\nreturn annualBandHtml;`,
    )(x => String(x), SEM_HE, () => {}, () => ['year_2_semester_a', 'year_2_semester_b']);
    const movable = annualBandHtml3(annual);
    expect(movable).toContain('data-annual-movable="1"');
    expect(movable).not.toContain('data-locked="1"');
  });

  test('annualAlternativeSpanLocal returns null for a single allowed span pair', () => {
    const fn = new Function(`${grab('annualAlternativeSpanLocal')}\nreturn annualAlternativeSpanLocal;`)();
    // Only year_3 a/b allowed and that IS the current span → no alternative.
    expect(fn({
      spans_semesters: ['year_3_semester_a', 'year_3_semester_b'],
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'],
    })).toBeNull();
    // A second full a/b pair in another year → that pair is the alternative.
    expect(fn({
      spans_semesters: ['year_3_semester_a', 'year_3_semester_b'],
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b', 'year_2_semester_a', 'year_2_semester_b'],
    })).toEqual(['year_2_semester_a', 'year_2_semester_b']);
  });

  test('annual band card styling matches locked/mandatory cards for visual consistency', () => {
    // Issue 1 regression fix — the annual band was rendering as a thin banner
    // instead of a normal card. The CSS must match locked card padding + height.
    // Annual band padding should match .card-main (9px 11px 8px), not be too compact.
    expect(html).toMatch(/\.annual-band\s*\{[^}]*padding:\s*9px\s+11px\s+8px/);
    // Border width should match locked cards (5px), not be thinner (4px).
    expect(html).toMatch(/\.annual-band\s*\{[^}]*border-inline-start:\s*5px\s+solid\s+var\(--mand-accent\)/);
    // Min height should be sufficient for readable content, not a 1-line banner.
    expect(html).toMatch(/\.annual-band\s+\.annual-band-hdr\s*\{[^}]*min-height:\s*2\.[2-9]em/);
    // Header should allow wrapping for multi-line layout like normal cards.
    expect(html).toMatch(/\.annual-band\s+\.annual-band-hdr\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  test('annual band is positioned inside course-card area, not as separate banner above headers', () => {
    // Issue 1 regression fix — the annual band was appearing as a separate band
    // ABOVE the semester headers and course-card area. It must now be INSIDE
    // the course-card container (.year-sems-cards) BELOW the headers.

    // .year-sems-cards must exist as a separate container for course cards.
    expect(html).toContain('class="year-sems-cards"');

    // Annual band is rendered as a child of .year-sems-cards (course-card area),
    // BEFORE the normal semester zones, with grid-column: 1 / -1 to span both.
    expect(html).toContain('${annualBands}${zones}');
    expect(html).toMatch(/\.year-sems-cards\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr\s+1fr/);

    // Annual band grid-column: 1 / -1 makes it span both columns in the cards grid.
    expect(html).toMatch(/\.annual-band\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);

    // .sem-zone no longer needs special grid positioning—it auto-places after
    // the annual band as a normal grid child (the annual band takes row N,
    // zones take rows N+1, N+2 per the auto-placement).
    expect(html).toContain('.sem-zone');

    // Headers are in a separate container above cards, not mixed inside .year-sems-cards.
    expect(html).toContain('class="year-sems-headers"');
    expect(html).toMatch(/\.year-sems-headers\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr\s+1fr/);
  });

  test('annual band DOM order: inside year-sems-cards before sem-zones', () => {
    // Verify the rendering produces the correct DOM order:
    // <div class="year-sems">
    //   <div class="year-sems-headers">...</div>
    //   <div class="year-sems-cards">
    //     <div class="annual-band">...</div>
    //     <div class="sem-zone">...</div>
    //     <div class="sem-zone">...</div>
    //   </div>
    // </div>

    // The new renderBoard should call both semHeaderHtml and semZoneHtml.
    expect(html).toContain('semHeaderHtml(s)');
    expect(html).toContain('semZoneHtml(s, draftDiff)');

    // Verify year-sems is now flex (not grid), with two sub-containers.
    expect(html).toMatch(/\.year-sems\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);

    // The rendering structure must place annualBands and zones INSIDE year-sems-cards.
    const renderMatch = html.match(/const annualBands[\s\S]*?const headers[\s\S]*?const zones[\s\S]*?<div class="year-sems">/);
    expect(renderMatch).toBeTruthy();

    // Verify the template string order: headers first (above), then cards with annual+zones.
    expect(html).toContain('<div class="year-sems-headers">${headers}</div>');
    expect(html).toContain('<div class="year-sems-cards">${annualBands}${zones}</div>');
  });
});

describe('Issue 2 — difficulty estimator domain calibration', () => {
  const estimate = new Function(
    `${grab('estimateCourseDifficultyLocal')}\nreturn estimateCourseDifficultyLocal;`,
  )();

  test('Heat Transfer (core, thin syllabus) lands at least medium (>=2.5)', () => {
    const ht = {
      course_id: '0542-3620', name_he: 'מעבר חום', weekly_hours: 4, course_type: 'mandatory',
      is_mandatory: true, difficulty_score: null,
      syllabus_summary_he: 'Introduction: conduction, convection and radiation.',
      prerequisites: [],
    };
    expect(estimate(ht)).toBeGreaterThanOrEqual(2.5);
  });

  test('Heat Transfer even with the board typo "מעבר חם" still >=2.5', () => {
    const ht = { name_he: 'מעבר חם', weekly_hours: 4, course_type: 'mandatory', is_mandatory: true };
    expect(estimate(ht)).toBeGreaterThanOrEqual(2.5);
  });

  test('a hard core course ranks strictly above an easy general elective', () => {
    const solid = { course_id: 's', name_he: 'מכניקת מוצקים', weekly_hours: 3, course_type: 'mandatory', is_mandatory: true };
    const easy = { course_id: 'e', name_he: 'מבוא לכתיבה טכנית', weekly_hours: 2, course_type: 'elective', syllabus_summary_he: 'כתיבה.' };
    expect(estimate(solid)).toBeGreaterThan(estimate(easy));
  });

  test('a mandatory core course with no syllabus is NOT falsely easy (<1.5)', () => {
    const bare = { course_id: 'm', name_he: 'תרמודינמיקה', course_type: 'mandatory', is_mandatory: true };
    expect(estimate(bare)).toBeGreaterThanOrEqual(1.5);
  });

  test('no signal at all still returns null', () => {
    expect(estimate({ course_id: 'x', weekly_hours: null, semester_hours: null })).toBeNull();
  });
});

describe('Issue 3 — proposal pipeline auto-enforces semester legality', () => {
  const SEM_HE = { year_3_semester_a: 'ג׳-א׳', year_3_semester_b: 'ג׳-ב׳', year_4_semester_a: 'ד׳-א׳', year_4_semester_b: 'ד׳-ב׳' };
  const courseMap = {
    '0542-4223': { course_id: '0542-4223', name_he: 'מבוא לאלמנטים סופיים', weekly_hours: 4,
      effective_allowed_semesters: ['year_3_semester_a', 'year_4_semester_a'] },
  };
  const MAX_HOURS = 26;
  const factory = new Function('courseMap', 'SEM_HE', 'MAX_HOURS', 'isAnnualCourse',
    'getLegalSemestersLocal', 'isCourseAllowedInSemesterLocal',
    `${grab('enforceLegalPlacementsLocal')}\nreturn enforceLegalPlacementsLocal;`,
  );
  const isAnnualCourse = new Function(`${grab('isAnnualCourse')}\nreturn isAnnualCourse;`)();
  const getLegalSemestersLocal = new Function('SEMESTERS',
    `${grab('getLegalSemestersLocal')}\nreturn getLegalSemestersLocal;`,
  )([{ id: 'year_3_semester_a' }, { id: 'year_3_semester_b' }, { id: 'year_4_semester_a' }, { id: 'year_4_semester_b' }]);
  const isCourseAllowedInSemesterLocal = new Function('getLegalSemestersLocal',
    `${grab('isCourseAllowedInSemesterLocal')}\nreturn isCourseAllowedInSemesterLocal;`,
  )(getLegalSemestersLocal);
  const enforce = factory(courseMap, SEM_HE, MAX_HOURS, isAnnualCourse, getLegalSemestersLocal, isCourseAllowedInSemesterLocal);

  test('0542-4223 placed in Semester B is relocated to a legal Semester A', () => {
    const proposal = { semesters: [
      { semester_id: 'year_3_semester_a', course_ids: [] },
      { semester_id: 'year_3_semester_b', course_ids: ['0542-4223'] },
      { semester_id: 'year_4_semester_a', course_ids: [] },
      { semester_id: 'year_4_semester_b', course_ids: [] },
    ] };
    const { proposal: out, relocated } = enforce(proposal, { courses: { '0542-4223': { hours: 4 } } });
    const semB = out.semesters.find(s => s.semester_id === 'year_3_semester_b');
    expect(semB.course_ids).not.toContain('0542-4223');
    const landed = out.semesters.find(s => s.course_ids.includes('0542-4223'));
    expect(['year_3_semester_a', 'year_4_semester_a']).toContain(landed.semester_id);
    expect(relocated.some(r => r.course_id === '0542-4223')).toBe(true);
  });

  test('board_audit fails on 4223 in Semester B (general placement check exists)', () => {
    const audit = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'analysis', 'board_audit.py'), 'utf8');
    expect(audit).toContain('GENERAL placement legality');
    expect(audit).toMatch(/effective and sem_id not in effective/);
  });
});

describe('Issue 4 — robotics-lab prerequisite enforcement (union + strict timing)', () => {
  const prereqIdsOf = new Function(`${grab('prereqIdsOf')}\nreturn prereqIdsOf;`)();

  test('prereqIdsOf returns the UNION of prerequisites + missing_prerequisites', () => {
    expect(prereqIdsOf({ prerequisites: ['A'], missing_prerequisites: ['B'] }).sort()).toEqual(['A', 'B']);
    expect(prereqIdsOf({ missing_prerequisites: ['0542-4621'] })).toEqual(['0542-4621']);
    expect(prereqIdsOf({})).toEqual([]);
  });

  test('strict timing: completed / strictly-earlier satisfies; same-sem / later / missing does NOT', () => {
    // INTRO is an IN-SCOPE prereq (present in courseMap) — mirrors production where
    // מבוא לרובוטיקה (0542-4621) is a program course. In-scope prereqs are strictly
    // timing-enforced; only foundational year-1/2 prereqs ABSENT from courseMap are
    // assumed completed (covered by planner_user_intent_focus.test.js Test 10).
    const courseMap = { ROBOLAB: { missing_prerequisites: ['INTRO'] }, INTRO: { name_he: 'מבוא' } };
    const userCourseStatuses = {};
    const SEMESTERS = [{ id: 's0' }, { id: 's1' }, { id: 's2' }];
    const factory = new Function('courseMap', 'userCourseStatuses', 'SEMESTERS',
      `${grab('prereqIdsOf')}\n${grab('prereqGroupsOf')}\n${grab('_semIndexOf')}\n${grab('_userSemesterIndex')}\n${grab('prereqsSatisfiedForPlacementLocal')}\nreturn prereqsSatisfiedForPlacementLocal;`,
    );
    const fn = factory(courseMap, userCourseStatuses, SEMESTERS);
    // prereq scheduled earlier (idx 0), lab at idx 1 → ok
    expect(fn('ROBOLAB', 1, { INTRO: 0 }, new Set()).ok).toBe(true);
    // same semester (both idx 1) → NOT ok
    expect(fn('ROBOLAB', 1, { INTRO: 1 }, new Set()).ok).toBe(false);
    // later (idx 2) → NOT ok
    expect(fn('ROBOLAB', 1, { INTRO: 2 }, new Set()).ok).toBe(false);
    // not scheduled at all → NOT ok
    expect(fn('ROBOLAB', 1, {}, new Set()).ok).toBe(false);
    // completed → ok
    expect(fn('ROBOLAB', 1, {}, new Set(['INTRO'])).ok).toBe(true);
  });
});

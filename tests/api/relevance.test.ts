/**
 * Phase 2A/2B — generic relevance scoring (api/ai/relevance.ts).
 *
 * Verifies that:
 *   - extractPreferenceTerms works for arbitrary Hebrew/English requests
 *     (no hardcoded topic-specific paths).
 *   - lexicalRelevance against a course's syllabus text picks the better
 *     match for any topic the user mentions (design, control, structural,
 *     etc.) without any per-topic special case.
 *   - courseUtility scores practical courses (labs/projects) higher than
 *     boilerplate ones.
 *   - avoid terms produce negative lexicalRelevance scores.
 */

import {
  extractPreferenceTerms,
  buildCourseSearchText,
  lexicalRelevance,
  courseUtility,
  buildSelectionReason,
  resolveAvoidedCourseIds,
  normalizeCourseName,
  type CourseLike,
} from '../../api/ai/relevance';

describe('Issue C — explicit course-name avoid resolution (general)', () => {
  const courses = [
    { course_id: 'T2', name_he: 'תרמודינמיקה (2)' },
    { course_id: 'T1', name_he: 'תרמודינמיקה (1)' },
    { course_id: 'HEAT', name_he: 'מעבר חום' },
    { course_id: 'VIB', name_he: 'רעידות ותנודות' },
  ];

  it('resolves "לא רוצה תרמודינמיקה (2)" to T2 only (not T1, not מעבר חום)', () => {
    const ids = resolveAvoidedCourseIds('לא רוצה תרמודינמיקה (2)', courses);
    expect([...ids]).toEqual(['T2']);
  });

  it('tolerates "בלי תרמודינמיקה 2" suffix without parens', () => {
    const ids = resolveAvoidedCourseIds('בלי תרמודינמיקה 2', courses);
    expect([...ids]).toEqual(['T2']);
  });

  it('works for a different named course (general, not thermo-specific)', () => {
    const ids = resolveAvoidedCourseIds('להימנע מרעידות ותנודות', courses);
    expect([...ids]).toEqual(['VIB']);
  });

  it('returns empty when no avoid intent present', () => {
    const ids = resolveAvoidedCourseIds('אני אוהב תרמודינמיקה (2)', courses);
    expect(ids.size).toBe(0);
  });

  it('normalizeCourseName folds ב\' suffix to a digit', () => {
    expect(normalizeCourseName("תרמודינמיקה ב'")).toBe(normalizeCourseName('תרמודינמיקה 2'));
  });
});

function course(overrides: Partial<CourseLike>): CourseLike {
  return {
    name_he: '',
    syllabus_summary_he: '',
    syllabus_topics_he: [],
    syllabus_assessment_he: '',
    syllabus_structure_he: '',
    program_category_name_he: '',
    course_type: '',
    ...overrides,
  };
}

describe('extractPreferenceTerms', () => {
  it('extracts interest terms from arbitrary Hebrew design/product-dev request', () => {
    const out = extractPreferenceTerms('אני רוצה מסלול תכן מכני ופיתוח מוצר עם קורסים פרקטיים');
    expect(out.interest_terms).toEqual(expect.arrayContaining(['תכן', 'מכני', 'פיתוח', 'מוצר']));
    expect(out.wants_practical).toBe(true);
    // Generic: no special bucket for "design" topic.
    expect((out as any).fem_analysis).toBeUndefined();
  });

  it('parses grade_target via Hebrew ממוצע NN syntax', () => {
    const out = extractPreferenceTerms('אנליזות חוזק ויברציות וזרימה עם זיקה לרובוטיקה ומכטרוניקה, ממוצע מעל 82');
    expect(out.grade_target).toBe(82);
    expect(out.interest_terms).toEqual(expect.arrayContaining(['רובוטיקה', 'מכטרוניקה']));
  });

  it('routes negated tokens into avoid_terms via בלי/פחות/לא רוצה', () => {
    const out = extractPreferenceTerms('אני רוצה כמה שפחות תרמודינמיקה');
    expect(out.avoid_terms).toEqual(expect.arrayContaining(['תרמודינמיקה']));
    expect(out.interest_terms).not.toContain('תרמודינמיקה');
  });

  it('detects wants_easy and grade_target together', () => {
    const out = extractPreferenceTerms('מסלול קל יחסית עם ממוצע גבוה');
    expect(out.wants_easy).toBe(true);
    // No explicit numeric target — should be undefined, not a false positive.
    expect(out.grade_target).toBeUndefined();
  });

  it('detects industry-value and pushes "נישתיים" into avoid_terms', () => {
    const out = extractPreferenceTerms('ערך תעשייתי גבוה ולא קורסים נישתיים');
    expect(out.wants_industry_value).toBe(true);
    // Normalized form may have plural suffix stripped (נישתיים -> נישתי), so
    // check that any avoid term shares the stem.
    expect(out.avoid_terms.some(t => t.startsWith('נישתי'))).toBe(true);
  });
});

describe('lexicalRelevance — generic, topic-agnostic', () => {
  it('arbitrary design request: practical/design course beats boilerplate', () => {
    const designCourse = course({
      name_he: 'תכן מכני מתקדם',
      syllabus_summary_he: 'הקורס עוסק בתכן מכני, פרויקט אישי, מעבדה ושימוש בכלי CAD לפיתוח מוצר.',
      syllabus_topics_he: ['תכן', 'פרויקט', 'CAD', 'פיתוח מוצר'],
    });
    const boilerplate = course({
      name_he: 'מבוא לסטטיסטיקה',
      syllabus_summary_he: 'שעות: 4 ש"ס',
    });
    const prefs = extractPreferenceTerms('אני רוצה מסלול תכן מכני ופיתוח מוצר עם קורסים פרקטיים');
    const a = lexicalRelevance(buildCourseSearchText(designCourse), prefs);
    const b = lexicalRelevance(buildCourseSearchText(boilerplate), prefs);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.matched_terms.length).toBeGreaterThan(0);
  });

  it('FEM/vibrations request: relevant course beats unrelated thermo course (no hardcoding)', () => {
    const femCourse = course({
      name_he: 'מבוא לאלמנטים סופיים',
      syllabus_summary_he: 'אלמנטים סופיים, תורת התנודות, אנליזות חוזק.',
      syllabus_topics_he: ['אלמנטים סופיים', 'תנודות', 'חוזק'],
    });
    const thermo = course({
      name_he: 'תרמודינמיקה 2',
      syllabus_summary_he: 'מחזורים תרמודינמיים, אנטרופיה, גזים.',
      syllabus_topics_he: ['תרמודינמיקה', 'גזים'],
    });
    const prefs = extractPreferenceTerms('אנליזות חוזק ויברציות וזרימה עם זיקה לרובוטיקה ומכטרוניקה, ממוצע מעל 82');
    const a = lexicalRelevance(buildCourseSearchText(femCourse), prefs);
    const b = lexicalRelevance(buildCourseSearchText(thermo), prefs);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('avoid request: thermodynamics course gets a negative score', () => {
    const thermo = course({
      name_he: 'תרמודינמיקה',
      syllabus_summary_he: 'מבוא לתרמודינמיקה: אנרגיה, אנטרופיה, מחזורים.',
      syllabus_topics_he: ['תרמודינמיקה', 'אנטרופיה'],
    });
    const prefs = extractPreferenceTerms('אני רוצה כמה שפחות תרמודינמיקה');
    expect(prefs.avoid_terms).toContain('תרמודינמיקה');
    const out = lexicalRelevance(buildCourseSearchText(thermo), prefs);
    expect(out.score).toBeLessThan(0);
    expect(out.avoided_terms).toContain('תרמודינמיקה');
  });

  it('arbitrary control/systems request: control course beats unrelated structural course', () => {
    const controlCourse = course({
      name_he: 'בקרה לינארית',
      syllabus_summary_he: 'תכן בקרה למערכות לינאריות, יציבות, תגובת תדר.',
      syllabus_topics_he: ['בקרה', 'מערכות לינאריות', 'יציבות'],
    });
    const structural = course({
      name_he: 'מכניקת מבנים',
      syllabus_summary_he: 'ניתוח מבנים סטטיים, קורות, מסבכים.',
      syllabus_topics_he: ['מבנים', 'קורות'],
    });
    const prefs = extractPreferenceTerms('אני רוצה להתמקד בבקרה ומערכות');
    const a = lexicalRelevance(buildCourseSearchText(controlCourse), prefs);
    const b = lexicalRelevance(buildCourseSearchText(structural), prefs);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.matched_terms).toEqual(expect.arrayContaining(['בקרה']));
  });
});

describe('courseUtility', () => {
  it('lab/project course scores higher than boilerplate', () => {
    const labCourse = course({
      name_he: 'מעבדה בהנדסת חומרים',
      syllabus_summary_he: 'הקורס כולל פרויקט מעשי, דוחות שבועיים, ניסויי מעבדה והגשת מצגת מסכמת.',
      syllabus_assessment_he: 'דוח מעבדה, פרויקט, מצגת',
      syllabus_topics_he: ['מעבדה', 'פרויקט', 'דוחות', 'ניסויים', 'מצגות'],
    });
    const boilerplate = course({
      name_he: 'מבוא לסטטיסטיקה',
      syllabus_summary_he: 'שעות: 4 ש"ס',
    });
    const a = courseUtility(labCourse);
    const b = courseUtility(boilerplate);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons.length).toBeGreaterThan(0);
  });
});

describe('buildSelectionReason — facts only, no static topic strings', () => {
  it('composes matched terms + utility + category into one Hebrew line', () => {
    const r = buildSelectionReason({
      matched_terms: ['תכן', 'מעבדה'],
      utility_reasons: ['פרויקט'],
      category: 'התמחות מכנית',
    });
    expect(r).toContain('תכן');
    expect(r).toContain('פרויקט');
    expect(r).toContain('התמחות מכנית');
    // Never the old fixed strings.
    expect(r).not.toContain('FEM');
  });

  it('falls back to a generic line when no facts are available', () => {
    const r = buildSelectionReason({});
    expect(r).toBe('נבחר על בסיס התאמה כללית');
  });
});

describe('Issue 2 — avoid-term parsing & penalty (general, no hardcoding)', () => {
  it('"לא רוצה תרמודינמיקה כקורס בחירה": תרמודינמיקה is an avoid term; generic words (בחירה/קורס) do NOT leak', () => {
    const out = extractPreferenceTerms('לא רוצה תרמודינמיקה כקורס בחירה');
    expect(out.avoid_terms).toContain('תרמודינמיקה');
    // Generic curriculum words must never become avoid terms — they would
    // otherwise substring-match nearly every elective.
    expect(out.avoid_terms).not.toContain('בחירה');
    expect(out.avoid_terms).not.toContain('כקורס');
    expect(out.avoid_terms).not.toContain('קורס');
    // The prefix-stripping heuristic must not leak a mangled fragment of בחירה.
    expect(out.avoid_terms).not.toContain('חירה');
  });

  it('an elective thermo course scores negative vs a neutral elective (lexicalRelevance)', () => {
    const prefs = extractPreferenceTerms('לא רוצה תרמודינמיקה כקורס בחירה');
    const thermo = lexicalRelevance(buildCourseSearchText(course({
      name_he: 'מבוא לתרמודינמיקה',
      syllabus_topics_he: ['תרמודינמיקה', 'אנתרופיה'],
    })), prefs);
    const neutral = lexicalRelevance(buildCourseSearchText(course({
      name_he: 'מבוא לרובוטיקה',
      syllabus_topics_he: ['רובוטיקה', 'בקרה'],
    })), prefs);
    expect(thermo.score).toBeLessThan(0);
    expect(thermo.avoided_terms).toContain('תרמודינמיקה');
    expect(neutral.score).toBeGreaterThanOrEqual(thermo.score);
  });

  it('GENERALITY — a different avoid topic (אלקטרוניקה) lands in avoid_terms and penalizes a matching elective', () => {
    const prefs = extractPreferenceTerms('אני רוצה להימנע מאלקטרוניקה');
    expect(prefs.avoid_terms).toContain('אלקטרוניקה');
    const elec = lexicalRelevance(buildCourseSearchText(course({
      name_he: 'אלקטרוניקה אנלוגית',
      syllabus_topics_he: ['אלקטרוניקה', 'מעגלים'],
    })), prefs);
    expect(elec.score).toBeLessThan(0);
  });

  it('GENERALITY — "כמה שפחות ביולוגיה" penalizes a biology elective', () => {
    const prefs = extractPreferenceTerms('כמה שפחות ביולוגיה');
    const bio = lexicalRelevance(buildCourseSearchText(course({
      name_he: 'מבוא לביולוגיה',
      syllabus_topics_he: ['ביולוגיה', 'תאים'],
    })), prefs);
    expect(bio.score).toBeLessThan(0);
  });
});

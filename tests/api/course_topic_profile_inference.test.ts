/**
 * Deterministic Course Topic inference — tests for api/ai/course_topic_profile_inference.ts.
 *
 * inferCourseTopicProfile maps a CatalogCourse (courseId + nameHe + categoryId)
 * to a CourseTopicProfile using ONLY explicit, deterministic keyword/category
 * rules (Hebrew primary, English secondary). No syllabus-text mining, no LLM,
 * no unbounded name inference. Conservative weights; honest 'default' +
 * needs_review note when no topic area can be confidently inferred.
 */

import {
  inferCourseTopicProfile,
  inferFocusAreasFromText,
  NEEDS_REVIEW_NOTE_PREFIX,
} from '../../api/ai/course_topic_profile_inference';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';

function topicAreas(courseId: string, nameHe: string | null, categoryId: string | null = null) {
  return inferCourseTopicProfile({ courseId, nameHe, categoryId }).topics.map((t) => t.area);
}
function styleNames(courseId: string, nameHe: string | null, categoryId: string | null = null) {
  return inferCourseTopicProfile({ courseId, nameHe, categoryId }).styles.map((s) => s.style);
}

describe('inferFocusAreasFromText — reuse the SAME keyword vocabulary for user-side free text', () => {
  test('"בתכן" (in design) → mechanical_design (same rule as course names)', () => {
    expect(inferFocusAreasFromText('בתכן')).toContain('mechanical_design');
    expect(inferFocusAreasFromText('להתמקד בתכן')).toContain('mechanical_design');
  });
  test('non-domain / control text resolves to its canonical area, empty when nothing matches', () => {
    expect(inferFocusAreasFromText('בקרה')).toContain('control_systems');
    expect(inferFocusAreasFromText('משהו כללי בלי דומיין')).toEqual([]);
  });

  test('the broad ambiguous token "מכונות" alone is NOT sufficient proof of mechanical_design', () => {
    // A machine course (e.g. "תורת המכונות" = theory of machines) is not a design course.
    // Design alignment must come from evidence, not this broad title token.
    expect(inferFocusAreasFromText('מכונות')).not.toContain('mechanical_design');
    expect(inferFocusAreasFromText('תורת המכונות')).not.toContain('mechanical_design');
    // the direct design word still resolves
    expect(inferFocusAreasFromText('תכן')).toContain('mechanical_design');
  });
});

describe('inferCourseTopicProfile — Hebrew topic keyword rules', () => {
  test('זורמים / זרימה -> fluids', () => {
    expect(topicAreas('C', 'מכניקת הזורמים (2)')).toContain('fluids');
    expect(topicAreas('C', 'מעבדת זרימה ומעבר חום')).toContain('fluids');
  });

  test('מעבר חום / מעבר חם -> heat_transfer', () => {
    expect(topicAreas('C', 'תהליכי מעבר חום וחומר')).toContain('heat_transfer');
    expect(topicAreas('C', 'מעבר חם')).toContain('heat_transfer');
  });

  test('אלמנטים סופיים -> finite_elements', () => {
    expect(topicAreas('C', 'מבוא לאלמנטים סופיים')).toContain('finite_elements');
  });

  test('מוצקים / אלסטיות / תנודות -> strength_analysis', () => {
    expect(topicAreas('C', 'מכניקת המוצקים (2)')).toContain('strength_analysis');
    expect(topicAreas('C', 'מבוא לתורת האלסטיות')).toContain('strength_analysis');
    expect(topicAreas('C', 'תורת התנודות')).toContain('strength_analysis');
  });

  test('תכן / תיכון -> mechanical_design', () => {
    expect(topicAreas('C', 'תכן הנדסי: מבוא ושיטות')).toContain('mechanical_design');
    expect(topicAreas('C', 'תיכון ופרוייקט (1)')).toContain('mechanical_design');
  });

  test('בקרה / משוב -> control_systems', () => {
    expect(topicAreas('C', 'מבוא לבקרה')).toContain('control_systems');
    expect(topicAreas('C', 'מערכות משוב שימושיות')).toContain('control_systems');
  });

  test('רובוטיקה / מכאטרוניקה -> robotics', () => {
    expect(topicAreas('C', 'מבוא לרובוטיקה')).toContain('robotics');
    expect(topicAreas('C', 'מעבדה במכאטרוניקה')).toContain('robotics');
  });

  test('אנרגיה -> energy', () => {
    expect(topicAreas('C', 'אנרגיה מתחדשת')).toContain('energy');
  });

  test('חומרים / פולימר -> materials', () => {
    expect(topicAreas('C', 'מעבדה בחומרים הנדסיים')).toContain('materials');
    expect(topicAreas('C', 'ביו-חומרים פולימרים')).toContain('materials');
  });

  test('ביו / רקמות -> biomechanics', () => {
    expect(topicAreas('C', 'הנדסת תאים ורקמות')).toContain('biomechanics');
    expect(topicAreas('C', 'מבוא לביופיזיקה של התא')).toContain('biomechanics');
  });

  test('תרמודינמיקה -> thermal_systems', () => {
    expect(topicAreas('C', 'תרמודינמיקה (2)')).toContain('thermal_systems');
  });

  test('תהליכי עיבוד -> manufacturing (but signal-processing עיבוד אותות does NOT)', () => {
    expect(topicAreas('C', 'תהליכי עיבוד (1)')).toContain('manufacturing');
    expect(topicAreas('C', 'מבוא לעיבוד אותות')).not.toContain('manufacturing');
  });
});

describe('inferCourseTopicProfile — Hebrew substring false friends (no fabricated topics)', () => {
  test('שריפה פנימית (internal combustion) does NOT get fluids from ימית inside פנימית', () => {
    // 'ימית' (maritime) is a substring of 'פנימית' (internal). A fluids topic here
    // would be fabricated — the name asserts combustion/energy, not fluid mechanics.
    const areas = topicAreas('C', 'מנועי שריפה פנימית');
    expect(areas).not.toContain('fluids');
    // The real, evidenced topics stay: combustion -> thermal_systems, engine -> energy.
    expect(areas).toContain('thermal_systems');
    expect(areas).toContain('energy');
  });

  test('כימית (chemical) does NOT get fluids from ימית inside כימית', () => {
    // Guards the same false friend against a chemistry-named course.
    expect(topicAreas('C', 'הנדסה כימית')).not.toContain('fluids');
  });

  test('הנדסה ימית (marine engineering) still infers fluids (true positive preserved)', () => {
    expect(topicAreas('C', 'הנדסה ימית')).toContain('fluids');
  });
});

describe('inferCourseTopicProfile — English topic keyword rules', () => {
  test('fluid / aerodynamics / CFD -> fluids', () => {
    expect(topicAreas('C', 'Fluid Mechanics')).toContain('fluids');
    expect(topicAreas('C', 'Wind turbine aerodynamics')).toContain('fluids');
  });

  test('finite element / FEM -> finite_elements', () => {
    expect(topicAreas('C', 'Introduction to the Finite Element Method')).toContain('finite_elements');
  });

  test('robotics / mechatronics -> robotics', () => {
    expect(topicAreas('C', 'Introduction to Robotics')).toContain('robotics');
  });
});

describe('inferCourseTopicProfile — category rules', () => {
  test("category 'fluids' contributes a fluids topic", () => {
    expect(topicAreas('C', null, 'fluids')).toContain('fluids');
  });

  test("category 'solids' contributes a strength_analysis topic", () => {
    expect(topicAreas('C', null, 'solids')).toContain('strength_analysis');
  });

  test("category 'advanced_labs' contributes a lab_based style, not a topic area", () => {
    expect(styleNames('C', null, 'advanced_labs')).toContain('lab_based');
    expect(topicAreas('C', null, 'advanced_labs')).toEqual([]);
  });

  test("heterogeneous categories ('systems','other_specialization') do NOT force a topic area", () => {
    expect(topicAreas('C', null, 'systems')).toEqual([]);
    expect(topicAreas('C', null, 'other_specialization')).toEqual([]);
  });
});

describe('inferCourseTopicProfile — style rules', () => {
  test('מעבדה -> lab_based + practical', () => {
    const styles = styleNames('C', 'מעבדה בחומרים הנדסיים');
    expect(styles).toContain('lab_based');
    expect(styles).toContain('practical');
  });

  test('פרויקט / פרוייקט -> project_based', () => {
    expect(styleNames('C', 'פרויקט יישומי בהנדסה מכנית')).toContain('project_based');
    expect(styleNames('C', 'פרוייקט מחקר למצטיינים (1)')).toContain('project_based');
  });

  test('תעשייה -> industry_relevant', () => {
    expect(styleNames('C', 'יישומי אלמנטים סופיים בתעשייה')).toContain('industry_relevant');
  });

  test('יישומי -> practical', () => {
    expect(styleNames('C', 'פרויקט יישומי בהנדסה מכנית')).toContain('practical');
  });
});

describe('inferCourseTopicProfile — honesty & determinism', () => {
  test('no topic area inferred -> source default with a needs_review note', () => {
    const profile = inferCourseTopicProfile({ courseId: 'C', nameHe: 'אתיקה מעשית', categoryId: 'other_specialization' });
    expect(profile.topics).toEqual([]);
    expect(profile.source).toBe('default');
    expect(profile.notes?.some((n) => n.startsWith(NEEDS_REVIEW_NOTE_PREFIX))).toBe(true);
  });

  test('a null-name course with no category is default + needs_review', () => {
    const profile = inferCourseTopicProfile({ courseId: 'C', nameHe: null, categoryId: null });
    expect(profile.topics).toEqual([]);
    expect(profile.styles).toEqual([]);
    expect(profile.source).toBe('default');
    expect(profile.notes?.some((n) => n.startsWith(NEEDS_REVIEW_NOTE_PREFIX))).toBe(true);
  });

  test('at least one topic area inferred -> source inferred, no needs_review note', () => {
    const profile = inferCourseTopicProfile({ courseId: 'C', nameHe: 'מכניקת הזורמים', categoryId: 'fluids' });
    expect(profile.topics.length).toBeGreaterThan(0);
    expect(profile.source).toBe('inferred');
    expect(profile.notes?.some((n) => n.startsWith(NEEDS_REVIEW_NOTE_PREFIX)) ?? false).toBe(false);
  });

  test('a project with no topic area is still default/needs_review but keeps its project_based style', () => {
    const profile = inferCourseTopicProfile({ courseId: 'C', nameHe: 'פרוייקט מחקר למצטיינים (1)', categoryId: 'other_specialization' });
    expect(profile.topics).toEqual([]);
    expect(profile.styles.map((s) => s.style)).toContain('project_based');
    expect(profile.source).toBe('default');
    expect(profile.notes?.some((n) => n.startsWith(NEEDS_REVIEW_NOTE_PREFIX))).toBe(true);
  });

  test('never emits a topic weight above 0.7 (no strong weights without evidence)', () => {
    const samples = [
      { courseId: 'C', nameHe: 'מכניקת הזורמים (2)', categoryId: 'fluids' },
      { courseId: 'C', nameHe: 'מבוא לאלמנטים סופיים', categoryId: 'solids' },
      { courseId: 'C', nameHe: 'מעבדה בחומרים הנדסיים', categoryId: 'advanced_labs' },
    ];
    for (const s of samples) {
      for (const t of inferCourseTopicProfile(s).topics) {
        expect(t.weight).toBeLessThanOrEqual(0.7);
      }
    }
  });

  test('output is already normalized: re-normalizing is a no-op (canonical order, clamped)', () => {
    const profile = inferCourseTopicProfile({ courseId: 'C1', nameHe: 'מעבדת זרימה ומעבר חום', categoryId: 'advanced_labs' });
    expect(normalizeCourseTopicProfile(profile)).toEqual(profile);
  });

  test('deterministic: same input yields deeply-equal output every call', () => {
    const input = { courseId: 'C1', nameHe: 'מעבדה ברובוטיקה ובקרה של מערכות', categoryId: 'advanced_labs' };
    expect(inferCourseTopicProfile(input)).toEqual(inferCourseTopicProfile(input));
  });

  test('courseId is carried through to the profile', () => {
    expect(inferCourseTopicProfile({ courseId: '0542-4120', nameHe: 'תרמודינמיקה (2)', categoryId: 'fluids' }).courseId).toBe('0542-4120');
  });
});

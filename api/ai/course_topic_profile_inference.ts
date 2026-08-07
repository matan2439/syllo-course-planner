/**
 * Deterministic Course Topic inference — turns a CatalogCourse (courseId +
 * nameHe + categoryId) into a CourseTopicProfile using ONLY explicit,
 * reviewable keyword/category rules. No syllabus-text mining, no LLM, no
 * unbounded name inference.
 *
 * Design constraints (from the epic):
 *  - Hebrew primary, English secondary keyword rules; all explicit substrings.
 *  - Conservative weights: STRONG (explicit name keyword) = 0.7, MEDIUM
 *    (category-derived, or a supporting style) = 0.6, WEAK (a secondary style
 *    such as 'practical' implied by a lab) = 0.5. Never above 0.7 — we never
 *    fabricate strong evidence.
 *  - Only clean, homogeneous categories map to a topic area: 'fluids' ->
 *    fluids, 'solids' -> strength_analysis. 'advanced_labs' maps to a lab
 *    STYLE, not a topic. Heterogeneous categories ('systems',
 *    'other_specialization') never force a topic area — the name must carry it.
 *  - source: 'inferred' when at least one TOPIC AREA is confidently inferred;
 *    otherwise 'default' with a needs_review note. Styles are attached
 *    whenever their rule fires, independently of the topic decision — so e.g.
 *    a research project with no confident topic area still records its
 *    project_based style but is honestly flagged needs_review for topics.
 *  - Syllabus summaries are DELIBERATELY not consumed here (they are noisy —
 *    they lead with hours/weight boilerplate). A future syllabus-derived
 *    'syllabus' source is the documented next seam; that is why no profile
 *    here ever carries source 'syllabus' or 'manual'.
 *
 * Output is produced through normalizeCourseTopicProfile so it is always in
 * canonical order, weight-clamped, and deduped (max-weight per key) — the same
 * invariant every other CourseTopicProfile in this codebase satisfies.
 */

import { normalizeCourseTopicProfile } from './course_topic_profile';
import type { CourseTopicProfile } from './course_topic_profile';
import type { AcademicFocusArea, CourseStyle } from './academic_interest_profile';
import type { CatalogCourse } from './course_catalog';

export const NEEDS_REVIEW_NOTE_PREFIX = 'needs_review:';
const NEEDS_REVIEW_NOTE = `${NEEDS_REVIEW_NOTE_PREFIX} insufficient metadata for confident topic tagging`;
const INFERRED_NOTE = 'topics inferred from deterministic name/category keyword rules';

const STRONG = 0.7;
const MEDIUM = 0.6;
const WEAK = 0.5;

interface KeywordRule<T extends string> {
  keywords: string[];
  value: T;
  weight: number;
}

/**
 * Topic-area rules, matched as case-insensitive substrings of the course name.
 * Hebrew terms first, then English equivalents. Kept explicit and narrow to
 * avoid false friends (e.g. 'תהליכי עיבוד' = machining, NOT 'עיבוד אותות' =
 * signal processing; so the manufacturing rule requires the fuller phrase).
 */
const TOPIC_NAME_RULES: ReadonlyArray<KeywordRule<AcademicFocusArea>> = [
  { keywords: ['אלמנטים סופיים', 'finite element', 'finite-element', 'fem', 'fea'], value: 'finite_elements', weight: STRONG },
  { keywords: ['מוצקים', 'אלסטיות', 'תנודות', 'חוזק', 'mechanics of solids', 'elasticity', 'vibration', 'strength'], value: 'strength_analysis', weight: STRONG },
  // 'הנדסה ימית' (marine engineering) is spelled out in full on purpose: the bare
  // token 'ימית' is a substring of 'פנימית' (internal) and 'כימית' (chemical),
  // which would fabricate a fluids topic for e.g. 'מנועי שריפה פנימית'. Same
  // fuller-phrase defense the manufacturing rule uses against 'עיבוד אותות'.
  { keywords: ['זורמים', 'זרימה', 'הידראוליק', 'אווירודינמיק', 'גזים', 'הנדסה ימית', 'fluid', 'aerodynamic', 'cfd', 'hydraulic'], value: 'fluids', weight: STRONG },
  { keywords: ['מעבר חום', 'מעבר חם', 'תרמי', 'heat transfer', 'thermal'], value: 'heat_transfer', weight: STRONG },
  { keywords: ['תרמודינמיק', 'שריפה', 'thermodynamic', 'combustion'], value: 'thermal_systems', weight: STRONG },
  { keywords: ['בקרה', 'משוב', 'control', 'feedback'], value: 'control_systems', weight: STRONG },
  { keywords: ['רובוטיק', 'מכאטרוני', 'מכטרוני', 'robotic', 'mechatronic'], value: 'robotics', weight: STRONG },
  { keywords: ['אנרגיה', 'טורבינ', 'מנוע', 'energy', 'turbine', 'engine'], value: 'energy', weight: STRONG },
  { keywords: ['תהליכי עיבוד', 'הדפס', 'ייצור', 'manufacturing', 'machining', '3d print'], value: 'manufacturing', weight: STRONG },
  { keywords: ['חומרים', 'פולימר', 'פלסטי', 'ננוחומר', 'material', 'polymer', 'plastic'], value: 'materials', weight: STRONG },
  { keywords: ['ביו', 'רקמות', 'תאים', 'אולטרסאונד', 'רפוא', 'bio', 'tissue', 'ultrasound', 'medical'], value: 'biomechanics', weight: STRONG },
  // NB: the broad token 'מכונות' (machines) was removed — a machine course
  // (e.g. "תורת המכונות", theory of machines) is NOT a design course, so a title
  // token alone must not establish design alignment. Substantive design alignment
  // now comes from official-syllabus evidence (course_capability_evidence.ts), not
  // the title. 'תכן'/'design'/'cad' are direct design words and are kept only for
  // display-side topic hints and for LOCATING candidate courses, never as proof.
  { keywords: ['תכן', 'תיכון', 'design', 'cad'], value: 'mechanical_design', weight: STRONG },
];

/** Clean, homogeneous category ids that justify a (medium-weight) topic area on their own. */
const CATEGORY_TOPIC_RULES: Readonly<Record<string, AcademicFocusArea>> = {
  fluids: 'fluids',
  solids: 'strength_analysis',
};

/** Style rules matched as case-insensitive substrings of the course name. */
const STYLE_NAME_RULES: ReadonlyArray<KeywordRule<CourseStyle>> = [
  { keywords: ['מעבד', 'lab', 'laborator'], value: 'lab_based', weight: STRONG },
  { keywords: ['פרויקט', 'פרוייקט', 'project'], value: 'project_based', weight: STRONG },
  { keywords: ['תעשיי', 'industry', 'industrial'], value: 'industry_relevant', weight: MEDIUM },
  { keywords: ['יישומי', 'applied'], value: 'practical', weight: MEDIUM },
];

function matches(haystack: string, keywords: string[]): boolean {
  return keywords.some((k) => haystack.includes(k));
}

/**
 * Resolve arbitrary free text (a USER's phrase, not a course name) to the
 * canonical AcademicFocusArea(s) it names, using the SAME keyword vocabulary
 * the course-side topic inference already uses (TOPIC_NAME_RULES). Deliberate
 * reuse — one Hebrew/English keyword→area taxonomy for both the supply side
 * (course names) and the demand side (user "focus on X" requests) — so "תכן" in
 * a request and a course named "תכן ..." resolve through identical rules, with
 * no second taxonomy. Category rules are course-only (a user phrase has no
 * categoryId) and are intentionally not applied here.
 */
export function inferFocusAreasFromText(text: string): AcademicFocusArea[] {
  const haystack = (text ?? '').toLowerCase();
  const areas = new Set<AcademicFocusArea>();
  for (const rule of TOPIC_NAME_RULES) {
    if (matches(haystack, rule.keywords)) areas.add(rule.value);
  }
  return [...areas];
}

export function inferCourseTopicProfile(course: CatalogCourse): CourseTopicProfile {
  const name = (course.nameHe ?? '').toLowerCase();
  const category = course.categoryId ?? '';

  const topics: Array<{ area: AcademicFocusArea; weight: number }> = [];
  for (const rule of TOPIC_NAME_RULES) {
    if (matches(name, rule.keywords)) topics.push({ area: rule.value, weight: rule.weight });
  }
  const categoryTopic = CATEGORY_TOPIC_RULES[category];
  if (categoryTopic) topics.push({ area: categoryTopic, weight: MEDIUM });

  const styles: Array<{ style: CourseStyle; weight: number }> = [];
  for (const rule of STYLE_NAME_RULES) {
    if (matches(name, rule.keywords)) styles.push({ style: rule.value, weight: rule.weight });
  }
  // A lab is inherently practical; the 'advanced_labs' category is a lab signal too.
  const isLab = styles.some((s) => s.style === 'lab_based') || category === 'advanced_labs';
  if (isLab) {
    styles.push({ style: 'lab_based', weight: STRONG });
    styles.push({ style: 'practical', weight: WEAK });
  }

  const hasTopic = topics.length > 0;
  const notes = hasTopic ? [INFERRED_NOTE] : [NEEDS_REVIEW_NOTE];
  const source = hasTopic ? 'inferred' : 'default';

  // normalizeCourseTopicProfile clamps, dedupes (max-weight per key), and
  // canonically orders — so duplicate lab_based entries collapse to one, etc.
  return normalizeCourseTopicProfile({
    courseId: course.courseId,
    topics,
    styles,
    notes,
    source,
  });
}

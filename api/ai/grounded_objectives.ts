/**
 * K4 — ONE narrow, source-grounded soft optimization objective.
 *
 * Implemented objective: `prefer_laboratory_courses` — "מעדיף קורסים עם מעבדה".
 *
 * Why this one, after investigating what the official sources actually support:
 * the institution's syllabus template carries `אופן ההוראה` (delivery mode) as a
 * SCHEMA-COMPLETE enumerated field — always published, always naming the mode.
 * That makes "this course has a laboratory component" the single best-evidenced
 * feature available (see course_features.ts), which is exactly the requirement
 * for a grounded objective: strong official evidence, not inference.
 *
 * Semantics — deliberately SOFT:
 *   - it RANKS candidates that are already legal and already retained; it never
 *     requires that every selected course have a laboratory;
 *   - it cannot override degree completion, legality, hard include/exclude
 *     constraints, load caps, or the confirmed distribution policy — those are
 *     compared strictly ahead of it (see candidate_set.ts's ranking);
 *   - only a CONFIRMED, active preference contributes anything at all;
 *   - `unknown` evidence, missing evidence and unsupported features contribute
 *     exactly ZERO — an absent fact is never read as a negative, and never as a
 *     positive;
 *   - a course whose feature is genuinely `false` also contributes zero. This is
 *     a preference FOR something, not a penalty AGAINST its absence.
 *
 * All candidates in a request are scored against ONE `EvidenceSnapshot`, so a
 * ranking difference can only ever come from the candidates' own course
 * composition — never from one candidate seeing fresher data than another.
 */

import type { AcademicEvidence } from './academic_evidence';
import type { CourseFeatures } from './course_features';
import type { TopicId } from './course_topics';

export type GroundedObjectiveId =
  | 'prefer_laboratory_courses'
  | 'prefer_project_courses'
  /**
   * T4 — content/topic alignment with confirmed interests. Unlike the two
   * delivery objectives, this one is PARAMETERISED by the topics the student
   * confirmed, and it reads a different evidence field (`תוכן הקורס ומטרתו`)
   * whose semantics are weaker: a topic is affirmed or unknown, never false,
   * because prose that omits a subject does not establish its absence.
   */
  | 'prefer_topic_alignment';

/**
 * Which extracted feature each objective reads, and how it is described. Both
 * come from the SAME schema-complete official delivery-mode field, which the K8A
 * audit measured at 8/8 coverage — topic alignment (1/7) and assessment (0/8)
 * did not meet the threshold and are not implemented.
 */
const OBJECTIVE_FEATURE: Record<'prefer_laboratory_courses' | 'prefer_project_courses', { key: 'laboratory' | 'projectDelivery'; labelHe: string }> = {
  prefer_laboratory_courses: { key: 'laboratory', labelHe: 'מעבדה' },
  prefer_project_courses: { key: 'projectDelivery', labelHe: 'פרויקט' },
};

/**
 * Student-facing Hebrew names for the topic vocabulary. The internal id is never
 * shown; these are the words the official documents themselves use, so the
 * explanation stays recognisable and auditable.
 */
const TOPIC_LABEL_HE: Record<TopicId, string> = {
  engineering_design: 'תכן ועיצוב הנדסי',
  finite_element_analysis: 'ניתוח אלמנטים סופיים',
  solid_mechanics: 'מכניקת מוצקים',
  robotics: 'רובוטיקה',
  control: 'בקרה',
  manufacturing: 'ייצור ועיבוד',
  materials: 'חומרים',
  thermofluids: 'זרימה ומעבר חום',
  programming_electronics: 'תכנות ואלקטרוניקה',
};

/**
 * One course's affirmatively-supported topics, with the official document they
 * came from. Provenance travels WITH the fact so an explanation can cite it
 * without re-deriving anything.
 */
export interface CourseTopicSupport {
  topicIds: ReadonlySet<TopicId>;
  sourceRef: string;
  academicYear: number | string;
}

/** Courses' supported topics, keyed by course id — one snapshot's worth. */
export type TopicIndex = ReadonlyMap<string, CourseTopicSupport>;

/**
 * A confirmed, active grounded preference. Constructing one is the ONLY way to
 * make the objective contribute; an unanswered, indifferent or merely-inferred
 * preference must not produce this value.
 */
export interface GroundedObjective {
  id: GroundedObjectiveId;
  /** Literal true — an unconfirmed preference has no place in ranking. */
  confirmed: true;
  /** The evidence snapshot every candidate in this request is scored against. */
  snapshotId: string;
  /**
   * T4 — the confirmed topics, for `prefer_topic_alignment` only. Absent or
   * empty makes the objective inert rather than an error.
   */
  topicIds?: readonly TopicId[];
}

/** One course's evidence-backed contribution to the objective. */
export interface ObjectiveContribution {
  courseId: string;
  feature: 'laboratory' | 'projectDelivery' | 'topic';
  /** Present for `feature: 'topic'` — which confirmed topic this course supports. */
  topicId?: TopicId;
  /** Official source the claim rests on. */
  sourceRef: string;
  academicYear: number | string;
  /** Short copyright-safe quote from the official page. */
  excerpt?: string;
}

export interface GroundedScore {
  /** Higher is better. Zero when nothing is supported by evidence. */
  score: number;
  /** Exactly the courses that contributed, with their provenance. */
  contributions: ObjectiveContribution[];
  /** Courses whose feature is genuinely unknown — disclosed, never counted. */
  unknownCourseIds: string[];
  /**
   * K7.5 — courses whose official sections genuinely DISAGREE on the feature
   * (e.g. group 05 is a laboratory, group 01 is not). Disclosed, never counted:
   * the candidate selects a course and a period, not a group, so the plan does
   * not establish which format the student would actually get.
   */
  variesBySectionCourseIds: string[];
}

/** A course's extracted features, keyed by course id — one snapshot's worth. */
export type FeatureIndex = ReadonlyMap<string, CourseFeatures>;

function firstEvidence(features: CourseFeatures, key: 'laboratory' | 'projectDelivery'): AcademicEvidence | undefined {
  return features[key].evidence[0];
}

/**
 * Score ONE candidate's course set on the objective.
 *
 * Counts only courses whose `laboratory` feature is confirmed `true` by official
 * evidence. `false` and `'unknown'` both contribute zero, and a course with no
 * features at all contributes zero — so a candidate can never be advantaged or
 * disadvantaged by the mere absence of data.
 */
export function scoreCandidateOnObjective(
  courseIds: readonly string[],
  objective: GroundedObjective,
  features: FeatureIndex,
  topics?: TopicIndex,
): GroundedScore {
  const contributions: ObjectiveContribution[] = [];
  const unknownCourseIds: string[] = [];
  const variesBySectionCourseIds: string[] = [];

  if (objective.id === 'prefer_topic_alignment') {
    return scoreTopicAlignment(courseIds, objective, features, topics);
  }

  const { key } = OBJECTIVE_FEATURE[objective.id];

  for (const courseId of [...courseIds].sort()) {
    const f = features.get(courseId);
    if (!f) continue; // no evidence at all — no bias in either direction
    const feature = f[key];
    // K7.5 — the sections disagree. Neither true nor false applies to a
    // course-level candidate, so this is disclosed and contributes nothing.
    if ((feature.value as unknown) === 'varies_by_section') {
      variesBySectionCourseIds.push(courseId);
      continue;
    }
    if (feature.value === 'unknown') {
      unknownCourseIds.push(courseId);
      continue; // disclosed, never counted
    }
    if (feature.value !== true) continue; // genuinely false — a preference FOR, not a penalty
    const e = firstEvidence(f, key);
    contributions.push({
      courseId,
      feature: key,
      sourceRef: e?.sourceRef ?? '',
      academicYear: e?.academicYear ?? f.academicYear,
      ...(e?.excerpt !== undefined ? { excerpt: e.excerpt } : {}),
    });
  }

  return { score: contributions.length, contributions, unknownCourseIds, variesBySectionCourseIds };
}

/**
 * T4 — score a candidate on confirmed CONTENT/TOPIC alignment.
 *
 * One contribution per (course, confirmed topic) the course affirmatively
 * supports. Because `supportedTopics` already collapses repeated wording and
 * multiple documents into a set, a topic stated three times — or in three
 * documents — is one contribution, never three.
 *
 * A course with no topic evidence is DISCLOSED and adds zero. It is never
 * penalised: topic prose that omits a subject does not establish the course
 * lacks it, so unknown is genuinely unknown, and a candidate can neither gain
 * nor lose from missing coverage.
 */
function scoreTopicAlignment(
  courseIds: readonly string[],
  objective: GroundedObjective,
  features: FeatureIndex,
  topics?: TopicIndex,
): GroundedScore {
  const contributions: ObjectiveContribution[] = [];
  const unknownCourseIds: string[] = [];
  const wanted = [...new Set(objective.topicIds ?? [])].sort();

  for (const courseId of [...courseIds].sort()) {
    const support = topics?.get(courseId);
    if (!support || support.topicIds.size === 0) {
      // No official content statement for this course — disclosed, never counted.
      if (topics?.has(courseId) || features.has(courseId)) unknownCourseIds.push(courseId);
      continue;
    }
    for (const topicId of wanted) {
      if (!support.topicIds.has(topicId)) continue;
      contributions.push({
        courseId,
        feature: 'topic',
        topicId,
        sourceRef: support.sourceRef,
        academicYear: support.academicYear,
      });
    }
  }

  return { score: contributions.length, contributions, unknownCourseIds, variesBySectionCourseIds: [] };
}

/**
 * A concise, factual Hebrew explanation of the objective's effect. States which
 * confirmed preference applied, which course feature supported it, and the
 * official source and year — and, when a lower-ranked candidate is supplied, why
 * that alternative scored lower ON THIS SOFT OBJECTIVE ONLY.
 *
 * Deliberately never claims a course is objectively better, only that it matches
 * a preference the user confirmed.
 */
export function explainGroundedRanking(input: {
  objective: GroundedObjective;
  selected: GroundedScore;
  alternative?: GroundedScore;
}): string {
  const { selected, alternative } = input;
  if (input.objective.id === 'prefer_topic_alignment') return explainTopicAlignment(input);
  const label = OBJECTIVE_FEATURE[input.objective.id].labelHe;
  if (selected.contributions.length === 0 && (!alternative || alternative.contributions.length === 0)) {
    const varying = selected.variesBySectionCourseIds?.length
      ? ' עבור חלק מהקורסים אופן ההוראה משתנה בין קבוצות, ולכן לא ניתן לייחס אותו לקורס כולו.'
      : '';
    return 'לא נמצאה עדות רשמית שתומכת בהעדפה שסימנת, ולכן ההעדפה לא השפיעה על הדירוג.' + varying;
  }
  const names = selected.contributions.map((c) => c.courseId).join(', ');
  const src = selected.contributions[0];
  const head = selected.contributions.length
    ? `לפי ההעדפה שאישרת (קורסים עם ${label}), התוכנית הנבחרת כוללת ${selected.contributions.length} קורס/ים עם רכיב ${label}: ${names}.`
    : `ההעדפה שאישרת (קורסים עם ${label}) לא נתמכה בעדות רשמית עבור התוכנית הנבחרת.`;
  const provenance = src
    ? ` המקור: אופן ההוראה בסילבוס הרשמי (${src.sourceRef}, שנת ${src.academicYear}).`
    : '';
  const compare = alternative
    ? ` חלופה חוקית אחרת דורגה נמוך יותר בהעדפה הרכה הזו בלבד (${alternative.contributions.length} קורס/ים עם ${label}), ולא מסיבה אקדמית אחרת.`
    : '';
  const unknown = selected.unknownCourseIds.length
    ? ` עבור ${selected.unknownCourseIds.length} קורס/ים לא קיימת עדות רשמית על אופן ההוראה, ולכן הם לא נספרו לכאן ולא לכאן.`
    : '';
  // K7.5 — a course whose sections disagree is described AS varying. It is never
  // called a laboratory course on the strength of one group.
  const varies = selected.variesBySectionCourseIds?.length
    ? ` עבור ${selected.variesBySectionCourseIds.length} קורס/ים אופן ההוראה משתנה בין קבוצות, ולכן הם לא השפיעו על הדירוג.`
    : '';
  return head + provenance + compare + unknown + varies;
}

/**
 * T4 — the topic-alignment explanation.
 *
 * States which content interest was confirmed, which selected courses officially
 * cover it, the official source and year, and — crucially — that courses without
 * a published statement were NOT counted against anything. It never claims the
 * selected plan is better, only that it matches a confirmed interest.
 */
function explainTopicAlignment(input: {
  objective: GroundedObjective;
  selected: GroundedScore;
  alternative?: GroundedScore;
}): string {
  const { objective, selected, alternative } = input;
  const wanted = [...new Set(objective.topicIds ?? [])].sort();
  const names = wanted.map((t) => TOPIC_LABEL_HE[t]).join(', ');

  if (selected.contributions.length === 0) {
    return `לא נמצאה עדות רשמית שתומכת בתחומי התוכן שסימנת (${names}) בתוכנית הנבחרת, ולכן ההעדפה לא השפיעה על הדירוג.`;
  }

  const byCourse = new Map<string, TopicId[]>();
  for (const c of selected.contributions) {
    byCourse.set(c.courseId, [...(byCourse.get(c.courseId) ?? []), c.topicId!]);
  }
  const perCourse = [...byCourse.entries()]
    .map(([courseId, ts]) => `${courseId} (${[...new Set(ts)].map((t) => TOPIC_LABEL_HE[t]).join(', ')})`)
    .join('; ');
  const src = selected.contributions[0];

  const head = `לפי תחומי התוכן שאישרת (${names}), התוכנית הנבחרת כוללת ${byCourse.size} קורס/ים שהתוכן הרשמי שלהם מציין אותם: ${perCourse}.`;
  const provenance = ` המקור: שדה "תוכן הקורס ומטרתו" בסילבוס הרשמי (${src.sourceRef}, שנת ${src.academicYear}).`;
  const compare = alternative
    ? ` חלופה חוקית אחרת דורגה נמוך יותר בהעדפה הרכה הזו בלבד (${alternative.contributions.length} התאמות תוכן), ולא מסיבה אקדמית אחרת.`
    : '';
  // Coverage limitation, always stated: silence in the official text is not a
  // statement that the course lacks the topic.
  const unknown = selected.unknownCourseIds.length
    ? ` עבור ${selected.unknownCourseIds.length} קורס/ים לא פורסם תוכן רשמי שניתן להשוות, ולכן הם לא נספרו לכאן ולא לכאן.`
    : ' יש לשים לב שהיעדר אזכור בתוכן הרשמי אינו קביעה שהנושא לא נלמד בקורס.';
  return head + provenance + compare + unknown;
}

/**
 * M6 — explain EVERY active objective that influenced the ranking.
 *
 * Each objective is described with its own already-proven wording, so nothing
 * about the single-objective explanation changes. With exactly one active
 * objective this returns byte-identical text to `explainGroundedRanking`.
 *
 * With several, the per-objective sentences are followed by ONE sentence naming
 * how they were combined. That sentence is derived from the objective vectors,
 * never asserted: when no candidate is best on everything, the trade-off is
 * stated plainly rather than hidden behind a precedence rule, and the
 * equal-importance default is described as this system's ranking policy — not
 * as something the student said.
 */
export function explainGroundedComposition(input: {
  objectives: ReadonlyArray<{ id: GroundedObjectiveId; topicIds?: readonly TopicId[] }>;
  snapshotId: string;
  selected: readonly GroundedScore[];
  alternative?: readonly GroundedScore[];
  reason:
    | 'single_objective'
    | 'dominates_all_objectives'
    | 'equal_confirmed_preferences'
    | 'explicit_priority'
    | 'canonical_tie_break'
    | 'no_distinguishing_evidence';
}): string {
  const { objectives, selected, alternative, snapshotId } = input;
  if (objectives.length === 0 || selected.length === 0) return '';

  const per = objectives.map((o, i) =>
    explainGroundedRanking({
      objective: {
        id: o.id,
        confirmed: true,
        snapshotId,
        ...(o.topicIds?.length ? { topicIds: o.topicIds } : {}),
      },
      selected: selected[i],
      ...(alternative?.[i] ? { alternative: alternative[i] } : {}),
    }),
  );

  // One objective ⇒ exactly the text this produced before composition existed.
  if (objectives.length === 1) return per[0];

  const combined: Record<typeof input.reason, string> = {
    single_objective: '',
    dominates_all_objectives:
      ' התוכנית הנבחרת מתאימה לכל ההעדפות שאישרת לפחות כמו כל חלופה חוקית אחרת שנבדקה, ועדיפה על חלקן בלפחות העדפה אחת.',
    equal_confirmed_preferences:
      ' אין חלופה חוקית שמצטיינת בכל ההעדפות שאישרת בו-זמנית. לא ציינת מה חשוב יותר, ולכן כל ההעדפות נשקלו במשקל שווה — זו מדיניות הדירוג של המערכת, לא קביעה שלך.',
    explicit_priority:
      ' הבחירה נעשתה לפי סדר החשיבות שציינת בין ההעדפות.',
    canonical_tie_break:
      ' כל החלופות החוקיות התאימו להעדפות שאישרת באותה מידה, ולכן נשמרה תוכנית ברירת המחדל.',
    no_distinguishing_evidence:
      ' לא נמצאה עדות רשמית שמבדילה בין החלופות עבור ההעדפות שאישרת, ולכן הן לא השפיעו על הדירוג.',
  };

  return per.join(' ') + (combined[input.reason] ?? '');
}

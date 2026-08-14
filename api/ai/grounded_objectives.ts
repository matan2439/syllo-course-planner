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

export type GroundedObjectiveId = 'prefer_laboratory_courses';

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
}

/** One course's evidence-backed contribution to the objective. */
export interface ObjectiveContribution {
  courseId: string;
  feature: 'laboratory';
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
}

/** A course's extracted features, keyed by course id — one snapshot's worth. */
export type FeatureIndex = ReadonlyMap<string, CourseFeatures>;

function firstEvidence(features: CourseFeatures): AcademicEvidence | undefined {
  return features.laboratory.evidence[0];
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
): GroundedScore {
  const contributions: ObjectiveContribution[] = [];
  const unknownCourseIds: string[] = [];

  for (const courseId of [...courseIds].sort()) {
    const f = features.get(courseId);
    if (!f) continue; // no evidence at all — no bias in either direction
    if (f.laboratory.value === 'unknown') {
      unknownCourseIds.push(courseId);
      continue; // disclosed, never counted
    }
    if (f.laboratory.value !== true) continue; // genuinely false — a preference FOR, not a penalty
    const e = firstEvidence(f);
    contributions.push({
      courseId,
      feature: 'laboratory',
      sourceRef: e?.sourceRef ?? '',
      academicYear: e?.academicYear ?? f.academicYear,
      ...(e?.excerpt !== undefined ? { excerpt: e.excerpt } : {}),
    });
  }

  return { score: contributions.length, contributions, unknownCourseIds };
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
  if (selected.contributions.length === 0 && (!alternative || alternative.contributions.length === 0)) {
    return 'לא נמצאה עדות רשמית שתומכת בהעדפה שסימנת, ולכן ההעדפה לא השפיעה על הדירוג.';
  }
  const names = selected.contributions.map((c) => c.courseId).join(', ');
  const src = selected.contributions[0];
  const head = selected.contributions.length
    ? `לפי ההעדפה שאישרת (קורסים עם מעבדה), התוכנית הנבחרת כוללת ${selected.contributions.length} קורס/ים עם רכיב מעבדה: ${names}.`
    : 'ההעדפה שאישרת (קורסים עם מעבדה) לא נתמכה בעדות רשמית עבור התוכנית הנבחרת.';
  const provenance = src
    ? ` המקור: אופן ההוראה בסילבוס הרשמי (${src.sourceRef}, שנת ${src.academicYear}).`
    : '';
  const compare = alternative
    ? ` חלופה חוקית אחרת דורגה נמוך יותר בהעדפה הרכה הזו בלבד (${alternative.contributions.length} קורס/ים עם מעבדה), ולא מסיבה אקדמית אחרת.`
    : '';
  const unknown = selected.unknownCourseIds.length
    ? ` עבור ${selected.unknownCourseIds.length} קורס/ים לא קיימת עדות רשמית על אופן ההוראה, ולכן הם לא נספרו לכאן ולא לכאן.`
    : '';
  return head + provenance + compare + unknown;
}

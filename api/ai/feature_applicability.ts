/**
 * K7.5 — evidence APPLICABILITY and safe course-level aggregation.
 *
 * Discovered by the live K7 acquisition: course 0542-3792, year 2025, is
 * `laboratory=true` for group 05 and `laboratory=false` for group 01. Both are
 * genuine official facts — about DIFFERENT academic objects. The planner selects
 * a course and a period, never a group, so attributing either group's fact to
 * the course-level candidate would be a category error: the plan does not
 * establish which group the student would attend.
 *
 * Hence: a fact may influence ranking only if it applies to the actual academic
 * object the candidate selects. Section-level evidence is retained in full (a
 * future section-selecting planner will need it) but is aggregated to the course
 * level under rules that refuse to guess.
 *
 * SCOPES
 *   course   — a fact about the course irrespective of offering/section
 *   offering — a fact about the course in a given year/period
 *   section  — a fact about ONE group/section of that offering
 *
 * AGGREGATION (section → course), for a boolean feature:
 *   - every observed group true  + COMPLETE authoritative coverage → true
 *   - every observed group false + COMPLETE authoritative coverage → false
 *   - any mix of true and false                                    → varies_by_section
 *   - any observation unknown                                      → unknown
 *   - coverage incomplete, or the group universe is unknown        → unknown
 *   - no observations                                              → unknown
 *
 * Explicitly forbidden, and tested: the "first" group, the lowest group id, or
 * whichever group happened to download successfully must NEVER define the
 * course-level value; and a failed or missing group acquisition is never read as
 * `false`.
 */
import type { SyllabusDocument } from './syllabus_source';

/** Course-level feature value, including the honest "it depends" case. */
export type ScopedFeatureValue = true | false | 'varies_by_section' | 'unknown';

export type EvidenceScope = 'course' | 'offering' | 'section';

export interface FeatureObservation {
  /** Absent ⇒ the observation is about the offering/course, not one section. */
  groupId?: string;
  value: true | false | 'unknown';
}

export interface AggregationResult {
  value: ScopedFeatureValue;
  /** Stable machine-readable justification. */
  reason:
    | 'no_observations'
    | 'unknown_observation'
    | 'mixed_sections'
    | 'complete_coverage'
    | 'incomplete_coverage'
    | 'unknown_group_universe'
    | 'course_scope_observation';
  /** The group ids actually observed, sorted. */
  observedGroups: string[];
  /** Whether an authoritative complete group list was available. */
  universeKnown: boolean;
}

/**
 * The group/section id the official document is about, read from the document's
 * OWN course-number field (e.g. '0542-3792-05' → '05'). Taken from the source,
 * never from the URL we happened to request, so a redirect or a corrected
 * response cannot desynchronise the section identity from the content.
 */
export function groupIdOfDocument(doc: SyllabusDocument): string | undefined {
  const raw = doc.labeledFields?.['מספר קורס']?.[0];
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  // 8 digits of course + 2 of group. Anything shorter carries no section id.
  return digits.length >= 10 ? digits.slice(8, 10) : undefined;
}

/** The scope a document's facts belong to. */
export function scopeOfDocument(doc: SyllabusDocument): EvidenceScope {
  return groupIdOfDocument(doc) !== undefined ? 'section' : 'offering';
}

/**
 * Aggregate section-level observations into a course-level value.
 *
 * `groupUniverse` is the AUTHORITATIVE complete list of groups offered for this
 * course/year (from the official timetable/course-details source). Without it,
 * completeness cannot be established and the result is `unknown` — deliberately,
 * because "we only managed to download one group" is not evidence about the
 * others.
 */
export function aggregateCourseLevelFeature(input: {
  observations: FeatureObservation[];
  groupUniverse?: string[];
}): AggregationResult {
  const observations = input.observations ?? [];
  const universeKnown = Array.isArray(input.groupUniverse) && input.groupUniverse.length > 0;
  const observedGroups = [...new Set(observations.map((o) => o.groupId).filter((g): g is string => !!g))].sort();

  if (observations.length === 0) {
    return { value: 'unknown', reason: 'no_observations', observedGroups, universeKnown };
  }

  // An observation with no group is about the offering itself — it needs no
  // section aggregation and resolves directly.
  const sectionObs = observations.filter((o) => o.groupId !== undefined);
  if (sectionObs.length === 0) {
    const only = observations[0];
    if (only.value === 'unknown') {
      return { value: 'unknown', reason: 'unknown_observation', observedGroups, universeKnown };
    }
    return { value: only.value, reason: 'course_scope_observation', observedGroups, universeKnown };
  }

  // Any unknown among the sections makes the whole picture unknown: we cannot
  // claim "all groups are X" while one of them is unread.
  if (sectionObs.some((o) => o.value === 'unknown')) {
    return { value: 'unknown', reason: 'unknown_observation', observedGroups, universeKnown };
  }

  const hasTrue = sectionObs.some((o) => o.value === true);
  const hasFalse = sectionObs.some((o) => o.value === false);

  // Mixed sections are the honest answer regardless of coverage: the format
  // genuinely differs between groups, so no single course-level boolean is true.
  if (hasTrue && hasFalse) {
    return { value: 'varies_by_section', reason: 'mixed_sections', observedGroups, universeKnown };
  }

  if (!universeKnown) {
    return { value: 'unknown', reason: 'unknown_group_universe', observedGroups, universeKnown };
  }

  const universe = [...new Set(input.groupUniverse!)].sort();
  const covered = universe.every((g) => observedGroups.includes(g));
  if (!covered) {
    return { value: 'unknown', reason: 'incomplete_coverage', observedGroups, universeKnown };
  }

  return { value: hasTrue, reason: 'complete_coverage', observedGroups, universeKnown };
}

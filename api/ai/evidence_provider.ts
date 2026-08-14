/**
 * K9B — the KnowledgeCapability boundary that PREPARES evidence for one Generate
 * request, before any planning starts.
 *
 * The whole point of this module is ownership. Generate calls `prepareEvidence`
 * exactly once, and the resulting immutable snapshot is handed to candidate
 * generation. Candidates never acquire, resolve or refresh evidence themselves,
 * so:
 *   - every candidate in a request is scored against the SAME snapshotId;
 *   - no network call can occur inside PlannerWorker.step, a rollout, a score
 *     comparison, candidate ranking, or Apply — this boundary is the only place
 *     acquisition could ever happen, and it runs strictly before all of them;
 *   - a run is reproducible from the snapshot alone.
 *
 * The default provider performs NO acquisition. It reads whatever prepared
 * evidence a caller supplies (K6 backs this with a durable cache; K7 populates
 * that cache out-of-band). With nothing supplied it returns an EMPTY snapshot,
 * which is inert by construction — so the feature is default-off and a request
 * without evidence behaves exactly as it did before this module existed.
 *
 * ── Coverage is not a signal ────────────────────────────────────────────────
 * A course having a syllabus on file must never, by itself, make a candidate
 * rank higher. `scoreCandidateOnObjective` (grounded_objectives.ts) only counts
 * a feature that is affirmatively TRUE, so a covered course whose feature is
 * `false` scores exactly the same as an uncovered course: zero. This module
 * reports coverage truthfully for disclosure, and coverage never enters a score.
 */

import { buildEvidenceSnapshot, type EvidenceSnapshot, type SyllabusDocument } from './syllabus_source';
import { aggregateCourseLevelFeature, groupIdOfDocument } from './feature_applicability';
import { RuleBasedFeatureExtractor, FEATURE_EXTRACTION_VERSION, type CourseFeatures, type FeatureExtractor } from './course_features';

/** Truthful, disclosure-only summary of what the snapshot does and does not cover. */
export interface EvidenceCoverage {
  snapshotId: string;
  extractionVersion: string;
  /** Academic years present in the snapshot. */
  academicYears: Array<number | string>;
  /** Course ids the request asked about. */
  requestedCourseCount: number;
  /** Of those, how many have an official document in the snapshot. */
  coveredCourseCount: number;
  /** Requested course ids with no document at all. */
  missingCourseIds: string[];
  /** Covered courses whose grounded feature is genuinely unknown. */
  unknownFeatureCourseIds: string[];
  /** Course ids whose evidence is stale for the requested year. */
  staleCourseIds: string[];
  /** Course ids with an unresolved authoritative conflict. */
  conflictingCourseIds: string[];
  /**
   * K7.5 — courses whose observed sections genuinely disagree on the feature.
   * Disclosed truthfully; contributes NOTHING to ranking, because the candidate
   * does not select a section.
   */
  variesBySectionCourseIds: string[];
}

export interface PreparedEvidence {
  snapshot: EvidenceSnapshot;
  /**
   * COURSE-LEVEL features, safely aggregated across sections — the only view
   * ranking may consult, because a candidate selects a course and a period, not
   * a group.
   */
  features: Map<string, CourseFeatures>;
  /**
   * K7.5 — the underlying SECTION-level facts, retained in full. Not used for
   * ranking today; a future section-selecting planner binds evidence to the
   * exact chosen group from here.
   */
  sectionFeatures: Map<string, SectionFeature[]>;
  coverage: EvidenceCoverage;
}

export interface PrepareEvidenceInput {
  /** The courses this request could possibly place. */
  courseIds: string[];
  /** The academic year the plan is for — evidence for another year is stale. */
  academicYear: number | string;
  /**
   * Already-acquired official documents. Supplied by the durable cache (K6) or
   * by a test. This function performs NO acquisition of its own.
   */
  documents?: SyllabusDocument[];
  /** Course ids known to carry an unresolved authoritative conflict. */
  conflictingCourseIds?: string[];
  extractor?: FeatureExtractor;
  /**
   * K7.5 — the AUTHORITATIVE complete group/section list per course, from the
   * official timetable source. Without it, section-level evidence can never be
   * aggregated to a course-level `true`/`false`, because completeness cannot be
   * established. Absent ⇒ every multi-section course resolves to unknown or
   * varies_by_section, which is the safe direction.
   */
  groupUniverse?: Record<string, string[]>;
}

/** One section's extracted facts, retained for a future section-selecting planner. */
export interface SectionFeature {
  groupId: string;
  laboratory: string;
  /** K8 — the project/design reading of the same official delivery-mode field. */
  projectDelivery: string;
  contentHash: string;
  sourceUrl: string;
}

const EMPTY_EXTRACTOR = new RuleBasedFeatureExtractor();

/**
 * Build the one immutable evidence snapshot for a request, plus the features
 * derived from it and a truthful coverage summary.
 *
 * Stale handling: a document whose academic year differs from the request's is
 * NOT used for features — it is counted as stale and its course is treated as
 * uncovered. An older syllabus can never silently apply to another year.
 */
export function prepareEvidence(input: PrepareEvidenceInput): PreparedEvidence {
  const extractor = input.extractor ?? EMPTY_EXTRACTOR;
  const requested = [...new Set(input.courseIds)].sort();
  const requestedSet = new Set(requested);
  const all = input.documents ?? [];

  // Only documents for a REQUESTED course are relevant; only documents for the
  // REQUESTED YEAR are applicable. The rest are recorded, never applied.
  const relevant = all.filter((d) => requestedSet.has(d.courseId));
  const applicable = relevant.filter((d) => String(d.academicYear) === String(input.academicYear));
  const staleCourseIds = [
    ...new Set(relevant.filter((d) => String(d.academicYear) !== String(input.academicYear)).map((d) => d.courseId)),
  ].sort();

  const conflicting = [...new Set(input.conflictingCourseIds ?? [])].sort();
  const conflictingSet = new Set(conflicting);

  // A conflicting course's evidence is retained in the snapshot for disclosure
  // but never turned into a feature — an unresolved authoritative conflict must
  // not silently bias ranking in either direction.
  const usable = applicable.filter((d) => !conflictingSet.has(d.courseId));

  const snapshot = buildEvidenceSnapshot(applicable);

  // K7.5 — group documents by course, extract EACH section faithfully, then
  // aggregate to the course level under the safe rules. Previously the last (or
  // first) document simply won, which let one favourable group define the whole
  // course — the exact defect the live acquisition exposed.
  const byCourse = new Map<string, SyllabusDocument[]>();
  for (const d of usable) {
    const list = byCourse.get(d.courseId) ?? [];
    list.push(d);
    byCourse.set(d.courseId, list);
  }

  const features = new Map<string, CourseFeatures>();
  const sectionFeatures = new Map<string, SectionFeature[]>();
  const variesBySectionCourseIds: string[] = [];

  for (const [courseId, docs] of byCourse) {
    const extracted = docs.map((d) => ({ doc: d, features: extractor.extract(d), groupId: groupIdOfDocument(d) }));

    sectionFeatures.set(
      courseId,
      extracted
        .filter((e) => e.groupId !== undefined)
        .map((e) => ({
          groupId: e.groupId!,
          laboratory: String(e.features.laboratory.value),
          projectDelivery: String(e.features.projectDelivery.value),
          contentHash: e.doc.contentHash,
          sourceUrl: e.doc.sourceUrl,
        }))
        .sort((a, b) => (a.groupId < b.groupId ? -1 : 1)),
    );

    // Every delivery-derived feature is aggregated under the SAME K7.5 rules, so
    // a second objective can never acquire weaker applicability than the first.
    const aggregateOf = (pick: (f: CourseFeatures) => CourseFeatures['laboratory']) =>
      aggregateCourseLevelFeature({
        observations: extracted.map((e) => ({
          ...(e.groupId !== undefined ? { groupId: e.groupId } : {}),
          value: pick(e.features).value,
        })),
        ...(input.groupUniverse?.[courseId] ? { groupUniverse: input.groupUniverse[courseId] } : {}),
      });

    const aggregated = aggregateOf((f) => f.laboratory);
    const aggregatedProject = aggregateOf((f) => f.projectDelivery);

    if (aggregated.value === 'varies_by_section' || aggregatedProject.value === 'varies_by_section') {
      variesBySectionCourseIds.push(courseId);
    }

    // The course-level view carries the AGGREGATED value. Only an unambiguous
    // `true` can ever contribute to ranking (grounded_objectives.ts), so
    // 'varies_by_section' and 'unknown' are both inert by construction.
    const base = extracted[0].features;
    /** Replace a feature with its safely-aggregated course-level value. */
    const applied = (
      f: CourseFeatures['laboratory'],
      agg: ReturnType<typeof aggregateCourseLevelFeature>,
    ): CourseFeatures['laboratory'] => ({
      ...f,
      value: agg.value as CourseFeatures['laboratory']['value'],
      // An aggregate that is not a definite boolean supports no claim at all.
      ...(agg.value === true || agg.value === false ? {} : { confidence: 0, evidence: [] }),
      rule: `${f.rule}+aggregate:${agg.reason}`,
    });

    features.set(courseId, {
      ...base,
      laboratory: applied(base.laboratory, aggregated),
      projectDelivery: applied(base.projectDelivery, aggregatedProject),
    });
  }

  const unknownFeatureCourseIds = [...features.entries()]
    .filter(([, f]) => f.laboratory.value === 'unknown' && f.projectDelivery.value === 'unknown')
    .map(([id]) => id)
    .sort();

  const coveredIds = new Set(snapshot.byCourseId.keys());
  const missingCourseIds = requested.filter((id) => !coveredIds.has(id));

  return {
    snapshot,
    features,
    sectionFeatures,
    coverage: {
      snapshotId: snapshot.snapshotId,
      extractionVersion: FEATURE_EXTRACTION_VERSION,
      academicYears: [...new Set(snapshot.documents.map((d) => d.academicYear))].sort(),
      requestedCourseCount: requested.length,
      coveredCourseCount: coveredIds.size,
      missingCourseIds,
      unknownFeatureCourseIds,
      staleCourseIds,
      conflictingCourseIds: conflicting,
      variesBySectionCourseIds: variesBySectionCourseIds.sort(),
    },
  };
}

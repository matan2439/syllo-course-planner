/**
 * ADAPTERS — wire payload → canonical model. Lossless; half-hour conversion is
 * exact (throws on unsupported precision, never rounds). Runtime-neutral.
 */
import { boardResponseSchema, generatePlanResponseSchema } from './wire';
import { toHalfHours, catalogRevision, normalizeCourseId } from './model';
import type { BoardModel, BoardCourseModel, GeneratedPlanModel } from './model';

/** Raw course shape shared by placed courses and program_repository_courses. */
type RawCourse = {
  course_id: string;
  name_he?: string | null;
  weekly_hours?: number | null;
  course_type?: string;
  is_mandatory?: boolean;
  offered_semesters?: string[] | null;
};

/** Map one raw course (from either source) to the canonical model. Half-hour exact. */
function courseToModel(c: RawCourse): BoardCourseModel {
  return {
    courseId: normalizeCourseId(c.course_id),
    nameHe: c.name_he ?? '',
    halfHours: c.weekly_hours == null ? null : toHalfHours(c.weekly_hours),
    courseType: c.course_type ?? '',
    isMandatory: c.is_mandatory ?? false,
    ...(c.offered_semesters != null ? { offeredSemesters: [...c.offered_semesters] } : {}),
  };
}

/** Parse + map a raw /api/board response into the canonical BoardModel + catalog. */
export function boardResponseToModel(raw: unknown): BoardModel {
  const parsed = boardResponseSchema.parse(raw);

  const semesters = parsed.semesters.map((s) => ({
    semesterId: s.semester_id,
    courses: s.courses.map(courseToModel),
  }));

  // courseCatalog = placed ∪ program_repository_courses, keyed by normalized id.
  // Order-independent merge: within a source, the last occurrence wins; across
  // sources the REPOSITORY entry is authoritative for shared fields, while the
  // placement-only `courseType` (repo entries carry none) is retained.
  const placedIndex: Record<string, BoardCourseModel> = {};
  for (const s of parsed.semesters) {
    for (const c of s.courses) placedIndex[normalizeCourseId(c.course_id)] = courseToModel(c);
  }
  const repoIndex: Record<string, BoardCourseModel> = {};
  for (const c of parsed.metadata.program_repository_courses ?? []) {
    repoIndex[normalizeCourseId(c.course_id)] = courseToModel(c);
  }
  const courseCatalog: Record<string, BoardCourseModel> = {};
  for (const id of new Set([...Object.keys(placedIndex), ...Object.keys(repoIndex)])) {
    const placed = placedIndex[id];
    const repo = repoIndex[id];
    courseCatalog[id] =
      repo && placed ? { ...repo, courseType: repo.courseType || placed.courseType } : repo ?? placed;
  }

  return {
    catalogRevision: catalogRevision(parsed.metadata.board_data_version),
    semesters,
    courseCatalog,
  };
}

/** Parse + map a raw /api/ai/generate-plan response into the canonical model. */
export function generatePlanResponseToModel(raw: unknown): GeneratedPlanModel {
  const p = generatePlanResponseSchema.parse(raw);
  return {
    semesters: p.semesters.map((s) => ({ semesterId: s.semester_id, courseIds: s.course_ids })),
    moves: p.moves.map((m) => ({ courseId: m.course_id, from: m.from, to: m.to })),
    warningsHe: p.warnings_he,
    errors: p.errors,
    blocked: p.blocked,
    ...(p.intentOutcome ? { intentOutcome: p.intentOutcome } : {}),
    // Opt-in AcademicDecisionAgent path only (default-off). Absent on the legacy
    // response → both stay undefined and Apply gating is unchanged.
    ...(p.academicDecision?.outcome ? { agentOutcome: p.academicDecision.outcome } : {}),
    ...(typeof p.academicDecision?.applyEligible === 'boolean'
      ? { applyEligible: p.academicDecision.applyEligible }
      : {}),
    ...(typeof p.academicDecision?.profileVersion === 'number'
      ? { profileVersion: p.academicDecision.profileVersion }
      : {}),
    // S1 — carried through verbatim; it is the only handle Apply may use.
    ...(p.academicDecision?.proposal ? { proposal: p.academicDecision.proposal } : {}),
    ...(typeof p.academicDecision?.candidates?.hasMeaningfulAlternatives === 'boolean'
      ? { balanceAlternativesMaterial: p.academicDecision.candidates.hasMeaningfulAlternatives }
      : {}),
    ...(p.academicDecision?.candidates?.evidence?.groundedQuestionImpact
      ? { groundedQuestionImpact: p.academicDecision.candidates.evidence.groundedQuestionImpact }
      : {}),
    ...(p.academicDecision?.candidates?.alternatives?.length
      ? { alternatives: p.academicDecision.candidates.alternatives }
      : {}),
    ...(p.academicDecision?.candidates?.groundedComposition
      ? { groundedComposition: p.academicDecision.candidates.groundedComposition }
      : {}),
    // C5 — carried through verbatim, for the same reason: the browser must not
    // recompute whether a priority question is worth asking.
    ...(p.academicDecision?.candidates?.evidence?.priorityQuestionImpact
      ? { priorityQuestionImpact: p.academicDecision.candidates.evidence.priorityQuestionImpact }
      : {}),
    // W1 — carried through verbatim. The UI never reconstructs impact from the
    // proposal or the explanation text; this is the only source.
    ...(p.academicDecision?.candidates?.evidence?.topicQuestionImpact
      ? { topicQuestionImpact: p.academicDecision.candidates.evidence.topicQuestionImpact }
      : {}),
    ...(typeof p.academicDecision?.candidates?.groundedExplanationHe === 'string' &&
    p.academicDecision.candidates.groundedExplanationHe.length > 0
      ? { groundedExplanationHe: p.academicDecision.candidates.groundedExplanationHe }
      : {}),
    ...(Array.isArray(p.academicDecision?.candidates?.groundedSources) && p.academicDecision.candidates.groundedSources.length
      ? { groundedSources: p.academicDecision.candidates.groundedSources }
      : {}),
    ...(typeof p.academicDecision?.candidates?.evidence?.groundedObjective === 'string'
      ? { groundedObjective: p.academicDecision.candidates.evidence.groundedObjective }
      : {}),
    // Coverage is disclosure only; emitted just when the server reported real
    // counts, so a partial payload never becomes a fabricated "0 of 0".
    ...(typeof p.academicDecision?.candidates?.evidence?.coveredCourseCount === 'number' &&
    typeof p.academicDecision?.candidates?.evidence?.requestedCourseCount === 'number'
      ? { groundedCoverage: {
            coveredCourseCount: p.academicDecision.candidates.evidence.coveredCourseCount,
            requestedCourseCount: p.academicDecision.candidates.evidence.requestedCourseCount,
            unknownCourseIds: p.academicDecision.candidates.evidence.unknownFeatureCourseIds ?? [],
          } }
      : {}),
    ...(p.academicDecision?.structuredClarification
      ? { agentClarificationItems: mapClarificationItems(p.academicDecision.structuredClarification.items) }
      : {}),
    ...(p.academicDecision?.validationFindings
      ? { agentValidationFindings: mapValidationFindings(p.academicDecision.validationFindings) }
      : {}),
  };
}

function mapClarificationItems(items: Array<Record<string, unknown>>): GeneratedPlanModel['agentClarificationItems'] {
  return items.map((i) => ({
    reasonCode: String(i.reasonCode ?? ''),
    kind: (i.kind === 'authoritative_conflict' ? 'authoritative_conflict' : 'answerable_preference'),
    messageHe: String(i.message_he ?? ''),
    answerable: i.answerable === true,
    applyBlocked: i.applyBlocked === true,
    ...(Array.isArray(i.courseIds) ? { courseIds: i.courseIds.map(String) } : {}),
    ...(typeof i.answerType === 'string' ? { answerType: i.answerType } : {}),
    ...(i.provenance !== undefined ? { provenance: i.provenance as never } : {}),
    ...(typeof i.detail === 'string' ? { detail: i.detail } : {}),
  }));
}

function mapValidationFindings(findings: Array<Record<string, unknown>>): GeneratedPlanModel['agentValidationFindings'] {
  return findings.map((f) => ({
    code: String(f.code ?? ''),
    courseId: String(f.courseId ?? ''),
    messageHe: String(f.message_he ?? ''),
    detail: String(f.detail ?? ''),
    provenance: (f.provenance ?? null) as never,
  }));
}

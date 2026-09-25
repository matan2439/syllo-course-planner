/**
 * Shared helpers for the planning co-pilot's tools (api/ai/agent/tools.ts):
 * model-readable snapshots, validated mutations, grounded facts. The worker
 * executes and VALIDATES every change; the model never decides a hard fact.
 */

import type { PlannerWorker, MutationResult } from './planner_worker';
import { semesterOf } from './planner_types';
import type { CandidateReport } from './planner_validate';
import type { ValidationEvidence, ValidationResult } from './planner_capabilities';


/** Compact, model-readable snapshot after an action. */
export function snapshot(worker: PlannerWorker) {
  const st = worker.getState();
  return {
    phase: st.phase,
    degree_hours: st.degreeHours,
    semester_loads: st.semesterLoads,
    mandatory_placed: st.mandatoryPlaced,
    categories_satisfied: st.categoriesSatisfied,
    errors_he: st.errors,
  };
}

function mutationResult(worker: PlannerWorker, r: MutationResult) {
  return {
    accepted: r.accepted,
    reason: r.action.reason,
    blocked_by: r.errorsIntroduced,
    ...snapshot(worker),
  };
}

export function safeMutation(worker: PlannerWorker, mutate: () => MutationResult) {
  try {
    return mutationResult(worker, mutate());
  } catch {
    return {
      accepted: false,
      reason: 'הפעולה נדחתה כי אינה מוכרת או אינה חוקית.',
      blocked_by: ['פעולה לא חוקית'],
      ...snapshot(worker),
    };
  }
}

type FactMeta = {
  source: string;
  freshness: 'request_snapshot';
  confidence: number;
  source_url?: string | null;
};

export function fact(source = 'planner_model', confidence = 1, sourceUrl?: string | null): FactMeta {
  return {
    source,
    freshness: 'request_snapshot',
    confidence,
    ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
  };
}

export function grounded<T>(data: T, meta: FactMeta = fact()) {
  return { data, fact: meta };
}

/**
 * Adapts the authoritative CandidateReport into the shared validation
 * capability contract. It copies already-computed findings only: this layer
 * neither adds rules nor parses error text to infer academic facts.
 */
export function simulationValidationFromCandidateReport(
  report: CandidateReport,
  degreeHoursRequired: number,
): ValidationResult {
  const evidence: ValidationEvidence = {
    legal: report.legal,
    complete: report.complete,
    constraintsChecked: [...report.constraintsChecked],
    degreeHours: report.degreeHours,
    degreeHoursRequired,
    degreeMet: report.degreeMet,
    missingMandatoryCourseIds: [...report.missingMandatory],
    unsatisfiedCategoryIds: [...report.unsatisfiedCategories],
    disallowedCourseIds: [...report.disallowedPlaced],
    overCapSemesterIds: [...report.overCapSemesters],
    missingMustIncludeCourseIds: [...report.missingMustInclude],
    warnings: [...report.warnings],
  };
  if (report.valid) return { valid: true, violations: [], evidence };
  return {
    valid: false,
    reason: report.errors.join('\n') || undefined,
    violations: report.errors.map((message) => ({
      code: 'CANDIDATE_VALIDATION_REJECTED',
      severity: 'error' as const,
      message,
    })),
    evidence,
  };
}

export function profileFor(worker: PlannerWorker, courseId: string) {
  return worker.getModel().profiles.get(courseId);
}

export function allowedSemesters(profile: NonNullable<ReturnType<typeof profileFor>>): string[] | null {
  return profile.effective_allowed_semesters
    ?? profile.offered_semesters
    ?? profile.allowed_semesters
    ?? profile.program_allowed_semesters;
}

function semesterIndex(worker: PlannerWorker, semesterId: string): number {
  return worker.getModel().knownSemesterIds.indexOf(semesterId);
}

export function prerequisiteStatus(worker: PlannerWorker, courseId: string, targetSemester?: string) {
  const profile = profileFor(worker, courseId);
  if (!profile) return { course_id: courseId, known: false, missing_course_ids: [] as string[] };
  const model = worker.getModel();
  const plan = worker.getPlan();
  const completed = model.completedCourseIds;
  const current = model.currentlyPlannedCourseIds ?? new Set<string>();
  const targetIndex = targetSemester ? semesterIndex(worker, targetSemester) : null;
  const missing = profile.prerequisites.filter((id) => {
    if (completed.has(id) || current.has(id)) return false;
    const placedAt = semesterOf(plan, id);
    if (placedAt && targetIndex !== null) return semesterIndex(worker, placedAt) >= targetIndex;
    return !placedAt;
  });
  return {
    course_id: courseId,
    known: true,
    target_semester: targetSemester ?? null,
    prerequisite_course_ids: [...profile.prerequisites],
    missing_course_ids: missing,
    legal: missing.length === 0,
  };
}

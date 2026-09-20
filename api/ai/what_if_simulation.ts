import { applyMutation } from './planner_goals';
import { cloneState, type PlanState, type PlannerMutation } from './planner_types';
import type {
  ConstraintViolation,
  ValidationCapability,
  ValidationEvidence,
} from './planner_capabilities';

/** Explicit hypothetical edits; annual additions retain the worker's atomic spans. */
export type SimulationChange =
  | { kind: 'add_course'; courseId: string; semesterId: string; alsoSemesterIds?: string[] }
  | { kind: 'remove_course'; courseId: string }
  | { kind: 'move_course'; courseId: string; toSemester: string };

export interface SimulationRequest {
  baseline: PlanState;
  changes: SimulationChange[];
}

export type SimulationResult =
  | { status: 'simulated'; baseline: PlanState; candidate: PlanState;
      changes: SimulationChange[];
      /** Legality under the injected validator, not an assertion of degree completion. */
      validation: {
        valid: boolean;
        violations: ConstraintViolation[];
        /** Structured facts returned by the injected validator, when available. */
        evidence?: ValidationEvidence;
      } }
  | { status: 'rejected'; baseline: PlanState; changes: SimulationChange[];
      failedChangeIndex: number; code: 'CHANGE_NOT_APPLICABLE' };

export interface WhatIfSimulationCapability {
  simulate(request: SimulationRequest): Promise<SimulationResult>;
}

/** Bind validation to the same model/policy snapshot used to construct the plan.
 * No search, scoring, persistence or committed-plan mutation occurs here.
 */
export class DeterministicWhatIfSimulationCapability implements WhatIfSimulationCapability {
  constructor(private readonly validation: ValidationCapability) {}

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const baseline = cloneState(request.baseline);
    const changes = request.changes.map(change => change.kind === 'add_course' && change.alsoSemesterIds
      ? { ...change, alsoSemesterIds: [...change.alsoSemesterIds] } : { ...change });
    let candidate = cloneState(baseline);
    for (const [index, change] of changes.entries()) {
      const mutation: PlannerMutation = change.kind === 'add_course'
        ? { type: 'ADD_COURSE', courseId: change.courseId, semesterId: change.semesterId, alsoSemesterIds: change.alsoSemesterIds }
        : change.kind === 'remove_course'
          ? { type: 'REMOVE_COURSE', courseId: change.courseId }
          : { type: 'MOVE_COURSE', courseId: change.courseId, toSemester: change.toSemester };
      const next = applyMutation(candidate, mutation);
      if (!next) return { status: 'rejected', baseline, changes, failedChangeIndex: index, code: 'CHANGE_NOT_APPLICABLE' };
      candidate = next;
    }
    const checked = this.validation.validateState(cloneState(candidate));
    const violations = checked.violations
      ? checked.violations.map((violation) => ({
          ...violation,
          ...(violation.courseIds ? { courseIds: [...violation.courseIds] } : {}),
        }))
      : checked.valid
        ? []
        : [checked.reason === undefined
          ? { code: 'VALIDATION_REJECTED' }
          : { code: 'VALIDATION_REJECTED', message: checked.reason }];
    const evidence = checked.evidence && {
      ...checked.evidence,
      ...(checked.evidence.constraintsChecked ? { constraintsChecked: [...checked.evidence.constraintsChecked] } : {}),
      ...(checked.evidence.missingMandatoryCourseIds ? { missingMandatoryCourseIds: [...checked.evidence.missingMandatoryCourseIds] } : {}),
      ...(checked.evidence.unsatisfiedCategoryIds ? { unsatisfiedCategoryIds: [...checked.evidence.unsatisfiedCategoryIds] } : {}),
      ...(checked.evidence.disallowedCourseIds ? { disallowedCourseIds: [...checked.evidence.disallowedCourseIds] } : {}),
      ...(checked.evidence.overCapSemesterIds ? { overCapSemesterIds: [...checked.evidence.overCapSemesterIds] } : {}),
      ...(checked.evidence.missingMustIncludeCourseIds ? { missingMustIncludeCourseIds: [...checked.evidence.missingMustIncludeCourseIds] } : {}),
      ...(checked.evidence.warnings ? { warnings: [...checked.evidence.warnings] } : {}),
    };
    return { status: 'simulated', baseline, candidate, changes,
      validation: { valid: checked.valid, violations, ...(evidence ? { evidence } : {}) } };
  }
}

import type { ManualBoardEditRequest } from '../../shared/planner/wire';
import type { AcademicContextRecord } from './academic_context_store';
import type { CommittedBoard, BoardSemesterState } from './board_repository';
import { buildModel } from './generate-plan';
import { planContextToState } from './planner_model';
import { validatePlanState } from './planner_validate';

export type ManualAddFailureCode =
  | 'ACADEMIC_STATUS_MISMATCH'
  | 'UNKNOWN_COURSE'
  | 'UNKNOWN_SEMESTER'
  | 'COURSE_ALREADY_PRESENT'
  | 'COURSE_COMPLETED'
  | 'COURSE_CURRENTLY_TAKING'
  | 'COURSE_HARD_EXCLUDED'
  | 'PLAN_INVALID';
export type ManualRemoveFailureCode = ManualAddFailureCode | 'COURSE_NOT_PRESENT' | 'COURSE_REQUIRED';

export type ManualAddResult =
  | { ok: true; semesters: BoardSemesterState[] }
  | { ok: false; code: ManualAddFailureCode; details?: string[] };

export interface PrepareManualCourseAddInput {
  boardJson: unknown;
  context: AcademicContextRecord;
  currentBoard: CommittedBoard | null;
  request: Extract<ManualBoardEditRequest, { operation: 'add_course' }>;
}

export interface PrepareManualCourseRemoveInput {
  boardJson: unknown;
  context: AcademicContextRecord;
  currentBoard: CommittedBoard;
  request: Extract<ManualBoardEditRequest, { operation: 'remove_course' }>;
}
export interface PrepareManualCourseMoveInput {
  boardJson: unknown;
  context: AcademicContextRecord;
  currentBoard: CommittedBoard;
  request: Extract<ManualBoardEditRequest, { operation: 'move_course' }>;
}

const statusIds = (status: unknown, field: 'completed' | 'currently_taking'): Set<string> => {
  const source = (status ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(source[field]) ? source[field] as Array<{ course_id?: unknown }> : [];
  return new Set(entries.map((entry) => String(entry?.course_id ?? '')).filter(Boolean));
};

/**
 * Build and validate the exact board the repository may commit. This function
 * is pure: ownership, CAS and idempotency belong to the handler/repository;
 * academic and catalog legality belong here.
 */
export function prepareManualCourseAdd(input: PrepareManualCourseAddInput): ManualAddResult {
  const { boardJson, context, currentBoard, request } = input;
  if (context.digest !== request.academic_status_digest) {
    return { ok: false, code: 'ACADEMIC_STATUS_MISMATCH' };
  }

  const model = buildModel(boardJson, context.planContext, context.preferences as any, request.program_id);
  if (!model.knownSemesterIds.includes(request.semester_id)) {
    return { ok: false, code: 'UNKNOWN_SEMESTER' };
  }
  const profile = model.profiles.get(request.course_id);
  if (!profile) return { ok: false, code: 'UNKNOWN_COURSE' };

  const completed = statusIds(context.personalStatus, 'completed');
  if (completed.has(request.course_id) || model.completedCourseIds.has(request.course_id)) {
    return { ok: false, code: 'COURSE_COMPLETED' };
  }
  const taking = statusIds(context.personalStatus, 'currently_taking');
  if (taking.has(request.course_id) || model.currentlyPlannedCourseIds?.has(request.course_id)) {
    return { ok: false, code: 'COURSE_CURRENTLY_TAKING' };
  }
  if (model.disallowedCourseIds.has(request.course_id) || profile.excluded) {
    return { ok: false, code: 'COURSE_HARD_EXCLUDED' };
  }

  const state = currentBoard
    ? { semesters: Object.fromEntries(model.knownSemesterIds.map((semesterId) => [
        semesterId,
        [...(currentBoard.semesters.find((semester) => semester.semesterId === semesterId)?.courseIds ?? [])],
      ])) }
    : planContextToState(context.planContext as any, model);

  if (Object.values(state.semesters).some((ids) => ids.includes(request.course_id))) {
    return { ok: false, code: 'COURSE_ALREADY_PRESENT' };
  }

  const destinations = profile.is_annual && profile.spans_semesters?.length
    ? [...profile.spans_semesters]
    : [request.semester_id];
  for (const semesterId of destinations) {
    if (!model.knownSemesterIds.includes(semesterId)) {
      return { ok: false, code: 'UNKNOWN_SEMESTER' };
    }
    state.semesters[semesterId] = [...(state.semesters[semesterId] ?? []), request.course_id];
  }

  const validation = validatePlanState(state, model);
  if (!validation.valid) return { ok: false, code: 'PLAN_INVALID', details: validation.errors };

  return {
    ok: true,
    semesters: model.knownSemesterIds.map((semesterId) => ({
      semesterId,
      courseIds: [...new Set(state.semesters[semesterId] ?? [])].sort(),
    })),
  };
}

export function prepareManualCourseRemove(input: PrepareManualCourseRemoveInput):
  | { ok: true; semesters: BoardSemesterState[] }
  | { ok: false; code: ManualRemoveFailureCode; details?: string[] } {
  const { boardJson, context, currentBoard, request } = input;
  if (context.digest !== request.academic_status_digest) {
    return { ok: false, code: 'ACADEMIC_STATUS_MISMATCH' };
  }
  const model = buildModel(boardJson, context.planContext, context.preferences as any, request.program_id);
  const profile = model.profiles.get(request.course_id);
  if (!profile) return { ok: false, code: 'UNKNOWN_COURSE' };
  if (profile.is_mandatory) return { ok: false, code: 'COURSE_REQUIRED' };
  if (!currentBoard.semesters.some((semester) => semester.courseIds.includes(request.course_id))) {
    return { ok: false, code: 'COURSE_NOT_PRESENT' };
  }

  const state = { semesters: Object.fromEntries(model.knownSemesterIds.map((semesterId) => [
    semesterId,
    (currentBoard.semesters.find((semester) => semester.semesterId === semesterId)?.courseIds ?? [])
      .filter((courseId) => courseId !== request.course_id),
  ])) };
  const validation = validatePlanState(state, model);
  if (!validation.valid) return { ok: false, code: 'PLAN_INVALID', details: validation.errors };
  return {
    ok: true,
    semesters: model.knownSemesterIds.map((semesterId) => ({
      semesterId, courseIds: [...new Set(state.semesters[semesterId] ?? [])].sort(),
    })),
  };
}

export function prepareManualCourseMove(input: PrepareManualCourseMoveInput):
  | { ok: true; semesters: BoardSemesterState[] }
  | { ok: false; code: ManualRemoveFailureCode; details?: string[] } {
  const { boardJson, context, currentBoard, request } = input;
  if (context.digest !== request.academic_status_digest) {
    return { ok: false, code: 'ACADEMIC_STATUS_MISMATCH' };
  }
  const model = buildModel(boardJson, context.planContext, context.preferences as any, request.program_id);
  if (!model.knownSemesterIds.includes(request.semester_id)) {
    return { ok: false, code: 'UNKNOWN_SEMESTER' };
  }
  const profile = model.profiles.get(request.course_id);
  if (!profile) return { ok: false, code: 'UNKNOWN_COURSE' };
  const sourceSemesterIds = currentBoard.semesters
    .filter((semester) => semester.courseIds.includes(request.course_id))
    .map((semester) => semester.semesterId);
  if (!sourceSemesterIds.length) return { ok: false, code: 'COURSE_NOT_PRESENT' };
  if (sourceSemesterIds.includes(request.semester_id)) {
    return { ok: false, code: 'COURSE_ALREADY_PRESENT' };
  }

  const state = { semesters: Object.fromEntries(model.knownSemesterIds.map((semesterId) => [
    semesterId,
    (currentBoard.semesters.find((semester) => semester.semesterId === semesterId)?.courseIds ?? [])
      .filter((courseId) => courseId !== request.course_id),
  ])) };
  const destinations = profile.is_annual && profile.spans_semesters?.length
    ? [...profile.spans_semesters]
    : [request.semester_id];
  for (const semesterId of destinations) {
    state.semesters[semesterId] = [...(state.semesters[semesterId] ?? []), request.course_id];
  }
  const validation = validatePlanState(state, model);
  if (!validation.valid) return { ok: false, code: 'PLAN_INVALID', details: validation.errors };
  return {
    ok: true,
    semesters: model.knownSemesterIds.map((semesterId) => ({
      semesterId, courseIds: [...new Set(state.semesters[semesterId] ?? [])].sort(),
    })),
  };
}

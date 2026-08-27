import { prepareManualCourseAdd } from '../../api/ai/manual_board_edit_service';
import type { AcademicContextRecord } from '../../api/ai/academic_context_store';

const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const PROGRAM = 'test_program_2027';
const course = (course_id: string, over: Record<string, unknown> = {}) => ({
  course_id, name_he: course_id, weekly_hours: 3, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective',
  offered_semesters: [A, B], prerequisites: [], ...over,
});
const BOARD = {
  semesters: [{ semester_id: A, courses: [] }, { semester_id: B, courses: [] }],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 6, categories: [] },
    program_repository_courses: [
      course('BASE'), course('NEEDS_BASE', { prerequisites: ['BASE'] }),
      course('DONE'), course('BLOCKED'), course('ONLY_B', {
        offered_semesters: [B], effective_allowed_semesters: [B], data_quality: 'verified',
      }),
    ],
  },
};
const context: AcademicContextRecord = {
  ownerId: 'o'.repeat(43), programId: PROGRAM, digest: 'as_current', updatedAt: 1,
  personalStatus: {
    completed: [{ course_id: 'DONE' }], currently_taking: [],
    completed_knowledge: { status: 'known' },
  },
  planContext: { semesters: [], personal_status: {
    completed: [{ course_id: 'DONE' }], currently_taking: [],
    completed_knowledge: { status: 'known' },
  } },
  preferences: { disallowed_course_ids: ['BLOCKED'], max_weekly_hours: 20 },
};
const request = (course_id: string, semester_id = A) => ({
  operation: 'add_course' as const, program_id: PROGRAM,
  expected_board_version: null, operation_id: 'edit_0123456789abcdef',
  course_id, semester_id, academic_status_digest: 'as_current',
});

describe('R2 — authoritative manual add preparation', () => {
  test('adds a catalog course to a canonical semester without mutating inputs', () => {
    const result = prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null, request: request('BASE') });
    expect(result).toEqual({ ok: true, semesters: [
      { semesterId: A, courseIds: ['BASE'] }, { semesterId: B, courseIds: [] },
    ] });
    expect(BOARD.semesters[0].courses).toEqual([]);
  });

  test.each([
    ['UNKNOWN', 'UNKNOWN_COURSE'],
    ['DONE', 'COURSE_COMPLETED'],
    ['BLOCKED', 'COURSE_HARD_EXCLUDED'],
  ])('rejects %s with %s', (courseId, code) => {
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null, request: request(courseId) }))
      .toEqual(expect.objectContaining({ ok: false, code }));
  });

  test('rejects a stale academic digest and unknown semester', () => {
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null,
      request: { ...request('BASE'), academic_status_digest: 'as_stale' } }))
      .toEqual(expect.objectContaining({ ok: false, code: 'ACADEMIC_STATUS_MISMATCH' }));
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null,
      request: request('BASE', 'invented') }))
      .toEqual(expect.objectContaining({ ok: false, code: 'UNKNOWN_SEMESTER' }));
  });

  test('uses the real legality validator for offering and prerequisite timing', () => {
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null, request: request('ONLY_B', A) }))
      .toEqual(expect.objectContaining({ ok: false, code: 'PLAN_INVALID' }));
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: null, request: request('NEEDS_BASE', A) }))
      .toEqual(expect.objectContaining({ ok: false, code: 'PLAN_INVALID' }));
  });

  test('rejects a duplicate from the authoritative committed board', () => {
    const currentBoard = {
      ownerId: context.ownerId, programId: PROGRAM, version: 'bv_1', updatedAt: 1,
      semesters: [{ semesterId: A, courseIds: ['BASE'] }, { semesterId: B, courseIds: [] }],
    };
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard, request: { ...request('BASE'), expected_board_version: 'bv_1' } }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_ALREADY_PRESENT' }));
  });
});

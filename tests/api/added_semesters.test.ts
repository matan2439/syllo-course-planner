import {
  prepareManualCourseAdd, prepareManualSemesterChange,
} from '../../api/ai/manual_board_edit_service';
import type { AcademicContextRecord } from '../../api/ai/academic_context_store';
import type { CommittedBoard } from '../../api/ai/board_repository';
import { buildModel } from '../../api/ai/generate-plan';
import { addedSemesterIds, buildConstraintModel, withCommittedColumns } from '../../api/ai/planner_model';

const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const ADDED_A = 'year_4_semester_a';
const ADDED_B = 'year_4_semester_b';
const PROGRAM = 'test_program_2027';
const course = (course_id: string, over: Record<string, unknown> = {}) => ({
  course_id, name_he: course_id, weekly_hours: 3, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective', prerequisites: [], ...over,
});
const BOARD = {
  semesters: [{ semester_id: A, courses: [] }, { semester_id: B, courses: [] }],
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 6, categories: [] },
    program_repository_courses: [
      course('ANY', { offered_semesters: ['A', 'B'] }),
      course('ONLY_B', { offered_semesters: [B], effective_allowed_semesters: [B], data_quality: 'verified' }),
    ],
  },
};
const context: AcademicContextRecord = {
  ownerId: 'o'.repeat(43), programId: PROGRAM, digest: 'as_current', updatedAt: 1,
  personalStatus: { completed: [], currently_taking: [], completed_knowledge: { status: 'known' } },
  planContext: { semesters: [], personal_status: { completed: [], currently_taking: [], completed_knowledge: { status: 'known' } } },
  preferences: { max_weekly_hours: 20 },
};
const base = {
  program_id: PROGRAM, expected_board_version: null, operation_id: 'edit_0123456789abcdef',
  academic_status_digest: 'as_current',
};
const semesterOp = (operation: 'add_semester' | 'remove_semester', semester_id: string) =>
  ({ ...base, operation, semester_id });
const committed = (semesters: CommittedBoard['semesters']): CommittedBoard =>
  ({ ownerId: context.ownerId, programId: PROGRAM, version: 'bv_1', semesters, updatedAt: 1 });
const boardWith = (...extra: CommittedBoard['semesters']) => committed([
  { semesterId: A, courseIds: [] }, { semesterId: B, courseIds: [] }, ...extra,
]);

describe('student-added semesters', () => {
  test('a board without added semesters builds exactly the model it did before', () => {
    const before = buildConstraintModel(BOARD);
    const after = buildConstraintModel(BOARD, { extraSemesterIds: [] });
    expect(after.knownSemesterIds).toEqual([A, B]);
    expect(after).toEqual(before);
    // A plan context listing only board columns adds nothing.
    expect(buildModel(BOARD, { semesters: [{ id: A }, { id: B }] }, {}, PROGRAM).knownSemesterIds).toEqual([A, B]);
  });

  test('only canonical ids past the board\'s last year, up to the cap, qualify', () => {
    expect(addedSemesterIds(BOARD, [ADDED_B, A, 'year_3_semester_c', 'year_7_semester_a', 'x', ADDED_A, ADDED_A]))
      .toEqual([ADDED_A, ADDED_B]);
  });

  test('adding a semester commits an empty column after the board\'s own', () => {
    const result = prepareManualSemesterChange({ boardJson: BOARD, context, currentBoard: null, request: semesterOp('add_semester', ADDED_A) });
    expect(result).toEqual({ ok: true, semesters: [
      { semesterId: A, courseIds: [] }, { semesterId: B, courseIds: [] }, { semesterId: ADDED_A, courseIds: [] },
    ] });
  });

  test.each([
    ['add_semester', A, 'UNKNOWN_SEMESTER'],
    ['add_semester', 'year_7_semester_a', 'UNKNOWN_SEMESTER'],
    ['add_semester', ADDED_A, 'SEMESTER_ALREADY_PRESENT'],
    ['remove_semester', A, 'SEMESTER_NOT_REMOVABLE'],
    ['remove_semester', ADDED_B, 'UNKNOWN_SEMESTER'],
  ] as const)('%s %s is refused with %s', (operation, semesterId, code) => {
    const result = prepareManualSemesterChange({
      boardJson: BOARD, context, currentBoard: boardWith({ semesterId: ADDED_A, courseIds: [] }),
      request: semesterOp(operation, semesterId),
    });
    expect(result).toEqual({ ok: false, code });
  });

  test('placement into an added semester validates, with offering keyed by the term', () => {
    const currentBoard = boardWith({ semesterId: ADDED_A, courseIds: [] }, { semesterId: ADDED_B, courseIds: [] });
    const add = (course_id: string, semester_id: string) => prepareManualCourseAdd({
      boardJson: BOARD, context, currentBoard,
      request: { ...base, operation: 'add_course', course_id, semester_id },
    });
    const placed = add('ONLY_B', ADDED_B);
    expect(placed.ok).toBe(true);
    if (placed.ok) expect(placed.semesters.find(s => s.semesterId === ADDED_B)?.courseIds).toEqual(['ONLY_B']);
    expect(add('ANY', ADDED_A).ok).toBe(true);
    // A ב-only course stays illegal in an added א semester.
    expect(add('ONLY_B', ADDED_A)).toMatchObject({ ok: false, code: 'PLAN_INVALID' });
    // Without the column on the committed board the id is unknown, as before.
    expect(prepareManualCourseAdd({ boardJson: BOARD, context, currentBoard: boardWith(),
      request: { ...base, operation: 'add_course', course_id: 'ANY', semester_id: ADDED_A } }))
      .toEqual({ ok: false, code: 'UNKNOWN_SEMESTER' });
  });

  test('removing an added semester is refused while it holds a course, allowed once empty', () => {
    const request = semesterOp('remove_semester', ADDED_A);
    expect(prepareManualSemesterChange({ boardJson: BOARD, context, request,
      currentBoard: boardWith({ semesterId: ADDED_A, courseIds: ['ANY'] }) }))
      .toEqual({ ok: false, code: 'SEMESTER_NOT_EMPTY' });
    expect(prepareManualSemesterChange({ boardJson: BOARD, context, request,
      currentBoard: boardWith({ semesterId: ADDED_A, courseIds: [] }) }))
      .toEqual({ ok: true, semesters: [{ semesterId: A, courseIds: [] }, { semesterId: B, courseIds: [] }] });
  });

  test('the committed board, not a stale stored context, decides the added columns', () => {
    const stale = { semesters: [{ id: A, courses: [] }, { id: ADDED_A, courses: [] }] };
    expect(withCommittedColumns(BOARD, stale, [A, B, ADDED_B]).semesters.map((s: any) => s.id)).toEqual([A, ADDED_B]);
    expect(withCommittedColumns(BOARD, stale, null)).toBe(stale);
  });
});

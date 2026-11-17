import {
  prepareManualCourseAdd, prepareManualCourseMove, prepareManualCourseRemove,
} from '../../api/ai/manual_board_edit_service';
import type { AcademicContextRecord } from '../../api/ai/academic_context_store';
import { readFileSync } from 'node:fs';
import { buildModel } from '../../api/ai/generate-plan';

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
  test.each([false, true])('real Engineering Design placement at 30 weekly hours (currently taking: %s)', taking => {
    const boardJson = JSON.parse(readFileSync('data/boards/mechanical_engineering_2027.json', 'utf8'));
    const initialModel = buildModel(boardJson, {}, {}, 'mechanical_engineering_2027');
    const personalStatus = {
      completed: [...new Set([...initialModel.profiles.values()].flatMap(p => p.prerequisites))]
        .map(course_id => ({ course_id })),
      currently_taking: taking ? [{ course_id: '0542-4422' }] : [],
    };
    const result = prepareManualCourseAdd({ boardJson, currentBoard: null,
      context: { ...context, programId: 'mechanical_engineering_2027', personalStatus,
        planContext: { semesters: boardJson.semesters.map((s: any) => ({ id: s.semester_id, courses: s.courses })), personal_status: personalStatus } },
      request: { ...request('0542-4422'), program_id: 'mechanical_engineering_2027' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.semesters.find(s => s.semesterId === A)?.courseIds).toContain('0542-4422');
  });

  test('an unrelated existing prerequisite error does not block adding a legal course', () => {
    const result = prepareManualCourseAdd({ boardJson: BOARD,
      context: { ...context, planContext: { ...context.planContext as object,
        semesters: [{ id: B, courses: [{ course_id: 'NEEDS_BASE' }] }] } },
      currentBoard: null, request: request('ONLY_B', B) });
    expect(result.ok).toBe(true);
  });

  test('in-progress prerequisites placed on the board must still precede dependents', () => {
    const personalStatus = { currently_taking: [{ course_id: 'BASE' }] };
    const ctx = { ...context, personalStatus, planContext: {
      personal_status: personalStatus, semesters: [{ id: A, courses: [{ course_id: 'BASE' }] }],
    } };
    expect(prepareManualCourseAdd({ boardJson: BOARD, context: ctx, currentBoard: null, request: request('NEEDS_BASE', A) }).ok).toBe(false);
    expect(prepareManualCourseAdd({ boardJson: BOARD, context: ctx, currentBoard: null, request: request('NEEDS_BASE', B) }).ok).toBe(true);
  });
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

  test('availability is a hard rule on the real board: wrong term and not-offered courses are refused with a reason', () => {
    const boardJson = JSON.parse(readFileSync('data/boards/mechanical_engineering_2027.json', 'utf8'));
    const real = { ...context, programId: 'mechanical_engineering_2027', preferences: {},
      planContext: { semesters: boardJson.semesters.map((s: any) => ({ id: s.semester_id, courses: s.courses })), personal_status: context.personalStatus } };
    const add = (course_id: string, semester_id: string) => prepareManualCourseAdd({ boardJson, context: real, currentBoard: null,
      request: { ...request(course_id, semester_id), program_id: 'mechanical_engineering_2027' } });
    // Intro to finite elements is given in semester A only.
    const wrongTerm = add('0542-4223', 'year_4_semester_b');
    expect(wrongTerm).toEqual(expect.objectContaining({ ok: false, code: 'PLAN_INVALID' }));
    expect((wrongTerm as { details?: string[] }).details?.join(' ')).toMatch(/מותר רק ב/);
    expect(add('0542-4223', 'year_4_semester_a')).toEqual(expect.objectContaining({ ok: true }));
    // Not offered at all this academic year.
    expect(add('0542-4226', 'year_4_semester_a')).toEqual(expect.objectContaining({ ok: false, code: 'COURSE_HARD_EXCLUDED' }));
  });

  test('catalog term letters alone are enough to refuse a wrong-term placement', () => {
    const board = { ...BOARD, metadata: { ...BOARD.metadata,
      program_repository_courses: [...BOARD.metadata.program_repository_courses, course('TERM_B', { offered_semesters: ['B'] })] } };
    expect(prepareManualCourseAdd({ boardJson: board, context, currentBoard: null, request: request('TERM_B', A) }))
      .toEqual(expect.objectContaining({ ok: false, code: 'PLAN_INVALID' }));
    expect(prepareManualCourseAdd({ boardJson: board, context, currentBoard: null, request: request('TERM_B', B) }))
      .toEqual(expect.objectContaining({ ok: true }));
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

describe('R2 — authoritative manual remove preparation', () => {
  const currentBoard = {
    ownerId: context.ownerId, programId: PROGRAM, version: 'bv_1', updatedAt: 1,
    semesters: [{ semesterId: A, courseIds: ['BASE'] }, { semesterId: B, courseIds: [] }],
  };
  const remove = (course_id: string) => ({
    operation: 'remove_course' as const, program_id: PROGRAM,
    expected_board_version: 'bv_1', operation_id: 'remove_0123456789abcdef',
    course_id, academic_status_digest: 'as_current',
  });

  test('removes one present elective from the authoritative board', () => {
    expect(prepareManualCourseRemove({ boardJson: BOARD, context, currentBoard, request: remove('BASE') }))
      .toEqual({ ok: true, semesters: [
        { semesterId: A, courseIds: [] }, { semesterId: B, courseIds: [] },
      ] });
  });

  test('removal cannot strand a dependent even when another error already exists', () => {
    const withDependent = { ...currentBoard, semesters: [
      { semesterId: A, courseIds: ['BASE', 'ONLY_B'] },
      { semesterId: B, courseIds: ['NEEDS_BASE'] },
    ] };
    expect(prepareManualCourseRemove({ boardJson: BOARD, context, currentBoard: withDependent, request: remove('BASE') }).ok).toBe(false);
  });

  test('rejects a course that is absent instead of silently succeeding', () => {
    expect(prepareManualCourseRemove({ boardJson: BOARD, context, currentBoard, request: remove('ONLY_B') }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_NOT_PRESENT' }));
  });

  test('rejects removal of an authoritative mandatory course', () => {
    const mandatoryBoard = {
      ...BOARD,
      metadata: { ...BOARD.metadata, program_repository_courses: [
        ...BOARD.metadata.program_repository_courses, course('MANDATORY', { is_mandatory: true, course_type: 'mandatory' }),
      ] },
    };
    const withMandatory = { ...currentBoard, semesters: [{ semesterId: A, courseIds: ['MANDATORY'] }, { semesterId: B, courseIds: [] }] };
    expect(prepareManualCourseRemove({ boardJson: mandatoryBoard, context, currentBoard: withMandatory, request: remove('MANDATORY') }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_REQUIRED' }));
  });
});

describe('R2 — authoritative manual move preparation', () => {
  const currentBoard = {
    ownerId: context.ownerId, programId: PROGRAM, version: 'bv_1', updatedAt: 1,
    semesters: [{ semesterId: A, courseIds: ['BASE'] }, { semesterId: B, courseIds: [] }],
  };
  const move = (course_id: string, semester_id = B) => ({
    operation: 'move_course' as const, program_id: PROGRAM,
    expected_board_version: 'bv_1', operation_id: 'move_0123456789abcdef',
    course_id, semester_id, academic_status_digest: 'as_current',
  });

  test('moves a present elective to one authoritative destination', () => {
    expect(prepareManualCourseMove({ boardJson: BOARD, context, currentBoard, request: move('BASE') }))
      .toEqual({ ok: true, semesters: [
        { semesterId: A, courseIds: [] }, { semesterId: B, courseIds: ['BASE'] },
      ] });
  });

  test('enforces pins from the existing board', () => {
    const ctx = { ...context, planContext: { ...context.planContext as object, pinned_course_ids: ['BASE'] } };
    expect(prepareManualCourseMove({ boardJson: BOARD, context: ctx, currentBoard, request: move('BASE') }).ok).toBe(false);
  });

  test('rechecks a moved course even if its invalid prerequisite order already existed', () => {
    const ctx = { ...context, planContext: { ...context.planContext as object, semesters: [
      { id: A, courses: [{ course_id: 'NEEDS_BASE' }] }, { id: B, courses: [] },
    ] } };
    expect(prepareManualCourseMove({ boardJson: BOARD, context: ctx, currentBoard: null,
      request: { ...move('NEEDS_BASE'), expected_board_version: null } }).ok).toBe(false);
  });

  test('moving a prerequisite into its dependent semester remains blocked', () => {
    const withDependent = { ...currentBoard, semesters: [
      { semesterId: A, courseIds: ['BASE'] }, { semesterId: B, courseIds: ['NEEDS_BASE'] },
    ] };
    expect(prepareManualCourseMove({ boardJson: BOARD, context, currentBoard: withDependent, request: move('BASE') }).ok).toBe(false);
  });

  test('moves a course from the authoritative planning context before a committed board exists', () => {
    const initialContext = {
      ...context,
      planContext: {
        semesters: [{ id: A, courses: [{ course_id: 'BASE' }] }, { id: B, courses: [] }],
        personal_status: context.personalStatus,
      },
    };
    expect(prepareManualCourseMove({
      boardJson: BOARD,
      context: initialContext,
      currentBoard: null,
      request: { ...move('BASE'), expected_board_version: null },
    })).toEqual({ ok: true, semesters: [
      { semesterId: A, courseIds: [] }, { semesterId: B, courseIds: ['BASE'] },
    ] });
  });

  test('rejects absent courses and a no-op destination', () => {
    expect(prepareManualCourseMove({ boardJson: BOARD, context, currentBoard, request: move('NEEDS_BASE') }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_NOT_PRESENT' }));
    expect(prepareManualCourseMove({ boardJson: BOARD, context, currentBoard, request: move('BASE', A) }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_ALREADY_PRESENT' }));
  });

  test('uses the authoritative offering validator at the destination', () => {
    expect(prepareManualCourseMove({ boardJson: BOARD, context, currentBoard, request: move('ONLY_B', A) }))
      .toEqual(expect.objectContaining({ ok: false, code: 'COURSE_NOT_PRESENT' }));
    expect(prepareManualCourseMove({
      boardJson: BOARD, context,
      currentBoard: { ...currentBoard, semesters: [{ semesterId: A, courseIds: [] }, { semesterId: B, courseIds: ['ONLY_B'] }] },
      request: move('ONLY_B', A),
    })).toEqual(expect.objectContaining({ ok: false, code: 'PLAN_INVALID' }));
  });
});

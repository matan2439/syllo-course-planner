import {
  manualBoardEditRequestSchema,
  manualBoardEditResponseSchema,
} from '../../shared/planner/wire';

describe('R2 — authoritative manual board edit wire contract', () => {
  const valid = {
    operation: 'add_course',
    program_id: 'mechanical_engineering_2027',
    expected_board_version: 'bv_3',
    operation_id: 'edit_0123456789abcdef',
    course_id: '0542-4241',
    semester_id: 'year_3_semester_a',
    academic_status_digest: 'as_0123456789abcdef',
  };

  test('accepts only the minimal add intent and no client-authored plan or owner', () => {
    expect(manualBoardEditRequestSchema.parse(valid)).toEqual(valid);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, semesters: [] }).success).toBe(false);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, owner_id: 'attacker' }).success).toBe(false);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, new_board_version: 'bv_99' }).success).toBe(false);
  });

  test('keeps unknown first-board version distinct from an arbitrary client version', () => {
    expect(manualBoardEditRequestSchema.parse({ ...valid, expected_board_version: null }).expected_board_version).toBeNull();
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, expected_board_version: '3' }).success).toBe(false);
  });

  test('requires stable canonical identities', () => {
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, operation_id: '' }).success).toBe(false);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, course_id: '' }).success).toBe(false);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, semester_id: '' }).success).toBe(false);
    expect(manualBoardEditRequestSchema.safeParse({ ...valid, academic_status_digest: '' }).success).toBe(false);
  });

  test('success returns only the server board; failure carries a typed reason', () => {
    expect(manualBoardEditResponseSchema.safeParse({
      ok: true,
      replayed: false,
      operation_id: valid.operation_id,
      board: { programId: valid.program_id, version: 'bv_4', semesters: [] },
    }).success).toBe(true);
    expect(manualBoardEditResponseSchema.safeParse({
      ok: false,
      code: 'BOARD_VERSION_CONFLICT',
      message_he: 'הלוח השתנה.',
      currentBoardVersion: 'bv_4',
    }).success).toBe(true);
  });
});

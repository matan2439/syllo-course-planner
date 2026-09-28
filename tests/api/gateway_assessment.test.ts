import { readFileSync } from 'fs';
import { join } from 'path';
import { buildModel } from '../../api/ai/generate-plan';
import { gatewayAssessmentType, gatewayAssessmentMismatchIds } from '../../api/ai/gateway_assessment';
import { applyConversationClarificationAnswers } from '../../api/ai/conversation_clarification';
import { prepareManualCourseAdd } from '../../api/ai/manual_board_edit_service';

const board = JSON.parse(readFileSync(join(__dirname, '../../data/boards/mechanical_engineering_2027.json'), 'utf-8'));
const course = (id: string) => board.metadata.program_repository_courses.find((c: any) => c.course_id === id);

test('classifies שער רוח assessment types from the official syllabus line', () => {
  expect(gatewayAssessmentType(course('0609-1005'))).toBe('final_exam');
  expect(gatewayAssessmentType(course('0609-1003'))).toBe('paper');
  expect(gatewayAssessmentType({ syllabus_assessment_he: 'בחינת בית ייתכנו מטלות' })).toBe('home_exam');
  expect(gatewayAssessmentType({ syllabus_assessment_he: 'ייתכנו מטלות נוספות' })).toBeNull();
});

test('a paper-only preference hard-blocks exam שער רוח courses from planning', () => {
  const mismatched = gatewayAssessmentMismatchIds(board, ['paper']);
  expect(mismatched).toContain('0609-1005');
  expect(mismatched).not.toContain('0609-1003');

  const model = buildModel(board, {}, { gateway_assessment_types: ['paper'], disallowed_course_ids: ['X'] });
  expect(model.disallowedCourseIds.has('0609-1005')).toBe(true);
  expect(model.disallowedCourseIds.has('0609-1003')).toBe(false);
  expect(model.disallowedCourseIds.has('X')).toBe(true);
  expect(buildModel(board, {}, {}).disallowedCourseIds.has('0609-1005')).toBe(false);
});

test('a course already on the board is never blocked by the assessment choice', () => {
  const ctx = { semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: '0609-1005' }] }] };
  expect(buildModel(board, ctx, { gateway_assessment_types: ['paper'] }).disallowedCourseIds.has('0609-1005')).toBe(false);
});

test('the student can still add an unticked-type course by hand', () => {
  const A = 'year_3_semester_a';
  const tiny = {
    semesters: [{ semester_id: A, courses: [] }],
    metadata: {
      program_requirements_categories: { total_required_hours: 2, categories: [] },
      program_repository_courses: [{
        course_id: 'G-1', name_he: 'G', weekly_hours: 2, category_id: 'shaar_ruach', offered_semesters: [A],
        prerequisites: [], syllabus_assessment_he: 'בחינה סופית',
      }],
    },
  };
  const context = {
    ownerId: 'o'.repeat(43), programId: 'test_program_2027', digest: 'd', updatedAt: 1,
    personalStatus: { completed: [], currently_taking: [], completed_knowledge: { status: 'known' } },
    planContext: { semesters: [], personal_status: { completed: [], currently_taking: [], completed_knowledge: { status: 'known' } } },
    preferences: { gateway_assessment_types: ['paper'] },
  };
  expect(buildModel(tiny, {}, { gateway_assessment_types: ['paper'] }).disallowedCourseIds.has('G-1')).toBe(true);
  const result = prepareManualCourseAdd({
    boardJson: tiny, context: context as never, currentBoard: null,
    request: { operation: 'add_course', program_id: 'test_program_2027', expected_board_version: null,
      operation_id: 'edit_0123456789abcdef', course_id: 'G-1', semester_id: A, academic_status_digest: 'd' },
  });
  expect(result).toEqual(expect.objectContaining({ ok: true }));
});

test('the profile panel answer lands in the stored preferences', () => {
  const result = applyConversationClarificationAnswers({
    programId: 'mechanical_engineering_2027',
    personalStatus: {},
    planContext: {},
    preferences: {},
    answers: [{ questionId: 'gateway_assessment', value: ['paper', 'home_exam'] }],
  });
  expect(result.preferences).toEqual({ gateway_assessment_types: ['paper', 'home_exam'] });
  expect(result.changed).toBe(true);

  const invalid = applyConversationClarificationAnswers({
    programId: 'mechanical_engineering_2027', personalStatus: {}, planContext: {}, preferences: {},
    answers: [{ questionId: 'gateway_assessment', value: ['oral'] }],
  });
  expect(invalid.preferences).toEqual({});
  expect(invalid.invalidAnswers).toHaveLength(1);
});

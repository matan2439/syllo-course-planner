import { readFileSync } from 'fs';
import { join } from 'path';
import { buildModel } from '../../api/ai/generate-plan';
import { gatewayAssessmentType, gatewayAssessmentMismatchIds } from '../../api/ai/gateway_assessment';
import { applyConversationClarificationAnswers } from '../../api/ai/conversation_clarification';

const board = JSON.parse(readFileSync(join(__dirname, '../../data/boards/mechanical_engineering_2027.json'), 'utf-8'));
const course = (id: string) => board.metadata.program_repository_courses.find((c: any) => c.course_id === id);

test('classifies שער רוח assessment types from the official syllabus line', () => {
  expect(gatewayAssessmentType(course('0609-1005'))).toBe('final_exam');
  expect(gatewayAssessmentType(course('0609-1003'))).toBe('paper');
  expect(gatewayAssessmentType({ syllabus_assessment_he: 'בחינת בית ייתכנו מטלות' })).toBe('home_exam');
  expect(gatewayAssessmentType({ syllabus_assessment_he: 'ייתכנו מטלות נוספות' })).toBeNull();
});

test('a paper-only preference soft-avoids exam שער רוח courses and nothing else', () => {
  const mismatched = gatewayAssessmentMismatchIds(board, ['paper']);
  expect(mismatched).toContain('0609-1005');
  expect(mismatched).not.toContain('0609-1003');

  const model = buildModel(board, {}, { gateway_assessment_types: ['paper'] });
  expect(model.profiles.get('0609-1005')?.is_unwanted).toBe(true);
  expect(model.profiles.get('0609-1003')?.is_unwanted).toBe(false);
  expect(buildModel(board, {}, {}).profiles.get('0609-1005')?.is_unwanted).toBe(false);
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

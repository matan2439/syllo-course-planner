/**
 * An unnamed completion count (e.g. how many שער רוח courses) changes hard category requirements,
 * so it must be part of the apply-time constraint fingerprint — and absent counts must leave
 * existing fingerprints untouched.
 */
import { loadLocalBoardJson } from '../../api/ai/board_loader';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { constraintFingerprint } from '../../api/ai/plan_alternatives';

const board = loadLocalBoardJson('mechanical_engineering_2027');
const gateway = (board.metadata.program_requirements_categories.categories as Array<{ category_id: string; min_courses: number }>)
  .find((c) => c.category_id === 'shaar_ruach')!;

const fingerprint = (counts?: Record<string, number>) => {
  const model = buildConstraintModel(board, counts ? { completedCountByCategory: counts } : {});
  return { model, cf: constraintFingerprint({ model, completedCourseIds: [], profileVersion: 1 }) };
};

test('the count lowers the remaining requirement and changes the fingerprint', () => {
  const none = fingerprint();
  const empty = fingerprint({});
  const two = fingerprint({ shaar_ruach: 2 });
  const three = fingerprint({ shaar_ruach: 3 });

  expect(empty.cf).toBe(none.cf);
  expect(new Set([none.cf, two.cf, three.cf]).size).toBe(3);
  expect(two.model.categories.find((c) => c.id === 'shaar_ruach')?.required).toBe(gateway.min_courses - 2);
});

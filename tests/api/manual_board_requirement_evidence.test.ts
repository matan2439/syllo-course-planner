import { buildConstraintModel } from '../../api/ai/planner_model';
import { manualBoardValidationContext, validateManualBoardChange } from '../../api/ai/manual_board_validation';
import { buildValidationContext, validateCandidate, validatePlanState } from '../../api/ai/planner_validate';
import { emptyState } from '../../api/ai/planner_types';

const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const SEMS = [A, B];

function model(prerequisite_expression: unknown, corequisite_expression: unknown = null) {
  return buildConstraintModel({
    semesters: SEMS.map(semester_id => ({ semester_id, courses: [] })),
    metadata: {
      program_requirements_categories: { total_required_hours: 2, categories: [] },
      program_repository_courses: [{
        course_id: 'DEP', name_he: 'קורס', weekly_hours: 2, is_mandatory: true,
        placement_policy: 'mandatory', offered_semesters: SEMS,
        prerequisites: [], corequisites: [], prerequisite_expression, corequisite_expression,
      }],
    },
  });
}

const placed = { semesters: { [A]: ['DEP'], [B]: [] } };

describe('manual drafts with unknown requirement evidence', () => {
  test.each([null, {}, { any_of: [] }])('unknown/malformed catalog evidence warns for drafts but blocks AI: %j', expression => {
    const m = model(expression);
    const manual = validateManualBoardChange(placed, emptyState(SEMS), m, 'DEP');
    expect(manual.valid).toBe(true);
    expect(manual.errors).toEqual([]);
    expect(manual.warnings.length).toBeGreaterThanOrEqual(2);
    expect(manualBoardValidationContext(m)).toMatchObject({ allowUnknownRequirementEvidence: true });
    expect(buildValidationContext(m).allowUnknownRequirementEvidence).not.toBe(true);
    expect(validatePlanState(placed, m).valid).toBe(false);
    expect(validateCandidate(placed, m).valid).toBe(false);
  });

  test('a well-formed missing leaf is a definite failure, even when its course is outside the catalog', () => {
    const m = model({ course_id: 'EXTERNAL' });
    const result = validateManualBoardChange(placed, emptyState(SEMS), m, 'DEP');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1); // Only the unknown corequisite root.
  });

  test('a known missing corequisite cannot be downgraded with unknown prerequisites', () => {
    const m = model(null, { course_id: 'EXTERNAL' });
    const result = validateManualBoardChange(placed, emptyState(SEMS), m, 'DEP');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  test('all-of and OR without a satisfied alternative remain definite failures', () => {
    for (const expression of [
      { all_of: [{ course_id: 'DONE' }, { course_id: 'MISSING' }] },
      { any_of: [{ course_id: 'MISSING' }, { course_id: 'OTHER' }] },
    ]) {
      const m = model(expression);
      m.completedCourseIds.add('DONE');
      expect(validateManualBoardChange(placed, emptyState(SEMS), m, 'DEP').valid).toBe(false);
    }
  });

  test('draft warnings never downgrade a known timing violation', () => {
    const m = model({ course_id: 'PRE' });
    m.profiles.set('PRE', { ...m.profiles.get('DEP')!, course_id: 'PRE',
      prerequisite_expression: { all_of: [] }, corequisite_expression: { all_of: [] } });
    const state = { semesters: { [A]: ['DEP'], [B]: ['PRE'] } };
    expect(validateManualBoardChange(state, emptyState(SEMS), m, 'DEP').valid).toBe(false);
    m.allowConcurrentPrerequisites = true;
    expect(validateManualBoardChange(state, emptyState(SEMS), m, 'DEP').valid).toBe(false);
  });

  test('a completed OR alternative permits editing; unknown corequisites still prevent AI certification', () => {
    const m = model({ any_of: [{ course_id: 'MISSING' }, { course_id: 'DONE' }] });
    m.completedCourseIds.add('DONE');
    expect(validateManualBoardChange(placed, emptyState(SEMS), m, 'DEP').valid).toBe(true);
    expect(validateCandidate(placed, m).valid).toBe(false);
  });
});

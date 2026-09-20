import { buildConstraintModel } from '../../api/ai/planner_model';
import { enumerateActions } from '../../api/ai/planner_actions';
import { emptyState } from '../../api/ai/planner_types';

test('bounds automatic alternatives for a large general-requirement catalog', () => {
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    course_id: `G-${index + 1}`,
    name_he: `שער רוח ${index + 1}`,
    weekly_hours: 2,
    category_id: 'shaar_ruach',
    does_not_count_as_engineering_elective: true,
    offered_semesters: ['A'],
  }));
  const model = buildConstraintModel({
    semesters: [{ semester_id: 'year_3_semester_a', courses: [] }],
    metadata: {
      program_repository_courses: candidates,
      program_requirements_categories: {
        total_required_hours: 185,
        categories: [{ category_id: 'shaar_ruach', name_he: 'קורסי שער רוח', min_courses: 3, course_ids: candidates.map(c => c.course_id) }],
      },
    },
  });

  const actions = enumerateActions(emptyState(model.knownSemesterIds), model);
  expect(actions.filter(action => action.type === 'ADD_COURSE')).toHaveLength(1);
});

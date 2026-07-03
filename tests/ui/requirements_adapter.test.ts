/**
 * Adapter contract: metadata.program_requirements_validation from the board
 * JSON → view model for the /plan progress panel. Strictly a pass-through of
 * shipped numbers and labels — no requirement recalculation, no inference.
 */
import { adaptRequirements } from '../../web/lib/requirements';

const rawBoard = {
  semesters: [],
  metadata: {
    program_requirements_validation: {
      valid: false,
      total_required_hours: 185,
      planned_hours: 41.0,
      remaining_hours: 144.0,
      core_courses_total_min: 6,
      core_courses_selected: 0,
      core_courses_satisfied: false,
      category_results: [
        {
          category_id: 'fluids',
          name_he: 'קורסי ליבה — זורמים',
          min_courses: 1,
          selected_count: 0,
          satisfied: false,
          missing_count: 1,
        },
        {
          category_id: 'other_specialization',
          name_he: 'קורסי התמחות / בחירה נוספים',
          min_courses: 0,
          selected_count: 0,
          satisfied: true,
          missing_count: 0,
        },
      ],
      warnings: ['קטגוריה לא הושלמה: קורסי ליבה — זורמים'],
      explanation: 'דרישות לא מסופקות: 4 קטגוריות לא הושלמו; קורסי ליבה: 0/6',
    },
  },
};

test('passes shipped hour and core totals through untouched', () => {
  const req = adaptRequirements(rawBoard);
  expect(req).not.toBeNull();
  expect(req!.plannedHours).toBe(41.0);
  expect(req!.totalRequiredHours).toBe(185);
  expect(req!.remainingHours).toBe(144.0);
  expect(req!.core).toEqual({ selected: 0, min: 6, satisfied: false });
});

test('maps categories with shipped Hebrew labels and statuses', () => {
  const cats = adaptRequirements(rawBoard)!.categories;
  expect(cats).toEqual([
    {
      id: 'fluids',
      title: 'קורסי ליבה — זורמים',
      minCourses: 1,
      selectedCount: 0,
      satisfied: false,
      missingCount: 1,
    },
    {
      id: 'other_specialization',
      title: 'קורסי התמחות / בחירה נוספים',
      minCourses: 0,
      selectedCount: 0,
      satisfied: true,
      missingCount: 0,
    },
  ]);
});

test('exposes the shipped explanation and warnings for disclosure', () => {
  const req = adaptRequirements(rawBoard)!;
  expect(req.explanation).toContain('דרישות לא מסופקות');
  expect(req.warnings).toHaveLength(1);
});

test('returns null when the validation metadata is not shipped', () => {
  expect(adaptRequirements({ semesters: [] })).toBeNull();
  expect(adaptRequirements({ semesters: [], metadata: {} })).toBeNull();
});

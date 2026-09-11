import { adaptRequirementsFromModel } from './requirements'
import type { BoardModel } from '../../shared/planner/model'

test('adaptRequirementsFromModel maps BoardModel.requirementsValidation into the existing RequirementsVM shape', () => {
  const model = {
    catalogRevision: 'rev-1' as never, courseCatalog: {}, semesters: [],
    requirementsValidation: {
      valid: false, totalRequiredHours: 185, plannedHours: 128.5, remainingHours: 56.5,
      coreCoursesTotalMin: 6, coreCoursesSelected: 0, coreCoursesSatisfied: false,
      categories: [{ categoryId: 'fluids', nameHe: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
      warnings: ['שעות חסרות: 56.5'],
    },
  } satisfies BoardModel
  expect(adaptRequirementsFromModel(model)).toEqual({
    valid: false, plannedHours: 128.5, totalRequiredHours: 185, remainingHours: 56.5,
    core: { selected: 0, min: 6, satisfied: false },
    categories: [{ id: 'fluids', title: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
    warnings: ['שעות חסרות: 56.5'], explanation: null,
  })
})

test('adaptRequirementsFromModel returns null when the model carries no requirements block', () => {
  const model = { catalogRevision: 'rev-1' as never, courseCatalog: {}, semesters: [] } satisfies BoardModel
  expect(adaptRequirementsFromModel(model)).toBeNull()
})

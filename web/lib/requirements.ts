/**
 * View-model adapter for metadata.program_requirements_validation from the
 * board JSON — the same pre-computed block the canonical planner renders.
 * Strictly a pass-through of shipped numbers and Hebrew labels: no
 * requirement recalculation, no inference, no mutation.
 */
import type { RawBoard } from './board'

type RawCategoryResult = {
  category_id: string
  name_he: string
  min_courses: number
  selected_count: number
  satisfied: boolean
  missing_count: number
}

type RawRequirementsValidation = {
  valid: boolean
  total_required_hours: number
  planned_hours: number
  remaining_hours: number
  core_courses_total_min: number
  core_courses_selected: number
  core_courses_satisfied: boolean
  category_results?: RawCategoryResult[]
  warnings?: string[]
  explanation?: string
}

export type RequirementCategoryVM = {
  id: string
  title: string
  minCourses: number
  selectedCount: number
  satisfied: boolean
  missingCount: number
}

export type RequirementsVM = {
  valid: boolean
  plannedHours: number
  totalRequiredHours: number
  remainingHours: number
  core: { selected: number; min: number; satisfied: boolean }
  categories: RequirementCategoryVM[]
  warnings: string[]
  explanation: string | null
}

export function adaptRequirements(raw: RawBoard): RequirementsVM | null {
  const v = raw.metadata?.program_requirements_validation as
    | RawRequirementsValidation
    | undefined
  if (!v || typeof v.total_required_hours !== 'number') return null

  return {
    valid: v.valid,
    plannedHours: v.planned_hours,
    totalRequiredHours: v.total_required_hours,
    remainingHours: v.remaining_hours,
    core: {
      selected: v.core_courses_selected,
      min: v.core_courses_total_min,
      satisfied: v.core_courses_satisfied,
    },
    categories: (v.category_results ?? []).map((c) => ({
      id: c.category_id,
      title: c.name_he,
      minCourses: c.min_courses,
      selectedCount: c.selected_count,
      satisfied: c.satisfied,
      missingCount: c.missing_count,
    })),
    warnings: v.warnings ?? [],
    explanation: v.explanation ?? null,
  }
}

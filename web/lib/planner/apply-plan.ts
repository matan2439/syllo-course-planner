/**
 * Client-side "apply" for the MVP journey: turn an accepted GeneratedPlanModel
 * back into a canonical BoardModel so the accepted proposal becomes the visible
 * current plan (and a fresh Build diffs against it). Pure/derived — inputs are
 * never mutated. The course UNIVERSE (courseCatalog) and catalogRevision carry
 * over from the base unchanged; only PLACEMENTS change. An id the catalog does
 * not know is preserved as a truthful placeholder (never fabricated metadata),
 * exactly like draft-vm's unresolved-course handling.
 */
import { normalizeCourseId } from '../../../shared/planner/model'
import type { BoardCourseModel, BoardModel, GeneratedPlanModel } from '../../../shared/planner/model'

function resolve(base: BoardModel, rawId: string): BoardCourseModel {
  const meta = base.courseCatalog[normalizeCourseId(rawId)]
  if (meta) return meta
  return { courseId: rawId, nameHe: '', halfHours: null, courseType: '', isMandatory: false }
}

export function applyGeneratedToBoard(generated: GeneratedPlanModel, base: BoardModel): BoardModel {
  return {
    catalogRevision: base.catalogRevision,
    courseCatalog: base.courseCatalog,
    semesters: generated.semesters.map((s) => ({
      semesterId: s.semesterId,
      courses: s.courseIds.map((id) => resolve(base, id)),
    })),
  }
}

/** Courses placed in `base` but absent from every semester of `generated`. */
export function removedCourseIds(
  base: BoardModel,
  generated: GeneratedPlanModel,
): Array<{ id: string; nameHe: string | null }> {
  const genPlaced = new Set<string>()
  for (const s of generated.semesters) for (const id of s.courseIds) genPlaced.add(normalizeCourseId(id))
  const out: Array<{ id: string; nameHe: string | null }> = []
  const seen = new Set<string>()
  for (const s of base.semesters) {
    for (const c of s.courses) {
      const norm = normalizeCourseId(c.courseId)
      if (genPlaced.has(norm) || seen.has(norm)) continue
      seen.add(norm)
      out.push({ id: c.courseId, nameHe: c.nameHe || null })
    }
  }
  return out
}

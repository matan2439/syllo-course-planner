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
import type { CommittedBoardState } from '../../../shared/planner/api-client'
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
    requirementsValidation: base.requirementsValidation,
    semesters: generated.semesters.map((s) => ({
      semesterId: s.semesterId,
      courses: s.courseIds.map((id) => resolve(base, id)),
    })),
  }
}

/** A committed placement the previewed proposal would change: moved elsewhere, or dropped. */
export type LeavingMarker = 'moving' | 'removed'

/**
 * Preview a proposal ON the board without hiding anything the student placed. Every committed
 * placement stays exactly where it is; the proposal's placements are added around them. Placements
 * the proposal would change come back in `leaving` (`${semesterId}|${courseId}`), so the board can
 * label them instead of dropping them. Nothing here changes the committed board.
 */
export function overlayProposalOnBoard(
  generated: Pick<GeneratedPlanModel, 'semesters'>, base: BoardModel,
): { board: BoardModel; leaving: Record<string, LeavingMarker> } {
  const proposed = new Map(generated.semesters.map((s) => [s.semesterId, s.courseIds]))
  const placedAnywhere = new Set(generated.semesters.flatMap((s) => s.courseIds.map(normalizeCourseId)))
  const leaving: Record<string, LeavingMarker> = {}
  const semesterIds = [...new Set([...base.semesters.map((s) => s.semesterId), ...generated.semesters.map((s) => s.semesterId)])]
  const semesters = semesterIds.map((semesterId) => {
    const here = proposed.get(semesterId) ?? []
    const hereIds = new Set(here.map(normalizeCourseId))
    const kept = (base.semesters.find((s) => s.semesterId === semesterId)?.courses ?? [])
      .filter((course) => !hereIds.has(normalizeCourseId(course.courseId)))
    for (const course of kept) {
      leaving[`${semesterId}|${course.courseId}`] = placedAnywhere.has(normalizeCourseId(course.courseId)) ? 'moving' : 'removed'
    }
    return { semesterId, courses: [...here.map((id) => resolve(base, id)), ...kept] }
  })
  return {
    board: { catalogRevision: base.catalogRevision, courseCatalog: base.courseCatalog, requirementsValidation: base.requirementsValidation, semesters },
    leaving,
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

/**
 * Adopt a board the SERVER committed. Placements come from it, and so do the degree requirements the
 * server recomputed for that plan; when it sent none (no base snapshot to refresh) the base board's
 * numbers are kept. Requirements are never recomputed here.
 */
export function applyCommittedBoard(committed: CommittedBoardState, base: BoardModel): BoardModel {
  const board = applyGeneratedToBoard({ semesters: committed.semesters } as GeneratedPlanModel, base)
  return committed.requirementsValidation ? { ...board, requirementsValidation: committed.requirementsValidation } : board
}

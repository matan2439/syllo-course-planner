import { useMemo } from 'react'
import { fromHalfHours, type BoardModel } from '../../../../shared/planner/model'

/** Lookups derived from the loaded catalog. */
export function useCatalogLookups(current: BoardModel | null) {
  // Course universe for the approximate-name pickers (fuzzy search by Hebrew name).
  const pickerCourses = useMemo(
    () => (current ? Object.values(current.courseCatalog).map((c) => ({ id: c.courseId, nameHe: c.nameHe || null })) : []),
    [current],
  )
  /** Authoritative catalog hours — the only credit source for completed electives. */
  const catalogHoursById = useMemo(() => {
    const out: Record<string, number | null | undefined> = {}
    if (current) {
      for (const c of Object.values(current.courseCatalog)) {
        out[c.courseId] = c.halfHours == null ? null : fromHalfHours(c.halfHours)
      }
    }
    return out
  }, [current])

  return { pickerCourses, catalogHoursById }
}

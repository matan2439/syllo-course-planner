import { useCallback, useEffect, useState } from 'react'
import { DEGREE_YEARS, type DegreeYear } from '../../../lib/planner/semester-window'

export const CURRENT_DEGREE_YEAR_KEY = 'syllo_current_degree_year'

/**
 * The student's current year in the degree (profile data), `null` until they pick one.
 * ponytail: device-local localStorage (no accounts yet) — swap the read/write for the
 * account profile API when authentication lands; callers keep the same [year, setYear] shape.
 */
export function useCurrentDegreeYear(): [DegreeYear | null, (year: DegreeYear) => void] {
  const [year, setYear] = useState<DegreeYear | null>(null)
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY))
      if ((DEGREE_YEARS as readonly number[]).includes(stored)) setYear(stored as DegreeYear)
    } catch { /* storage unavailable: year stays unknown */ }
  }, [])
  const update = useCallback((next: DegreeYear) => {
    setYear(next)
    try { localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, String(next)) } catch { /* best effort */ }
  }, [])
  return [year, update]
}

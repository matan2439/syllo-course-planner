import { useCallback, useEffect, useState } from 'react'
import { CURRENT_DEGREE_YEAR_KEY, DEGREE_YEARS, type DegreeYear } from '../../../lib/planner/semester-window'
import { useAuth } from '../../auth/AuthProvider'

export { CURRENT_DEGREE_YEAR_KEY }

/**
 * The student's current year in the degree (profile data), `null` until they pick one.
 * Signed out: device-local localStorage. Signed in: the account profile is the source
 * (reconciled with this device on sign-in — see reconcileProfile), and localStorage
 * stays as the device cache.
 */
export function useCurrentDegreeYear(): [DegreeYear | null, (year: DegreeYear) => void] {
  const [year, setYear] = useState<DegreeYear | null>(null)
  const { profile, updateProfile } = useAuth()
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(CURRENT_DEGREE_YEAR_KEY))
      if ((DEGREE_YEARS as readonly number[]).includes(stored)) setYear(stored as DegreeYear)
    } catch { /* storage unavailable: year stays unknown */ }
  }, [])
  const accountYear = profile?.current_degree_year ?? null
  useEffect(() => {
    if (accountYear != null) setYear(accountYear as DegreeYear)
  }, [accountYear])
  const update = useCallback((next: DegreeYear) => {
    setYear(next)
    try { localStorage.setItem(CURRENT_DEGREE_YEAR_KEY, String(next)) } catch { /* best effort */ }
    void updateProfile({ current_degree_year: next })
  }, [updateProfile])
  return [year, update]
}

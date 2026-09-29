'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { programQuery, resolveProgram } from '../../../lib/programs'
import { LAST_PROGRAM_KEY } from '../last-program'
import { useAuth } from '../../auth/AuthProvider'

const PRIMARY =
  'inline-block rounded-full bg-[var(--purple-strong)] px-8 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-premium)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]'
const SECONDARY =
  'text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]'

/** Landing calls to action. A returning student (a remembered program) goes straight back to their plan. */
export default function LandingCtas() {
  const [remembered, setRemembered] = useState<string | null>(null)
  const accountProgramId = useAuth().profile?.program_id ?? null
  useEffect(() => {
    try {
      // Signed in: the account's program (any device) wins over this device's memory.
      const id = accountProgramId ?? localStorage.getItem(LAST_PROGRAM_KEY)
      if (id && resolveProgram(id)) setRemembered(id)
    } catch { /* storage unavailable: behave as a first visit */ }
  }, [accountProgramId])

  if (remembered) {
    return (
      <>
        <Link href={`/planner${programQuery(remembered)}`} className={PRIMARY}>המשך לתוכנית שלי</Link>
        <Link href="/programs" className={SECONDARY}>בחירת תוכנית אחרת</Link>
      </>
    )
  }
  return (
    <>
      <Link href="/programs" className={PRIMARY}>בנו תוכנית</Link>
      <Link href="/planner" className={SECONDARY}>המשך לתוכנית שלי</Link>
    </>
  )
}

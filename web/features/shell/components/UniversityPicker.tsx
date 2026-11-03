'use client'
import Link from 'next/link'
import { useState } from 'react'
import { searchUniversities, type UniversityVM } from '../../../lib/universities'

/** Search plus one tile per university; a tile continues to that university's degree programs. */
export default function UniversityPicker({ universities }: { universities: readonly UniversityVM[] }) {
  const [query, setQuery] = useState('')
  const shown = searchUniversities(query, universities)
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">חיפוש מוסד לימודים</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="שם האוניברסיטה…"
          className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]" />
      </label>
      {shown.length === 0
        ? <p role="status" className="text-sm text-[var(--text-muted)]">לא נמצא מוסד בשם הזה. בינתיים Syllo תומך באוניברסיטת תל אביב.</p>
        : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((university) => (
              <li key={university.id}>
                <Link href={`/programs?university=${university.id}`}
                  className="flex h-full flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-purple-500/40 hover:shadow-[var(--shadow-premium)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static brand tile */}
                  <img src={university.logo} alt="" width={64} height={64} className="h-16 w-16" />
                  <span className="text-sm font-bold">{university.nameHe}</span>
                  <span className="text-xs text-[var(--text-muted)]">{university.nameEn}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import type { RepoCourseVM, RepositoryVM } from '../../lib/repository'
import { buildCourseDetails, type CourseDetailsVM } from '../../lib/course-details'
import CourseDetailsPanel from './CourseDetailsPanel'
import { filterRepository, repositoryStatus } from './RepositoryExplorer'
import { Badge, Card, EmptyState } from './ui'

export default function UnifiedCourseRepository({
  repo,
  selectedCourseIds,
  onRequestAdd,
  onRequestDetails,
}: {
  repo: RepositoryVM
  selectedCourseIds: readonly string[]
  onRequestAdd: (courseId: string) => void
  onRequestDetails?: (course: CourseDetailsVM) => void
}) {
  const [query, setQuery] = useState('')
  const [details, setDetails] = useState<CourseDetailsVM | null>(null)
  const selected = useMemo(() => new Set(selectedCourseIds), [selectedCourseIds])
  const filtered = useMemo(() => filterRepository(repo, query), [query, repo])
  const status = repositoryStatus(repo, filtered, query)

  const showDetails = (course: RepoCourseVM, category: string) => {
    const view = buildCourseDetails({ ...course, category })
    if (onRequestDetails) onRequestDetails(view)
    else setDetails(view)
  }

  return (
    <section aria-label="מאגר קורסים" dir="rtl" className="flex flex-col gap-5">
      <div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש לפי שם, קוד או קטגוריה…"
          aria-label="חיפוש קורס"
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        />
        <p aria-live="polite" className="mt-2 text-center text-xs text-[var(--text-muted)]">
          {status}
        </p>
      </div>

      <p className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs text-[var(--text-muted)]">
        הוספה ידנית תישמר רק לאחר אימות השרת. בשלב היסוד הכפתור מעביר בקשת הוספה בלבד ואינו משנה את הלוח.
      </p>

      {filtered.length === 0 ? (
        <EmptyState>לא נמצאו קורסים עבור „{query.trim()}”</EmptyState>
      ) : filtered.map((category) => (
        <section key={category.id} aria-label={category.title} className="flex flex-col gap-3">
          <h3 className="border-b border-[var(--border)] pb-2 text-sm font-bold">
            {category.title}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {category.courses.map((course) => {
              const onBoard = selected.has(course.id)
              return (
                <Card key={course.id} className="flex flex-col gap-3 px-3.5 py-3">
                  <div>
                    <h4 className="text-sm font-semibold">{course.name}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {course.weeklyHours != null && <Badge>{course.weeklyHours} ש״ש</Badge>}
                      <Badge variant="neutral"><span dir="ltr">{course.id}</span></Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`פרטים על ${course.name}`}
                      onClick={() => showDetails(course, category.title)}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
                    >
                      פרטים
                    </button>
                    <button
                      type="button"
                      disabled={onBoard}
                      aria-label={onBoard ? `${course.name} כבר נמצא בלוח` : `הוסף את ${course.name} ללוח`}
                      onClick={() => onRequestAdd(course.id)}
                      className="rounded-full bg-[var(--purple-strong)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
                    >
                      {onBoard ? 'כבר בלוח' : 'הוסף ללוח'}
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        </section>
      ))}

      {!onRequestDetails && <CourseDetailsPanel course={details} onClose={() => setDetails(null)} />}
    </section>
  )
}

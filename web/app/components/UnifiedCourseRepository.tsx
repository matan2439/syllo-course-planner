'use client'

import { useMemo, useState } from 'react'
import type { RepoCourseVM, RepositoryVM } from '../../lib/repository'
import { buildCourseDetails, type CourseDetailsVM } from '../../lib/course-details'
import CourseDetailsPanel from './CourseDetailsPanel'
import { filterRepository, repositoryStatus } from './RepositoryExplorer'
import { Badge, Card, EmptyState } from './ui'
import { writeRepositoryDrag } from '../../lib/planner/drag-payload'

export type SemesterDestination = { id: string; label: string }

function allowedDestinations(course: RepoCourseVM, destinations: readonly SemesterDestination[]) {
  const offered = new Set(course.offered.map((value) => value.toLowerCase()))
  return destinations.filter(({ id }) => (
    offered.has(id.toLowerCase())
    || offered.has(id.toLowerCase().endsWith('_a') ? 'a' : 'b')
  ))
}

export default function UnifiedCourseRepository({
  repo,
  selectedCourseIds,
  semesterDestinations = [],
  onRequestAdd,
  onRequestDetails,
}: {
  repo: RepositoryVM
  selectedCourseIds: readonly string[]
  semesterDestinations?: readonly SemesterDestination[]
  onRequestAdd: (courseId: string, semesterId?: string) => void
  onRequestDetails?: (course: CourseDetailsVM) => void
}) {
  const [query, setQuery] = useState('')
  const [details, setDetails] = useState<CourseDetailsVM | null>(null)
  const [draggingCourseId, setDraggingCourseId] = useState<string | null>(null)
  const selected = useMemo(() => new Set(selectedCourseIds), [selectedCourseIds])
  const filtered = useMemo(() => filterRepository(repo, query), [query, repo])
  const status = repositoryStatus(repo, filtered, query)
  const draggingCourse = draggingCourseId
    ? repo.categories.flatMap((category) => category.courses).find((course) => course.id === draggingCourseId)
    : null

  const showDetails = (course: RepoCourseVM, category: string) => {
    const view = buildCourseDetails({ ...course, category })
    if (onRequestDetails) onRequestDetails(view)
    else setDetails(view)
  }

  return (
    <section aria-label="מאגר קורסים" dir="rtl" className="flex flex-col gap-5">
      <div>
        <input
          name="course-repository-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש לפי שם, קוד או קטגוריה…"
          aria-label="חיפוש קורס"
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        />
        <p
          role={draggingCourse ? 'status' : undefined}
          aria-live="polite"
          className="mt-2 text-center text-xs text-[var(--text-muted)]"
        >
          {draggingCourse
            ? `גוררים את ${draggingCourse.name} — שחררו בעמודת סמסטר מתאימה`
            : status}
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
              const destinations = allowedDestinations(course, semesterDestinations)
              const draggable = !onBoard && destinations.length > 0
              return (
                <div
                  key={course.id}
                  data-drag-card
                  data-dragging={draggingCourseId === course.id ? 'true' : undefined}
                  className={draggable ? 'planner-drag-source' : undefined}
                  role={draggable ? 'group' : undefined}
                  aria-label={draggable ? `גרור את ${course.name} ללוח הסמסטרים` : undefined}
                  onDragStart={(event) => {
                    if (!draggable) return
                    event.dataTransfer.effectAllowed = 'copy'
                    writeRepositoryDrag(event.dataTransfer, course.id, destinations.map(({ id }) => id))
                    setDraggingCourseId(course.id)
                  }}
                  onDragEnd={() => setDraggingCourseId(null)}
                >
                <Card className="flex flex-col gap-3 px-3.5 py-3">
                  <div>
                    <h4 className="text-sm font-semibold">{course.name}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {course.weeklyHours != null && <Badge>{course.weeklyHours} ש״ש</Badge>}
                      <Badge variant="neutral"><span dir="ltr">{course.id}</span></Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {draggable && (
                      <span
                        data-drag-handle
                        draggable
                        title="גררו מכאן ללוח"
                        aria-hidden="true"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'copy'
                          writeRepositoryDrag(event.dataTransfer, course.id, destinations.map(({ id }) => id))
                          setDraggingCourseId(course.id)
                        }}
                        onDragEnd={() => setDraggingCourseId(null)}
                        className="planner-drag-handle self-center text-[11px] text-[var(--text-muted)]"
                      >
                        ⠿ גרור ללוח
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`פרטים על ${course.name}`}
                      onClick={() => showDetails(course, category.title)}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
                    >
                      פרטים
                    </button>
                    {onBoard ? (
                      <button
                        type="button"
                        disabled
                        aria-label={`${course.name} כבר נמצא בלוח`}
                        className="rounded-full bg-[var(--purple-strong)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        כבר בלוח
                      </button>
                    ) : destinations.length > 0 ? (
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded-full bg-[var(--purple-strong)] px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]">
                          הוסף לסמסטר…
                        </summary>
                        <div className="mt-2 flex flex-col gap-1">
                          {destinations.map((destination) => (
                            <button
                              key={destination.id}
                              type="button"
                              aria-label={`הוסף את ${course.name} אל ${destination.label}`}
                              onClick={() => onRequestAdd(course.id, destination.id)}
                              className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-right text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
                            >
                              {destination.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <span className="self-center px-2 py-1 text-xs text-[var(--text-muted)]">
                        אין סמסטר זמין
                      </span>
                    )}
                  </div>
                </Card>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {!onRequestDetails && <CourseDetailsPanel course={details} onClose={() => setDetails(null)} />}
    </section>
  )
}

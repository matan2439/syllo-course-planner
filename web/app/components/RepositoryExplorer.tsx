'use client'

import { useMemo, useState } from 'react'
import type { RepositoryVM, RepoCategoryVM } from '../../lib/repository'
import { buildCourseDetails, type CourseDetailsVM } from '../../lib/course-details'
import CourseDetailsPanel from './CourseDetailsPanel'
import RepositoryCourseCard from './RepositoryCourseCard'
import { EmptyState } from './ui'

function RepositorySearch({
  query,
  onChange,
  status,
}: {
  query: string
  onChange: (q: string) => void
  status: string
}) {
  return (
    <div className="rise mx-auto w-full max-w-xl">
      <div className="relative">
        <input
          type="search"
          dir="rtl"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="חיפוש לפי שם, קוד או קטגוריה…"
          aria-label="חיפוש קורס"
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm backdrop-blur-sm transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-muted)] focus:border-purple-500/40 focus:shadow-[var(--shadow-premium)] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="נקה חיפוש"
            className="absolute inset-y-0 start-4 my-auto h-6 w-6 rounded-full text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
          >
            ✕
          </button>
        )}
      </div>
      <p aria-live="polite" className="mt-2 text-center text-xs text-[var(--text-muted)]">
        {status}
      </p>
    </div>
  )
}

function RepositoryCategoryGroup({
  category,
  onSelect,
}: {
  category: RepoCategoryVM
  onSelect: (course: RepoCategoryVM['courses'][number]) => void
}) {
  return (
    <section aria-label={category.title}>
      <header className="mb-3 flex items-baseline gap-2 border-b border-[var(--border)] pb-2">
        <h2 className="text-sm font-bold tracking-tight">{category.title}</h2>
        <span className="text-xs text-[var(--text-muted)]">
          {category.courses.length}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {category.courses.map((c) => (
          <RepositoryCourseCard
            key={c.id}
            course={c}
            onSelect={() => onSelect(c)}
          />
        ))}
      </div>
    </section>
  )
}

export default function RepositoryExplorer({ repo }: { repo: RepositoryVM }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CourseDetailsVM | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repo.categories
    return repo.categories
      .map((cat) => ({
        ...cat,
        courses: cat.courses.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.id.includes(q) ||
            cat.title.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.courses.length > 0)
  }, [query, repo])

  const shown = filtered.reduce((n, c) => n + c.courses.length, 0)
  const status = query
    ? `נמצאו ${shown} מתוך ${repo.totalCourses} קורסים`
    : `${repo.totalCourses} קורסים ב־${repo.categories.length} קטגוריות`

  return (
    <div className="flex flex-col gap-8">
      <RepositorySearch query={query} onChange={setQuery} status={status} />

      {filtered.length === 0 ? (
        <EmptyState>
          לא נמצאו קורסים עבור „{query.trim()}”
          <br />
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-2 text-[var(--purple)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            ניקוי החיפוש
          </button>
        </EmptyState>
      ) : (
        filtered.map((cat) => (
          <RepositoryCategoryGroup
            key={cat.id}
            category={cat}
            onSelect={(course) =>
              setSelected(buildCourseDetails({ ...course, category: cat.title }))
            }
          />
        ))
      )}

      <CourseDetailsPanel course={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

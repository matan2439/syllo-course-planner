'use client'

import { useEffect, useRef } from 'react'
import type { CourseDetailsVM } from '../../lib/course-details'
import { Badge } from './ui'

const SEMESTER_LABELS: Record<string, string> = {
  A: 'סמ׳ א׳',
  B: 'סמ׳ ב׳',
}

/**
 * Next-native, read-only course-details modal. Self-contained and decoupled:
 * it holds no reference to the legacy planner frame or its board state, so
 * opening or closing it can never mutate the canonical planner. Fed a
 * CourseDetailsVM (see lib/course-details.ts) — from the repository surface
 * today, from a same-origin selection bridge later. Null course renders nothing.
 *
 * Motion: a single subtle scale+fade entrance (~160ms, Emil-restraint for a
 * productivity surface). The global `prefers-reduced-motion` rule in globals.css
 * freezes it — no per-component opt-out (see web/README.md).
 */
export default function CourseDetailsPanel({
  course,
  onClose,
}: {
  course: CourseDetailsVM | null
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes; move focus onto the close control when the dialog opens.
  useEffect(() => {
    if (!course) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [course, onClose])

  if (!course) return null

  return (
    <div
      className="course-detail-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="פרטי קורס"
        dir="rtl"
        className="course-detail-panel relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-sm shadow-[var(--shadow-premium)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-snug">{course.name}</h2>
            <span
              dir="ltr"
              className="mt-0.5 block font-mono text-[11px] tracking-tight text-[var(--text-muted)]"
            >
              {course.id}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="shrink-0 rounded-full px-2 py-1 text-sm text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          {(course.weeklyHours != null ||
            course.credits != null ||
            course.offered.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {course.weeklyHours != null && (
                <Badge>{course.weeklyHours} ש״ש</Badge>
              )}
              {course.credits != null && (
                <Badge>{course.credits} נ״ז</Badge>
              )}
              {course.offered.map((s) => (
                <Badge key={s} variant="purple">
                  {SEMESTER_LABELS[s] ?? s}
                </Badge>
              ))}
            </div>
          )}

          {course.category && (
            <Field label="קטגוריה">
              <span className="text-[var(--text-muted)]">{course.category}</span>
            </Field>
          )}

          <Field label="דרישות קדם">
            {course.prerequisites.length === 0 ? (
              <span className="text-[var(--text-muted)]">אין דרישות קדם</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {course.prerequisites.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-black/[.04] px-2 py-0.5 text-[11px] text-[var(--text-muted)] dark:bg-white/[.06]"
                  >
                    {p.name ?? p.id}
                    {p.name && (
                      <span dir="ltr" className="font-mono opacity-60">
                        {p.id}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          {course.syllabusUrl ? (
            <a
              href={course.syllabusUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-medium text-[var(--purple)] transition-opacity duration-150 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
            >
              סילבוס ↗
            </a>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              אין קישור סילבוס
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-[var(--text)]">
        {label}
      </div>
      {children}
    </div>
  )
}

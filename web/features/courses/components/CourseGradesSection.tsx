'use client'

import { useState } from 'react'
import type { CourseGradeSummary } from '../../../../api/ai/course_insights/types'
import type { CourseInsightsState } from '../hooks/use-course-insights'
import { scopeView, termId, termLabel } from '../lib/grade-view'

const fmt = (value: number | null, suffix = '') => (value === null ? '—' : `${Math.round(value * 10) / 10}${suffix}`)

/**
 * Historical grades of one course (community grade sources, see
 * data/config/course_insight_sources.json): headline numbers, the distribution,
 * trend and lecturers, for all semesters or one chosen semester.
 */
export default function CourseGradesSection({ insights }: { insights: CourseInsightsState }) {
  return (
    <section aria-labelledby="course-grades-title" className="flex flex-col gap-2.5 border-t border-[var(--border)] pt-4">
      <h3 id="course-grades-title" className="text-xs font-semibold">ציונים היסטוריים</h3>
      {insights.status === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p className="text-xs text-[var(--text-muted)]">טוען נתוני ציונים…</p>
          <div className="h-16 animate-pulse rounded-lg bg-black/[.04] dark:bg-white/[.06]" />
        </div>
      )}
      {insights.status === 'error' && (
        <p className="text-xs text-[var(--text-muted)]">לא ניתן לטעון נתוני ציונים כרגע.</p>
      )}
      {insights.status === 'ready' && (
        insights.data.grades.has_data
          ? <GradesBody summary={insights.data.grades} />
          : <p className="text-xs text-[var(--text-muted)]">אין נתוני ציונים לקורס הזה במקורות הזמינים.</p>
      )}
    </section>
  )
}

function GradesBody({ summary }: { summary: CourseGradeSummary }) {
  const [scope, setScope] = useState('all')
  const view = scopeView(summary, scope)
  const usedSources = summary.sources.filter((source) => source.terms > 0)
  const failedSources = summary.sources.filter((source) => source.status === 'error')
  const peak = Math.max(1, ...(view?.bins ?? []).map((bin) => bin.percent))
  const term = scope === 'all' ? null : summary.terms.find((candidate) => termId(candidate) === scope)

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span>תקופה</span>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-xs text-[var(--text)]"
        >
          <option value="all">כל הסמסטרים ({summary.terms.length})</option>
          {summary.terms.map((option) => (
            <option key={termId(option)} value={termId(option)}>{termLabel(option)}</option>
          ))}
        </select>
      </label>

      {view && (
        <dl className="grid grid-cols-4 gap-1.5 text-center">
          <Stat label="ממוצע" value={fmt(view.mean)} />
          <Stat label="חציון" value={fmt(view.median)} />
          <Stat label="עוברים" value={fmt(view.passRate, '%')} />
          <Stat label="סטודנטים" value={view.students === null ? '—' : view.students.toLocaleString('he-IL')} />
        </dl>
      )}

      {view && view.bins.length > 0 && (
        <figure className="flex flex-col gap-1">
          <div
            role="img"
            aria-label={`התפלגות ציונים: ${view.bins.map((bin) => `${bin.from}–${bin.to}: ${fmt(bin.percent, '%')}`).join(', ')}`}
            dir="ltr"
            className="flex h-20 items-end gap-[3px]"
          >
            {view.bins.map((bin) => (
              <div
                key={`${bin.from}-${bin.to}`}
                title={`${bin.from}–${bin.to}: ${fmt(bin.percent, '%')}`}
                className={`flex-1 rounded-t-sm ${bin.to < summary.passing_grade ? 'bg-red-400/70 dark:bg-red-400/60' : 'bg-[var(--purple)]'}`}
                style={{ height: `${Math.max(2, (bin.percent / peak) * 100)}%`, opacity: bin.percent ? 1 : 0.25 }}
              />
            ))}
          </div>
          <div dir="ltr" className="flex gap-[3px] text-[9px] text-[var(--text-muted)]">
            {view.bins.map((bin) => <span key={`${bin.from}-${bin.to}`} className="flex-1 text-center">{bin.from}</span>)}
          </div>
          <figcaption className="text-[10px] text-[var(--text-muted)]">
            התפלגות הציונים{scope === 'all' ? ` (ממוצע משוקלל של ${view.terms} סמסטרים)` : ''}
          </figcaption>
        </figure>
      )}

      {scope === 'all' && summary.trend && summary.trend.direction !== 'flat' && (
        <p className="text-xs">
          <span className={summary.trend.direction === 'up' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
            {summary.trend.direction === 'up' ? '▲' : '▼'} {Math.abs(summary.trend.delta)} נק׳
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            בסמסטרים האחרונים ({summary.trend.recent_mean}) לעומת הקודמים ({summary.trend.older_mean})
          </span>
        </p>
      )}

      {term && term.lecturers.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">מרצים: {term.lecturers.join(', ')}</p>
      )}
      {scope === 'all' && summary.lecturers.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {summary.lecturers.slice(0, 3).map((lecturer) => (
            <li key={lecturer.name} className="flex justify-between gap-2">
              <span className="truncate">{lecturer.name}</span>
              <span className="shrink-0 text-[var(--text-muted)]">
                ממוצע {lecturer.mean} · {lecturer.terms === 1 ? 'סמסטר אחד' : `${lecturer.terms} סמסטרים`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-[var(--text-muted)]">
        מקור:{' '}
        {usedSources.map((source, i) => (
          <span key={source.id}>
            {i > 0 && ', '}
            {source.attribution_url
              ? <a href={source.attribution_url} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted hover:text-[var(--purple)]">{source.label_he}</a>
              : source.label_he}
            {source.snapshot_at && ` (נכון ל-${new Date(source.snapshot_at).toLocaleDateString('he-IL')})`}
          </span>
        ))}
        {' '}· נתוני סטודנטים, לא רשמיים
        {failedSources.length > 0 && ` · ${failedSources.map((source) => source.label_he).join(', ')} לא זמין כרגע`}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-1 py-1.5">
      <dt className="text-[10px] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import type { AssessmentKind, RepositoryVM } from '../../../lib/repository'
import { filterRepository, type RepositoryFilters, type RepositorySort } from '../../../lib/repository-filters'
import { useLocale } from '../../locale/LocaleProvider'

const ASSESSMENTS: Array<[AssessmentKind, string, string]> = [
  ['exam', 'בחינה', 'Exam'], ['take_home', 'בחינת בית', 'Take-home exam'],
  ['project', 'פרויקט', 'Project'], ['assignment', 'עבודה', 'Assignment'],
  ['lab', 'דוח מעבדה', 'Lab report'], ['mixed', 'הערכה משולבת', 'Mixed assessment'],
  ['no_exam', 'ללא בחינה (מפורש)', 'Explicitly no exam'], ['unknown', 'הערכה לא ידועה', 'Unknown assessment'],
]
const SEMESTERS = [['a', 'סמסטר א׳', 'Semester A'], ['b', 'סמסטר ב׳', 'Semester B'], ['summer', 'קיץ', 'Summer'], ['unknown', 'סמסטר לא ידוע', 'Unknown semester']]
export function assessmentLabel(kind: AssessmentKind, t: (he: string, en: string) => string) {
  const label = ASSESSMENTS.find(([id]) => id === kind) ?? ASSESSMENTS[7]
  return t(label[1], label[2])
}

function toggle<T>(items: readonly T[] | undefined, value: T): T[] {
  return items?.includes(value) ? items.filter((item) => item !== value) : [...(items ?? []), value]
}

type ControlsProps = {
  repo: RepositoryVM
  filters: RepositoryFilters
  onChange(filters: RepositoryFilters): void
}
const inputClass = 'min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]'
const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]'

export function RepositorySortControl({ filters, onChange }: Pick<ControlsProps, 'filters' | 'onChange'>) {
  const { t } = useLocale()
  return <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-muted)]">
    <span className="shrink-0">{t('מיון', 'Sort')}</span>
    <select aria-label={t('מיון בתוך קטגוריה', 'Sort within category')} className={`${inputClass} max-w-full text-[var(--text)]`} value={filters.sort ?? 'catalog'} onChange={(event) => onChange({ ...filters, sort: event.target.value as RepositorySort })}>
      <option value="catalog">{t('סדר הקטלוג', 'Catalog order')}</option>
      <option value="name">{t('שם הקורס', 'Course name')}</option>
      <option value="grade-desc">{t('ממוצע: גבוה לנמוך', 'Average: high to low')}</option>
      <option value="grade-asc">{t('ממוצע: נמוך לגבוה', 'Average: low to high')}</option>
      <option value="hours-asc">{t('שעות: מעט להרבה', 'Hours: low to high')}</option>
      <option value="hours-desc">{t('שעות: הרבה למעט', 'Hours: high to low')}</option>
    </select>
  </label>
}

export function RepositoryAppliedFilters({ repo, filters, onChange }: ControlsProps) {
  const { t } = useLocale()
  const chips: Array<{ key: string; label: string; remove(): void }> = []
  for (const id of filters.categoryIds ?? []) chips.push({ key: `category:${id}`, label: repo.categories.find((category) => category.id === id)?.title ?? id, remove: () => onChange({ ...filters, categoryIds: toggle(filters.categoryIds, id) }) })
  for (const id of filters.semesters ?? []) {
    const label = SEMESTERS.find(([value]) => value === id)
    chips.push({ key: `semester:${id}`, label: label ? t(label[1], label[2]) : id, remove: () => onChange({ ...filters, semesters: toggle(filters.semesters, id) }) })
  }
  for (const id of filters.assessments ?? []) chips.push({ key: `assessment:${id}`, label: assessmentLabel(id, t), remove: () => onChange({ ...filters, assessments: toggle(filters.assessments, id) }) })
  if (filters.minGrade != null || filters.maxGrade != null) chips.push({ key: 'grades', label: t(`ממוצע ${filters.minGrade ?? 0}–${filters.maxGrade ?? 100}`, `Average ${filters.minGrade ?? 0}–${filters.maxGrade ?? 100}`), remove: () => onChange({ ...filters, minGrade: undefined, maxGrade: undefined, includeUnknownGrades: undefined }) })
  if (filters.favoritesOnly) chips.push({ key: 'favorites', label: t('מועדפים בלבד', 'Favorites only'), remove: () => onChange({ ...filters, favoritesOnly: false }) })
  if (!chips.length) return null
  return <div aria-label={t('מסננים פעילים', 'Applied filters')} className="flex flex-wrap items-center gap-1.5">
    {chips.map((chip) => <button key={chip.key} type="button" aria-label={t(`הסרת מסנן: ${chip.label}`, `Remove filter: ${chip.label}`)} onClick={chip.remove} className={`inline-flex max-w-full items-center gap-2 rounded-md bg-[var(--purple)]/10 px-2.5 py-1.5 text-xs text-[var(--text)] ${focusClass}`}><span className="truncate">{chip.label}</span><span aria-hidden="true" className="text-[var(--text-muted)]">×</span></button>)}
    <button type="button" onClick={() => onChange({ sort: filters.sort })} className={`px-2 py-1.5 text-xs text-[var(--text-muted)] underline underline-offset-4 ${focusClass}`}>{t('ניקוי הכול', 'Clear all')}</button>
  </div>
}

function Facet({ title, count = 0, open = false, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return <details className="repository-facet border-t border-[var(--border)]" open={open}>
    <summary className={`flex cursor-pointer list-none items-center gap-2 py-3 text-xs font-semibold ${focusClass}`}>
      <span className="flex-1">{title}</span>{count > 0 && <span className="rounded bg-[var(--purple)]/10 px-1.5 py-0.5 text-[10px] text-[var(--purple)]" aria-hidden="true">{count}</span>}
      <span className="repository-facet-chevron text-[var(--text-muted)]" aria-hidden="true">⌄</span>
    </summary>
    <div className="pb-4">{children}</div>
  </details>
}

export default function RepositoryDiscoveryControls({ repo, filters, onChange, query = '', favoriteIds = [], savedSearchControls }: ControlsProps & { query?: string; favoriteIds?: readonly string[]; savedSearchControls?: ReactNode }) {
  const { t } = useLocale()
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const update = (patch: Partial<RepositoryFilters>) => onChange({ ...filters, ...patch })
  const gradeActive = filters.minGrade != null || filters.maxGrade != null
  const activeCount = (filters.categoryIds?.length ?? 0) + (filters.semesters?.length ?? 0) + (filters.assessments?.length ?? 0) + Number(gradeActive) + Number(!!filters.favoritesOnly)
  // Counts respect the search and other facets; each facet keeps its own alternatives available.
  const count = (patch: Partial<RepositoryFilters>) => filterRepository(repo, query, { ...filters, favoriteIds, ...patch }).reduce((sum, category) => sum + category.courses.length, 0)
  const categoryCounts = new Map(filterRepository(repo, query, { ...filters, favoriteIds, categoryIds: undefined }).map((category) => [category.id, category.courses.length]))
  const setGrade = (bound: 'minGrade' | 'maxGrade', raw: string) => {
    if (raw === '') { update({ [bound]: undefined }); return }
    const value = Math.min(100, Math.max(0, Number(raw)))
    if (!Number.isFinite(value)) return
    update(bound === 'minGrade'
      ? { minGrade: value, ...(filters.maxGrade != null && value > filters.maxGrade ? { maxGrade: value } : {}) }
      : { maxGrade: value, ...(filters.minGrade != null && value < filters.minGrade ? { minGrade: value } : {}) })
  }
  const choice = (label: string, checked: boolean, onToggle: () => void, total?: number) => <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-xs leading-5">
    <input type="checkbox" className={`mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--purple-strong)] ${focusClass}`} checked={checked} onChange={onToggle} />
    <span className="min-w-0 flex-1">{label}</span>{total != null && <span aria-hidden="true" className="shrink-0 text-[var(--text-muted)] tabular-nums">{total}</span>}
  </label>
  return <aside aria-label={t('סינון קורסים', 'Course filters')} className="repository-filters min-w-0 self-start rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <button ref={toggleRef} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} className={`repository-filter-toggle flex w-full items-center gap-2 px-3.5 py-3 text-start text-sm font-semibold [@container_course-repository_(min-width:42rem)]:!hidden ${focusClass}`}>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h14M5 10h10M7 15h6" /></svg><span className="flex-1">{t('סינון קורסים', 'Filter courses')}</span>{activeCount > 0 && <span className="rounded bg-[var(--purple)]/10 px-2 text-xs text-[var(--purple)]">{activeCount}</span>}<span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <div id={panelId} className="repository-filter-body px-3.5 [@container_course-repository_(min-width:42rem)]:!block" data-expanded={expanded}>
      <div className="repository-filter-heading items-center justify-between gap-2 py-3 text-sm font-semibold [@container_course-repository_(min-width:42rem)]:!flex"><span>{t('סינון קורסים', 'Filter courses')}</span><span className="text-xs font-normal text-[var(--text-muted)]">{activeCount || ''}</span></div>
      {savedSearchControls}
      <Facet title={t('קטגוריה', 'Category')} count={filters.categoryIds?.length} open>
        <div className="max-h-60 overflow-y-auto">{repo.categories.map((category) => <div key={category.id}>{choice(category.title, filters.categoryIds?.includes(category.id) ?? false, () => update({ categoryIds: toggle(filters.categoryIds, category.id) }), categoryCounts.get(category.id) ?? 0)}</div>)}</div>
      </Facet>
      <Facet title={t('סמסטר מוצע', 'Offered semester')} count={filters.semesters?.length} open>
        {SEMESTERS.map(([value, he, en]) => <div key={value}>{choice(t(he, en), filters.semesters?.includes(value) ?? false, () => update({ semesters: toggle(filters.semesters, value) }), count({ semesters: [value] }))}</div>)}
      </Facet>
      <Facet title={t('הערכה מסכמת', 'Final assessment')} count={filters.assessments?.length}>
        {ASSESSMENTS.map(([value, he, en]) => <div key={value}>{choice(t(he, en), filters.assessments?.includes(value) ?? false, () => update({ assessments: toggle(filters.assessments, value) }), count({ assessments: [value] }))}</div>)}
      </Facet>
      <Facet title={t('ממוצע ציונים היסטורי', 'Historical grade average')} count={Number(gradeActive)}>
        <div className="grid grid-cols-2 gap-2">{(['minGrade', 'maxGrade'] as const).map((bound) => {
          const label = bound === 'minGrade' ? t('ממוצע מינימלי', 'Minimum average') : t('ממוצע מקסימלי', 'Maximum average')
          return <div key={bound} className="min-w-0"><label className="flex flex-col gap-1.5 text-[11px] text-[var(--text-muted)]">{label}<input type="number" min={0} max={100} step={1} className={`${inputClass} w-full text-[var(--text)]`} value={filters[bound] ?? ''} placeholder={bound === 'minGrade' ? '0' : '100'} onChange={(event) => setGrade(bound, event.target.value)} /></label><input className="mt-2 w-full accent-[var(--purple-strong)]" type="range" aria-label={label} min={0} max={100} value={filters[bound] ?? (bound === 'minGrade' ? 0 : 100)} onChange={(event) => setGrade(bound, event.target.value)} /></div>
        })}</div>
        {choice(t('כלול גם ממוצע לא ידוע בטווח', 'Include unknown averages in range'), filters.includeUnknownGrades ?? false, () => update({ includeUnknownGrades: !filters.includeUnknownGrades }))}
        <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{t('הממוצע מבוסס על נתוני עבר ואינו תחזית לציון.', 'Averages reflect past results and do not predict your grade.')}</p>
      </Facet>
      <div className="border-t border-[var(--border)] py-2">{choice(t('מועדפים בלבד', 'Favorites only'), filters.favoritesOnly ?? false, () => update({ favoritesOnly: !filters.favoritesOnly }))}</div>
      <button type="button" onClick={() => onChange({ sort: filters.sort })} className={`mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] ${focusClass}`}>{t('ניקוי מסננים', 'Clear filters')}</button>
      <button type="button" onClick={() => { setExpanded(false); toggleRef.current?.focus() }} className={`repository-filter-done mb-3 w-full rounded-lg bg-[var(--purple-strong)] px-3 py-2 text-xs font-semibold text-white [@container_course-repository_(min-width:42rem)]:!hidden ${focusClass}`}>{t('הצגת תוצאות', 'Show results')}</button>
    </div>
  </aside>
}

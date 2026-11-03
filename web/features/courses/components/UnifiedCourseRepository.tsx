'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RepoCourseVM, RepositoryVM } from '../../../lib/repository'
import { buildCourseDetails, type CourseDetailsVM } from '../../../lib/course-details'
import CourseDetailsPanel from './CourseDetailsPanel'
import { filterRepository, repositorySemester, type RepositoryFilters } from '../../../lib/repository-filters'
import { Badge, Card, EmptyState } from '../../../components/ui'
import { writeRepositoryDrag, type PlannerDragPayload } from '../../../lib/planner/drag-payload'
import { categoryAccentClass } from './course-category'
import { useLocale } from '../../locale/LocaleProvider'
import { useAuth } from '../../auth/AuthProvider'
import RepositoryDiscoveryControls, { assessmentLabel, RepositoryAppliedFilters, RepositorySortControl } from './RepositoryDiscoveryControls'
import RepositoryCourseEvidence from './RepositoryCourseEvidence'
import RepositorySavedSearches from './RepositorySavedSearches'
import { savedCourseSearchSchema, type SavedCourseSearch } from '../../../../shared/planner/catalog-searches'

export type SemesterDestination = { id: string; label: string }

function allowedDestinations(course: RepoCourseVM, destinations: readonly SemesterDestination[]) {
  if (course.allowedSemesterIds) return destinations.filter(({ id }) => course.allowedSemesterIds!.includes(id))
  const offered = new Set(course.offered.map((value) => value.toLowerCase()))
  return destinations.filter(({ id }) => (
    offered.has(id.toLowerCase())
    || offered.has(id.toLowerCase().endsWith('_a') ? 'a' : 'b')
  ))
}

export default function UnifiedCourseRepository({
  repo,
  programId,
  selectedCourseIds,
  semesterDestinations = [],
  onRequestAdd,
  onRequestDetails,
  onDragStateChange,
  savedSearches = [],
  onSavedSearchesChange,
  savedSearchesReady = false,
}: {
  repo: RepositoryVM
  /** Required to ask the per-course AI chat; omit only where no AI context exists yet. */
  programId?: string
  selectedCourseIds: readonly string[]
  semesterDestinations?: readonly SemesterDestination[]
  onRequestAdd: (courseId: string, semesterId?: string) => void
  onRequestDetails?: (course: CourseDetailsVM) => void
  onDragStateChange?: (drag: PlannerDragPayload | null) => void
  savedSearches?: readonly SavedCourseSearch[]
  onSavedSearchesChange?: (searches: SavedCourseSearch[]) => void
  savedSearchesReady?: boolean
}) {
  const { t, dir } = useLocale()
  const { user, loading: authLoading } = useAuth()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<RepositoryFilters>({})
  const scope = `${user?.id ?? 'guest'}:${programId ?? 'catalog'}`
  const [savedFavorites, setSavedFavorites] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] })
  const [comparison, setComparison] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] })
  const [storageFailed, setStorageFailed] = useState(false)
  const favorites = useMemo(() => savedFavorites.scope === scope && !authLoading ? savedFavorites.ids : [], [savedFavorites, scope, authLoading])
  const compareIds = comparison.scope === scope && !authLoading ? comparison.ids : []
  useEffect(() => {
    if (authLoading) return
    let ids: string[] = []
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`syllo:repository:favorites:${scope}`) ?? '[]')
      if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === 'string').slice(0, 2000)
      setStorageFailed(false)
    } catch { setStorageFailed(true) }
    setSavedFavorites({ scope, ids })
  }, [scope, authLoading])
  const toggleFavorite = (id: string) => {
    const ids = favorites.includes(id) ? favorites.filter((value) => value !== id) : [...favorites, id]
    setSavedFavorites({ scope, ids })
    try { localStorage.setItem(`syllo:repository:favorites:${scope}`, JSON.stringify(ids)); setStorageFailed(false) }
    catch { setStorageFailed(true) }
  }
  const [details, setDetails] = useState<CourseDetailsVM | null>(null)
  const [draggingCourseId, setDraggingCourseId] = useState<string | null>(null)
  const selected = useMemo(() => new Set(selectedCourseIds), [selectedCourseIds])
  const filtered = useMemo(() => filterRepository(repo, query, { ...filters, favoriteIds: favorites }), [query, repo, filters, favorites])
  const shown = filtered.reduce((sum, category) => sum + category.courses.length, 0)
  const status = t(`מוצגים ${shown} מתוך ${repo.totalCourses} קורסים`, `Showing ${shown} of ${repo.totalCourses} courses`)
  const compared = repo.categories.flatMap((category) => category.courses.map((course) => ({ ...course, category: category.title }))).filter((course) => compareIds.includes(course.id))
  const semesterLabel = (semester: string) => ({ a: t('סמסטר א׳', 'Semester A'), b: t('סמסטר ב׳', 'Semester B'), summer: t('קיץ', 'Summer') }[repositorySemester(semester)] ?? semester)
  const draggingCourse = draggingCourseId
    ? repo.categories.flatMap((category) => category.courses).find((course) => course.id === draggingCourseId)
    : null

  const announceDragPreview = (courseId: string, allowedSemesterIds: string[]) => {
    onDragStateChange?.({ kind: 'repository', courseId, allowedSemesterIds })
    setDraggingCourseId(courseId)
  }

  const showDetails = (course: RepoCourseVM, category: string) => {
    const view = buildCourseDetails({ ...course, category })
    if (onRequestDetails) onRequestDetails(view)
    else setDetails(view)
  }

  return (
    <section aria-label={t('מאגר קורסים', 'Course repository')} dir={dir} className="course-repository flex min-w-0 flex-col gap-3">
      <style>{`
        .course-repository { container: course-repository / inline-size; }
        .repository-filter-body[data-expanded="false"], .repository-filter-heading { display: none; }
        .repository-filter-body[data-expanded="true"] { display: block; }
        .repository-facet summary::-webkit-details-marker { display: none; }
        .repository-facet[open] .repository-facet-chevron { transform: rotate(180deg); }
      `}</style>
      <div className="relative">
        <svg aria-hidden="true" className="pointer-events-none absolute start-3.5 top-3.5 text-[var(--text-muted)]" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input
          name="course-repository-search"
          type="search"
          maxLength={300}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('חיפוש לפי שם, קוד או קטגוריה…', 'Search by name, code or category…')}
          aria-label={t('חיפוש קורס', 'Search courses')}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3 pe-3 ps-10 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
        />
      </div>

      <div className="repository-layout grid gap-4 [@container_course-repository_(min-width:42rem)]:grid-cols-[11.5rem_minmax(0,1fr)] [@container_course-repository_(min-width:42rem)]:gap-5">
      <RepositoryDiscoveryControls repo={repo} filters={filters} onChange={setFilters} query={query} favoriteIds={favorites}
        savedSearchControls={onSavedSearchesChange && <RepositorySavedSearches key={scope} searches={savedSearches} ready={savedSearchesReady && !authLoading}
          query={query} filters={filters} onChange={onSavedSearchesChange} onLoad={(search) => {
            const parsed = savedCourseSearchSchema.safeParse(search)
            if (parsed.success) { setQuery(parsed.data.query); setFilters(parsed.data.filters) }
          }} />} />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
        <p
          role={draggingCourse ? 'status' : undefined}
          aria-live="polite"
          className="text-xs text-[var(--text-muted)]"
        >
          {draggingCourse
            ? t(`גוררים את ${draggingCourse.name} — שחררו בעמודת סמסטר מתאימה`, `Dragging ${draggingCourse.name} — drop in an available semester`)
            : status}
        </p>
        <RepositorySortControl filters={filters} onChange={setFilters} />
        </div>
      <RepositoryAppliedFilters repo={repo} filters={filters} onChange={setFilters} />
      {storageFailed && <p className="text-[11px] text-[var(--text-muted)]">{t('המועדפים נשמרים במפגש הנוכחי בלבד; האחסון במכשיר אינו זמין.', 'Favorites last for this session; device storage is unavailable.')}</p>}

      {compared.length > 0 && <details className="rounded-lg border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">{t(`השוואת קורסים (${compared.length}/4)`, `Compare courses (${compared.length}/4)`)}</summary>
        <div className="mt-3 overflow-x-auto">
        <table aria-label={t('השוואת קורסים', 'Course comparison')} className="w-full text-start text-xs">
          <caption className="mb-2 text-start font-semibold">{t('השוואת קורסים (עד ארבעה)', 'Compare courses (up to four)')}</caption>
          <thead><tr>{[t('קורס', 'Course'), t('קטגוריה', 'Category'), t('שעות', 'Hours'), t('סמסטר', 'Semester'), t('הערכה', 'Assessment'), t('ממוצע', 'Average')].map((label) => <th key={label} scope="col" className="p-2 text-start">{label}</th>)}<th scope="col"><span className="sr-only">{t('הסרה', 'Remove')}</span></th></tr></thead>
          <tbody>{compared.map((course) => <tr key={course.id} className="border-t border-[var(--border)]"><th scope="row" className="p-2 text-start font-medium">{course.name}<span className="block font-mono text-[10px]" dir="ltr">{course.id}</span></th><td className="p-2">{course.category}</td><td className="p-2">{course.weeklyHours ?? t('לא ידוע', 'Unknown')}</td><td className="p-2">{course.offered.length ? course.offered.map(semesterLabel).join(', ') : t('לא ידוע', 'Unknown')}</td><td className="p-2">{assessmentLabel(course.assessment?.kind ?? 'unknown', t)}</td><td className="p-2"><RepositoryCourseEvidence course={course} /></td><td className="p-2"><button type="button" aria-label={t(`הסרת ${course.name} מההשוואה`, `Remove ${course.name} from comparison`)} onClick={() => setComparison({ scope, ids: compareIds.filter((id) => id !== course.id) })} className="rounded p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">×</button></td></tr>)}</tbody>
        </table>
      </div></details>}

      <p className="text-[11px] leading-5 text-[var(--text-muted)]">
        {t('בחירת קורס מהמאגר פותחת בחירת סמסטר. הקורס יתווסף ללוח רק לאחר אימות השרת.', 'Choose a course, then a semester. The course is added to the board after server validation.')}
      </p>

      {filtered.length === 0 ? (
        <EmptyState>
          <p>{t('לא נמצאו קורסים המתאימים לחיפוש ולמסננים.', 'No courses match this search and these filters.')}</p>
          <button type="button" onClick={() => { setQuery(''); setFilters({ sort: filters.sort }) }} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">{t('איפוס החיפוש והמסננים', 'Reset search and filters')}</button>
        </EmptyState>
      ) : filtered.map((category) => (
        <section key={category.id} aria-label={category.title} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 pt-1 text-sm font-semibold">
            <span>{category.title}</span><span className="text-[11px] font-normal tabular-nums text-[var(--text-muted)]">{category.courses.length}</span>
          </h3>
          <div className="repository-course-grid grid grid-cols-1 gap-3 [@container_course-repository_(min-width:55rem)]:grid-cols-2">
            {category.courses.map((course) => {
              const onBoard = selected.has(course.id)
              const destinations = allowedDestinations(course, semesterDestinations)
              const draggable = !onBoard && destinations.length > 0
              const allowedSemesterIds = destinations.map(({ id }) => id)
              return (
                <div
                  key={course.id}
                  data-drag-card
                  draggable={draggable}
                  data-dragging={draggingCourseId === course.id ? 'true' : undefined}
                  className={draggable ? 'planner-drag-source' : undefined}
                  onDragStart={(event) => {
                    if (!draggable) return
                    if ((event.target as HTMLElement | null)?.closest('button,summary,a,input,textarea,select')) {
                      event.preventDefault()
                      return
                    }
                    event.dataTransfer.effectAllowed = 'copy'
                    writeRepositoryDrag(event.dataTransfer, course.id, allowedSemesterIds)
                    announceDragPreview(course.id, allowedSemesterIds)
                  }}
                  onDragEnd={() => {
                    onDragStateChange?.(null)
                    setDraggingCourseId(null)
                  }}
                >
                <Card className={`flex flex-col gap-3 px-3.5 py-3 ${categoryAccentClass(category.id)}`}>
                  <div>
                    <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold leading-6">{course.name}</h4>
                    <button type="button" disabled={authLoading} aria-pressed={favorites.includes(course.id)} aria-label={favorites.includes(course.id) ? t(`הסרת ${course.name} מהמועדפים`, `Remove ${course.name} from favorites`) : t(`שמירת ${course.name} במועדפים`, `Save ${course.name} to favorites`)} onClick={() => toggleFavorite(course.id)} className="shrink-0 rounded-md px-1.5 py-0.5 text-lg leading-6 text-[var(--text-muted)] aria-pressed:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]">{favorites.includes(course.id) ? '★' : '☆'}</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {course.weeklyHours != null && <Badge>{course.weeklyHours} {t('ש״ש', 'weekly hrs')}</Badge>}
                      <Badge variant="neutral"><span dir="ltr">{course.id}</span></Badge>
                      {course.offered.map((semester) => <Badge key={semester}>{semesterLabel(semester)}</Badge>)}
                    </div>
                    <div className="mt-2"><RepositoryCourseEvidence course={course} /></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
                    {draggable && (
                      <span
                        data-drag-handle
                        draggable={draggable}
                        title={t('גררו מכאן ללוח', 'Drag from here to the board')}
                        aria-label={t(`גרור את ${course.name} ללוח הסמסטרים`, `Drag ${course.name} to the semester board`)}
                        className="planner-drag-handle self-center text-[11px] text-[var(--text-muted)]"
                      >
                        ⠿ {t('גרור ללוח', 'Drag to board')}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={t(`פרטים על ${course.name}`, `Details about ${course.name}`)}
                      onClick={() => showDetails(course, category.title)}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
                    >
                      {t('פרטים', 'Details')}
                    </button>
                    {onBoard ? (
                      <button
                        type="button"
                        disabled
                        aria-label={t(`${course.name} כבר נמצא בלוח`, `${course.name} is already on the board`)}
                        className="rounded-full bg-[var(--purple-strong)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('כבר בלוח', 'On board')}
                      </button>
                    ) : destinations.length > 0 ? (
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded-full bg-[var(--purple-strong)] px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]">
                          {t('הוסף לסמסטר…', 'Add to semester…')}
                        </summary>
                        <div className="mt-2 flex flex-col gap-1">
                          {destinations.map((destination) => (
                            <button
                              key={destination.id}
                              type="button"
                              aria-label={t(`הוסף את ${course.name} אל ${destination.label}`, `Add ${course.name} to ${destination.label}`)}
                              onClick={() => onRequestAdd(course.id, destination.id)}
                              className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-start text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]"
                            >
                              {destination.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <span className="self-center px-2 py-1 text-xs text-[var(--text-muted)]">
                        {t('אין סמסטר זמין', 'No available semester')}
                      </span>
                    )}
                    <label className="ms-auto flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><input type="checkbox" className="accent-[var(--purple-strong)]" aria-label={t(`השוואת ${course.name}`, `Compare ${course.name}`)} checked={compareIds.includes(course.id)} disabled={!compareIds.includes(course.id) && compareIds.length >= 4} onChange={() => setComparison({ scope, ids: compareIds.includes(course.id) ? compareIds.filter((id) => id !== course.id) : [...compareIds, course.id] })} />{t('השוואה', 'Compare')}</label>
                  </div>
                </Card>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      </div>
      </div>

      {!onRequestDetails && <CourseDetailsPanel course={details} onClose={() => setDetails(null)} programId={programId} />}
    </section>
  )
}

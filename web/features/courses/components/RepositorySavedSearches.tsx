'use client'

import { useMemo, useState } from 'react'
import { savedCourseSearchSchema, type SavedCourseSearch } from '../../../../shared/planner/catalog-searches'
import type { RepositoryFilters } from '../../../lib/repository-filters'
import { uuidv4 } from '../../../lib/ai-session-token'
import { useLocale } from '../../locale/LocaleProvider'

const fieldClass = 'w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)]'
const actionClass = 'rounded-md px-2 py-1.5 text-xs hover:bg-[var(--purple)]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--purple)] disabled:cursor-not-allowed disabled:opacity-40'

export default function RepositorySavedSearches({ searches, ready, query, filters, onChange, onLoad }: {
  searches: readonly SavedCourseSearch[]
  ready: boolean
  query: string
  filters: RepositoryFilters
  onChange(searches: SavedCourseSearch[]): void
  onLoad(search: SavedCourseSearch): void
}) {
  const { t } = useLocale()
  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState(false)
  const valid = useMemo(() => {
    if (!ready || !Array.isArray(searches)) return []
    const seen = new Set<string>()
    return searches.flatMap((search) => {
      const parsed = savedCourseSearchSchema.safeParse(search)
      if (!parsed.success || seen.has(parsed.data.id)) return []
      seen.add(parsed.data.id)
      return [parsed.data]
    }).slice(0, 15)
  }, [searches, ready])
  const selected = valid.find((search) => search.id === selectedId)
  const save = () => {
    if (!ready || !name.trim() || (editing === 'new' && valid.length >= 15)) return
    if (editing === 'rename' && !selected) return
    const { categoryIds, semesters, assessments, minGrade, maxGrade, includeUnknownGrades, favoritesOnly, sort } = filters
    const parsed = savedCourseSearchSchema.safeParse(editing === 'rename' && selected
      ? { ...selected, name }
      : { id: `search_${uuidv4()}`, name, query, filters: { categoryIds, semesters, assessments, minGrade, maxGrade, includeUnknownGrades, favoritesOnly, sort } })
    if (!parsed.success) { setInvalid(true); return }
    const saved = parsed.data
    onChange(editing === 'rename' ? valid.map((search) => search.id === saved.id ? saved : search) : [...valid, saved])
    setSelectedId(saved.id)
    setEditing(null)
    setName('')
    setInvalid(false)
  }
  return <div className="border-t border-[var(--border)] py-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold">{t('חיפושים שמורים', 'Saved searches')}</span>
      <button type="button" disabled={!ready || valid.length >= 15} onClick={() => { setEditing('new'); setName(query.trim().slice(0, 80)); setInvalid(false) }} className={`${actionClass} inline-flex items-center gap-1.5 text-[var(--purple)]`}>
        <svg aria-hidden="true" width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 1h8v11L6 9.5 2 12V1Z" /></svg>{t('שמירת החיפוש', 'Save search')}
      </button>
    </div>
    {ready && valid.length > 0 && <>
      <select aria-label={t('טעינת חיפוש שמור', 'Load saved search')} className={`${fieldClass} mt-2`} value={selected?.id ?? ''} onChange={(event) => {
        const search = valid.find((item) => item.id === event.target.value)
        setSelectedId(search?.id ?? ''); setEditing(null); setName(''); setInvalid(false)
        if (search) onLoad(search)
      }}>
        <option value="">{t('בחירת חיפוש שמור…', 'Choose a saved search…')}</option>
        {valid.map((search) => <option key={search.id} value={search.id}>{search.name}</option>)}
      </select>
      {selected && <div className="mt-1 flex gap-1 text-[var(--text-muted)]">
        <button type="button" className={actionClass} onClick={() => onLoad(selected)}>{t('טעינה', 'Load')}</button>
        <button type="button" className={actionClass} onClick={() => { setEditing('rename'); setName(selected.name); setInvalid(false) }}>{t('שינוי שם', 'Rename')}</button>
        <button type="button" className={actionClass} onClick={() => { onChange(valid.filter((search) => search.id !== selected.id)); setSelectedId(''); setEditing(null); setName(''); setInvalid(false) }}>{t('מחיקה', 'Delete')}</button>
      </div>}
    </>}
    {ready && editing && <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); save() }}>
      <input autoFocus aria-label={t('שם החיפוש', 'Search name')} placeholder={t('שם לחיפוש', 'Name this search')} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setInvalid(false) }} className={fieldClass} />
      <div className="flex gap-1"><button type="submit" disabled={!name.trim()} className={`${actionClass} bg-[var(--purple)]/10 text-[var(--purple)]`}>{t('שמירה', 'Save')}</button><button type="button" className={`${actionClass} text-[var(--text-muted)]`} onClick={() => { setEditing(null); setName(''); setInvalid(false) }}>{t('ביטול', 'Cancel')}</button></div>
      {invalid && <p role="alert" className="text-[11px] text-[var(--text-muted)]">{t('לא ניתן לשמור את החיפוש. בדקו את השם והמסננים.', 'Could not save this search. Check the name and filters.')}</p>}
    </form>}
    {ready && valid.length >= 15 && <p className="mt-1 text-[10px] text-[var(--text-muted)]">{t('אפשר לשמור עד 15 חיפושים. מחקו חיפוש כדי לפנות מקום.', 'You can save up to 15 searches. Delete one to make room.')}</p>}
  </div>
}

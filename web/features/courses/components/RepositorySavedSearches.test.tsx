import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { SavedCourseSearch } from '../../../../shared/planner/catalog-searches'
import type { RepositoryVM } from '../../../lib/repository'
import UnifiedCourseRepository from './UnifiedCourseRepository'
import RepositorySavedSearches from './RepositorySavedSearches'
import { LocaleProvider } from '../../locale/LocaleProvider'
import * as Auth from '../../auth/AuthProvider'

const repo: RepositoryVM = { totalCourses: 2, categories: [
  { id: 'systems', title: 'בקרה', courses: [{ id: 'C1', name: 'בקרה מודרנית', weeklyHours: 3, offered: ['a'], difficulty: null, syllabusUrl: null }] },
  { id: 'energy', title: 'אנרגיה', courses: [{ id: 'C2', name: 'תכן תרמי', weeklyHours: 2, offered: ['b'], difficulty: null, syllabusUrl: null }] },
] }
const preset: SavedCourseSearch = { id: 'search_saved', name: 'הבחירה שלי', query: 'בקרה', filters: { categoryIds: ['systems'], semesters: ['a'], includeUnknownGrades: true, sort: 'hours-desc' } }

beforeEach(() => localStorage.clear())
afterEach(() => jest.restoreAllMocks())

test('saves, reloads exact query and filters, renames, and deletes within the filter panel', () => {
  const writes = jest.fn()
  function App() {
    const [searches, setSearches] = useState<SavedCourseSearch[]>([preset])
    return <UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} savedSearches={searches} savedSearchesReady
      onSavedSearchesChange={(next) => { writes(next); setSearches(next) }} />
  }
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
  const panel = screen.getByRole('complementary', { name: 'סינון קורסים' })
  const picker = within(panel).getByRole('combobox', { name: 'טעינת חיפוש שמור' })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'תכן תרמי' } })
  fireEvent.change(picker, { target: { value: preset.id } })
  expect(screen.getByRole('searchbox')).toHaveValue(preset.query)
  expect(screen.getByRole('combobox', { name: 'מיון בתוך קטגוריה' })).toHaveValue('hours-desc')
  expect(screen.getByRole('checkbox', { name: 'בקרה' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'סמסטר א׳' })).toBeChecked()
  expect(screen.getByText('בקרה מודרנית')).toBeInTheDocument()
  expect(screen.queryByText('תכן תרמי')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'temporary edit' } })
  fireEvent.click(within(panel).getByRole('button', { name: 'טעינה' }))
  expect(screen.getByRole('searchbox')).toHaveValue(preset.query)
  fireEvent.click(within(panel).getByRole('button', { name: 'שמירת החיפוש' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'שם החיפוש' }), { target: { value: '  חיפוש נוסף  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  const saved = writes.mock.calls[0][0][1]
  expect(saved).toMatchObject({ name: 'חיפוש נוסף', query: preset.query, filters: preset.filters })
  expect(saved.filters).not.toHaveProperty('favoriteIds')
  fireEvent.click(screen.getByRole('button', { name: 'שינוי שם' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'שם החיפוש' }), { target: { value: 'שם חדש' } })
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(writes.mock.calls[1][0][1]).toEqual({ ...saved, name: 'שם חדש' })
  fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }))
  expect(writes.mock.calls[2][0]).toEqual([preset])
})

test('sanitizes corrupt incoming searches, strips favorite ids from newly saved filters, and bounds the list', () => {
  const change = jest.fn()
  const load = jest.fn()
  const corrupt = { ...preset, id: 'search_corrupt', name: 'corrupted', filters: { sort: 'bad' } } as unknown as SavedCourseSearch
  const { rerender } = render(<RepositorySavedSearches searches={[corrupt, preset]} ready query="  exact query  " filters={{ favoriteIds: ['private-course'], favoritesOnly: true }} onChange={change} onLoad={load} />)
  expect(screen.queryByRole('option', { name: 'corrupted' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: preset.id } })
  expect(load).toHaveBeenCalledWith(preset)
  fireEvent.click(screen.getByRole('button', { name: 'שמירת החיפוש' }))
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(change.mock.calls[0][0][1]).toMatchObject({ query: '  exact query  ', filters: { favoritesOnly: true } })
  expect(change.mock.calls[0][0][1].filters).not.toHaveProperty('favoriteIds')
  rerender(<RepositorySavedSearches searches={Array.from({ length: 15 }, (_, i) => ({ ...preset, id: `search_${i}` }))} ready query="" filters={{}} onChange={change} onLoad={load} />)
  expect(screen.getByRole('button', { name: 'שמירת החיפוש' })).toBeDisabled()
})

test('clears edit drafts on account changes and hides names while the new scope is not ready', () => {
  const auth = jest.spyOn(Auth, 'useAuth')
  const signedOut = { enabled: true, loading: false, user: { id: 'owner-a', email: null } } as ReturnType<typeof Auth.useAuth>
  auth.mockReturnValue(signedOut)
  const writes = jest.fn()
  const props = { repo, selectedCourseIds: [], onRequestAdd: jest.fn(), savedSearches: [preset], onSavedSearchesChange: writes }
  const { rerender } = render(<UnifiedCourseRepository {...props} savedSearchesReady />)
  fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
  fireEvent.click(screen.getByRole('button', { name: 'שמירת החיפוש' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'שם החיפוש' }), { target: { value: 'private draft' } })
  auth.mockReturnValue({ ...signedOut, user: { id: 'owner-b', email: null } })
  rerender(<UnifiedCourseRepository {...props} savedSearchesReady={false} />)
  expect(screen.queryByRole('option', { name: preset.name })).toBeNull()
  expect(screen.queryByDisplayValue('private draft')).toBeNull()
  expect(screen.getByRole('button', { name: 'שמירת החיפוש' })).toBeDisabled()
  rerender(<UnifiedCourseRepository {...props} savedSearches={[]} savedSearchesReady />)
  expect(screen.queryByRole('textbox', { name: 'שם החיפוש' })).toBeNull()
  expect(writes).not.toHaveBeenCalled()
})

test('provides English saved-search actions and leaves account persistence to the caller', () => {
  localStorage.setItem('tau_locale', 'en')
  const storage = jest.spyOn(Storage.prototype, 'setItem')
  render(<LocaleProvider><RepositorySavedSearches searches={[preset]} ready query="" filters={{}} onChange={jest.fn()} onLoad={jest.fn()} /></LocaleProvider>)
  fireEvent.change(screen.getByRole('combobox', { name: 'Load saved search' }), { target: { value: preset.id } })
  expect(screen.getByRole('button', { name: 'Save search' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  expect(storage).not.toHaveBeenCalled()
})

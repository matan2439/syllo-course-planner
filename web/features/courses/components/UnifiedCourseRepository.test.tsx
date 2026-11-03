import { fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import type { RepositoryVM } from '../../../lib/repository'
import UnifiedCourseRepository from './UnifiedCourseRepository'
import { LocaleProvider } from '../../locale/LocaleProvider'
import * as Auth from '../../auth/AuthProvider'

const repo: RepositoryVM = {
  totalCourses: 3,
  categories: [
    {
      id: 'systems',
      title: 'בקרה ורובוטיקה',
      courses: [
        { id: '0542-4241', name: 'בקרה מודרנית', weeklyHours: 3, offered: ['A'], difficulty: 'medium', syllabusUrl: null },
        { id: '0542-4264', name: 'מבוא ללמידת מכונה סטטיסטית', weeklyHours: 3, offered: ['B'], difficulty: 'hard', syllabusUrl: null },
      ],
    },
    {
      id: 'energy',
      title: 'אנרגיה',
      courses: [
        { id: '0542-4135', name: 'תכן תרמי מתקדם', weeklyHours: 2, offered: ['A'], difficulty: null, syllabusUrl: null },
      ],
    },
  ],
}

const semesterDestinations = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
]

describe('UnifiedCourseRepository', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => jest.restoreAllMocks())

  test('combines discovery controls and keeps grade unknowns explicit', () => {
    const enriched: RepositoryVM = { ...repo, categories: repo.categories.map((category) => ({ ...category, courses: category.courses.map((course) => ({
      ...course,
      assessment: { kind: 'exam', text: 'בחינה סופית', sourceUrl: null },
      gradeSummary: course.id === '0542-4241' ? { mean: 84, students: 90, terms: 2, sources: [{ label: 'TAU+', url: null }] } : null,
    })) })) } as RepositoryVM
    render(<UnifiedCourseRepository repo={enriched} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'בקרה ורובוטיקה' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'סמסטר א׳' }))
    fireEvent.click(screen.getByText('ממוצע ציונים היסטורי'))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ממוצע מינימלי' }), { target: { value: '80' } })
    expect(screen.getByRole('slider', { name: 'ממוצע מינימלי' })).toHaveValue('80')
    expect(screen.getByText('בקרה מודרנית')).toBeInTheDocument()
    expect(screen.queryByText('תכן תרמי מתקדם')).not.toBeInTheDocument()
    expect(screen.getByText(/90.*2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי מסננים' }))
    expect(screen.getByText('תכן תרמי מתקדם')).toBeInTheDocument()
    expect(screen.getAllByText('ממוצע לא ידוע')).toHaveLength(2)
  })

  test('persists favorites for this program and compares chosen courses', () => {
    const { unmount } = render(<UnifiedCourseRepository repo={repo} programId="test_a" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'שמירת בקרה מודרנית במועדפים' }))
    fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'מועדפים בלבד' }))
    expect(screen.queryByText('תכן תרמי מתקדם')).not.toBeInTheDocument()
    unmount()
    render(<UnifiedCourseRepository repo={repo} programId="test_a" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'הסרת בקרה מודרנית מהמועדפים' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('checkbox', { name: 'השוואת בקרה מודרנית' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'השוואת תכן תרמי מתקדם' }))
    fireEvent.click(screen.getByText('השוואת קורסים (2/4)'))
    const comparison = screen.getByRole('table', { name: 'השוואת קורסים' })
    expect(within(comparison).getByText('בקרה מודרנית')).toBeInTheDocument()
    expect(within(comparison).getByText('תכן תרמי מתקדם')).toBeInTheDocument()
  })

  test('does not expose another owner or program favorites and comparison after switching scope', () => {
    const signedOut = renderHook(() => Auth.useAuth()).result.current
    const auth = jest.spyOn(Auth, 'useAuth')
    auth.mockReturnValue({ ...signedOut, user: { id: 'owner-a', email: null } })
    const { rerender } = render(<UnifiedCourseRepository repo={repo} programId="program_a" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'שמירת בקרה מודרנית במועדפים' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'השוואת בקרה מודרנית' }))
    expect(screen.getByLabelText('השוואת קורסים')).toBeInTheDocument()
    auth.mockReturnValue({ ...signedOut, user: { id: 'owner-b', email: null } })
    rerender(<UnifiedCourseRepository repo={repo} programId="program_a" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'שמירת בקרה מודרנית במועדפים' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('השוואת קורסים')).not.toBeInTheDocument()
    auth.mockReturnValue({ ...signedOut, user: { id: 'owner-a', email: null } })
    rerender(<UnifiedCourseRepository repo={repo} programId="program_b" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'שמירת בקרה מודרנית במועדפים' })).toHaveAttribute('aria-pressed', 'false')
    rerender(<UnifiedCourseRepository repo={repo} programId="program_a" selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'הסרת בקרה מודרנית מהמועדפים' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('uses English controls and direction while preserving original catalog titles', () => {
    localStorage.setItem('tau_locale', 'en')
    render(<LocaleProvider><UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} /></LocaleProvider>)
    expect(screen.getByRole('region', { name: 'Course repository' })).toHaveAttribute('dir', 'ltr')
    fireEvent.click(screen.getByRole('button', { name: 'Filter courses' }))
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(screen.getByText('בקרה מודרנית')).toBeInTheDocument()
  })

  test('searches by Hebrew name, id and category using the real repository projection', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'חיפוש קורס' })
    expect(search).toHaveAttribute('name', 'course-repository-search')

    fireEvent.change(search, { target: { value: 'למידת מכונה' } })
    expect(screen.getByText('מבוא ללמידת מכונה סטטיסטית')).toBeInTheDocument()
    expect(screen.queryByText('תכן תרמי מתקדם')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '0542-4135' } })
    expect(screen.getByText('תכן תרמי מתקדם')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'בקרה ורובוטיקה' } })
    expect(screen.getByText('בקרה מודרנית')).toBeInTheDocument()
    expect(screen.getByText('מבוא ללמידת מכונה סטטיסטית')).toBeInTheDocument()
  })

  test('exposes a semester-specific keyboard add without mutating the board', () => {
    const onRequestAdd = jest.fn()
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={['0542-4241']}
        semesterDestinations={semesterDestinations}
        onRequestAdd={onRequestAdd}
      />,
    )

    expect(screen.getByRole('button', { name: 'בקרה מודרנית כבר נמצא בלוח' })).toBeDisabled()
    expect(screen.getByText('בקרה מודרנית').closest('[draggable="true"]')).toBeNull()
    const machineLearningCard = screen.getByText('מבוא ללמידת מכונה סטטיסטית').closest('[data-drag-card]') as HTMLElement
    expect(machineLearningCard).not.toHaveAttribute('aria-label')
    expect(machineLearningCard.querySelector('[data-drag-handle]')).toHaveAttribute(
      'aria-label', 'גרור את מבוא ללמידת מכונה סטטיסטית ללוח הסמסטרים',
    )
    fireEvent.click(screen.getByRole('button', { name: 'הוסף את תכן תרמי מתקדם אל שנה ג׳ — סמסטר א׳' }))
    expect(onRequestAdd).toHaveBeenCalledWith('0542-4135', 'year_3_semester_a')
    expect(onRequestAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/בחירת קורס מהמאגר פותחת בחירת סמסטר/)).toBeInTheDocument()
  })

  test('writes a typed repository drag payload with offered semester restrictions', () => {
    const transfer = {
      values: new Map<string, string>(),
      setData(type: string, value: string) { this.values.set(type, value) },
      getData(type: string) { return this.values.get(type) ?? '' },
      effectAllowed: '',
    }
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
      />,
    )

    const card = screen.getByText('בקרה מודרנית').closest('[data-drag-card]') as HTMLElement
    const handle = card.querySelector('[data-drag-handle]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('draggable', 'true')
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(card).toHaveClass('planner-drag-source')
    expect(handle).toHaveClass('planner-drag-handle')
    expect(handle).toHaveAttribute('aria-label', 'גרור את בקרה מודרנית ללוח הסמסטרים')
    expect(handle).not.toHaveAttribute('aria-hidden', 'true')
    fireEvent.dragStart(handle, { dataTransfer: transfer })

    expect(JSON.parse(transfer.getData('application/x-syllo-repository-course'))).toEqual({
      kind: 'repository',
      courseId: '0542-4241',
      allowedSemesterIds: ['year_3_semester_a'],
    })
  })

  test('makes the full available course card a draggable source', () => {
    const transfer = {
      values: new Map<string, string>(),
      setData(type: string, value: string) { this.values.set(type, value) },
      getData(type: string) { return this.values.get(type) ?? '' },
      effectAllowed: '',
    }
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
      />,
    )

    const card = screen.getByText('בקרה מודרנית').closest('[data-drag-card]') as HTMLElement
    expect(card).toHaveAttribute('draggable', 'true')
    expect(card).toHaveClass('planner-drag-source')

    fireEvent.dragStart(card, { dataTransfer: transfer })
    expect(JSON.parse(transfer.getData('application/x-syllo-repository-course'))).toEqual({
      kind: 'repository',
      courseId: '0542-4241',
      allowedSemesterIds: ['year_3_semester_a'],
    })
  })

  test('does not hijack a drag that starts on an interactive card control', () => {
    const transfer = {
      values: new Map<string, string>(),
      setData(type: string, value: string) { this.values.set(type, value) },
      getData(type: string) { return this.values.get(type) ?? '' },
      effectAllowed: '',
    }
    const onDragStateChange = jest.fn()
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
        onDragStateChange={onDragStateChange}
      />,
    )

    const detailsButton = screen.getByRole('button', { name: 'פרטים על בקרה מודרנית' })
    fireEvent.dragStart(detailsButton, { dataTransfer: transfer })

    expect(onDragStateChange).not.toHaveBeenCalled()
    expect(transfer.values.size).toBe(0)
  })

  test('announces the active drag and clears it when the course card is released', () => {
    const transfer = {
      values: new Map<string, string>(),
      setData(type: string, value: string) { this.values.set(type, value) },
      getData(type: string) { return this.values.get(type) ?? '' },
      effectAllowed: '',
    }
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
      />,
    )

    const card = screen.getByText('בקרה מודרנית').closest('[data-drag-card]') as HTMLElement
    const handle = card.querySelector('[data-drag-handle]') as HTMLElement
    fireEvent.dragStart(handle, { dataTransfer: transfer })

    expect(screen.getByRole('status')).toHaveTextContent('גוררים את בקרה מודרנית')
    expect(card).toHaveAttribute('data-dragging', 'true')
    expect(card.querySelector('[data-drag-handle]')).toHaveAttribute('title', 'גררו מכאן ללוח')
    expect(card.querySelectorAll('[draggable="true"]').length + (card.matches('[draggable="true"]') ? 1 : 0))
      .toBe(2)

    fireEvent.dragEnd(handle)

    expect(screen.queryByText(/נגרר/)).not.toBeInTheDocument()
    expect(card).not.toHaveAttribute('data-dragging', 'true')
  })

  test('keeps the source interactive until native dragstart establishes a repository drag', () => {
    const onDragStateChange = jest.fn()
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
        onDragStateChange={onDragStateChange}
      />,
    )

    const handle = screen.getByLabelText('גרור את בקרה מודרנית ללוח הסמסטרים')
    fireEvent.pointerDown(handle)

    // The workspace makes the open drawer pointer-transparent only after it
    // receives this state. Publishing it on pointerdown removes the native
    // drag source before the browser can create its DataTransfer payload.
    expect(onDragStateChange).not.toHaveBeenCalled()
    expect(handle).toHaveAttribute('draggable', 'true')

    const transfer = {
      values: new Map<string, string>(),
      setData(type: string, value: string) { this.values.set(type, value) },
      getData(type: string) { return this.values.get(type) ?? '' },
      effectAllowed: '',
    }
    fireEvent.dragStart(handle, { dataTransfer: transfer })

    expect(onDragStateChange).toHaveBeenCalledWith({
      kind: 'repository',
      courseId: '0542-4241',
      allowedSemesterIds: ['year_3_semester_a'],
    })
  })

  test('gives every repository course card its category accent', () => {
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
      />,
    )

    const card = screen.getByText('בקרה מודרנית').closest('[data-drag-card]')
    expect(card?.querySelector('.card-cat-systems')).toBeInTheDocument()
  })

  test('does not advertise a draggable source when no authoritative destination is known', () => {
    const repoWithoutOffering: RepositoryVM = {
      totalCourses: 1,
      categories: [{
        id: 'unknown', title: 'קורסים נוספים', courses: [{
          id: '0542-4999', name: 'קורס ללא זמינות', weeklyHours: 3,
          offered: [], difficulty: null, syllabusUrl: null,
        }],
      }],
    }

    render(
      <UnifiedCourseRepository
        repo={repoWithoutOffering}
        selectedCourseIds={[]}
        semesterDestinations={semesterDestinations}
        onRequestAdd={jest.fn()}
      />,
    )

    expect(screen.getByText('קורס ללא זמינות').closest('[draggable="true"]')).toBeNull()
    expect(screen.getByText('אין סמסטר זמין')).toBeInTheDocument()
    expect(screen.queryByText('הוסף לסמסטר…')).toBeNull()
  })

  test('opens understandable details from a keyboard-accessible control', () => {
    const onRequestDetails = jest.fn()
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={[]}
        onRequestAdd={jest.fn()}
        onRequestDetails={onRequestDetails}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'פרטים על בקרה מודרנית' }))
    expect(onRequestDetails).toHaveBeenCalledWith(expect.objectContaining({ id: '0542-4241' }))
  })

  test('announces a clear empty result in RTL', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    expect(screen.getByRole('region', { name: 'מאגר קורסים' })).toHaveAttribute('dir', 'rtl')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'קורס שלא קיים' } })
    expect(screen.getByText(/לא נמצאו קורסים/)).toBeInTheDocument()
  })

  test('keeps filters compact, removes individual facets, and preserves sorting when clearing', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    const toggleFilters = screen.getByRole('button', { name: 'סינון קורסים' })
    expect(toggleFilters).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: 'בקרה ורובוטיקה' })).not.toBeInTheDocument()
    fireEvent.click(toggleFilters)
    expect(toggleFilters).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: 'מיון בתוך קטגוריה' }), { target: { value: 'hours-asc' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'בקרה ורובוטיקה' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'סמסטר א׳' }))
    expect(screen.getByText('מוצגים 1 מתוך 3 קורסים')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הצגת תוצאות' }))
    expect(toggleFilters).toHaveAttribute('aria-expanded', 'false')
    expect(toggleFilters).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'הסרת מסנן: בקרה ורובוטיקה' }))
    expect(screen.getByText('תכן תרמי מתקדם')).toBeInTheDocument()
    expect(screen.queryByText('מבוא ללמידת מכונה סטטיסטית')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי הכול' }))
    expect(screen.getByText('מוצגים 3 מתוך 3 קורסים')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'מיון בתוך קטגוריה' })).toHaveValue('hours-asc')
  })

  test('facet counts respect other selections and keep category alternatives available', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'סמסטר א׳' }))
    const energy = screen.getByRole('checkbox', { name: 'אנרגיה' })
    const systems = screen.getByRole('checkbox', { name: 'בקרה ורובוטיקה' })
    expect(within(energy.closest('label')!).getByText('1')).toBeInTheDocument()
    expect(within(systems.closest('label')!).getByText('1')).toBeInTheDocument()
    fireEvent.click(systems)
    // An OR alternative keeps its matching count when another category is selected.
    expect(within(energy.closest('label')!).getByText('1')).toBeInTheDocument()
    fireEvent.click(energy)
    expect(screen.getByText('מוצגים 2 מתוך 3 קורסים')).toBeInTheDocument()
  })

  test('keeps grade bounds valid and can remove their range without clearing another facet', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'סינון קורסים' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'סמסטר א׳' }))
    fireEvent.click(screen.getByText('ממוצע ציונים היסטורי'))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ממוצע מקסימלי' }), { target: { value: '70' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ממוצע מינימלי' }), { target: { value: '80' } })
    expect(screen.getByRole('spinbutton', { name: 'ממוצע מקסימלי' })).toHaveValue(80)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת מסנן: ממוצע 80–80' }))
    expect(screen.getByText('מוצגים 2 מתוך 3 קורסים')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'סמסטר א׳' })).toBeChecked()
  })

  test('offers an empty-state reset for search and filters while retaining the sort', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'מיון בתוך קטגוריה' }), { target: { value: 'name' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'קורס שלא קיים' } })
    fireEvent.click(screen.getByRole('button', { name: 'איפוס החיפוש והמסננים' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByText('מוצגים 3 מתוך 3 קורסים')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'מיון בתוך קטגוריה' })).toHaveValue('name')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import type { RepositoryVM } from '../../lib/repository'
import UnifiedCourseRepository from './UnifiedCourseRepository'

const repo: RepositoryVM = {
  totalCourses: 3,
  categories: [
    {
      id: 'control',
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
    expect(screen.getByText(/הוספה ידנית תישמר רק לאחר אימות השרת/)).toBeInTheDocument()
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
    expect(card).not.toHaveAttribute('draggable', 'true')
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(card).not.toHaveClass('planner-drag-source')
    expect(handle).toHaveClass('planner-drag-source')
    expect(handle).toHaveAttribute('aria-label', 'גרור את בקרה מודרנית ללוח הסמסטרים')
    expect(handle).not.toHaveAttribute('aria-hidden', 'true')
    fireEvent.dragStart(handle, { dataTransfer: transfer })

    expect(JSON.parse(transfer.getData('application/x-syllo-repository-course'))).toEqual({
      kind: 'repository',
      courseId: '0542-4241',
      allowedSemesterIds: ['year_3_semester_a'],
    })
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
      .toBe(1)

    fireEvent.dragEnd(handle)

    expect(screen.queryByText(/נגרר/)).not.toBeInTheDocument()
    expect(card).not.toHaveAttribute('data-dragging', 'true')
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
})

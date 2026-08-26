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

describe('UnifiedCourseRepository', () => {
  test('searches by Hebrew name, id and category using the real repository projection', () => {
    render(<UnifiedCourseRepository repo={repo} selectedCourseIds={[]} onRequestAdd={jest.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'חיפוש קורס' })

    fireEvent.change(search, { target: { value: 'למידת מכונה' } })
    expect(screen.getByText('מבוא ללמידת מכונה סטטיסטית')).toBeInTheDocument()
    expect(screen.queryByText('תכן תרמי מתקדם')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '0542-4135' } })
    expect(screen.getByText('תכן תרמי מתקדם')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'בקרה ורובוטיקה' } })
    expect(screen.getByText('בקרה מודרנית')).toBeInTheDocument()
    expect(screen.getByText('מבוא ללמידת מכונה סטטיסטית')).toBeInTheDocument()
  })

  test('exposes an add intent without mutating the board or generating a plan', () => {
    const onRequestAdd = jest.fn()
    render(
      <UnifiedCourseRepository
        repo={repo}
        selectedCourseIds={['0542-4241']}
        onRequestAdd={onRequestAdd}
      />,
    )

    expect(screen.getByRole('button', { name: 'בקרה מודרנית כבר נמצא בלוח' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'הוסף את תכן תרמי מתקדם ללוח' }))
    expect(onRequestAdd).toHaveBeenCalledWith('0542-4135')
    expect(onRequestAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/הוספה ידנית תישמר רק לאחר אימות השרת/)).toBeInTheDocument()
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

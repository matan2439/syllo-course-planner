import { fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider, LOCALE_STORAGE_KEY } from './LocaleProvider'
import ProductShell from '../shell/components/ProductShell'
import NativePlannerBoard from '../planner/components/NativePlannerBoard'
import { BoardLoading } from '../planner/components/BoardStatus'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { boardResponseToModel } from '../../../shared/planner/adapters'

jest.mock('../shell/components/ShaderGradientBackground', () => ({ __esModule: true, default: () => null }))
beforeEach(() => localStorage.clear())

test('profile language choice translates shell actions and footer and changes direction', () => {
  render(<LocaleProvider><ProductShell programId="mechanical_engineering_2025"><p>Content</p></ProductShell></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'הפרופיל שלי' }))
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Change program/ })).toHaveAttribute('href', '/programs?program=mechanical_engineering_2025')
  expect(screen.getByRole('navigation', { name: 'Service information' })).toBeInTheDocument()
  expect(document.documentElement).toHaveAttribute('dir', 'ltr')
})

test('English board labels and removal actions retain the official course name and semester target', () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  const removed: string[] = []
  const board = boardModelToVM(boardResponseToModel({
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'E-1', name_he: 'מכניקת זורמים', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false }] },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }))
  render(<LocaleProvider><NativePlannerBoard board={board} onRemoveCourse={(id) => removed.push(id)} /></LocaleProvider>)
  expect(screen.getByRole('heading', { name: 'Year 3 — Semester A' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Year 3 — Semester B' })).toHaveTextContent('No courses scheduled')
  expect(screen.getByText('מכניקת זורמים')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove מכניקת זורמים from board' }))
  expect(removed).toEqual(['E-1'])
})

test('loading state follows the selected language', () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  render(<LocaleProvider><BoardLoading /></LocaleProvider>)
  expect(screen.getByRole('region', { name: 'Current plan' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading your current plan')
})

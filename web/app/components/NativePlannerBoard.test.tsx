/**
 * Slice 1 — read-only native board (RTL). The board is exercised ONLY through
 * the canonical path: board payload → shared/planner adapter → BoardModel →
 * boardModelToVM → NativePlannerBoard. No hand-built BoardVM data fixtures.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import NativePlannerBoard from './NativePlannerBoard'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import { writeRepositoryDrag } from '../../lib/planner/drag-payload'

const BOARD = {
  metadata: { board_data_version: 'rev-1' },
  semesters: [
    {
      semester_id: 'year_3_semester_a',
      courses: [{ course_id: 'C-1', name_he: 'קורס לדוגמה', weekly_hours: 3.5, course_type: 'mandatory', is_mandatory: true }],
    },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const vmFromPayload = (payload: unknown) => boardModelToVM(boardResponseToModel(payload))

test('renders semesters and courses from the canonical path', () => {
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  expect(screen.getByText('קורס לדוגמה')).toBeInTheDocument()
})

test('3.5 weekly hours render exactly as 3.5 (no rounding)', () => {
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  expect(screen.getByText(/3\.5/)).toBeInTheDocument()
})

test('an empty semester shows the truthful "no courses" state', () => {
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  expect(screen.getByText('אין קורסים משובצים')).toBeInTheDocument()
})

test('the board and its semesters expose accessible labels (RTL Hebrew)', () => {
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  expect(screen.getByRole('list', { name: 'לוח סמסטרים' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })).toBeInTheDocument()
})

test('informational course cards are not focusable — no fake interactivity (Slice 1)', () => {
  const { container } = render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  expect(container.querySelectorAll('a, button, [tabindex]').length).toBe(0)
})

test('an entirely empty board renders the truthful board-unavailable state', () => {
  render(<NativePlannerBoard board={vmFromPayload({ metadata: { board_data_version: 'x' }, semesters: [] })} />)
  expect(screen.getByText(/עדיין לא זמינים/)).toBeInTheDocument()
})

test('uses a continuous horizontally scrollable semester table', () => {
  const { container } = render(<NativePlannerBoard board={vmFromPayload(BOARD)} />)
  const grid = container.querySelector('[role="list"]') as HTMLElement
  expect(grid.parentElement?.className).toMatch(/overflow-x-auto/)
  expect(grid.className).toMatch(/grid-flow-col/)
  expect(grid.className).toMatch(/auto-cols-\[minmax\(17rem,1fr\)\]/)
})

test('a repository drop invokes add and never move', () => {
  const onAddCourse = jest.fn()
  const onMoveCourse = jest.fn()
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  render(
    <NativePlannerBoard
      board={vmFromPayload(BOARD)}
      onAddCourse={onAddCourse}
      onMoveCourse={onMoveCourse}
    />,
  )

  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), { dataTransfer: transfer })

  expect(onAddCourse).toHaveBeenCalledWith('0542-4120', 'year_3_semester_a')
  expect(onMoveCourse).not.toHaveBeenCalled()
})

test('an allowed repository drag visibly marks the semester drop target', () => {
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} onAddCourse={jest.fn()} />)

  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  fireEvent.dragOver(target, { dataTransfer: transfer })
  expect(target).toHaveClass('planner-drop-target-active')
  expect(screen.getByRole('status')).toHaveTextContent('אפשר לשחרר כאן')

  fireEvent.drop(target, { dataTransfer: transfer })
  expect(target).not.toHaveClass('planner-drop-target-active')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('an allowed repository drag marks the target as soon as it enters the semester', () => {
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} onAddCourse={jest.fn()} />)

  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  fireEvent.dragEnter(target, { dataTransfer: transfer })

  expect(target).toHaveClass('planner-drop-target-active')
  expect(screen.getByRole('status')).toHaveTextContent('אפשר לשחרר כאן')
})

test('a repository drop outside its offering fails closed', () => {
  const onAddCourse = jest.fn()
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} onAddCourse={onAddCourse} />)

  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' }), { dataTransfer: transfer })

  expect(onAddCourse).not.toHaveBeenCalled()
})

test('mandatory courses do not advertise a move that authoritative validation must reject', () => {
  const onMoveCourse = jest.fn()
  const { container } = render(<NativePlannerBoard board={vmFromPayload(BOARD)} onMoveCourse={onMoveCourse} />)
  expect(screen.getByText('קורס לדוגמה').closest('[draggable="true"]')).toBeNull()
  expect(container.querySelector('details')).toBeNull()
})

test('dragging an elective onto another semester invokes the same authoritative move intent', () => {
  const onMoveCourse = jest.fn()
  const electiveBoard = {
    ...BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }
  const { container } = render(<NativePlannerBoard board={vmFromPayload(electiveBoard)} onMoveCourse={onMoveCourse} />)
  const card = screen.getByText('קורס בחירה').closest('[draggable="true"]') as HTMLElement
  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  expect(card).not.toBeNull()
  fireEvent.dragStart(card, { dataTransfer: transfer })
  fireEvent.dragOver(target, { dataTransfer: transfer })
  fireEvent.drop(target, { dataTransfer: transfer })
  expect(onMoveCourse).toHaveBeenCalledWith('E-1', 'year_3_semester_b')
  expect(container.querySelector('details')).toBeInTheDocument() // non-drag keyboard alternative remains
})

test('an elective advertises only semesters listed by the authoritative catalog', () => {
  const payload = {
    metadata: {
      board_data_version: 'rev-1',
      program_repository_courses: [{
        course_id: 'E-1', name_he: 'בחירה מוגבלת', weekly_hours: 3.5,
        is_mandatory: false, offered_semesters: ['year_3_semester_b'],
      }],
    },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'בחירה מוגבלת', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
    ],
  }

  render(<NativePlannerBoard board={vmFromPayload(payload)} onMoveCourse={jest.fn()} />)

  expect(screen.getByRole('button', { name: 'העבר בחירה מוגבלת אל שנה ג׳ — סמסטר ב׳' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'העבר בחירה מוגבלת אל שנה ד׳ — סמסטר א׳' })).toBeNull()
})

test('dropping an elective outside its catalog offering does not send a move intent', () => {
  const onMoveCourse = jest.fn()
  const payload = {
    metadata: {
      board_data_version: 'rev-1',
      program_repository_courses: [{
        course_id: 'E-1', name_he: 'בחירה מוגבלת', weekly_hours: 3.5,
        is_mandatory: false, offered_semesters: ['year_3_semester_b'],
      }],
    },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'בחירה מוגבלת', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
    ],
  }
  render(<NativePlannerBoard board={vmFromPayload(payload)} onMoveCourse={onMoveCourse} />)
  const card = screen.getByText('בחירה מוגבלת').closest('[draggable="true"]') as HTMLElement
  const invalidTarget = screen.getByRole('region', { name: 'שנה ד׳ — סמסטר א׳' })
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }

  fireEvent.dragStart(card, { dataTransfer: transfer })
  fireEvent.dragOver(invalidTarget, { dataTransfer: transfer })
  fireEvent.drop(invalidTarget, { dataTransfer: transfer })

  expect(onMoveCourse).not.toHaveBeenCalled()
})

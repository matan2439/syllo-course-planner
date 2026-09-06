/**
 * Slice 1 — read-only native board (RTL). The board is exercised ONLY through
 * the canonical path: board payload → shared/planner adapter → BoardModel →
 * boardModelToVM → NativePlannerBoard. No hand-built BoardVM data fixtures.
 */
import { createElement } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import NativePlannerBoard from './NativePlannerBoard'
import { boardModelToVM } from '../../lib/planner/board-vm'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import { REPOSITORY_COURSE_MIME, writeRepositoryDrag } from '../../lib/planner/drag-payload'

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

test('mandatory courses can request an offered move by drag or keyboard, but cannot be removed', () => {
  const onMove = jest.fn()
  render(<NativePlannerBoard onMoveCourse={onMove} onRemoveCourse={jest.fn()} board={vmFromPayload({
    ...BOARD,
    semesters: [
      { ...BOARD.semesters[0], courses: [{ ...BOARD.semesters[0].courses[0], offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }] },
      BOARD.semesters[1],
    ],
  })} />)
  const card = screen.getByText('קורס לדוגמה').closest('[draggable]')!
  expect(card).toHaveAttribute('draggable', 'true')
  const values = new Map<string, string>()
  const transfer = { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? '', effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(card, { dataTransfer: transfer })
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' }), { dataTransfer: transfer })
  expect(onMove).toHaveBeenCalledWith('C-1', 'year_3_semester_b')
  fireEvent.click(screen.getByText('אפשרויות העברה עבור קורס לדוגמה'))
  fireEvent.click(screen.getByRole('button', { name: 'העבר קורס לדוגמה אל שנה ג׳ — סמסטר ב׳' }))
  expect(onMove).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: 'הסר קורס לדוגמה מהלוח' })).toBeNull()
})

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

test('a movable course without an authoritative offering is not advertised as draggable', () => {
  const boardWithUnknownOffering = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{
          course_id: 'E-UNKNOWN',
          name_he: 'קורס ללא זמינות מאומתת',
          weekly_hours: 3,
          course_type: 'elective',
          is_mandatory: false,
        }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }

  const { container } = render(
    <NativePlannerBoard board={vmFromPayload(boardWithUnknownOffering)} onMoveCourse={jest.fn()} />,
  )

  const card = screen.getByText('קורס ללא זמינות מאומתת').closest('[draggable]')
  expect(card).not.toHaveAttribute('draggable', 'true')
  expect(container.querySelector('[data-drag-handle]')).toBeNull()
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

test('clears the shared drag intent when a valid drop is received', () => {
  const onDragStateChange = jest.fn()
  render(
    <NativePlannerBoard
      board={vmFromPayload(BOARD)}
      onAddCourse={jest.fn()}
      activeDrag={{
        kind: 'repository',
        courseId: '0542-4120',
        allowedSemesterIds: ['year_3_semester_a'],
      }}
      onDragStateChange={onDragStateChange}
    />,
  )

  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), {
    dataTransfer: { getData: () => '', types: [] },
  })

  expect(onDragStateChange).toHaveBeenCalledWith(null)
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
  expect(screen.getByRole('status')).toHaveTextContent('ניתן לשחרר כאן')

  fireEvent.drop(target, { dataTransfer: transfer })
  expect(target).not.toHaveClass('planner-drop-target-active')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('an ineligible repository drag visibly marks the semester as unavailable', () => {
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} onAddCourse={jest.fn()} />)

  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })
  fireEvent.dragOver(target, { dataTransfer: transfer })

  expect(target).toHaveClass('planner-drop-target-invalid')
  expect(within(target).getByRole('status')).toHaveTextContent('לא ניתן לשחרר כאן')
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
  expect(screen.getByRole('status')).toHaveTextContent('ניתן לשחרר כאן')
})

test('a browser that hides drag data during dragover still activates a known repository drop target', () => {
  const transfer = {
    types: [REPOSITORY_COURSE_MIME],
    getData: () => '',
    effectAllowed: '',
    dropEffect: '',
  }
  render(<NativePlannerBoard board={vmFromPayload(BOARD)} onAddCourse={jest.fn()} />)

  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  fireEvent.dragOver(target, { dataTransfer: transfer })

  expect(target).toHaveClass('planner-drop-target-pending')
  expect(screen.getByRole('status')).toHaveTextContent('בודקים אם ניתן לשחרר כאן')
  expect(transfer.dropEffect).toBe('copy')
})

test('uses the repository drag intent when the browser hides data and marks an illegal semester', () => {
  const transfer = {
    types: [REPOSITORY_COURSE_MIME],
    getData: () => '',
    effectAllowed: '',
    dropEffect: '',
  }
  const onAddCourse = jest.fn()
  render(createElement(NativePlannerBoard as any, {
    board: vmFromPayload(BOARD),
    onAddCourse,
    activeDrag: {
      kind: 'repository',
      courseId: '0542-4120',
      allowedSemesterIds: ['year_3_semester_a'],
    },
  }))

  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })
  fireEvent.dragOver(target, { dataTransfer: transfer })

  expect(target).toHaveClass('planner-drop-target-invalid')
  expect(within(target).getByRole('status')).toHaveTextContent('לא ניתן לשחרר כאן')

  fireEvent.drop(target, { dataTransfer: transfer })
  expect(onAddCourse).not.toHaveBeenCalled()
})

test('previews every semester against the active drag before pointer hover', () => {
  render(createElement(NativePlannerBoard as any, {
    board: vmFromPayload(BOARD),
    onAddCourse: jest.fn(),
    activeDrag: {
      kind: 'repository',
      courseId: '0542-4120',
      allowedSemesterIds: ['year_3_semester_a'],
    },
  }))

  const allowedTarget = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  const invalidTarget = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })

  expect(allowedTarget).toHaveClass('planner-drop-target-active')
  expect(invalidTarget).toHaveClass('planner-drop-target-invalid')
  expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([
    '✓ ניתן לשחרר כאן',
    '× לא ניתן לשחרר כאן',
  ])
})

test('drop feedback exposes a distinct visual state for legal and illegal destinations', () => {
  render(createElement(NativePlannerBoard as any, {
    board: vmFromPayload(BOARD),
    onAddCourse: jest.fn(),
    activeDrag: {
      kind: 'repository',
      courseId: '0542-4120',
      allowedSemesterIds: ['year_3_semester_a'],
    },
  }))

  const allowedTarget = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  const invalidTarget = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })

  expect(allowedTarget).toHaveAttribute('data-drop-state', 'allowed')
  expect(invalidTarget).toHaveAttribute('data-drop-state', 'invalid')
  expect(within(allowedTarget).getByRole('status')).toHaveAttribute('data-feedback-state', 'allowed')
  expect(within(allowedTarget).getByRole('status')).toHaveTextContent('✓ ניתן לשחרר כאן')
  expect(within(invalidTarget).getByRole('status')).toHaveAttribute('data-feedback-state', 'invalid')
  expect(within(invalidTarget).getByRole('status')).toHaveTextContent('× לא ניתן לשחרר כאן')
})

test('clears a hovered drop target when the shared drag intent ends', () => {
  const payload = {
    kind: 'repository' as const,
    courseId: '0542-4120',
    allowedSemesterIds: ['year_3_semester_a'],
  }
  const { rerender } = render(
    <NativePlannerBoard
      board={vmFromPayload(BOARD)}
      onAddCourse={jest.fn()}
      activeDrag={payload}
    />,
  )
  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }

  fireEvent.dragOver(target, { dataTransfer: transfer })
  expect(within(target).getByRole('status')).toHaveTextContent('ניתן לשחרר כאן')

  rerender(
    <NativePlannerBoard
      board={vmFromPayload(BOARD)}
      onAddCourse={jest.fn()}
      activeDrag={null}
    />,
  )

  expect(within(target).queryByRole('status')).toBeNull()
  expect(target).not.toHaveClass('planner-drop-target-active')
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
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false, offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }],
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

test('does not hijack a drag that starts on a board card control', () => {
  const electiveBoard = {
    ...BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false, offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }
  const onDragStateChange = jest.fn()
  render(
    <NativePlannerBoard
      board={vmFromPayload(electiveBoard)}
      onMoveCourse={jest.fn()}
      onDragStateChange={onDragStateChange}
    />,
  )

  fireEvent.dragStart(screen.getByText('אפשרויות העברה עבור קורס בחירה'), { dataTransfer: transfer })

  expect(onDragStateChange).not.toHaveBeenCalled()
  expect(transfer.values.size).toBe(0)
})

test('an elective drag source visibly enters and leaves its dragging state', () => {
  const electiveBoard = {
    ...BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false, offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }
  const { container } = render(<NativePlannerBoard board={vmFromPayload(electiveBoard)} onMoveCourse={jest.fn()} />)
  const card = screen.getByText('קורס בחירה').closest('[draggable="true"]') as HTMLElement
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    effectAllowed: '', dropEffect: '',
  }

  fireEvent.dragStart(card, { dataTransfer: transfer })
  expect(container.querySelector('[data-dragging="true"]')).toBe(card)

  fireEvent.dragEnd(card)
  expect(card).not.toHaveAttribute('data-dragging')
})

test('an elective card exposes a clear drag affordance alongside keyboard controls', () => {
  const electiveBoard = {
    ...BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false, offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }

  render(<NativePlannerBoard board={vmFromPayload(electiveBoard)} onMoveCourse={jest.fn()} />)

  expect(screen.getByLabelText('גרור את קורס בחירה לסמסטר אחר')).toHaveTextContent('גרור להעברה')
  expect(screen.getByRole('button', { name: 'העבר קורס בחירה אל שנה ג׳ — סמסטר ב׳' })).toBeInTheDocument()
})

test('the board drag affordance starts a shared move preview before native dragstart', () => {
  const electiveBoard = {
    ...BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'E-1', name_he: 'קורס בחירה', weekly_hours: 3.5, course_type: 'elective', is_mandatory: false, offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
    ],
  }
  const onDragStateChange = jest.fn()
  render(<NativePlannerBoard board={vmFromPayload(electiveBoard)} onMoveCourse={jest.fn()} onDragStateChange={onDragStateChange} />)

  const handle = screen.getByLabelText('גרור את קורס בחירה לסמסטר אחר')
  expect(handle).toHaveAttribute('draggable', 'true')
  fireEvent.pointerDown(handle)

  expect(onDragStateChange).toHaveBeenCalledWith({
    kind: 'board',
    courseId: 'E-1',
    allowedSemesterIds: ['year_3_semester_b'],
  })
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

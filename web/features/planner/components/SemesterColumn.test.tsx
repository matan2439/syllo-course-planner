import { fireEvent, render, screen } from '@testing-library/react'
import SemesterColumn from './SemesterColumn'
import type { SemesterVM } from '../../../lib/board'
import { writeRepositoryDrag } from '../../../lib/planner/drag-payload'

const SEMESTER_FIXTURE: SemesterVM = {
  id: 'year_3_semester_a', title: 'שנה ג׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null,
  warnings: [], courses: [],
}

test('unknown offering is checked by the server on drop instead of silently rejected by the browser', () => {
  const onAddCourse = jest.fn()
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    dropEffect: '',
  }
  writeRepositoryDrag(transfer, 'UNKNOWN-OFFERING')
  render(<SemesterColumn semester={SEMESTER_FIXTURE} index={0} onAddCourse={onAddCourse} />)
  const target = screen.getByLabelText(SEMESTER_FIXTURE.title)
  fireEvent.dragOver(target, { dataTransfer: transfer })
  expect(target).toHaveAttribute('data-drop-state', 'unknown')
  fireEvent.drop(target, { dataTransfer: transfer })
  expect(onAddCourse).toHaveBeenCalledWith('UNKNOWN-OFFERING', SEMESTER_FIXTURE.id)
})

test('an explicitly empty destination list remains unavailable', () => {
  const onAddCourse = jest.fn()
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
    dropEffect: '',
  }
  writeRepositoryDrag(transfer, 'NOT-OFFERED', [])
  render(<SemesterColumn semester={SEMESTER_FIXTURE} index={0} onAddCourse={onAddCourse} />)
  const target = screen.getByLabelText(SEMESTER_FIXTURE.title)
  fireEvent.dragOver(target, { dataTransfer: transfer })
  expect(target).toHaveAttribute('data-drop-state', 'invalid')
  fireEvent.drop(target, { dataTransfer: transfer })
  expect(onAddCourse).not.toHaveBeenCalled()
})

test('a successful placement flashes the target column via data-just-placed, keyed to re-trigger on repeat', () => {
  const { rerender } = render(
    <SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced justPlacedKey={1} />,
  )
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).toHaveAttribute('data-just-placed', 'true')
  rerender(<SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced={false} justPlacedKey={1} />)
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).not.toHaveAttribute('data-just-placed')
})

test('the placement pulse does not remount the column itself — an in-progress drag survives a second placement', () => {
  // The pulse must be a lightweight keyed overlay, not a remount of the whole
  // column: remounting would restart the entrance ".rise" animation and could
  // silently interrupt a native drag in progress in this same column.
  const semesterWithCourse: SemesterVM = {
    ...SEMESTER_FIXTURE,
    courses: [{ id: 'C-1', name: 'קורס לדוגמה', weeklyHours: 3, type: 'elective', difficulty: null, syllabusUrl: null, hasWarnings: false }],
  }
  const { rerender } = render(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced justPlacedKey={1} />)
  const courseNode = screen.getByText('קורס לדוגמה')
  // A second, distinct placement key must not detach and recreate this node —
  // the same DOM element instance must persist across the re-key.
  rerender(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced justPlacedKey={2} />)
  expect(screen.getByText('קורס לדוגמה')).toBe(courseNode)
  rerender(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced={false} justPlacedKey={2} />)
})

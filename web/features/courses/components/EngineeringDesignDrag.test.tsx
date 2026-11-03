import { fireEvent, render, screen } from '@testing-library/react'
import rawBoard from '../../../../data/boards/mechanical_engineering_2027.json'
import { adaptRepository } from '../../../lib/repository'
import type { RawBoard } from '../../../lib/board'
import { readPlannerDrag } from '../../../lib/planner/drag-payload'
import UnifiedCourseRepository from './UnifiedCourseRepository'
import SemesterColumn from '../../planner/components/SemesterColumn'

test('the actual Engineering Design catalog offering reaches Year 3 A through the repository drag payload', () => {
  const full = adaptRepository(rawBoard as unknown as RawBoard)
  const categories = full.categories.map((category) => ({ ...category, courses: category.courses.filter((course) => course.id === '0542-4422') })).filter((category) => category.courses.length)
  const onAdd = jest.fn()
  const targetId = 'year_3_semester_a'
  render(<>
    <UnifiedCourseRepository repo={{ categories, totalCourses: 1 }} selectedCourseIds={[]} onRequestAdd={jest.fn()}
      semesterDestinations={[
        { id: targetId, label: 'שנה ג׳ — סמסטר א׳' },
        { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
        { id: 'year_4_semester_a', label: 'שנה ד׳ — סמסטר א׳' },
      ]} />
    <SemesterColumn index={0} onAddCourse={onAdd} semester={{ id: targetId, title: 'שנה ג׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] }} />
  </>)
  const transfer = {
    values: new Map<string, string>(), effectAllowed: '', dropEffect: '',
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
  }
  fireEvent.dragStart(screen.getByLabelText('גרור את תכן הנדסי: מבוא ושיטות ללוח הסמסטרים'), { dataTransfer: transfer })
  expect(readPlannerDrag(transfer)).toEqual({ kind: 'repository', courseId: '0542-4422', allowedSemesterIds: [targetId, 'year_4_semester_a'] })
  const target = screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })
  fireEvent.dragOver(target, { dataTransfer: transfer })
  expect(target).toHaveAttribute('data-drop-state', 'allowed')
  fireEvent.drop(target, { dataTransfer: transfer })
  expect(onAdd).toHaveBeenCalledWith('0542-4422', targetId)
})

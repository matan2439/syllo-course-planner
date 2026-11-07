import { fireEvent, render, screen } from '@testing-library/react'
import LabCreditFields from './LabCreditFields'

const rules = [{ rule_id: 'labs', kind: 'distinct_categories', course_ids: ['0512-4190', '0512-4290', '0512-4291'],
  params: { same_track_requires_third_lab: true } }]

test('ordinary two-lab selection does not request an exceptional allocation', () => {
  render(<LabCreditFields rules={rules} value={{}} selectedCourseIds={['0512-4190', '0512-4290']}
    courseNames={{}} onChange={jest.fn()} />)
  expect(screen.queryByText('זיכוי שעות עבור מעבדות נוספות')).toBeNull()
})

test('changing the credited pair preserves evidence and identifies the remaining lab as non-theory', () => {
  const onChange = jest.fn()
  render(<LabCreditFields rules={rules} value={{ average: 90, labCreditAllocations: { labs: {
    creditedLabCourseIds: ['0512-4190'], nonTheoryLabCourseIds: ['0512-4290', '0512-4291'], reference: 'Faculty allocation',
  } } }} selectedCourseIds={rules[0].course_ids} courseNames={{}} onChange={onChange} />)
  fireEvent.click(screen.getAllByRole('checkbox')[1])
  expect(onChange).toHaveBeenCalledWith({ average: 90, labCreditAllocations: { labs: {
    creditedLabCourseIds: ['0512-4190', '0512-4290'], nonTheoryLabCourseIds: ['0512-4291'], reference: 'Faculty allocation',
  } } })
})

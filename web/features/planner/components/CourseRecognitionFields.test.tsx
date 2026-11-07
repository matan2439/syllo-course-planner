import { fireEvent, render, screen } from '@testing-library/react'
import CourseRecognitionFields from './CourseRecognitionFields'

const rules = [{ rule_id: 'recognition', kind: 'course_recognition', course_ids: [], params: {} }]
test('adding a recognition report preserves facts and does not grant credit by default', () => {
  const onChange = jest.fn()
  render(<CourseRecognitionFields rules={rules} value={{ average: 90 }} courseNames={{}} onChange={onChange} />)
  const add = screen.getByRole('button', { name: 'הוספת דיווח הכרה' })
  expect(add).toBeDisabled()
  fireEvent.change(screen.getByLabelText('מספר הקורס הנוסף'), { target: { value: '0599-9999' } })
  fireEvent.click(add)
  expect(onChange).toHaveBeenCalledWith({ average: 90, additionalCourseRecognition: { recognition: {
    '0599-9999': expect.objectContaining({ scope: 'out_of_catalog', completed: false, priorApproval: false, useForDegreeCredit: false }),
  } } })
})

test('a future course approval does not request an earned-credit award', () => {
  render(<CourseRecognitionFields rules={rules} value={{ additionalCourseRecognition: { recognition: { '0599-9999': {
    useForDegreeCredit: true, completed: false, priorApproval: true, scope: 'out_of_catalog', approvalReference: '',
    syllabusReference: '', instructorConsentReference: '', officialCourseReference: '',
  } } } }} courseNames={{}} onChange={jest.fn()} />)
  expect(screen.queryByLabelText(/שעות התואר שהוכרו בקורס/)).toBeNull()
  expect(screen.queryByLabelText(/אסמכתה לזיכוי שעות התואר/)).toBeNull()
  expect(screen.getByLabelText(/אסמכתה לאישור ועדת ההוראה/)).toBeInTheDocument()
})

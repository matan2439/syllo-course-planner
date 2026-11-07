import { fireEvent, render, screen } from '@testing-library/react'
import TechnicianExemptionFields from './TechnicianExemptionFields'

const rules = [{ rule_id: 'waiver', kind: 'course_exemption', course_ids: ['0512-3513', '0512-3561'], params: {
  eligible_course_ids_by_credential: { electronics: ['0512-3513', '0512-3561'], computers: ['0512-3561'] },
  credential_labels_he: { electronics: 'אלקטרוניקה ומחשבים', computers: 'מחשבים' },
} }]

test('changing credentials deactivates inapplicable awards while retaining their records', () => {
  const onChange = jest.fn()
  const award = { approved: true, degreeCreditHours: 4, reference: 'University record' }
  render(<TechnicianExemptionFields rules={rules} value={{ average: 90, technicianExemptions: {
    waiver: { credential: 'electronics', awards: { '0512-3513': award } },
  } }} courseNames={{}} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'computers' } })
  expect(onChange).toHaveBeenCalledWith({ average: 90, technicianExemptions: { waiver: {
    credential: 'computers', awards: { '0512-3513': { ...award, approved: false } },
  } } })
})

test('selecting a credential does not default any course to an awarded exemption', () => {
  const onChange = jest.fn()
  render(<TechnicianExemptionFields rules={rules} value={{ technicianExemptions: { waiver: { credential: 'computers' } } }}
    courseNames={{}} onChange={onChange} />)
  expect(screen.getByLabelText(/האוניברסיטה העניקה לי פטור/)).not.toBeChecked()
  expect(screen.queryByLabelText(/שעות התואר שהוכרו/)).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})

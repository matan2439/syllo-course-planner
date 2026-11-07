import { fireEvent, render, screen } from '@testing-library/react'
import OptionalPathwayFields from './OptionalPathwayFields'

const rules = [{ rule_id: 'pathway', kind: 'optional_pathway', course_ids: ['0512-4000'], params: {
  optional_goal: 'power', goal_label_he: 'מסלול זרם חזק', project_course_ids: ['0512-4000'],
  project_domain: 'electrical_installation_design', project_domain_label_he: 'תכנון מתקני חשמל',
} }]

test('choosing an optional pathway preserves unrelated student facts', () => {
  const onChange = jest.fn()
  render(<OptionalPathwayFields rules={rules} value={{ average: 90 }} courseNames={{}} onChange={onChange} />)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(onChange).toHaveBeenCalledWith({ average: 90, optionalGoals: ['power'] })
  expect(screen.queryByRole('combobox')).toBeNull()
})

test('a project report needs a chosen domain and retains a separate reference field', () => {
  const onChange = jest.fn()
  render(<OptionalPathwayFields rules={rules} value={{ optionalGoals: ['power'], projectDomains: {
    '0512-4000': { domain: 'electrical_installation_design', reference: '' },
  } }} courseNames={{ '0512-4000': 'פרויקט גמר' }} onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Project approval record' } })
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ projectDomains: {
    '0512-4000': { domain: 'electrical_installation_design', reference: 'Project approval record' },
  } }))
})

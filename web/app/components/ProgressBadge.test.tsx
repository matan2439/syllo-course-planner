import { render, screen, fireEvent } from '@testing-library/react'
import ProgressBadge from './ProgressBadge'
import type { RequirementsVM } from '../../lib/requirements'

const VM: RequirementsVM = {
  valid: false, plannedHours: 128.5, totalRequiredHours: 185, remainingHours: 56.5,
  core: { selected: 0, min: 6, satisfied: false },
  categories: [{ id: 'fluids', title: 'זורמים', minCourses: 1, selectedCount: 0, satisfied: false, missingCount: 1 }],
  warnings: [], explanation: null,
}

test('shows the hours summary collapsed, and expands the category breakdown on click', () => {
  render(<ProgressBadge requirements={VM} />)
  expect(screen.getByText('128.5/185 ש״ש')).toBeInTheDocument()
  expect(screen.queryByText('זורמים')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /התקדמות בתוכנית/ }))
  expect(screen.getByText('זורמים')).toBeInTheDocument()
})

test('renders nothing when there is no requirements data', () => {
  const { container } = render(<ProgressBadge requirements={null} />)
  expect(container).toBeEmptyDOMElement()
})

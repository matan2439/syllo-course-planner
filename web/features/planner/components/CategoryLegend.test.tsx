import { render, screen } from '@testing-library/react'
import CategoryLegend from './CategoryLegend'

test('renders one chip per category, including mandatory', () => {
  render(<CategoryLegend />)
  expect(screen.getByText('חובה')).toBeInTheDocument()
  expect(screen.getByText('זורמים')).toBeInTheDocument()
  expect(screen.getByText('מוצקים')).toBeInTheDocument()
  expect(screen.getByText('מערכות')).toBeInTheDocument()
  expect(screen.getByText('מעבדה')).toBeInTheDocument()
})

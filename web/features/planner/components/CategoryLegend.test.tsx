import { render, screen } from '@testing-library/react'
import CategoryLegend from './CategoryLegend'
import { categoryAccentColor } from '../../courses/components/course-category'

test('uses the selected degree categories and their course accents', () => {
  const { container } = render(<CategoryLegend categories={[
    { id: 'communications', title: 'תקשורת' },
    { id: 'signal_processing', title: 'עיבוד אותות' },
  ]} />)
  expect(screen.getByText('חובה')).toBeInTheDocument()
  expect(screen.queryByText('זורמים')).not.toBeInTheDocument()
  expect(screen.getByText('תקשורת').firstElementChild).toHaveStyle({ background: categoryAccentColor('communications') })
  expect(new Set(Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden=true]'), el => el.style.background)).size).toBe(3)
})

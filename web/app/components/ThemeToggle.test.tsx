import { fireEvent, render, screen } from '@testing-library/react'
import ThemeToggle from './ThemeToggle'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
})

test('toggles the explicit theme and persists it for the shell and legacy planner', () => {
  render(<ThemeToggle />)
  const button = screen.getByRole('button', { name: 'מעבר למצב לילה' })
  fireEvent.click(button)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('tau_theme')).toBe('dark')
  expect(screen.getByRole('button', { name: 'מעבר למצב יום' })).toHaveTextContent('יום')
})

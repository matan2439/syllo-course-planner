import { render, screen } from '@testing-library/react'
import LandingCtas from './LandingCtas'
import { LAST_PROGRAM_KEY } from '../last-program'

beforeEach(() => localStorage.clear())

test('a first visit starts with program choice and offers the default plan as the secondary link', () => {
  render(<LandingCtas />)
  expect(screen.getByRole('link', { name: 'בנו תוכנית' })).toHaveAttribute('href', '/programs')
  expect(screen.getByRole('link', { name: 'המשך לתוכנית שלי' })).toHaveAttribute('href', '/planner')
})

test('a returning student goes straight back to the remembered program', async () => {
  localStorage.setItem(LAST_PROGRAM_KEY, 'mechanical_engineering_2025')
  render(<LandingCtas />)
  expect(await screen.findByRole('link', { name: 'המשך לתוכנית שלי' }))
    .toHaveAttribute('href', '/planner?program=mechanical_engineering_2025')
  expect(screen.getByRole('link', { name: 'בחירת תוכנית אחרת' })).toHaveAttribute('href', '/programs')
})

test('an unknown remembered id is ignored', () => {
  localStorage.setItem(LAST_PROGRAM_KEY, 'not_a_program')
  render(<LandingCtas />)
  expect(screen.getByRole('link', { name: 'בנו תוכנית' })).toBeInTheDocument()
})

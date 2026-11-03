import { act, fireEvent, render, screen } from '@testing-library/react'
import SiteTour, { startTour, TOUR_DONE_KEY } from './SiteTour'

const steps = [
  { title: ['ראשון', 'First'] as [string, string], body: ['א', 'a'] as [string, string] },
  { target: '#missing', title: ['שני', 'Second'] as [string, string], body: ['ב', 'b'] as [string, string], prepare: jest.fn() },
]

beforeEach(() => localStorage.clear())

test('opt-in tour walks Next/Back, prepares steps, and remembers completion', () => {
  render(<SiteTour steps={steps} />)
  expect(screen.queryByRole('dialog')).toBeNull() // never auto-starts
  act(() => startTour())
  expect(screen.getByRole('dialog', { name: 'ראשון' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'הקודם' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
  expect(screen.getByRole('dialog', { name: 'שני' })).toBeInTheDocument()
  expect(steps[1].prepare).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'הקודם' }))
  expect(screen.getByRole('dialog', { name: 'ראשון' })).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' }) // RTL: left = forward
  fireEvent.click(screen.getByRole('button', { name: 'סיום' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(localStorage.getItem(TOUR_DONE_KEY)).toBe('1')
})

test('Skip and Escape end the tour', () => {
  render(<SiteTour steps={steps} />)
  act(() => startTour())
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => startTour())
  fireEvent.click(screen.getByRole('button', { name: 'דלג' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

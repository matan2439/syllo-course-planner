/**
 * K9C — the evidence-backed explanation surface.
 *
 * Asserts it shows exactly what was grounded, hides source detail behind an
 * accessible disclosure, and never makes a claim the evidence cannot support.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import GroundedExplanation from './GroundedExplanation'

const SOURCE = 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379200&year=2025'
const props = {
  explanationHe:
    'לפי ההעדפה שאישרת (קורסים עם מעבדה), התוכנית הנבחרת כוללת 1 קורס/ים עם רכיב מעבדה: E3.',
  sources: [{ courseId: 'E3', sourceRef: SOURCE, academicYear: 2025 }],
  coverage: { coveredCourseCount: 3, requestedCourseCount: 4, unknownCourseIds: ['E4'] },
}

test('renders nothing when no grounded objective applied', () => {
  const { container } = render(<GroundedExplanation />)
  expect(container).toBeEmptyDOMElement()
})

test('shows the factual explanation of which preference influenced the selection', () => {
  render(<GroundedExplanation {...props} />)
  expect(screen.getByText(/ההעדפה שאישרת/)).toBeInTheDocument()
  expect(screen.getByText(/מעבדה/)).toBeInTheDocument()
})

test('source details are behind an accessible disclosure, collapsed by default', () => {
  render(<GroundedExplanation {...props} />)
  const toggle = screen.getByRole('button', { name: 'הצג מקורות' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(new RegExp(SOURCE.slice(0, 30)))).not.toBeInTheDocument()

  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('region', { name: 'מקורות רשמיים' })).toBeInTheDocument()
})

test('the disclosure names the official source and the applicable academic year', () => {
  render(<GroundedExplanation {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'הצג מקורות' }))
  expect(screen.getByText(/סילבוס רשמי, שנת 2025/)).toBeInTheDocument()
  expect(screen.getByText(new RegExp('ims\\.tau\\.ac\\.il'))).toBeInTheDocument()
})

test('coverage limits are disclosed, and missing data is never read as "no laboratory"', () => {
  render(<GroundedExplanation {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'הצג מקורות' }))
  expect(screen.getByText(/3 מתוך 4/)).toBeInTheDocument()
  expect(screen.getByText(/היעדר מידע אינו מעיד שאין בהם מעבדה/)).toBeInTheDocument()
})

test('makes no unsupported claim about quality, difficulty, workload or career', () => {
  render(<GroundedExplanation {...props} />)
  const text = document.body.textContent ?? ''
  for (const forbidden of ['טוב יותר', 'קל יותר', 'מומלץ יותר', 'שכר', 'קריירה']) {
    expect(text).not.toContain(forbidden)
  }
})

test('the toggle is keyboard operable and carries meaning as TEXT, not colour', () => {
  render(<GroundedExplanation {...props} />)
  const toggle = screen.getByRole('button', { name: 'הצג מקורות' })
  // A real <button> is used (not a div), so Enter/Space activation and focus
  // come from the platform rather than from hand-rolled key handling.
  toggle.focus()
  expect(toggle).toHaveFocus()
  expect(toggle.tagName).toBe('BUTTON')
  fireEvent.click(toggle)
  expect(screen.getByRole('button', { name: 'הסתר מקורות' })).toBeInTheDocument()
})

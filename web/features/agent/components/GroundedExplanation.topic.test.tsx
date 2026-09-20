/**
 * W3 — the explanation for a TOPIC-grounded proposal.
 *
 * The component already renders whatever factual sentence the server produced.
 * The defect this suite pins is the disclosure block's own coverage sentence,
 * which was hard-coded to the DELIVERY objective ("missing data does not mean
 * the course has no laboratory"). On a topic-grounded proposal that sentence
 * describes the wrong fact entirely, so the limitation must follow the
 * objective that actually applied.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import GroundedExplanation from './GroundedExplanation'

/** The sentence the server produces for a confirmed topic interest. */
const TOPIC_EXPLANATION =
  'לפי תחומי התוכן שאישרת (רובוטיקה), התוכנית הנבחרת כוללת 1 קורס/ים שהתוכן הרשמי שלהם מציין אותם: 0542-4624 (רובוטיקה).' +
  ' המקור: שדה "תוכן הקורס ומטרתו" בסילבוס הרשמי (https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=054246240122&year=2025, שנת 2025).'

const props = {
  explanationHe: TOPIC_EXPLANATION,
  sources: [{ courseId: '0542-4624', sourceRef: 'https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=054246240122&year=2025', academicYear: 2025 }],
  coverage: { coveredCourseCount: 3, requestedCourseCount: 4, unknownCourseIds: ['E4'] },
  objectiveKind: 'topic' as const,
}

describe('W3 — a topic-grounded explanation', () => {
  test('it states the confirmed interest, the course, the source and the year', () => {
    render(<GroundedExplanation {...props} />)
    expect(screen.getByText(/רובוטיקה/)).toBeInTheDocument()
    expect(screen.getByText(/0542-4624/)).toBeInTheDocument()
    expect(screen.getByText(/תוכן הקורס ומטרתו/)).toBeInTheDocument()
    expect(screen.getByText(/2025/)).toBeInTheDocument()
  })

  test('the coverage limitation is about CONTENT, never about laboratories', () => {
    render(<GroundedExplanation {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'הצג מקורות' }))
    expect(screen.queryByText(/אין בהם מעבדה/)).not.toBeInTheDocument()
    expect(screen.queryByText(/אופן ההוראה/)).not.toBeInTheDocument()
    expect(screen.getByText(/היעדר אזכור בתוכן הרשמי אינו מעיד שהנושא אינו נלמד/)).toBeInTheDocument()
  })

  test('the DELIVERY wording is unchanged when that objective applied', () => {
    render(<GroundedExplanation {...props} objectiveKind="delivery" />)
    fireEvent.click(screen.getByRole('button', { name: 'הצג מקורות' }))
    expect(screen.getByText(/היעדר מידע אינו מעיד שאין בהם מעבדה/)).toBeInTheDocument()
  })

  test('it makes no superiority, career, difficulty or workload claim', () => {
    const { container } = render(<GroundedExplanation {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'הצג מקורות' }))
    expect(container.textContent).not.toMatch(
      /טוב יותר|מומלץ יותר|מתאים לקריירה|קל יותר|עומס נמוך|תלמד/,
    )
  })

  test('source detail sits behind an accessible disclosure', () => {
    render(<GroundedExplanation {...props} />)
    const toggle = screen.getByRole('button', { name: 'הצג מקורות' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls')
    expect(screen.queryByRole('region', { name: 'מקורות רשמיים' })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'הסתר מקורות' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'מקורות רשמיים' })).toBeInTheDocument()
  })

  test('with no explanation nothing is rendered at all', () => {
    const { container } = render(<GroundedExplanation objectiveKind="topic" />)
    expect(container).toBeEmptyDOMElement()
  })
})

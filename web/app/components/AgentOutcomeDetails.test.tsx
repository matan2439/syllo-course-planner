/**
 * Slice 9 — behavioral tests for AgentOutcomeDetails progressive disclosure:
 * every structured outcome, plus opening and closing the details region.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import AgentOutcomeDetails from './AgentOutcomeDetails'
import type { AgentClarificationItemVM, AgentValidationFindingVM } from '../../../shared/planner/model'

const answerable: AgentClarificationItemVM = {
  reasonCode: 'completed_courses', kind: 'answerable_preference',
  messageHe: 'אילו קורסים כבר השלמת?', answerable: true, applyBlocked: true, answerType: 'course_ids',
}
const conflictItem: AgentClarificationItemVM = {
  reasonCode: 'GROUNDING_AVAILABILITY_CONFLICT', kind: 'authoritative_conflict',
  messageHe: 'סתירת זמינות', answerable: false, applyBlocked: true, courseIds: ['CORE'],
}
const finding: AgentValidationFindingVM = {
  code: 'GROUNDING_AVAILABILITY_CONFLICT', courseId: 'CORE', messageHe: 'סתירת זמינות',
  detail: 'catalog [a] vs normalized [b]', provenance: { source: 'catalog', dataQuality: 'normalized', confidence: 0.8 },
}

test('renders nothing for a clean proposal', () => {
  const { container } = render(<AgentOutcomeDetails outcome="proposal" />)
  expect(container).toBeEmptyDOMElement()
})

test('clarification_required: details are collapsed, then open to show an answerable question', () => {
  render(<AgentOutcomeDetails outcome="clarification_required" clarificationItems={[answerable]} />)
  const toggle = screen.getByRole('button', { name: 'הצג פרטים' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('region')).toBeNull()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('region', { name: 'פרטי מצב ההצעה' })).toBeInTheDocument()
  expect(screen.getByText('אילו קורסים כבר השלמת?')).toBeInTheDocument()
  expect(screen.getByText(/ניתן לענות/)).toBeInTheDocument()
})

test('localizes server clarification text and links the required answer to its real control', () => {
  render(<AgentOutcomeDetails outcome="clarification_required" clarificationItems={[{
    reasonCode: 'excluded_courses', kind: 'answerable_preference',
    messageHe: 'Are there any courses you want to exclude from your plan?',
    answerable: true, applyBlocked: true, answerType: 'course_id_list',
  }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'הצג פרטים' }))
  expect(screen.getByText('האם יש קורסים שברצונך להחריג מהתוכנית?')).toBeInTheDocument()
  expect(screen.queryByText(/Are there any courses/)).toBeNull()
  expect(screen.getByRole('link', { name: 'עדכון קורסים להחרגה' }))
    .toHaveAttribute('href', '#excluded-courses-control')
  expect(screen.getByText('התשובה נדרשת לפני החלת התוכנית.')).toBeInTheDocument()
})

test('clarification with an authoritative conflict item is marked NON-answerable', () => {
  render(<AgentOutcomeDetails outcome="clarification_required" clarificationItems={[conflictItem]} />)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText(/דרושה הכרעה סמכותית/)).toBeInTheDocument()
  expect(screen.getByText(/CORE/)).toBeInTheDocument()
})

test('validation_failed: shows both facts, provenance, and the Apply-unavailable explanation', () => {
  render(<AgentOutcomeDetails outcome="validation_failed" validationFindings={[finding]} />)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText(/catalog \[a\] vs normalized \[b\]/)).toBeInTheDocument()
  expect(screen.getByText(/מקור:/)).toBeInTheDocument() // provenance source line
  expect(screen.getByText(/לא ניתן להחיל את התוכנית עד שתתקבל הכרעה סמכותית/)).toBeInTheDocument()
})

test('blocked: lists the blocking reasons', () => {
  render(<AgentOutcomeDetails outcome="blocked" errors={['סמסטר עמוס מדי — לא ניתן להחיל את התוכנית.']} />)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByLabelText('סיבות חסימה')).toBeInTheDocument()
  expect(screen.getByText(/סמסטר עמוס מדי/)).toBeInTheDocument()
})

test('error: shows a safe message with no diagnostics, and can be closed again', () => {
  render(<AgentOutcomeDetails outcome="error" />)
  const toggle = screen.getByRole('button')
  fireEvent.click(toggle)
  expect(screen.getByText(/אירעה שגיאה פנימית/)).toBeInTheDocument()
  expect(screen.getByText(/לא בוצע שינוי בתוכנית הנוכחית/)).toBeInTheDocument()
  fireEvent.click(toggle) // close
  expect(screen.queryByRole('region')).toBeNull()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

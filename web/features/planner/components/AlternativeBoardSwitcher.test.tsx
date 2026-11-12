import { fireEvent, render, screen, within } from '@testing-library/react'
import AlternativeBoardSwitcher from './AlternativeBoardSwitcher'

const alternative = (candidateId: string, labelHe: string) => ({
  candidateId,
  normalizedIdentity: candidateId,
  recommended: candidateId === 'a',
  applyable: true,
  semesters: [],
  constraintFingerprint: 'cf',
  profileVersion: 1,
  snapshotId: 'snap',
  nonDominated: true,
  composedUtility: 0,
  objectiveScores: [],
  labelHe,
  differencesHe: [],
  workload: { peakHours: 4, totalHours: 8, activePeriods: 2 },
})

test('each button shows only the alternative name; its courses live in the expandable details', () => {
  const onSelect = jest.fn()
  const alternatives = [
    { ...alternative('a', 'עומס מאוזן'), semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['c-1'] }] },
    { ...alternative('b', 'סיום מהיר'), semesters: [{ semesterId: 'year_3_semester_b', courseIds: ['c-2'] }] },
  ]
  render(<AlternativeBoardSwitcher alternatives={alternatives} selectedId="a" onSelect={onSelect} courseNameById={{ 'c-1': 'מבוא למערכות', 'c-2': 'תכנון מתקדם' }} />)
  expect(screen.getByTestId('alternative-board-switcher')).toHaveTextContent('בחרו חלופה להצגה על הלוח')
  const first = screen.getByRole('radio', { name: /עומס מאוזן/ })
  expect(first).toHaveAttribute('aria-checked', 'true')
  expect(first).toHaveTextContent(/^✓ חלופה א׳ · עומס מאוזן$/)
  expect(first).not.toHaveTextContent('מבוא למערכות')
  expect(first).toHaveClass('truncate', 'max-w-full') // long names never overflow a phone
  const second = screen.getByRole('radio', { name: /סיום מהיר/ })
  expect(second).toHaveTextContent(/^חלופה ב׳ · סיום מהיר$/)
  expect(second).not.toHaveTextContent('תכנון מתקדם')
  // The shown alternative's courses are in the details section, not in a button.
  const preview = screen.getByTestId('alternative-preview-a')
  expect(preview).toHaveAttribute('aria-label', 'תצוגת לוח: חלופה א׳ · עומס מאוזן')
  expect(preview.closest('details')).not.toBeNull()
  expect(within(preview).getByText('מבוא למערכות')).toBeInTheDocument()
  expect(within(preview).getByText('שנה ג׳ — סמסטר א׳')).toBeInTheDocument()
  fireEvent.click(second)
  expect(onSelect).toHaveBeenCalledWith('b')
})

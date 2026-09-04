import { fireEvent, render, screen } from '@testing-library/react'
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

test('renders alternatives as board modes with semester course previews', () => {
  const onSelect = jest.fn()
  const alternatives = [
    { ...alternative('a', 'עומס מאוזן'), semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['c-1'] }] },
    { ...alternative('b', 'סיום מהיר'), semesters: [{ semesterId: 'year_3_semester_b', courseIds: ['c-2'] }] },
  ]
  render(<AlternativeBoardSwitcher alternatives={alternatives} selectedId="a" onSelect={onSelect} courseNameById={{ 'c-1': 'מבוא למערכות', 'c-2': 'תכנון מתקדם' }} />)
  expect(screen.getByTestId('alternative-board-switcher')).toHaveTextContent('בחרו חלופה להצגה על הלוח')
  expect(screen.getByRole('radio', { name: /עומס מאוזן/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: /עומס מאוזן/ })).toHaveTextContent('מבוא למערכות')
  expect(screen.getByRole('radio', { name: /עומס מאוזן/ })).toHaveTextContent('שנה ג׳ — סמסטר א׳')
  expect(screen.getByRole('radio', { name: /סיום מהיר/ })).toHaveTextContent('תכנון מתקדם')
  fireEvent.click(screen.getByRole('radio', { name: /סיום מהיר/ }))
  expect(onSelect).toHaveBeenCalledWith('b')
})

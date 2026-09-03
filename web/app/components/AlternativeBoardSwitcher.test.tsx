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

test('renders alternatives as board modes instead of a text-only plan list', () => {
  const onSelect = jest.fn()
  render(<AlternativeBoardSwitcher alternatives={[alternative('a', 'עומס מאוזן'), alternative('b', 'סיום מהיר')]} selectedId="a" onSelect={onSelect} />)
  expect(screen.getByTestId('alternative-board-switcher')).toHaveTextContent('בחרו חלופה להצגה על הלוח')
  expect(screen.getByRole('radio', { name: /עומס מאוזן/ })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('radio', { name: /סיום מהיר/ }))
  expect(onSelect).toHaveBeenCalledWith('b')
})

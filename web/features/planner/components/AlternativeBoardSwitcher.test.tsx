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

test('each button shows the alternative name and workload; its courses live in the expandable details', () => {
  const onSelect = jest.fn()
  const alternatives = [
    { ...alternative('a', 'עומס מאוזן'), semesters: [{ semesterId: 'year_3_semester_a', courseIds: ['c-1'] }] },
    { ...alternative('b', 'סיום מהיר'), semesters: [{ semesterId: 'year_3_semester_b', courseIds: ['c-2'] }] },
  ]
  render(<AlternativeBoardSwitcher alternatives={alternatives} selectedId="a" onSelect={onSelect} courseNameById={{ 'c-1': 'מבוא למערכות', 'c-2': 'תכנון מתקדם' }} />)
  expect(screen.getByTestId('alternative-board-switcher')).toHaveTextContent('בחרו חלופה להצגה על הלוח')
  const first = screen.getByRole('radio', { name: /עומס מאוזן/ })
  expect(first).toHaveAttribute('aria-checked', 'true')
  // Card shows name + workload badge; courses never appear inside the button
  expect(first).toHaveTextContent('✓ חלופה א׳ · עומס מאוזן')
  expect(first).toHaveTextContent('4 ש״ש שיא · 2 סמסטרים')
  expect(first).not.toHaveTextContent('מבוא למערכות')
  const second = screen.getByRole('radio', { name: /סיום מהיר/ })
  expect(second).toHaveTextContent('חלופה ב׳ · סיום מהיר')
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

test('quality differences (specialization, prerequisite warnings, unverified data, progress) render with their own marker', () => {
  const diffs = [
    { kind: 'specialization' as const, textHe: '3 קורסים התואמים את תחום ההתמקדות לעומת 1' },
    { kind: 'prerequisite_warnings' as const, textHe: '0 אזהרות דרישות קדם רשמיות לעומת 2 (אזהרה בלבד, לא חסימה)' },
    { kind: 'unverified_prerequisites' as const, textHe: '1 קורסים עם דרישות קדם שלא אומתו לעומת 0' },
    { kind: 'progress' as const, textHe: '185 מתוך 185 ש״ש לתואר לעומת 183' },
  ]
  const alternatives = [alternative('a', 'מומלצת'), { ...alternative('b', 'התמקדות'), differences: diffs, differencesHe: diffs.map((d) => d.textHe) }]
  render(<AlternativeBoardSwitcher alternatives={alternatives} selectedId="b" onSelect={jest.fn()} courseNameById={{}} />)
  const list = screen.getByLabelText('הבדלים מול ההצעה המומלצת')
  for (const d of diffs) expect(within(list).getByText(d.textHe)).toBeInTheDocument()
  expect(list).toHaveTextContent('🎯')
  expect(list).toHaveTextContent('⚠️')
})

/**
 * K9C browser defect — the grounded question must surface once the server
 * reports that answering it could change the selected plan.
 *
 * Found during Preview acceptance: the impact signal only becomes available
 * AFTER the first Build (it is computed from the retained candidates), but the
 * conversation re-selected its current question only when `irrelevantTopicIds`
 * changed. So the grounded topic could never appear in a real browser, even
 * though the server was publishing the signal correctly.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import PreferenceConversation from './PreferenceConversation'
import type { ElicitationContext } from '../../../api/ai/preference_elicitation'

const impactful: ElicitationContext['groundedFeatureImpact'] = {
  feature: 'practical_laboratory',
  distinguishesCandidates: true,
  coverageSufficient: true,
  hasConflicts: false,
}

/** Answer the higher-impact topics so the grounded one is next in line. */
function answerHigherImpactTopics() {
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' }))
  fireEvent.click(screen.getByRole('button', { name: 'עדיף להימנע מבוקר' }))
}

test('the grounded question appears when the impact signal arrives after the first Build', () => {
  const { rerender } = render(
    <PreferenceConversation onBuild={() => {}} elicitationContext={{}} />,
  )
  answerHigherImpactTopics()
  // Before the signal exists the grounded topic must NOT be asked.
  expect(screen.queryByText(/מעבדה או עבודה מעשית/)).not.toBeInTheDocument()

  // The first Build returns the impact probe — the question must now surface.
  rerender(
    <PreferenceConversation onBuild={() => {}} elicitationContext={{ groundedFeatureImpact: impactful }} />,
  )
  expect(screen.getByRole('button', { name: /מעדיף\/ה קורסים עם מעבדה/ })).toBeInTheDocument()
})

test('a NON-distinguishing impact signal does not surface the question', () => {
  const { rerender } = render(
    <PreferenceConversation onBuild={() => {}} elicitationContext={{}} />,
  )
  answerHigherImpactTopics()
  rerender(
    <PreferenceConversation
      onBuild={() => {}}
      elicitationContext={{ groundedFeatureImpact: { ...impactful, distinguishesCandidates: false } }}
    />,
  )
  expect(screen.queryByRole('button', { name: /מעדיף\/ה קורסים עם מעבדה/ })).not.toBeInTheDocument()
})

test('mixed/conflicting evidence does not surface the question', () => {
  const { rerender } = render(
    <PreferenceConversation onBuild={() => {}} elicitationContext={{}} />,
  )
  answerHigherImpactTopics()
  rerender(
    <PreferenceConversation
      onBuild={() => {}}
      elicitationContext={{ groundedFeatureImpact: { ...impactful, hasConflicts: true } }}
    />,
  )
  expect(screen.queryByRole('button', { name: /מעדיף\/ה קורסים עם מעבדה/ })).not.toBeInTheDocument()
})

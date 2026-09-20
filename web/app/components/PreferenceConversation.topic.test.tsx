/**
 * W2 — the impact-driven course CONTENT/TOPIC question in the real conversation.
 *
 * The server is authoritative about what is impactful: this component must ask
 * only what `topicInterestImpact` says can change the selected plan, and must
 * offer only the topics that do the separating. It must never decide a topic is
 * interesting merely because it exists in the vocabulary.
 *
 * Written RED first: before W2 the conversation received no topic signal at all.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import PreferenceConversation from './PreferenceConversation'
import type { ElicitationContext } from '../../../api/ai/preference_elicitation'

/** Exactly the shape the server publishes — see shared/planner/model.ts. */
const impactful: NonNullable<ElicitationContext['topicInterestImpact']> = {
  category: 'course_topic_interest',
  distinguishesCandidates: true,
  distinguishingTopics: ['robotics', 'control'],
  coverageSufficient: true,
  hasConflicts: false,
}

const ctx = (over: Partial<typeof impactful> | null = {}): ElicitationContext =>
  over === null ? {} : { topicInterestImpact: { ...impactful, ...over } }

/** Answer the higher-impact topics so the topic question is next in line. */
function answerHigherImpactTopics() {
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' }))
  fireEvent.click(screen.getByRole('button', { name: 'עדיף להימנע מבוקר' }))
}

function mount(initial: ElicitationContext = {}) {
  const onBuild = jest.fn()
  const view = render(<PreferenceConversation onBuild={onBuild} elicitationContext={initial} />)
  answerHigherImpactTopics()
  return { ...view, onBuild }
}

const TOPIC_QUESTION = /יש תחום תוכן שמעניין אותך במיוחד/

describe('W2 — the topic question surfaces only on a real server signal', () => {
  test('it appears once the impact signal arrives after the first Build', () => {
    const { rerender } = mount()
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()

    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    expect(screen.getByText(TOPIC_QUESTION)).toBeInTheDocument()
  })

  test('ONLY the distinguishing topics are offered, with Hebrew labels', () => {
    const { rerender } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)

    expect(screen.getByRole('button', { name: 'רובוטיקה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בקרה ומערכות' })).toBeInTheDocument()
    // Present in official evidence but shared by every candidate, or absent
    // from the corpus entirely — the server excluded them, so they must not
    // appear merely because they exist in the vocabulary.
    for (const absent of ['תכן ועיצוב הנדסי', 'ייצור ותהליכי עיבוד', 'זרימה, אנרגיה ומעבר חום', 'מכניקת מוצקים']) {
      expect(screen.queryByRole('button', { name: absent })).not.toBeInTheDocument()
    }
  })

  test('no internal topic id is ever rendered', () => {
    const { rerender, container } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    for (const id of ['robotics', 'control', 'engineering_design', 'solid_mechanics']) {
      expect(container.textContent).not.toContain(id)
    }
  })

  test.each([
    ['no signal at all', null],
    ['candidates do not differ', { distinguishesCandidates: false }],
    ['coverage is insufficient', { coverageSufficient: false }],
    ['an authoritative conflict is open', { hasConflicts: true }],
    ['no topic separates anything', { distinguishingTopics: [] }],
  ])('SUPPRESSED when %s', (_label, over) => {
    const { rerender } = mount()
    rerender(
      <PreferenceConversation onBuild={() => {}} elicitationContext={ctx(over as never)} />,
    )
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })

  test('it is RETRACTED when a later Build reports the candidates converged', () => {
    const { rerender } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    expect(screen.getByText(TOPIC_QUESTION)).toBeInTheDocument()

    rerender(
      <PreferenceConversation
        onBuild={() => {}}
        elicitationContext={ctx({ distinguishesCandidates: false, distinguishingTopics: [] })}
      />,
    )
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })
})

describe('W2 — answering never plans, and is recorded understandably', () => {
  test('choosing a topic does NOT Generate', () => {
    const onBuild = jest.fn()
    const { rerender } = render(<PreferenceConversation onBuild={onBuild} elicitationContext={{}} />)
    answerHigherImpactTopics()
    rerender(<PreferenceConversation onBuild={onBuild} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    expect(onBuild).not.toHaveBeenCalled()
  })

  test('choosing INDIFFERENT does not Generate and stops the question returning', () => {
    const onBuild = jest.fn()
    const { rerender } = render(<PreferenceConversation onBuild={onBuild} elicitationContext={{}} />)
    answerHigherImpactTopics()
    rerender(<PreferenceConversation onBuild={onBuild} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'לא משנה לי' }))
    expect(onBuild).not.toHaveBeenCalled()
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()

    // Even with the signal still impactful, an answered topic is not re-asked.
    rerender(<PreferenceConversation onBuild={onBuild} elicitationContext={ctx()} />)
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })

  test('an answered topic is not re-asked', () => {
    const { rerender } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })

  test('the captured answer reads as Hebrew, never as an internal id', () => {
    const { rerender } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))

    const summary = screen.getByRole('region', { name: 'מה הבנתי ממך' })
    expect(summary).toHaveTextContent('רובוטיקה')
    expect(summary.textContent).not.toContain('robotics')
  })

  test('removing the captured answer does NOT Generate', () => {
    const onBuild = jest.fn()
    const { rerender } = render(<PreferenceConversation onBuild={onBuild} elicitationContext={{}} />)
    answerHigherImpactTopics()
    rerender(<PreferenceConversation onBuild={onBuild} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    fireEvent.click(screen.getByRole('button', { name: 'הסר רובוטיקה' }))
    expect(onBuild).not.toHaveBeenCalled()
  })

  test('the answer reaches the built profile as the normalized topic id', () => {
    let profile: unknown = null
    const { rerender } = render(
      <PreferenceConversation onBuild={(p) => { profile = p }} elicitationContext={{}} />,
    )
    answerHigherImpactTopics()
    rerender(
      <PreferenceConversation onBuild={(p) => { profile = p }} elicitationContext={ctx()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))

    const prefs = (profile as { preferences: Array<Record<string, unknown>> }).preferences
    const topic = prefs.find((p) => p.id === 'course_topic_interest')!
    expect(topic.normalized).toBe('robotics')
    expect(topic.affects).toBe('grounded_topic_interest')
    expect(topic.classification).toBe('soft_preference')
  })
})

/**
 * Browser-acceptance defect (Preview check 10): choosing "לא משנה לי" rendered
 * the row as `indifferent (לא משנה)` — the INTERNAL token as the primary label.
 *
 * Root cause: an indifferent answer is stored as `normalized: 'indifferent'`
 * with `value: null`, so no catalog option matches and `labelForPreference`
 * fell through to `String(p.normalized)`. This affects EVERY question, not just
 * the topic one, so both are pinned here.
 */
describe('W2 defect — an indifferent answer never renders its internal token', () => {
  test('the topic row names the subject in Hebrew, not "indifferent"', () => {
    const { rerender } = mount()
    rerender(<PreferenceConversation onBuild={() => {}} elicitationContext={ctx()} />)
    fireEvent.click(screen.getByRole('button', { name: 'לא משנה לי' }))

    const summary = screen.getByRole('region', { name: 'מה הבנתי ממך' })
    expect(summary.textContent).not.toContain('indifferent')
    expect(summary).toHaveTextContent('תחום תוכן')
  })

  test('an indifferent answer to a NON-topic question is also named in Hebrew', () => {
    render(<PreferenceConversation onBuild={() => {}} elicitationContext={{}} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'לא משנה לי' })[0])

    const summary = screen.getAllByRole('region', { name: 'מה הבנתי ממך' })[0]
    expect(summary.textContent).not.toContain('indifferent')
  })
})

/**
 * Deterministic multi-turn scenarios over the REAL conversation state machine and impact-gated
 * elicitation. They prove the rules encoded in code. They do NOT prove real-model conversational
 * quality (the live agent's wording, follow-up choice and tone are not exercised here).
 *
 */
import {
  answerQuestion, confirmPending, initConversation, isProposalStale, markPlanning, markProposalReady,
  removeCapturedPreference, reviseAnswer, type ConversationState,
} from '../../api/ai/conversation_state'
import { DEFAULT_QUESTION_CATALOG, DeterministicPreferenceElicitation, type ElicitationContext } from '../../api/ai/preference_elicitation'

const elicit = new DeterministicPreferenceElicitation()
const ids = (s: ConversationState) => s.profile.preferences.map((p) => p.id)

describe('question selection', () => {
  test('a new student with a legal, undifferentiated request is asked about workload first (highest impact)', () => {
    const s = initConversation(elicit, {})
    expect(s.status).toBe('question_pending')
    expect(s.currentQuestion?.id).toBe('workload_target')
  })

  test('asks one question at a time and never repeats an answered topic', () => {
    let s = initConversation(elicit, {})
    const asked: string[] = []
    for (let i = 0; i < 10 && s.currentQuestion; i++) {
      asked.push(s.currentQuestion.id)
      s = answerQuestion(s, { kind: 'choice', value: s.currentQuestion.options?.[0]?.value ?? 'x' }, elicit, {})
    }
    expect(new Set(asked).size).toBe(asked.length)
    expect(s.status).toBe('ready_to_plan')
  })

  test('saved answers are reused: a profile that already holds an answer is not asked again', () => {
    const first = answerQuestion(initConversation(elicit, {}), { kind: 'choice', value: 'lighter_week' }, elicit, {})
    expect(ids(first)).toContain('workload_target')
    expect(first.currentQuestion?.id).not.toBe('workload_target')
  })

  test('an indifferent answer is recorded as indifference — neither a want nor a constraint', () => {
    const s = answerQuestion(initConversation(elicit, {}), { kind: 'indifferent' }, elicit, {})
    const pref = s.profile.preferences.find((p) => p.id === 'workload_target')!
    expect(pref.classification).toBe('indifferent')
    expect(['hard_constraint', 'soft_preference', 'goal']).not.toContain(pref.classification)
  })

  test('a content/topic question is raised only when topics genuinely separate legal candidates', () => {
    const none = initConversation(elicit, {})
    const withoutGate = DEFAULT_QUESTION_CATALOG.filter((q) => q.id === 'course_topic_interest')
    expect(withoutGate).toHaveLength(1)
    const gated: ElicitationContext = { topicInterestImpact: { category: 'course_topic_interest', distinguishesCandidates: true, distinguishingTopics: ['control', 'robotics'], coverageSufficient: true, hasConflicts: false } }
    const noGate = elicit.selectNextQuestion({ ...none.profile, preferences: [] }, { impactThreshold: 0.1 })
    expect(noGate?.id).not.toBe('course_topic_interest')
    // only the two highest-impact generic questions are answered, then the gated topic question surfaces
    let s = initConversation(elicit, gated)
    const seen: string[] = []
    for (let i = 0; i < 10 && s.currentQuestion; i++) { seen.push(s.currentQuestion.id); s = answerQuestion(s, { kind: 'indifferent' }, elicit, gated) }
    expect(seen).toContain('course_topic_interest')
    expect(s.currentQuestion).toBeNull()
  })

  test('no distinguishing topic => the topic question is never asked (no generic interest questionnaire)', () => {
    const closed: ElicitationContext = { topicInterestImpact: { category: 'course_topic_interest', distinguishesCandidates: false, distinguishingTopics: [], coverageSufficient: true, hasConflicts: false } }
    let s = initConversation(elicit, closed)
    const seen: string[] = []
    for (let i = 0; i < 10 && s.currentQuestion; i++) { seen.push(s.currentQuestion.id); s = answerQuestion(s, { kind: 'indifferent' }, elicit, closed) }
    expect(seen).not.toContain('course_topic_interest')
  })
})

describe('changing preferences, confirmation and stale proposals', () => {
  test('a vague free-text answer to a consequential question needs confirmation and is inert until confirmed', () => {
    const s = answerQuestion(initConversation(elicit, {}), { kind: 'free_text', text: 'משהו קליל' }, elicit, {})
    expect(s.status).toBe('confirmation_required')
    const pref = s.profile.preferences.find((p) => p.id === 'workload_target')!
    expect(pref.classification).toBe('uncertain')
    const done = confirmPending(s, elicit, {}, { as: 'soft_preference' })
    expect(done.status).not.toBe('confirmation_required')
  })

  test('revising an answer replaces it, marks any proposal stale, and does not silently auto-generate', () => {
    let s = answerQuestion(initConversation(elicit, {}), { kind: 'choice', value: 'lighter_week' }, elicit, {})
    s = markProposalReady(markPlanning(s))
    expect(isProposalStale(s)).toBe(false)
    s = reviseAnswer(s, 'workload_target', { kind: 'choice', value: 'finish_faster' }, elicit, {})
    expect(s.profile.preferences.filter((p) => p.id === 'workload_target')).toHaveLength(1)
    expect(isProposalStale(s)).toBe(true)
    expect(s.rebuildRequired).toBe(true)
    expect(s.status).not.toBe('planning')
  })

  test('removing a captured preference makes the question askable again', () => {
    let s = answerQuestion(initConversation(elicit, {}), { kind: 'choice', value: 'lighter_week' }, elicit, {})
    s = removeCapturedPreference(s, 'workload_target', elicit, {})
    expect(ids(s)).not.toContain('workload_target')
    expect(s.currentQuestion?.id).toBe('workload_target')
  })

  test('contradictory active preferences on the same planner knob are surfaced, not resolved silently', () => {
    const a = elicit.applyAnswer(initConversation(elicit, {}).profile, { ...DEFAULT_QUESTION_CATALOG[0], id: 'a', affects: 'knob' }, { kind: 'choice', value: 'x' }).profile
    const b = elicit.applyAnswer(a, { ...DEFAULT_QUESTION_CATALOG[0], id: 'b', affects: 'knob' }, { kind: 'choice', value: 'y' }).profile
    expect(elicit.detectContradictions(b)).toEqual([expect.objectContaining({ affects: 'knob', preferenceIds: ['a', 'b'] })])
  })
})

describe('scope of the deterministic elicitation catalog (the live agent path is separate)', () => {
  const catalogIds = DEFAULT_QUESTION_CATALOG.map((q) => q.id)

  test('the catalog asks only impact-gated trade-off questions; direction, timing and course picks are the live agent session\'s intake (see copilot_agent.test.ts)', () => {
    expect(catalogIds).toEqual(['workload_target', 'semester_balance', 'time_of_day', 'course_feature_practical', 'course_topic_interest', 'objective_priority'])
  })
})

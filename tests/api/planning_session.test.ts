import {
  SESSION_LIMITS, appendTurns, emptyPlanningSession, objectiveOrder, planningSessionSchema, rebaseDraft,
  sessionBytes, setObjective, withSummary, type PlanningSessionState,
} from '../../shared/planner/planning-session'

const NOW = '2026-11-13T10:00:00Z'
const fresh = () => emptyPlanningSession('mechanical_engineering_2027', 'v1', NOW)
const turn = (role: 'user' | 'assistant', text: string) => ({ role, text })

test('a new session is valid and ranks specialization above load balance by default', () => {
  const session = fresh()
  expect(planningSessionSchema.safeParse(session).success).toBe(true)
  expect(objectiveOrder(session.profile)).toEqual(['specialization', 'degree_progress', 'load_balance'])
})

describe('priorities change through the conversation', () => {
  test('a stated priority takes effect at once and reorders the objectives', () => {
    const profile = setObjective(fresh().profile, 'campus_days', 0.95, 'stated')
    expect(objectiveOrder(profile)[0]).toBe('campus_days')
  })

  test('an inferred priority waits for the student to confirm it', () => {
    const profile = setObjective(fresh().profile, 'campus_days', 0.95, 'inferred')
    expect(objectiveOrder(profile)).not.toContain('campus_days')
    const confirmed = setObjective(profile, 'campus_days', 0.95, 'stated')
    expect(objectiveOrder(confirmed)[0]).toBe('campus_days')
  })

  test('"specialization even if a semester is heavier" lowers balance without touching anything else', () => {
    const profile = setObjective(setObjective(fresh().profile, 'load_balance', 0.9, 'stated'), 'load_balance', 0.1, 'stated')
    expect(objectiveOrder(profile)).toEqual(['specialization', 'degree_progress', 'load_balance'])
    expect(profile.objectives.filter((objective) => objective.id === 'load_balance')).toHaveLength(1)
  })
})

describe('a session never grows past its ceiling', () => {
  test('old turns leave the window and are handed back for summarizing', () => {
    let session = fresh()
    for (let i = 0; i < 40; i++) {
      const result = appendTurns(session, [turn('user', `שאלה ${i}`), turn('assistant', `תשובה ${i}`)], NOW)
      session = result.session
      if (i === 39) expect(result.overflow).toHaveLength(2)
    }
    expect(session.recent_turns).toHaveLength(SESSION_LIMITS.recentTurns)
    expect(session.recent_turns.at(-1)?.text).toBe('תשובה 39')
    expect(planningSessionSchema.safeParse(session).success).toBe(true)
  })

  test('the worst case stays under 150 KB however long the conversation runs', () => {
    let session: PlanningSessionState = {
      ...fresh(),
      decisions: Array.from({ length: SESSION_LIMITS.decisions }, () => ({ at: NOW, summary_he: 'ה'.repeat(300) })),
      draft_changes: Array.from({ length: SESSION_LIMITS.draftChanges }, (_, i) => ({
        kind: 'add' as const, course_id: `0542-${String(i).padStart(4, '0')}`, semester_id: 'year_4_semester_a', reason_he: 'ס'.repeat(160), accepted: false })),
      tool_digests: Array.from({ length: SESSION_LIMITS.toolDigests }, () => ({ tool: 'get_course_grades', key: 'k'.repeat(200), digest: 'ד'.repeat(600) })),
    }
    session = withSummary(session, 'ס'.repeat(10_000))
    for (let i = 0; i < 200; i++) session = appendTurns(session, [turn('user', 'ש'.repeat(9_000))], NOW).session
    expect(planningSessionSchema.safeParse(session).success).toBe(true)
    expect(sessionBytes(session)).toBeLessThan(150_000)
  })
})

describe('the committed board always wins over a stale draft', () => {
  const board = { version: 'v2', semesters: [
    { semesterId: 'year_3_semester_a', courseIds: ['MAND', 'FE'] }, { semesterId: 'year_4_semester_a', courseIds: [] },
  ] }
  const change = (kind: 'add' | 'move' | 'remove', course_id: string, semester_id: string | null) => ({ kind, course_id, semester_id, accepted: false })

  test('nothing changes while the board version is the same', () => {
    const session = { ...fresh(), draft_changes: [change('add', 'FE', 'year_4_semester_a')] }
    expect(rebaseDraft(session, { ...board, version: 'v1' })).toEqual({ session, dropped: [] })
  })

  test('changes the board has overtaken are dropped and reported; the rest survive', () => {
    const session = { ...fresh(), unlocked_course_ids: ['MAND', 'GONE'], draft_changes: [
      change('add', 'FE', 'year_4_semester_a'),     // the student already placed it themselves
      change('add', 'LAB', 'year_4_semester_a'),    // still meaningful
      change('remove', 'GONE', null),               // no longer on the board
      change('move', 'MAND', 'year_3_semester_a'),  // already there
      change('add', 'X', 'year_9_semester_a'),      // the column no longer exists
    ] }
    const result = rebaseDraft(session, board)
    expect(result.session.base_board_version).toBe('v2')
    expect(result.session.draft_changes.map((item) => item.course_id)).toEqual(['LAB'])
    expect(result.dropped.map((item) => item.course_id)).toEqual(['FE', 'GONE', 'MAND', 'X'])
    expect(result.session.unlocked_course_ids).toEqual(['MAND'])
  })
})

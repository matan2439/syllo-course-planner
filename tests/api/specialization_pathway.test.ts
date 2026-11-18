import { buildSpecializationPathway, explainPathwayCourse, pathwayCoherence } from '../../api/ai/specialization_pathway'
import type { PrerequisiteCatalog } from '../../api/ai/prerequisites'

const c = (course: string) => ({ course })
const catalog: PrerequisiteCatalog = {
  BASE: { status: 'verified_none', expression: null, corequisites: null },
  MID: { status: 'verified', expression: c('BASE'), corequisites: null },
  ADV: { status: 'verified', expression: { all: [c('MID'), { any: [c('ALT1'), c('ALT2')] }] }, corequisites: null },
  GUESS: { status: 'none_listed', expression: c('BASE'), corequisites: null },
  ALT1: { status: 'verified_none', expression: null, corequisites: null },
}
const universe = new Set(['BASE', 'MID', 'ADV', 'ALT1', 'GUESS', 'OTHER'])
const build = (fit: Record<string, number>, ids = universe) =>
  buildSpecializationPathway({ fitById: new Map(Object.entries(fit)), universeIds: ids, catalog })

describe('specialization pathway', () => {
  test('is always labelled a recommended, inferred pathway — never official', () => {
    expect(build({ ADV: 1 }).provenance).toBe('recommended_inferred')
  })

  test('edges come only from verified prerequisite records and mark OR alternatives', () => {
    const p = build({ ADV: 1 })
    expect(p.edges.map((e) => `${e.from}>${e.to}${e.alternative ? '?' : ''}`)).toEqual(['ALT1>ADV?', 'BASE>MID', 'MID>ADV'])
    expect(p.edges.every((e) => e.source === 'official_prerequisite')).toBe(true)
    expect([...p.foundations].sort()).toEqual(['ALT1', 'BASE', 'MID'])
  })

  test('a single-source (none_listed) record never creates an edge', () => {
    expect(build({ GUESS: 1 }).edges).toEqual([])
  })

  test('prerequisites outside the plannable universe are dropped, not invented', () => {
    const p = build({ ADV: 1 }, new Set(['ADV', 'MID']))
    expect(p.edges.map((e) => e.from)).toEqual(['MID'])
  })

  test('depth is the longest official prerequisite chain, in courses', () => {
    expect(build({ ADV: 1 }).depth).toBe(3) // BASE -> MID -> ADV
    expect(build({ OTHER: 1 }).depth).toBe(1)
  })

  test('coherence rewards a connected, prepared sequence over scattered members', () => {
    const p = build({ ADV: 1, MID: 1, OTHER: 1 })
    const chain = pathwayCoherence(new Set(['BASE', 'MID', 'ADV']), p)
    const scattered = pathwayCoherence(new Set(['OTHER', 'ADV']), p)
    expect(chain.score).toBeGreaterThan(scattered.score)
    expect(chain.satisfiedEdges).toBe(2)
    expect(pathwayCoherence(new Set(['BASE']), p).score).toBe(0)
  })

  test('a member placed without any met pathway prerequisite is not counted as prepared', () => {
    const p = build({ ADV: 1 })
    expect(pathwayCoherence(new Set(['ADV']), p).preparedMembers).toBe(0)
    expect(pathwayCoherence(new Set(['ADV', 'MID']), p).preparedMembers).toBe(2 - 1) // ADV prepared by MID; MID alone is not placed as member
  })

  test('explanations state the evidence level and never claim an official track', () => {
    const p = build({ ADV: 1 })
    const adv = explainPathwayCourse('ADV', p)
    expect(adv).toMatchObject({ role: 'member', evidence: 'name_rule', buildsOn: ['ALT1', 'MID'] })
    expect(adv.statement).toMatch(/not a university-defined track/)
    expect(adv.statement).toMatch(/not independently confirmed by syllabus text/)
    expect(explainPathwayCourse('MID', p)).toMatchObject({ role: 'foundation', enables: ['ADV'] })
    expect(explainPathwayCourse('OTHER', p).role).toBe('not_in_pathway')
  })
})

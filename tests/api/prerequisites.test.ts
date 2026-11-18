import {
  evaluatePrerequisites, loadPrerequisiteCatalog, prerequisiteRecord, shadowPrerequisiteAudit, unmetRequirements,
  type PrerequisiteCatalog, type PrerequisiteExpression,
} from '../../api/ai/prerequisites'

const c = (course: string): PrerequisiteExpression => ({ course })
const has = (...ids: string[]) => (id: string) => ids.includes(id)

describe('evaluating AND/OR prerequisite expressions', () => {
  const expression: PrerequisiteExpression = { all: [c('A'), { any: [c('B'), c('C')] }] }

  test('no requirement always holds', () => {
    expect(evaluatePrerequisites(null, has())).toBe(true)
  })

  test('AND needs every part; OR needs one alternative', () => {
    expect(evaluatePrerequisites(expression, has('A', 'C'))).toBe(true)
    expect(evaluatePrerequisites(expression, has('A'))).toBe(false)
    expect(evaluatePrerequisites(expression, has('B', 'C'))).toBe(false)
  })

  test('the unmet parts are reported as alternatives per requirement', () => {
    expect(unmetRequirements(expression, has())).toEqual([['A'], ['B', 'C']])
    expect(unmetRequirements(expression, has('A'))).toEqual([['B', 'C']])
    expect(unmetRequirements(expression, has('A', 'B'))).toEqual([])
  })
})

describe('the committed catalog (official syllabus pages)', () => {
  const catalog = loadPrerequisiteCatalog()

  test('the biological-manufacturing course carries its four official prerequisites', () => {
    expect(prerequisiteRecord(catalog, '0542-4124')).toMatchObject({
      status: 'verified',
      expression: { all: [c('0509-1815'), c('0542-3243'), c('0542-3620'), c('0542-2500')] },
    })
  })

  test('intro to finite elements needs Solids 1 OR Solids 2', () => {
    expect(prerequisiteRecord(catalog, '0542-4223').expression).toEqual({ any: [c('0542-2200'), c('0542-4224')] })
  })

  test('a course with no record is unknown, never "no prerequisites"', () => {
    expect(prerequisiteRecord(catalog, '9999-9999').status).toBe('unknown')
    expect(prerequisiteRecord(null, '0542-4223').status).toBe('unknown')
  })

  test('every record has a known status and verified ones a real expression', () => {
    for (const record of Object.values(catalog ?? {})) {
      expect(['verified', 'verified_none', 'none_listed', 'assumed_none_no_syllabus', 'not_in_catalog', 'unknown']).toContain(record.status)
      if (record.status === 'verified') expect(record.expression ?? record.corequisites).not.toBeNull()
      if (record.status === 'verified_none' && record.catalog) expect(record.catalog.found).toBe(true)
    }
  })
})

describe('shadow audit: what strict enforcement would block', () => {
  const catalog: PrerequisiteCatalog = {
    INTRO: { status: 'verified_none', expression: null, corequisites: null },
    ADV: { status: 'verified', expression: c('INTRO'), corequisites: null },
    LAB: { status: 'verified', expression: null, corequisites: c('ADV') },
    NOSYL: { status: 'assumed_none_no_syllabus', expression: null, corequisites: null },
  }
  const audit = (semesters: string[][], completed: string[] = []) => shadowPrerequisiteAudit({
    semesters: semesters.map((courseIds, index) => ({ semesterId: `s${index + 1}`, courseIds })), completedCourseIds: completed, catalog,
  })

  test('a prerequisite must be completed or in a strictly earlier semester', () => {
    expect(audit([['INTRO'], ['ADV']]).wouldBlock).toEqual([])
    expect(audit([[], ['ADV']], ['INTRO']).wouldBlock).toEqual([])
    expect(audit([['INTRO', 'ADV']]).wouldBlock).toEqual([
      expect.objectContaining({ courseId: 'ADV', semesterId: 's1', unmetPrerequisites: [['INTRO']] }),
    ])
  })

  test('a corequisite may share the semester', () => {
    expect(audit([['INTRO'], ['ADV', 'LAB']]).wouldBlock).toEqual([])
    expect(audit([['INTRO'], ['LAB'], ['ADV']]).wouldBlock).toEqual([
      expect.objectContaining({ courseId: 'LAB', unmetCorequisites: [['ADV']] }),
    ])
  })

  test('unknown and assumed-none courses are listed separately, not blocked', () => {
    const result = audit([['NOSYL', 'MYSTERY']])
    expect(result).toMatchObject({ wouldBlock: [], unknown: ['MYSTERY'], assumedNone: ['NOSYL'] })
  })

  test('a course listed as both prerequisite and corequisite may be taken in the same semester', () => {
    const both: PrerequisiteCatalog = { X: { status: 'verified_none', expression: null, corequisites: null },
      Y: { status: 'verified', expression: c('X'), corequisites: c('X') } }
    const run = (semesters: string[][]) => shadowPrerequisiteAudit({ semesters: semesters.map((courseIds, i) => ({ semesterId: `s${i}`, courseIds })), completedCourseIds: [], catalog: both })
    expect(run([['X', 'Y']]).wouldBlock).toEqual([])
    expect(run([['Y'], ['X']]).wouldBlock).toHaveLength(1)
  })
})

describe('shadow audit: enforcement grade of a would-block placement', () => {
  const catalog: PrerequisiteCatalog = {
    BASE: { status: 'verified_none', expression: null, corequisites: null },
    GONE: { status: 'not_in_catalog', expression: null, corequisites: null },
    REAL: { status: 'verified', expression: c('BASE'), corequisites: null },
    NEEDS_GONE: { status: 'verified', expression: { all: [c('BASE'), c('GONE')] }, corequisites: null },
    OR_GONE: { status: 'verified', expression: { any: [c('GONE'), c('BASE')] }, corequisites: null },
    DISAGREE: { status: 'verified', expression: c('BASE'), corequisites: null, needs_review: true, sources_disagree: true },
  }
  const run = (semesters: string[][]) => shadowPrerequisiteAudit({
    semesters: semesters.map((courseIds, i) => ({ semesterId: `s${i + 1}`, courseIds })), completedCourseIds: [], catalog,
  }).wouldBlock

  test('a violated prerequisite on a plannable catalog course is a verified violation', () => {
    expect(run([['BASE', 'REAL']])).toEqual([expect.objectContaining({ courseId: 'REAL', enforcementGrade: 'verified', advisoryReasons: [] })])
  })

  test('a requirement that names a course missing from the official catalog is advisory, never verified', () => {
    const [block] = run([['BASE'], ['NEEDS_GONE']])
    expect(block).toMatchObject({ courseId: 'NEEDS_GONE', enforcementGrade: 'advisory' })
    expect(block.advisoryReasons).toEqual(['unresolved_requirement:GONE'])
  })

  test('a retired alternative inside an OR does not block when its sibling is met', () => {
    expect(run([['BASE'], ['OR_GONE']])).toEqual([])
  })

  test('records whose official sources disagree stay advisory', () => {
    const [block] = run([['BASE', 'DISAGREE']])
    expect(block).toMatchObject({ courseId: 'DISAGREE', enforcementGrade: 'advisory' })
    expect(block.advisoryReasons).toContain('official_sources_disagree')
  })

  test('same-semester placement of a prerequisite still counts as unmet', () => {
    expect(run([['BASE', 'REAL']])[0].unmetPrerequisites).toEqual([['BASE']])
  })
})

describe('course pathways from official prerequisites', () => {
  // Imported lazily so the suites above stay independent of the planner model.
  const { coursePathway, buildSuccessorIndex } = require('../../api/ai/course_pathways')
  const { buildConstraintModel } = require('../../api/ai/planner_model')
  const { loadLocalBoardJson } = require('../../api/ai/board_loader')
  const model = buildConstraintModel(loadLocalBoardJson('mechanical_engineering_2027'), {})
  const catalog = loadPrerequisiteCatalog()!

  test('intro to finite elements leads to the industry-applications course, which is reported as not offered', () => {
    const pathway = coursePathway({ courseId: '0542-4223', model, catalog, satisfied: () => false })
    expect(pathway.prerequisite_status).toBe('verified')
    expect(pathway.unmet_prerequisites.map((group: Array<{ course_id: string }>) => group.map((item) => item.course_id)))
      .toEqual([['0542-2200', '0542-4224']])
    const followUp = pathway.leads_to.find((item: { course_id: string }) => item.course_id === '0542-4226')
    expect(followUp).toMatchObject({ in_program: true, offered: false })
    expect(followUp.not_offered_reason_he).toBeTruthy()
    expect(followUp.also_requires.map((item: { course_id: string }) => item.course_id)).toEqual(expect.arrayContaining(['0542-3620']))
  })

  test('met prerequisites are not listed as unmet', () => {
    const pathway = coursePathway({ courseId: '0542-4223', model, catalog, satisfied: (id: string) => id === '0542-2200' })
    expect(pathway.unmet_prerequisites).toEqual([])
  })

  test('the successor index only follows official prerequisite edges', () => {
    const index = buildSuccessorIndex({
      A: { status: 'verified_none', expression: null, corequisites: null },
      B: { status: 'verified', expression: { any: [{ course: 'A' }, { course: 'X' }] }, corequisites: { course: 'C' } },
      C: { status: 'verified_none', expression: null, corequisites: null },
    })
    expect(index.get('A')).toEqual(['B'])
    expect(index.get('C')).toBeUndefined()
  })
})

describe('approved course equivalences', () => {
  const { loadEquivalences, withEquivalences: withEq } = require('../../api/ai/prerequisites')
  const file = require('../../data/prerequisites/equivalences.json')
  const has2 = (...ids: string[]) => (id: string) => ids.includes(id)

  test('exactly the six approved mappings: four registrar-listed, two inferred', () => {
    const byRetired = Object.fromEntries(loadEquivalences().map((e: { retired: string; status: string }) => [e.retired, e.status]))
    expect(byRetired).toEqual({
      '0512-3632': 'registrar_listed', '0509-1824': 'registrar_listed', '0509-1843': 'registrar_listed',
      '0509-1845': 'registrar_listed', '0509-1510': 'inferred', '0542-1830': 'inferred',
    })
  })

  test('Materials Science is an INFERRED, Mechanical-only equivalence to 0581-1111; 0581-2111 never counts', () => {
    const entry = loadEquivalences().find((e: { retired: string }) => e.retired === '0542-1830')
    expect(entry).toMatchObject({ status: 'inferred', scope_programs: ['mechanical_engineering'] })
    expect(entry.evidence).toMatch(/INFERRED/)
    expect(withEq(has2('0581-1111'), undefined, undefined, 'mechanical_engineering_2027')('0542-1830')).toBe(true)
    expect(withEq(has2('0581-1111'), undefined, undefined, 'mechanical_engineering_years_1_2_2027')('0542-1830')).toBe(true)
    expect(withEq(has2('0581-1111'), undefined, undefined, 'electrical_engineering_2027')('0542-1830')).toBe(false)
    expect(withEq(has2('0581-2111'), undefined, undefined, 'mechanical_engineering_2027')('0542-1830')).toBe(false)
  })

  test('the other uncertain equivalences stay unresolved and satisfy nothing', () => {
    expect(file.unresolved.map((u: { retired: string }) => u.retired)).toEqual(['0555-2250', '0512-4262'])
    expect(loadEquivalences().some((e: { retired: string }) => ['0555-2250', '0512-4262'].includes(e.retired))).toBe(false)
  })

  test('the audit reports an inferred Materials Science use for Mechanical and not for Electrical', () => {
    const catalog: PrerequisiteCatalog = {
      '0581-1111': { status: 'verified_none', expression: null, corequisites: null },
      '0542-2400': { status: 'verified', expression: { course: '0542-1830' }, corequisites: null },
    }
    const semesters = [{ semesterId: 's1', courseIds: ['0581-1111'] }, { semesterId: 's2', courseIds: ['0542-2400'] }]
    const mech = shadowPrerequisiteAudit({ semesters, completedCourseIds: [], catalog, programId: 'mechanical_engineering_2027' })
    expect(mech.wouldBlock).toEqual([])
    expect(mech.equivalenceUses).toEqual([{ courseId: '0542-2400', required: '0542-1830', satisfiedBy: '0581-1111', status: 'inferred' }])
    const elec = shadowPrerequisiteAudit({ semesters, completedCourseIds: [], catalog, programId: 'electrical_engineering_2027' })
    expect(elec.wouldBlock).toHaveLength(1)
    expect(elec.equivalenceUses).toEqual([])
  })

  test('an approved equivalent satisfies the retired number; the program variants are alternatives', () => {
    expect(withEq(has2('0509-1624'))('0509-1824')).toBe(true)
    expect(withEq(has2('0509-1724'))('0509-1824')).toBe(true)
    expect(withEq(has2('0509-1647'))('0509-1843')).toBe(true)
    expect(withEq(has2('0512-2532'))('0512-3632')).toBe(true)
    expect(withEq(has2('0509-1745'))('0509-1824')).toBe(false)
    expect(withEq(has2())('0509-1824')).toBe(false)
  })

  test('similar names alone never count', () => {
    expect(withEq(has2('0509-1546', '0581-1132', '0555-2106'))('0509-1843')).toBe(false)
    expect(withEq(has2('0555-2106'))('0555-2250')).toBe(false)
  })

  test('the audit reports when an INFERRED equivalence made the difference', () => {
    const catalog: PrerequisiteCatalog = {
      '0542-1510': { status: 'verified_none', expression: null, corequisites: null },
      '0542-2400': { status: 'verified', expression: { course: '0509-1510' }, corequisites: null },
    }
    const audit = shadowPrerequisiteAudit({
      semesters: [{ semesterId: 's1', courseIds: ['0542-1510'] }, { semesterId: 's2', courseIds: ['0542-2400'] }],
      completedCourseIds: [], catalog,
    })
    expect(audit.wouldBlock).toEqual([])
    expect(audit.equivalenceUses).toEqual([{ courseId: '0542-2400', required: '0509-1510', satisfiedBy: '0542-1510', status: 'inferred' }])
  })

  test('without the equivalence the same plan would be blocked', () => {
    const catalog: PrerequisiteCatalog = { '0542-2400': { status: 'verified', expression: { course: '0509-1510' }, corequisites: null } }
    const audit = shadowPrerequisiteAudit({ semesters: [{ semesterId: 's1', courseIds: ['0542-2400'] }], completedCourseIds: [], catalog, equivalences: [] })
    expect(audit.wouldBlock).toHaveLength(1)
  })
})

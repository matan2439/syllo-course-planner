import { readFileSync } from 'node:fs'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import { buildConstraintModel } from '../../api/ai/planner_model'
import { legalSemestersFor } from '../../api/ai/planner_actions'
import { PLANNING_CATALOG_YEAR, catalogYearFromUrl, offeringStatus, projectedSemesterIds } from '../../shared/planner/offering-status'

const T = (year: number, semester: 1 | 2 = 1) => ({ year, semester })
const ev = (over = {}) => ({ allowedSemesterIds: ['year_3_semester_a', 'year_4_semester_a'], offeredInCatalogYear: true, catalogYear: 2026, ...over })

describe('offering status: confirmed, projected, unavailable, unknown', () => {
  test('the published year is confirmed when the course has groups in that semester', () => {
    expect(offeringStatus('year_3_semester_a', T(2026), ev())).toBe('confirmed')
  })
  test('the published year is officially unavailable in a semester without groups, or when not offered at all', () => {
    expect(offeringStatus('year_3_semester_b', T(2026, 2), ev())).toBe('unavailable')
    expect(offeringStatus('year_3_semester_a', T(2026), ev({ offeredInCatalogYear: false }))).toBe('unavailable')
  })
  test('a later year is only ever PROJECTED, never confirmed', () => {
    expect(offeringStatus('year_4_semester_a', T(2027), ev())).toBe('projected')
  })
  test('a later year cannot be projected from a course that did not run in the published year', () => {
    expect(offeringStatus('year_4_semester_a', T(2027), ev({ offeredInCatalogYear: false }))).toBe('unknown')
  })
  test('a later year in a term the pattern lacks is unknown, not "unavailable" (nothing official says so)', () => {
    expect(offeringStatus('year_4_semester_b', T(2027, 2), ev())).toBe('unknown')
  })
  test('no data, no year, or a past year is unknown', () => {
    expect(offeringStatus('year_3_semester_a', T(2026), ev({ allowedSemesterIds: [] }))).toBe('unknown')
    expect(offeringStatus('year_3_semester_a', T(2026), ev({ catalogYear: null }))).toBe('unknown')
    expect(offeringStatus('year_2_semester_a', T(2025), ev())).toBe('unknown')
    expect(offeringStatus('year_3_semester_a', undefined, ev())).toBe('unknown')
  })
  test('the source year is read from the course data\'s own official URL', () => {
    expect(catalogYearFromUrl('https://www.tau.ac.il/study-program?safa=1&shana=2026&tab=schedule&tcid=8715')).toBe(2026)
    expect(catalogYearFromUrl('https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05424223&year=2025')).toBe(2025)
    expect(catalogYearFromUrl(null)).toBeNull()
  })
})

describe('which board semesters rest on an unpublished timetable', () => {
  const ids = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b']
  test('for a third-year student in autumn 2026, year 4 is projected and year 3 is published', () => {
    expect([...projectedSemesterIds(ids, 3, new Date('2026-11-15'))].sort()).toEqual(['year_4_semester_a', 'year_4_semester_b'])
  })
  test('a fourth-year student has nothing projected', () => {
    expect(projectedSemesterIds(ids, 4, new Date('2026-11-15')).size).toBe(0)
  })
  test('a second-year student sees year 3 and 4 as projected', () => {
    expect([...projectedSemesterIds(ids, 2, new Date('2026-11-15'))].sort()).toEqual(ids)
  })
  test('once the next year\'s timetable is the catalog year, the label moves with it', () => {
    expect(projectedSemesterIds(ids, 3, new Date('2026-11-15'), 2027).size).toBe(0)
  })
})

describe('the constant matches the real data', () => {
  const boards = ['mechanical_engineering_2027', 'electrical_engineering_2027', 'mechanical_engineering_years_1_2_2027']
  test.each(boards)('%s course records take their offering from the %s catalog year', (id) => {
    const model = buildConstraintModel(loadLocalBoardJson(id), {})
    const years = new Set([...model.profiles.values()].map((p) => catalogYearFromUrl(p.provenance.offering_source_url)).filter((y) => y !== null))
    expect(years.size).toBeGreaterThan(0)
    expect([...years]).toEqual([PLANNING_CATALOG_YEAR])
    expect(JSON.parse(readFileSync('data/prerequisites/tau.json', 'utf8')).catalog_year).toBe(PLANNING_CATALOG_YEAR)
  })

  test('on the real Mechanical board, Intro to FE is confirmed in 3A, projected in 4A, unknown in 4B', () => {
    const model = buildConstraintModel(loadLocalBoardJson('mechanical_engineering_2027'), {})
    const p = model.profiles.get('0542-4223')!
    const base = { allowedSemesterIds: legalSemestersFor(model, '0542-4223'), offeredInCatalogYear: p.offered_in_year, catalogYear: catalogYearFromUrl(p.provenance.offering_source_url) ?? PLANNING_CATALOG_YEAR }
    expect(offeringStatus('year_3_semester_a', T(2026), base)).toBe('confirmed')
    expect(offeringStatus('year_4_semester_a', T(2027), base)).toBe('projected')
    expect(offeringStatus('year_4_semester_b', T(2027, 2), base)).toBe('unknown')
  })
})

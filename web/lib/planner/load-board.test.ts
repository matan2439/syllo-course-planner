/**
 * Slice 1 — loader/integration: proves the real read-only data path
 *   /api/board payload → shared/planner runtime parse + adapter → BoardModel
 * without bypassing shared/planner (fetch is mocked; the payload is board-shaped).
 *
 * Fixture provenance: board_json shape trimmed from the real repo catalog
 * data/parsed_json/mechanical_semester_board_2027.json (metadata.board_data_version;
 * semesters[].courses[].weekly_hours as a decimal half-hour, e.g. 3.5). Sanitized.
 */
import { loadBoard } from './load-board'
import { ContractError } from '../../../shared/planner/model'

const BOARD = {
  metadata: { board_data_version: 'rev-1', total_courses: 1 },
  summary: { total_courses: 1 },
  semesters: [
    {
      semester_id: 'year_3_semester_a',
      display_name: 'Year 3 - Semester A',
      courses: [
        { course_id: 'C-1', name_he: 'קורס לדוגמה', weekly_hours: 3.5, course_type: 'mandatory', is_mandatory: true },
      ],
    },
    { semester_id: 'year_3_semester_b', display_name: 'Year 3 - Semester B', courses: [] },
  ],
}

const fakeFetch = (status: number, body: unknown) =>
  async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

test('loadBoard parses real board-shaped JSON through shared/planner into a canonical BoardModel', async () => {
  const model = await loadBoard('mechanical_engineering_2027', { fetchImpl: fakeFetch(200, BOARD), baseUrl: '' })
  expect(model.catalogRevision).toBe('rev-1')
  expect(model.semesters[0].courses[0].courseId).toBe('C-1')
  expect(model.semesters[0].courses[0].halfHours).toBe(7) // 3.5h → exact half-hour units
})

test('malformed board data fails with the typed ContractError (no silent coercion)', async () => {
  await expect(
    loadBoard('p_2027', { fetchImpl: fakeFetch(200, { semesters: 'not-an-array' }), baseUrl: '' }),
  ).rejects.toBeInstanceOf(ContractError)
})

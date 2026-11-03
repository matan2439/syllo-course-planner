import { getUniversity, searchUniversities, UNIVERSITIES } from './universities'

test('university search matches Hebrew or English names and falls back to TAU', () => {
  expect(searchUniversities('תל אביב').map((u) => u.id)).toEqual(['tau'])
  expect(searchUniversities('tel aviv').map((u) => u.id)).toEqual(['tau'])
  expect(searchUniversities('טכניון')).toEqual([])
  expect(searchUniversities('')).toHaveLength(UNIVERSITIES.length)
  expect(getUniversity('unknown').id).toBe('tau')
})

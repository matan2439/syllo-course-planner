import {
  BOARD_COURSE_MIME,
  REPOSITORY_COURSE_MIME,
  readPlannerDrag,
  writeBoardDrag,
  writeRepositoryDrag,
} from './drag-payload'

function fakeDataTransfer(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getData(type: string) {
      return values.get(type) ?? ''
    },
    setData(type: string, value: string) {
      values.set(type, value)
    },
  }
}

test('repository payload remains distinguishable from a board move', () => {
  const transfer = fakeDataTransfer()

  writeRepositoryDrag(transfer, '0542-4120', ['year_3_semester_a'])

  expect(readPlannerDrag(transfer)).toEqual({
    kind: 'repository',
    courseId: '0542-4120',
    allowedSemesterIds: ['year_3_semester_a'],
  })
  expect(transfer.getData(REPOSITORY_COURSE_MIME)).not.toBe('')
})

test('board payload round-trips without inventing semester restrictions', () => {
  const transfer = fakeDataTransfer()

  writeBoardDrag(transfer, 'E-1')

  expect(readPlannerDrag(transfer)).toEqual({ kind: 'board', courseId: 'E-1' })
  expect(transfer.getData(BOARD_COURSE_MIME)).not.toBe('')
})

test.each([
  { [REPOSITORY_COURSE_MIME]: '{' },
  { [REPOSITORY_COURSE_MIME]: JSON.stringify({ kind: 'repository', courseId: '' }) },
  { [REPOSITORY_COURSE_MIME]: JSON.stringify({ kind: 'unknown', courseId: 'E-1' }) },
  {
    [REPOSITORY_COURSE_MIME]: JSON.stringify({
      kind: 'repository',
      courseId: 'E-1',
      allowedSemesterIds: 'year_3_semester_a',
    }),
  },
])('malformed planner payload fails closed', (initial) => {
  expect(readPlannerDrag(fakeDataTransfer(initial))).toBeNull()
})


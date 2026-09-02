export const REPOSITORY_COURSE_MIME = 'application/x-syllo-repository-course'
export const BOARD_COURSE_MIME = 'application/x-syllo-board-course'

export type PlannerDragPayload = {
  kind: 'repository' | 'board'
  courseId: string
  allowedSemesterIds?: string[]
}

type DragDataTransfer = Pick<DataTransfer, 'getData' | 'setData'>

function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id.trim().length > 0)
}

function parsePayload(raw: string, expectedKind: PlannerDragPayload['kind']): PlannerDragPayload | null {
  if (!raw) return null

  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null

    const candidate = value as Record<string, unknown>
    if (candidate.kind !== expectedKind) return null
    if (typeof candidate.courseId !== 'string' || candidate.courseId.trim().length === 0) return null
    if (candidate.allowedSemesterIds !== undefined && !validIds(candidate.allowedSemesterIds)) return null

    return {
      kind: expectedKind,
      courseId: candidate.courseId,
      ...(candidate.allowedSemesterIds === undefined
        ? {}
        : { allowedSemesterIds: candidate.allowedSemesterIds }),
    }
  } catch {
    return null
  }
}

export function writeRepositoryDrag(
  dataTransfer: DragDataTransfer,
  courseId: string,
  allowedSemesterIds?: string[],
) {
  const payload: PlannerDragPayload = {
    kind: 'repository',
    courseId,
    ...(allowedSemesterIds === undefined ? {} : { allowedSemesterIds }),
  }
  dataTransfer.setData(REPOSITORY_COURSE_MIME, JSON.stringify(payload))
}

export function writeBoardDrag(dataTransfer: DragDataTransfer, courseId: string, allowedSemesterIds?: string[]) {
  const payload: PlannerDragPayload = {
    kind: 'board',
    courseId,
    ...(allowedSemesterIds === undefined ? {} : { allowedSemesterIds }),
  }
  dataTransfer.setData(BOARD_COURSE_MIME, JSON.stringify(payload))
}

export function readPlannerDrag(dataTransfer: Pick<DataTransfer, 'getData'>): PlannerDragPayload | null {
  return (
    parsePayload(dataTransfer.getData(REPOSITORY_COURSE_MIME), 'repository')
    ?? parsePayload(dataTransfer.getData(BOARD_COURSE_MIME), 'board')
  )
}


import { notFound } from 'next/navigation'
import { readBoardForProgramId } from '../../lib/board-data'
import { resolveProgram } from '../../lib/programs'
import { adaptRepository } from '../../lib/repository'
import { semesterTitleHe } from '../../lib/planner/board-vm'
import { SEMESTER_WINDOWS, windowBoardIdFor } from '../../lib/planner/semester-window'
import type { RawBoard } from '../../lib/board'
import ProductShell from '../../features/shell/components/ProductShell'
import UnifiedPlannerWorkspace from '../../features/planner/components/UnifiedPlannerWorkspace'

export const metadata = { title: 'מרחב התכנון — Syllo' }
export const dynamic = 'force-dynamic'

// Canonical public planner: one React workspace owns the board, repository and
// Academic Decision Agent.
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  const raw = await readBoardForProgramId(program.id)
  if (!raw) notFound()
  const repo = adaptRepository(raw)
  const destinationsOf = (board: RawBoard) => board.semesters.map((semester) => ({
    id: semester.semester_id,
    label: semesterTitleHe(semester.semester_id),
  }))
  // Each two-year window plans over its own published board; a window with no board is left out.
  const windowBoards = Object.fromEntries((await Promise.all(SEMESTER_WINDOWS.map(async (window) => {
    const boardId = windowBoardIdFor(program.id, window, raw.metadata?.start_year)
    const board = boardId === program.id ? raw : await readBoardForProgramId(boardId)
    return board ? [[window, { boardId, repo: adaptRepository(board), semesterDestinations: destinationsOf(board) }]] : []
  }))).flat())

  return (
    <ProductShell
      width="full"
      programId={program.id}
      preferLightweightBackground={false}
    >
      <UnifiedPlannerWorkspace
        programId={program.id}
        repo={repo}
        semesterDestinations={destinationsOf(raw)}
        windowBoards={windowBoards}
      />
    </ProductShell>
  )
}

import { notFound } from 'next/navigation'
import { readBoardForProgramId } from '../../lib/board-data'
import { resolveProgram } from '../../lib/programs'
import { adaptRepositoryWithSummaries } from '../../lib/repository-summaries'
import { semesterTitleHe } from '../../lib/planner/board-vm'
import { SEMESTER_WINDOWS, windowBoardIdFor } from '../../lib/planner/semester-window'
import type { RawBoard } from '../../lib/board'
import ProductShell from '../../features/shell/components/ProductShell'
import UnifiedPlannerWorkspace from '../../features/planner/components/UnifiedPlannerWorkspace'
import { isEditableDegreePreview } from '../../../shared/programs'
import type { DegreeRule } from '../../../shared/planner/degree-rules'

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
  const repo = await adaptRepositoryWithSummaries(raw)
  const destinationsOf = (board: RawBoard) => board.semesters.map((semester) => ({
    id: semester.semester_id,
    label: semesterTitleHe(semester.semester_id),
  }))
  // Each two-year window plans over its own published board; a window with no board is left out.
  const windowBoards = Object.fromEntries((await Promise.all(SEMESTER_WINDOWS.map(async (window) => {
    const boardId = windowBoardIdFor(program.id, window, raw.metadata?.start_year)
    const board = boardId === program.id ? raw : await readBoardForProgramId(boardId)
    return board ? [[window, { boardId, repo: board === raw ? repo : await adaptRepositoryWithSummaries(board), semesterDestinations: destinationsOf(board) }]] : []
  }))).flat())

  return (
    <ProductShell
      width="full"
      programId={program.id}
      preferLightweightBackground={false}
    >
      {isEditableDegreePreview(program.id) && <p role="status" className="mx-4 my-3 rounded border border-amber-500 p-3" dir="rtl">
        סביבת בדיקה לתכנון {program.name}: ניתן לערוך ולשמור תוכניות. אימות התנאים המיוחדים לתואר עדיין בפיתוח.
      </p>}
      <UnifiedPlannerWorkspace
        degreeRules={(raw.metadata as { degree_rules?: DegreeRule[] })?.degree_rules}
        programId={program.id}
        repo={repo}
        semesterDestinations={destinationsOf(raw)}
        windowBoards={windowBoards}
      />
    </ProductShell>
  )
}

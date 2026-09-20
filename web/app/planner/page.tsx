import { notFound } from 'next/navigation'
import { readBoardForProgramId } from '../../lib/board-data'
import { resolveProgram } from '../../lib/programs'
import { adaptRepository } from '../../lib/repository'
import { semesterTitleHe } from '../../lib/planner/board-vm'
import ProductShell from '../../features/shell/components/ProductShell'
import UnifiedPlannerWorkspace from '../../features/planner/components/UnifiedPlannerWorkspace'

export const metadata = { title: 'המתכנן המלא — מתכנן לימודים' }
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

  return (
    <ProductShell
      active="plan"
      programId={program.id}
      preferLightweightBackground={false}
    >
      <UnifiedPlannerWorkspace
        programId={program.id}
        repo={repo}
        semesterDestinations={raw.semesters.map((semester) => ({
          id: semester.semester_id,
          label: semesterTitleHe(semester.semester_id),
        }))}
      />
    </ProductShell>
  )
}

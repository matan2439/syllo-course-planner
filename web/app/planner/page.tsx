import { notFound } from 'next/navigation'
import { readBoardForProgramId } from '../../lib/board-data'
import { getProgram } from '../../lib/programs'
import { adaptRepository } from '../../lib/repository'
import ProductShell from '../components/ProductShell'
import UnifiedPlannerWorkspace from '../components/UnifiedPlannerWorkspace'

export const metadata = { title: 'המתכנן המלא — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Canonical public planner: one React workspace owns the board, repository and
// Academic Decision Agent. The raw legacy document remains available only at
// /planner/legacy as a rollback reference until the separate retirement gate.
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  const raw = await readBoardForProgramId(program.id)
  if (!raw) notFound()
  const repo = adaptRepository(raw)

  return (
    <ProductShell
      active="plan"
      programId={program.id}
      preferLightweightBackground={false}
    >
      <UnifiedPlannerWorkspace programId={program.id} repo={repo} />
    </ProductShell>
  )
}

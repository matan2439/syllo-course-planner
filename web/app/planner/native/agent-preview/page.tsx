import { notFound } from 'next/navigation'
import { readBoardForProgram } from '../../../../lib/board-data'
import { getProgram } from '../../../../lib/programs'
import { adaptRepository } from '../../../../lib/repository'
import ProductShell from '../../../components/ProductShell'
import UnifiedPlannerWorkspace from '../../../components/UnifiedPlannerWorkspace'

export const metadata = { title: 'מתכנן חכם — תצוגת בדיקה (Agent) — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

/**
 * Preview/test-ONLY route for the flagged academic-decision journey.
 *
 * This is the single browser entry point for the unified React workspace with
 * the Academic Decision Agent enabled. It is NOT part of the Production surface:
 * it renders only when the
 * explicit opt-in env `ENABLE_ACADEMIC_AGENT_PREVIEW=1` is set (git-ignored
 * `web/.env.local` in the local preview stack); everywhere it is unset — every
 * Production deployment — the route returns 404, so the default-off feature can
 * never leak. The canonical `/planner/native` page stays byte-identical and
 * flag-off.
 *
 * The `program` query param may still address deterministic board fixtures for
 * Agent acceptance. Repository presentation is loaded from the registered
 * program until fixtures gain their own complete repository projection.
 */
export default async function AgentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  if (process.env.ENABLE_ACADEMIC_AGENT_PREVIEW !== '1') notFound()

  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  const programId = programParam?.trim() || program.id
  const raw = await readBoardForProgram(program)
  const repo = raw ? adaptRepository(raw) : { categories: [], totalCourses: 0 }

  return (
    <ProductShell
      active="plan"
      programId={programId}
      preferLightweightBackground={false}
    >
      <UnifiedPlannerWorkspace programId={programId} repo={repo} />
    </ProductShell>
  )
}

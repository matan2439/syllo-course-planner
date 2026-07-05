import { programSubtitle } from '../../lib/board-data'
import { getProgram, programQuery } from '../../lib/programs'
import LegacyPlannerFrame from '../components/LegacyPlannerFrame'
import ProductShell from '../components/ProductShell'

export const metadata = { title: 'המתכנן המלא — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// The main planner, now inside the product experience: gradient + brand +
// cross-navigation frame the canonical planner, which runs unchanged in the
// embedded legacy frame. Raw fallback stays at /planner/legacy.
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)

  return (
    <ProductShell fullBleed programId={program.id}>
      <LegacyPlannerFrame
        programQuerySuffix={programQuery(program.id)}
        programLabel={programSubtitle(program)}
      />
    </ProductShell>
  )
}

import { programSubtitle } from '../../lib/board-data'
import { getProgram, programQuery } from '../../lib/programs'
import AiPlanningExperience from '../components/AiPlanningExperience'
import ProductShell from '../components/ProductShell'

export const metadata = { title: 'תכנון עם AI — מתכנן לימודים' }

// Guided AI planning entry — presentation only for now (see
// AiPlanningExperience). The canonical assistant stays at /planner.
export default async function AiPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)

  return (
    <ProductShell
      title="תכנון עם AI"
      subtitle={programSubtitle(program)}
      width="narrow"
      programId={program.id}
    >
      <p className="rise mb-6 max-w-lg text-sm leading-relaxed text-[var(--text-muted)]">
        נבנה תוכנית לפי מצב הלימודים, ההעדפות והעומס הרצוי.
      </p>
      <div className="rise rise-1">
        <AiPlanningExperience programQuerySuffix={programQuery(program.id)} />
      </div>
    </ProductShell>
  )
}

import { getProgram } from '../../../lib/programs'
import ProductShell from '../../components/ProductShell'
import NativePlannerJourney from '../../components/NativePlannerJourney'

export const metadata = { title: 'מתכנן חכם (Beta) — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

/**
 * The native planner journey — browser-reachable MVP. Additive alongside the
 * canonical embedded planner at /planner (which stays the working fallback):
 * current plan loads client-side from the real GET /api/board, the assistant
 * captures preferences, and "בנה תוכנית" calls the real POST /api/ai/generate-plan.
 * The whole flow lives in the client container so board load / generation /
 * apply-reject errors surface truthfully in the browser.
 */
export default async function NativePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)

  return (
    <ProductShell
      active="plan"
      programId={program.id}
      title="מתכנן חכם"
      subtitle="בטא — טעינת התוכנית הנוכחית, שיחה והעדפות, ובנייה מפורשת של הצעה דרך מנוע התכנון האמיתי."
    >
      <NativePlannerJourney programId={program.id} />
    </ProductShell>
  )
}

import { notFound } from 'next/navigation'
import ProductShell from '../../../components/ProductShell'
import NativePlannerJourney from '../../../components/NativePlannerJourney'

export const metadata = { title: 'מתכנן חכם — תצוגת בדיקה (Agent) — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

/**
 * Preview/test-ONLY route for the flagged academic-decision journey.
 *
 * This is the single browser entry point that mounts `NativePlannerJourney`
 * with `useAcademicDecisionAgent` on (Build sends `use_academic_decision_agent:
 * true`). It is NOT part of the Production surface: it renders only when the
 * explicit opt-in env `ENABLE_ACADEMIC_AGENT_PREVIEW=1` is set (git-ignored
 * `web/.env.local` in the local preview stack); everywhere it is unset — every
 * Production deployment — the route returns 404, so the default-off feature can
 * never leak. The canonical `/planner/native` page stays byte-identical and
 * flag-off.
 *
 * The `program` query param is passed straight through to the journey as the
 * board id (bypassing the program registry) so preview/test board fixtures such
 * as `test_program_agent_preview_2027` (material balanced/compact alternatives)
 * and `test_program_dual_balance_2027` (converged → balance question suppressed)
 * are reachable in a real browser. The `agent` query param toggles the flag
 * (`agent=0` → flag-OFF) so the unflagged legacy path can be compared against
 * the flagged journey on the identical deterministic fixture.
 */
export default async function AgentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; agent?: string }>
}) {
  if (process.env.ENABLE_ACADEMIC_AGENT_PREVIEW !== '1') notFound()

  const { program: programParam, agent } = await searchParams
  const programId = programParam?.trim() || 'test_program_agent_preview_2027'
  const agentOn = agent !== '0'

  return (
    <ProductShell
      active="plan"
      programId={programId}
      title="מתכנן חכם — תצוגת בדיקה"
      subtitle={
        agentOn
          ? 'סביבת בדיקה בלבד — מסלול הסוכן האקדמי מופעל (שיחת העדפות, מועמדים, שאלת איזון).'
          : 'סביבת בדיקה בלבד — מסלול מדור קודם (ללא סוכן) להשוואה.'
      }
    >
      <NativePlannerJourney programId={programId} useAcademicDecisionAgent={agentOn} />
    </ProductShell>
  )
}

import { redirect } from 'next/navigation'
import { getProgram, programQuery } from '../../lib/programs'

// The native /ai-plan entry was a presentation-only placeholder that faked a
// build animation and never called the planner API. It is retired: real AI
// planning is the embedded assistant at /planner. Redirect here so existing
// links/bookmarks land on the working surface with the selected program kept.
export default async function AiPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  redirect(`/planner${programQuery(program.id)}`)
}

import { notFound, redirect } from 'next/navigation'
import { programQuery, resolveProgram } from '../../lib/programs'

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
  const program = resolveProgram(programParam)
  if (!program) notFound()
  redirect(`/planner${programQuery(program.id)}`)
}

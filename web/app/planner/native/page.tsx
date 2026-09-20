import { notFound, redirect } from 'next/navigation'
import { programQuery, resolveProgram } from '../../../lib/programs'

// Compatibility entry retained for bookmarks and tests during route
// consolidation. There is one product destination: /planner.
export default async function NativePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  redirect(`/planner${programQuery(program.id)}`)
}

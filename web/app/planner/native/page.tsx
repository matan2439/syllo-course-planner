import { redirect } from 'next/navigation'
import { getProgram, programQuery } from '../../../lib/programs'

// Compatibility entry retained for bookmarks and tests during route
// consolidation. There is one product destination: /planner.
export default async function NativePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  redirect(`/planner${programQuery(program.id)}`)
}

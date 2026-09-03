import { notFound, redirect } from 'next/navigation'
import { programQuery, resolveProgram } from '../../lib/programs'

// Historical planning hub. The unified planner now owns manual planning,
// repository access and the Academic Decision Agent in one public workspace.
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  redirect(`/planner${programQuery(program.id)}`)
}

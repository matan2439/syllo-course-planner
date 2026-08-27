import { redirect } from 'next/navigation'
import { getProgram, programQuery } from '../../lib/programs'

// Historical planning hub. The unified planner now owns manual planning,
// repository access and the Academic Decision Agent in one public workspace.
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  redirect(`/planner${programQuery(program.id)}`)
}

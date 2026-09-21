import { notFound, redirect } from 'next/navigation'
import { programQuery, resolveProgram } from '../../lib/programs'

// Read-only duplicate of the planner course repository, retired. The unified
// workspace at /planner owns the repository drawer; keep old links working.
export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  redirect(`/planner${programQuery(program.id)}`)
}

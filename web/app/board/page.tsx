import { notFound, redirect } from 'next/navigation'
import { programQuery, resolveProgram } from '../../lib/programs'

// Read-only duplicate of the planner board, retired. The unified workspace at
// /planner owns the board; keep old links and bookmarks working.
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  redirect(`/planner${programQuery(program.id)}`)
}

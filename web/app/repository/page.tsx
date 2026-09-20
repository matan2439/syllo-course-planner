import { notFound } from 'next/navigation'
import { programSubtitle, readBoardForProgram, readBoardForProgramId } from '../../lib/board-data'
import { resolveProgram } from '../../lib/programs'
import { adaptRepository } from '../../lib/repository'
import ProductShell from '../../features/shell/components/ProductShell'
import RepositoryExplorer from '../../features/courses/components/RepositoryExplorer'
import { EmptyState } from '../../components/ui'

export const metadata = { title: 'מאגר קורסים — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Read-only Next-native repository over the same board JSON the canonical
// planner consumes (metadata.program_repository_courses). Prefer the
// data/boards/<id>.json snapshot readBoardForProgramId(program.id) uses on
// /planner — some programs (e.g. mechanical_engineering_2027) only get their
// full repository (incl. קורסי שער רוח) there; the data/parsed_json fallback
// stays for programs without that snapshot yet.
export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = resolveProgram(programParam)
  if (!program) notFound()
  const raw = (await readBoardForProgramId(program.id)) ?? (await readBoardForProgram(program))

  return (
    <ProductShell
      active="repository"
      title="מאגר קורסים"
      subtitle={programSubtitle(program, 'תצוגה בלבד')}
      width="narrow"
      programId={program.id}
    >
      {raw ? (
        <RepositoryExplorer repo={adaptRepository(raw)} programId={program.id} />
      ) : (
        <EmptyState>מאגר הקורסים לתוכנית זו עדיין לא זמין כאן</EmptyState>
      )}
    </ProductShell>
  )
}

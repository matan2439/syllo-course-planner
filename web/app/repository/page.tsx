import { programSubtitle, readBoardForProgram } from '../../lib/board-data'
import { getProgram } from '../../lib/programs'
import { adaptRepository } from '../../lib/repository'
import ProductShell from '../components/ProductShell'
import RepositoryExplorer from '../components/RepositoryExplorer'
import { EmptyState } from '../components/ui'

export const metadata = { title: 'מאגר קורסים — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Read-only Next-native repository over the same board JSON the canonical
// planner consumes (metadata.program_repository_courses).
export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  const raw = await readBoardForProgram(program)

  return (
    <ProductShell
      active="repository"
      title="מאגר קורסים"
      subtitle={programSubtitle(program, 'תצוגה בלבד')}
      width="narrow"
      programId={program.id}
    >
      {raw ? (
        <RepositoryExplorer repo={adaptRepository(raw)} />
      ) : (
        <EmptyState>מאגר הקורסים לתוכנית זו עדיין לא זמין כאן</EmptyState>
      )}
    </ProductShell>
  )
}

import { adaptBoard } from '../../lib/board'
import { programSubtitle, readBoardForProgram } from '../../lib/board-data'
import { getProgram } from '../../lib/programs'
import ProductShell from '../components/ProductShell'
import SemesterColumn from '../components/SemesterColumn'
import { EmptyState } from '../components/ui'

export const metadata = { title: 'לוח סמסטרים — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Read-only Next-native rendering of the same board JSON the canonical
// planner consumes. /planner remains the interactive, canonical surface.
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>
}) {
  const { program: programParam } = await searchParams
  const program = getProgram(programParam)
  const raw = await readBoardForProgram(program)

  return (
    <ProductShell
      active="board"
      title="לוח סמסטרים"
      subtitle={programSubtitle(program, 'תצוגה בלבד')}
      programId={program.id}
    >
      {raw ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {adaptBoard(raw).semesters.map((s, i) => (
            <SemesterColumn key={s.id} semester={s} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState>נתוני הלוח לתוכנית זו עדיין לא זמינים כאן</EmptyState>
      )}
    </ProductShell>
  )
}

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { adaptBoard, type RawBoard } from '../../lib/board'
import ProductShell from '../components/ProductShell'
import SemesterColumn from '../components/SemesterColumn'

export const metadata = { title: 'לוח סמסטרים — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Read-only Next-native rendering of the same board JSON the canonical
// planner consumes. /planner remains the interactive, canonical surface;
// this page is the first migrated slice (cards + semester columns).
const BOARD_JSON = path.resolve(
  process.cwd(),
  '..',
  'data',
  'parsed_json',
  'mechanical_semester_board_2027.json'
)

export default async function BoardPage() {
  const raw = JSON.parse(await readFile(BOARD_JSON, 'utf8')) as RawBoard
  const board = adaptBoard(raw)

  return (
    <ProductShell
      active="board"
      title="לוח סמסטרים"
      subtitle="הנדסה מכנית · 2027 (תשפ״ז) — תצוגה בלבד"
    >
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {board.semesters.map((s, i) => (
          <SemesterColumn key={s.id} semester={s} index={i} />
        ))}
      </div>
    </ProductShell>
  )
}

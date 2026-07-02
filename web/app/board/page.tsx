import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Link from 'next/link'
import { adaptBoard, type RawBoard } from '../../lib/board'
import BrandLogo from '../components/BrandLogo'
import SemesterColumn from '../components/SemesterColumn'
import ShaderGradientBackground from '../components/ShaderGradientBackground'

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
    <>
      <ShaderGradientBackground />

      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--purple)]"
          >
            <BrandLogo size={26} />
            <span className="text-sm font-semibold tracking-tight">
              מתכנן לימודים
            </span>
          </Link>
          <Link
            href="/planner"
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-purple-500/40 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
          >
            למתכנן המלא
          </Link>
        </header>

        <main className="flex-1 pb-16">
          <div className="rise mb-6">
            <h1 className="text-xl font-bold tracking-tight">לוח סמסטרים</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              הנדסה מכנית · 2027 (תשפ״ז) — תצוגה בלבד
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {board.semesters.map((s, i) => (
              <SemesterColumn key={s.id} semester={s} index={i} />
            ))}
          </div>
        </main>
      </div>
    </>
  )
}

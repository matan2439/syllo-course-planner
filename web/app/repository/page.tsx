import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Link from 'next/link'
import type { RawBoard } from '../../lib/board'
import { adaptRepository } from '../../lib/repository'
import BrandLogo from '../components/BrandLogo'
import RepositoryExplorer from '../components/RepositoryExplorer'
import ShaderGradientBackground from '../components/ShaderGradientBackground'

export const metadata = { title: 'מאגר קורסים — מתכנן לימודים' }
export const dynamic = 'force-dynamic'

// Read-only Next-native repository over the same board JSON the canonical
// planner consumes (metadata.program_repository_courses). /planner remains
// the interactive, canonical surface.
const BOARD_JSON = path.resolve(
  process.cwd(),
  '..',
  'data',
  'parsed_json',
  'mechanical_semester_board_2027.json'
)

export default async function RepositoryPage() {
  const raw = JSON.parse(await readFile(BOARD_JSON, 'utf8')) as RawBoard
  const repo = adaptRepository(raw)

  return (
    <>
      <ShaderGradientBackground />

      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 sm:px-6">
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
          <nav className="flex items-center gap-2">
            <Link
              href="/board"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
            >
              לוח סמסטרים
            </Link>
            <Link
              href="/planner"
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-purple-500/40 hover:text-[var(--purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple)]"
            >
              למתכנן המלא
            </Link>
          </nav>
        </header>

        <main className="flex-1 pb-16">
          <div className="rise mb-6 text-center">
            <h1 className="text-xl font-bold tracking-tight">מאגר קורסים</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              הנדסה מכנית · 2027 (תשפ״ז) — תצוגה בלבד
            </p>
          </div>

          <RepositoryExplorer repo={repo} />
        </main>
      </div>
    </>
  )
}

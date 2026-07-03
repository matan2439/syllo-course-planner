import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { RawBoard } from '../../lib/board'
import { adaptRepository } from '../../lib/repository'
import ProductShell from '../components/ProductShell'
import RepositoryExplorer from '../components/RepositoryExplorer'

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
    <ProductShell
      active="repository"
      title="מאגר קורסים"
      subtitle="הנדסה מכנית · 2027 (תשפ״ז) — תצוגה בלבד"
      width="narrow"
    >
      <RepositoryExplorer repo={repo} />
    </ProductShell>
  )
}

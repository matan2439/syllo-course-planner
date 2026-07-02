import { readFile } from 'node:fs/promises'
import path from 'node:path'

// The planner HTML loads static JSON relative to its own path — board/audit
// from ../../data/parsed_json/ and the program definition from
// ../../data/programs/ (see semester_board_viewer.html). Served through Next
// at /planner those URLs resolve to /data/<dir>/<file>, so this route exposes
// exactly those two directories read-only and keeps /planner functional
// without `vercel dev`. Assumes cwd = web/.
const DATA_ROOT = path.resolve(process.cwd(), '..', 'data')
const ALLOWED_DIRS = new Set(['parsed_json', 'programs'])

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dir: string; file: string }> }
) {
  const { dir, file } = await params
  // Trust boundary: known dirs and plain .json filenames only, no traversal
  if (!ALLOWED_DIRS.has(dir) || !/^[\w.-]+\.json$/.test(file)) {
    return new Response('Not found', { status: 404 })
  }
  try {
    const body = await readFile(path.join(DATA_ROOT, dir, file), 'utf8')
    return new Response(body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

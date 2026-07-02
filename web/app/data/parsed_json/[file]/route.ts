import { readFile } from 'node:fs/promises'
import path from 'node:path'

// The planner HTML's fetchBoardJSON falls back to ../../data/parsed_json/*.json
// when /api/board is unreachable (see semester_board_viewer.html). Served
// through Next at /planner those URLs resolve to /data/parsed_json/*, so this
// route exposes that directory read-only and keeps /planner functional
// without `vercel dev`. Assumes cwd = web/.
const DATA_DIR = path.resolve(process.cwd(), '..', 'data', 'parsed_json')

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params
  // Trust boundary: only plain .json filenames, no traversal
  if (!/^[\w.-]+\.json$/.test(file)) {
    return new Response('Not found', { status: 404 })
  }
  try {
    const body = await readFile(path.join(DATA_DIR, file), 'utf8')
    return new Response(body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

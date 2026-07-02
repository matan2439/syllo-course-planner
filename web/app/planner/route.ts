import { readFile } from 'node:fs/promises'
import path from 'node:path'

// The planner UI is still the canonical single-file static HTML that production
// Vercel serves at "/" (see /vercel.json). This route wraps it into the Next
// app without duplicating the 16k-line file, so both surfaces stay in sync
// until sections are migrated into real components.
// Assumes Next runs with cwd = web/ (its `npm run dev`/`build` default).
const PLANNER_HTML = path.resolve(
  process.cwd(),
  '..',
  'app',
  'web',
  'semester_board_viewer.html'
)

export const dynamic = 'force-dynamic'

export async function GET() {
  const html = await readFile(PLANNER_HTML, 'utf8')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

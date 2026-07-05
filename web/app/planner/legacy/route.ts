import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { injectPlannerHtml } from '../../../lib/embed-html'

// Raw legacy planner: the canonical single-file static HTML, served in its own
// document context so its 16k lines of scripts, localStorage and theme run
// unchanged. /planner (page.tsx) embeds this via an iframe inside ProductShell;
// this route is also the honest raw fallback if the frame ever fails.
// Assumes Next runs with cwd = web/ (its `npm run dev`/`build` default).
const PLANNER_HTML = path.resolve(
  process.cwd(),
  '..',
  'app',
  'web',
  'semester_board_viewer.html'
)

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const html = await readFile(PLANNER_HTML, 'utf8')
  const embed = new URL(request.url).searchParams.get('embed') === '1'
  return new Response(injectPlannerHtml(html, { embed }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

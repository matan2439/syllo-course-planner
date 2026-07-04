import { readFile } from 'node:fs/promises'
import path from 'node:path'

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

// Presentational bridge, injected at serve time only (the canonical file is
// untouched): the HTML defaults to light unless localStorage tau_theme is
// set, which breaks visual continuity for dark-OS users arriving from the
// Next pages. Seed the theme from prefers-color-scheme on first visit; an
// explicit in-app toggle still wins afterwards. Same-origin with the shell, so
// the seed shares localStorage with the rest of the product.
const THEME_SEED = `<script>try{if(!localStorage.getItem('tau_theme')&&matchMedia('(prefers-color-scheme: dark)').matches){localStorage.setItem('tau_theme','dark');document.documentElement.dataset.theme='dark';}}catch(e){}</script>`

export async function GET() {
  const html = await readFile(PLANNER_HTML, 'utf8')
  return new Response(html.replace('<head>', `<head>${THEME_SEED}`), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

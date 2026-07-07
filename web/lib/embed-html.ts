/**
 * Serve-time-only HTML injection for /planner/legacy. Never mutates the
 * canonical app/web/semester_board_viewer.html on disk — this only rewrites
 * the response string after reading it.
 *
 * embed=true is used by the /planner iframe to collapse the visible
 * two-header seam: the legacy .page-hdr duplicates the program label/actions
 * the outer ProductShell toolbar already mirrors (see LegacyPlannerFrame),
 * so it is hidden only in embedded mode. The raw /planner/legacy fallback
 * (embed=false) is unaffected — same theme-seed bridge as before.
 *
 * .sidebar's `height: calc(100vh - var(--hdr-h))` is not flex-relative to
 * .page-hdr's actual box, so hiding it alone would leave a --hdr-h (54px)
 * gap under the sidebar; the injected style zeroes --hdr-h too.
 */

// The HTML defaults to light unless localStorage tau_theme is set, which
// breaks visual continuity for dark-OS users arriving from the Next pages.
// Seed the theme from prefers-color-scheme on first visit; an explicit
// in-app toggle still wins afterwards. Same-origin with the shell, so the
// seed shares localStorage with the rest of the product.
const THEME_SEED = `<script>try{if(!localStorage.getItem('tau_theme')&&matchMedia('(prefers-color-scheme: dark)').matches){localStorage.setItem('tau_theme','dark');document.documentElement.dataset.theme='dark';}}catch(e){}</script>`

// Workspace-density polish for the embedded planner only. Every selector
// below matches the exact one already declared in semester_board_viewer.html
// (verified by reading the file), so — same as --hdr-h above — the cascade's
// last-in-<head> rule lets it win with no !important. Reuses the shell's own
// design tokens (--border2, --text-faint, --shadow-premium) rather than
// inventing new colors, and only adds hover/empty-state rules the base
// stylesheet doesn't already have — no existing rule is overridden away.
const EMBED_POLISH_STYLE = `<style>
.repo-group > summary { font-size: .74rem; padding: 8px 10px; }
.chip { font-size: .72rem; padding: 3px 9px; }
.course-card:hover, .course-card:focus-within {
  transform: translateY(-1px);
  border-color: var(--border2);
  box-shadow: var(--shadow-premium);
}
.sem-zone:empty::before {
  content: 'אין קורסים משובצים כאן';
  display: block;
  text-align: center;
  padding: 22px 10px;
  border: 1px dashed var(--border2);
  border-radius: 10px;
  color: var(--text-faint);
  font-size: .68rem;
}
.wl-track { height: 6px; }
.wl-fill.over, .wl-fill.blocked { box-shadow: 0 0 6px rgba(239,68,68,.5); }
</style>`

const EMBED_STYLE = `<style>:root{--hdr-h:0px}.page-hdr{display:none!important}</style>${EMBED_POLISH_STYLE}`

export function injectPlannerHtml(html: string, opts: { embed: boolean }): string {
  let out = html.replace('<head>', `<head>${THEME_SEED}`)
  if (opts.embed) {
    // :root is equal specificity to the base stylesheet's own :root{--hdr-h:54px}
    // rule — the later declaration wins the cascade, so this must land last in
    // <head> (right before </head>), not first, or the override silently loses.
    out = out.replace('</head>', `${EMBED_STYLE}</head>`)
  }
  return out
}

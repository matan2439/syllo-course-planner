/**
 * Behavioral test for the /planner/legacy serve-time HTML injection,
 * including the new embed=1 scoped CSS that collapses the visible
 * two-header seam for the embedded /planner iframe.
 *
 * `injectPlannerHtml` is the pure function the route's GET handler calls
 * after reading the canonical file — tested here directly against a literal
 * HTML fixture (no fs/cwd), so this proves real string-injection behavior,
 * not just source text.
 *
 * The raw /planner/legacy fallback (embed=false) must render exactly as
 * before (theme-seed only) — the canonical app/web/semester_board_viewer.html
 * source file is never touched; this is a serve-time-only injection.
 *
 * .sidebar's height: calc(100vh - var(--hdr-h)) is not flex-relative, so
 * hiding .page-hdr alone would leave a 54px gap — the injected style must
 * also zero --hdr-h.
 */
import { injectPlannerHtml } from '../../web/lib/embed-html';

const FIXTURE_HTML = '<html><head><title>x</title></head><body>legacy</body></html>';

// Reproduces the base stylesheet's real :root{--hdr-h:54px} declaration
// (app/web/semester_board_viewer.html line 63) to prove the CSS cascade
// ordering, not just string presence.
const FIXTURE_WITH_BASE_CSS =
  '<html><head><title>x</title><style>:root{--hdr-h:54px}</style></head><body>legacy</body></html>';

test('embed=false (raw /planner/legacy) injects only the theme-seed bridge', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: false });
  expect(html).toContain('tau_theme');
  expect(html).toContain('prefers-color-scheme');
  expect(html).not.toContain('--hdr-h:0');
  expect(html).not.toMatch(/\.page-hdr\s*\{\s*display:\s*none/);
});

test('embed=true injects scoped CSS hiding the legacy header', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/\.page-hdr\s*\{\s*display:\s*none\s*!important/);
});

test('embed=true zeroes --hdr-h so the sidebar height recalculates', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/--hdr-h:\s*0/);
});

test('embed=true keeps the theme-seed bridge too (both injections coexist)', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toContain('tau_theme');
});

test('embed=true makes the legacy document transparent so the app background shows through', () => {
  // Background integration: the embedded planner drops its own opaque body
  // background + its own body::before syllo gradient so the single shell
  // background (ShaderGradientBackground / .syllo-bg) shows through the iframe
  // as one continuous surface.
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/html,\s*body\s*\{[^}]*background:\s*transparent\s*!important/s);
  expect(html).toMatch(/body::before\s*\{[^}]*display:\s*none\s*!important/s);
});

test('embed=false (raw /planner/legacy) keeps its own opaque background', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: false });
  expect(html).not.toMatch(/background:\s*transparent/);
  expect(html).not.toContain('body::before');
});

test('embed injection only adds content — never rewrites the rest of the document', () => {
  const plain = injectPlannerHtml(FIXTURE_HTML, { embed: false });
  const embedded = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(embedded.length).toBeGreaterThan(plain.length);
  expect(embedded).toContain('<title>x</title>');
  expect(embedded).toContain('<body>legacy</body>');
  // Everything after stripping every added <style> block must equal the
  // plain output. Matches any <style> content generically (not a hardcoded
  // literal) so this stays valid as the embed-only polish CSS grows.
  const embeddedWithoutStyles = embedded.replace(/<style>[\s\S]*?<\/style>/g, '');
  expect(embeddedWithoutStyles).toBe(plain);
});

test('the injection point is <head>, so it never runs twice even if called twice', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  const count = (html.match(/<head>/g) || []).length;
  expect(count).toBe(1);
});

test('the --hdr-h:0 override wins the CSS cascade over the base :root{--hdr-h:54px} rule', () => {
  // Both are :root selectors (equal specificity) — the LATER declaration in
  // source order wins. The base stylesheet's real --hdr-h:54px rule sits
  // deep inside <head>, so the override must land last in <head> (right
  // before </head>), not first (right after <head>), or it silently loses.
  const html = injectPlannerHtml(FIXTURE_WITH_BASE_CSS, { embed: true });
  const overrideIdx = html.indexOf('--hdr-h:0px');
  const baseIdx = html.indexOf('--hdr-h:54px');
  expect(overrideIdx).toBeGreaterThan(-1);
  expect(baseIdx).toBeGreaterThan(-1);
  expect(overrideIdx).toBeGreaterThan(baseIdx);
});

/**
 * Embed-scoped visual polish (workspace-density pass). All rules below reuse
 * the exact selectors and CSS custom properties already declared in the
 * canonical semester_board_viewer.html (confirmed by reading the file
 * directly) — same specificity, so the cascade-order rule proven above lets
 * them win without !important. Purely presentational: no new HTML, no JS,
 * no change to the raw (embed=false) fallback.
 */
test('embed=true improves sidebar category-header and chip readability', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/\.repo-group > summary\s*\{[^}]*font-size:\s*\.7[0-9]rem/);
  expect(html).toMatch(/\.chip\s*\{[^}]*font-size:\s*\.7[0-9]rem/);
});

test('embed=true adds a course-card hover/focus lift reusing the shell shadow token', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  // Reuses --shadow-premium (the same token the Next-native repository card
  // uses) rather than inventing a new shadow, so both surfaces feel unified.
  expect(html).toMatch(/\.course-card:hover,\s*\.course-card:focus-within\s*\{[^}]*var\(--shadow-premium\)/s);
});

test('embed=true gives empty semesters an intentional placeholder, not blank space', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/\.sem-zone:empty::before\s*\{[^}]*content:/s);
});

test('embed=true makes the overload/blocked weekly-load state more visually obvious', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  expect(html).toMatch(/\.wl-track\s*\{[^}]*height:/);
  expect(html).toMatch(/\.wl-fill\.over,\s*\.wl-fill\.blocked\s*\{[^}]*box-shadow:/s);
});

test('embed=false (raw /planner/legacy) never receives the workspace-polish CSS', () => {
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: false });
  expect(html).not.toContain('.repo-group > summary');
  expect(html).not.toContain('.sem-zone:empty::before');
});

test('the polish rules use no !important — cascade order (last in <head>) already wins', () => {
  // The pre-existing header-collapse rule (.page-hdr{display:none!important})
  // legitimately needs !important and is untouched by this pass — scope the
  // assertion to only the new polish selectors, not the whole injected output.
  const html = injectPlannerHtml(FIXTURE_HTML, { embed: true });
  const polishStart = html.indexOf('.repo-group > summary');
  expect(polishStart).toBeGreaterThan(-1);
  const polishBlock = html.slice(polishStart);
  expect(polishBlock).not.toContain('!important');
});

/**
 * Guards the "two headers" seam fix: cross-cutting legacy planner actions
 * (my courses / change degree / reset) are surfaced in the outer ProductShell
 * frame on /planner and wired to the legacy iframe via a same-origin bridge,
 * rather than living only inside the legacy in-frame toolbar.
 *
 * The legacy planner (app/web/semester_board_viewer.html) must stay
 * untouched: its own header buttons keep working, and this suite would fail
 * if that file changed at all (see the "legacy HTML unmodified" test below).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('/planner still renders the ProductShell full-bleed frame', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('ProductShell');
  expect(page).toContain('fullBleed');
  expect(page).toContain('LegacyPlannerFrame');
});

test('the iframe still points at /planner/legacy and preserves ?program=', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('/planner/legacy');
  expect(frame).toContain('programQuerySuffix');
});

test('LegacyPlannerFrame exposes outer actions for the three cross-cutting buttons', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('הקורסים שלי');
  expect(frame).toContain('החלפת תואר');
  expect(frame).toContain('איפוס');
});

test('the outer actions call the legacy iframe window, not dead buttons', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  // must reach into the same-origin iframe's global functions
  expect(frame).toMatch(/contentWindow/);
  expect(frame).toContain('openMyCoursesModal');
  expect(frame).toContain('showModal');
  expect(frame).toContain('resetBoard');
});

test('the outer reset action is confirmation-gated', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  // resetBoard() itself has no confirmation in the legacy file (verified
  // separately) — the outer bridge must add one rather than firing it bare.
  const callSite = frame.indexOf("callLegacy('resetBoard')");
  expect(callSite).toBeGreaterThan(-1);
  const surrounding = frame.slice(Math.max(0, callSite - 400), callSite);
  expect(surrounding).toMatch(/confirm/i);
});

test('the outer frame labels the embedded workspace as the full interface', () => {
  // Subtle context text so the outer product toolbar reads intentionally as
  // the planner workspace, not a second competing header.
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('הממשק המלא');
});

test('the planner page feeds the current program label into the outer toolbar', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('programLabel');
});

test('the outer toolbar renders a current-program label (mirrors #hdr-prog-name)', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('programLabel');
});

test('the outer toolbar has a theme control synced to the legacy tau_theme source', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  // writes the same key the legacy planner reads, and re-applies it in-frame
  expect(frame).toContain('tau_theme');
  expect(frame).toContain('applyTheme');
});

test('the shell can be manually themed via a data-theme attribute override', () => {
  const css = read('web/app/globals.css');
  expect(css).toMatch(/\[data-theme=['"]dark['"]\]/);
});

test('the layout seeds the shell theme from tau_theme before paint (no reload desync)', () => {
  const layout = read('web/app/layout.tsx');
  expect(layout).toContain('tau_theme');
});

test('the html element suppresses the theme-bootstrap hydration mismatch', () => {
  // the pre-paint script mutates <html data-theme>, which the server cannot
  // know — without this the browser logs a hydration-mismatch error.
  const layout = read('web/app/layout.tsx');
  expect(layout).toContain('suppressHydrationWarning');
});

test('/planner/legacy route is unchanged and still serves the canonical file', () => {
  const route = read('web/app/planner/legacy/route.ts');
  expect(route).toMatch(/app[/\\'",\s]+web[/\\'",\s]+semester_board_viewer\.html/);
});

test('the canonical legacy HTML file was not modified by this feature', () => {
  const diff = execSync('git diff --name-only HEAD -- app/web/semester_board_viewer.html', {
    cwd: ROOT,
  }).toString().trim();
  expect(diff).toBe('');
});

test('legacy in-frame header buttons still exist (not removed this slice)', () => {
  const html = read('app/web/semester_board_viewer.html');
  expect(html).toContain('id="btn-my-courses"');
  expect(html).toContain('id="btn-change-prog"');
  expect(html).toContain('id="btn-reset"');
});

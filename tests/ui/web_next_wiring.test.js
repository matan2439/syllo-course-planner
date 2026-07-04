/**
 * Guards the Next.js (web/) wrap of the static planner:
 *  - /planner route must keep pointing at the canonical static HTML file
 *  - landing page must link into the planner
 *  - theme-aware brand assets must exist where BrandLogo expects them
 * Catches the real failure mode: someone moves/renames the HTML or brand
 * assets and the Next entry surface silently 404s.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('canonical static planner HTML exists', () => {
  expect(fs.existsSync(path.join(ROOT, 'app/web/semester_board_viewer.html'))).toBe(true);
});

test('/planner/legacy route serves the canonical HTML file', () => {
  const route = read('web/app/planner/legacy/route.ts');
  expect(route).toMatch(/app[/\\'",\s]+web[/\\'",\s]+semester_board_viewer\.html/);
});

test('/planner is a product-shell surface wrapping the legacy planner frame', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('ProductShell');
  expect(page).toContain('LegacyPlannerFrame');
});

test('the legacy planner frame embeds the raw /planner/legacy route', () => {
  expect(read('web/app/components/LegacyPlannerFrame.tsx')).toContain('/planner/legacy');
});

test('landing primary CTA starts the guided flow, not the raw planner', () => {
  const page = read('web/app/page.tsx');
  expect(page).toContain('/ai-plan');
});

test('landing page offers the plan hub as a quiet secondary route', () => {
  const page = read('web/app/page.tsx');
  expect(page).toMatch(/href="\/plan"/);
});

test('data route serves the static JSON fallbacks the planner HTML fetches', () => {
  // The HTML loads ../../data/parsed_json/*.json (board, audit) and
  // ../../data/programs/*.json (program definition) relative to /planner,
  // so Next must expose both directories read-only.
  const route = read('web/app/data/[dir]/[file]/route.ts');
  expect(route).toContain('parsed_json');
  expect(route).toContain('programs');
});

test('/board page renders through the board adapter (Next-native slice)', () => {
  const page = read('web/app/board/page.tsx');
  expect(page).toContain('adaptBoard');
});

test('/repository page renders through the repository adapter', () => {
  const page = read('web/app/repository/page.tsx');
  expect(page).toContain('adaptRepository');
});

test('/plan hub renders the data-shipped overview inside the shell', () => {
  const page = read('web/app/plan/page.tsx');
  expect(page).toContain('planOverview');
  expect(page).toContain('ProductShell');
});

test('/plan renders the requirements progress panel from shipped metadata', () => {
  expect(read('web/app/plan/page.tsx')).toContain('adaptRequirements');
  expect(read('web/app/components/RequirementsProgressPanel.tsx')).toContain('RequirementCategoryCard');
});

test('/programs picker renders the shipped program families', () => {
  expect(read('web/app/programs/page.tsx')).toContain('listProgramFamilies');
});

test('plan, board and repository resolve the program from the query param', () => {
  for (const page of ['plan', 'board', 'repository']) {
    expect(read(`web/app/${page}/page.tsx`)).toContain('getProgram');
  }
});

test('the shell preserves a non-default program selection on nav links', () => {
  expect(read('web/app/components/ProductShell.tsx')).toContain('programQuery');
});

test('/ai-plan resolves the selected program like every other surface', () => {
  const page = read('web/app/ai-plan/page.tsx');
  expect(page).toContain('getProgram');
  expect(page).toContain('AiPlanningExperience');
});

test('/plan AI section and the shell CTA route to the guided /ai-plan entry', () => {
  expect(read('web/app/plan/page.tsx')).toContain("'/ai-plan'");
  expect(read('web/app/components/ProductShell.tsx')).toContain('/ai-plan');
});

test('the AI experience ships honest loading and error state copy', () => {
  const xp = read('web/app/components/AiPlanningExperience.tsx');
  expect(xp).toContain('בודק דרישות'); // staged loading, same language as the canonical panel
  expect(xp).toContain('לא הצלחנו לבנות תוכנית כרגע'); // calm error state
  expect(xp).toContain('/planner'); // hands off to the real assistant, no fake generation
});

test('the shared shell navigates to all planner surfaces', () => {
  const shell = read('web/app/components/ProductShell.tsx');
  expect(shell).toContain('/repository');
  expect(shell).toContain('/board');
  expect(shell).toContain('/ai-plan'); // canonical /planner is one hop away via the AI entry
  expect(shell).toContain('/plan');
});

test('board and repository render inside the shared ProductShell', () => {
  expect(read('web/app/components/ProductShell.tsx')).toContain('ShaderGradientBackground');
  expect(read('web/app/board/page.tsx')).toContain('ProductShell');
  expect(read('web/app/repository/page.tsx')).toContain('ProductShell');
});

test('/planner/legacy seeds the static planner theme from the OS scheme', () => {
  // The HTML defaults to light unless localStorage tau_theme is set; the
  // legacy wrapper injects a seed so dark-mode users get visual continuity
  // even inside the embedded frame (same-origin localStorage).
  const route = read('web/app/planner/legacy/route.ts');
  expect(route).toContain('tau_theme');
  expect(route).toContain('prefers-color-scheme');
});

test('a global route-transition template wraps every surface', () => {
  const template = read('web/app/template.tsx');
  expect(template).toContain('route-fade');
});

test('the route transition and reduced-motion rules live in globals', () => {
  const css = read('web/app/globals.css');
  expect(css).toContain('route-fade');
  expect(css).toContain('prefers-reduced-motion');
});

test('ProductShell supports a full-bleed variant for the embedded planner', () => {
  expect(read('web/app/components/ProductShell.tsx')).toContain('fullBleed');
});

test('theme-aware logo assets exist at the documented convention paths', () => {
  expect(fs.existsSync(path.join(ROOT, 'web/public/brand/logo-light.svg'))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, 'web/public/brand/logo-dark.svg'))).toBe(true);
});

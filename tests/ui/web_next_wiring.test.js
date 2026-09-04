/**
 * Guards the canonical Next.js planner and its legacy rollback route:
 *  - /planner must render the unified React workspace
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

test('/planner is the product-shell surface for the unified React workspace', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('ProductShell');
  expect(page).toContain('UnifiedPlannerWorkspace');
  expect(page).not.toContain('LegacyPlannerFrame');
});

test('the legacy planner frame embeds the raw /planner/legacy route', () => {
  expect(read('web/app/components/LegacyPlannerFrame.tsx')).toContain('/planner/legacy');
});

test('landing primary CTA opens the working /planner assistant, not the retired placeholder', () => {
  const page = read('web/app/page.tsx');
  expect(page).toContain('href="/planner"');
  expect(page).not.toContain('/ai-plan');
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

test('/plan redirects the historical hub to the canonical planner', () => {
  const page = read('web/app/plan/page.tsx');
  expect(page).toContain('redirect');
  expect(page).toContain('/planner');
});

test('the retained requirements panel remains available to native consumers', () => {
  expect(read('web/app/components/RequirementsProgressPanel.tsx')).toContain('RequirementCategoryCard');
});

test('/programs picker renders the shipped program families', () => {
  expect(read('web/app/programs/page.tsx')).toContain('listProgramFamilies');
});

test('plan, board and repository resolve the program from the query param', () => {
  for (const page of ['plan', 'board', 'repository']) {
    expect(read(`web/app/${page}/page.tsx`)).toContain('resolveProgram');
  }
});

test('the shell preserves a non-default program selection on nav links', () => {
  expect(read('web/app/components/ProductShell.tsx')).toContain('programQuery');
});

test('/ai-plan is retired — it redirects to the canonical /planner assistant, preserving program', () => {
  const page = read('web/app/ai-plan/page.tsx');
  expect(page).toContain('redirect');
  expect(page).toContain('/planner');
  expect(page).toContain('resolveProgram'); // still resolves/normalizes the selected program before redirecting
  expect(page).not.toContain('AiPlanningExperience');
});

test('/plan AI section and the shell CTA route to the working /planner assistant', () => {
  expect(read('web/app/plan/page.tsx')).toContain('`/planner');
  expect(read('web/app/plan/page.tsx')).not.toContain("'/ai-plan'");
  expect(read('web/app/components/ProductShell.tsx')).toContain('/planner');
  expect(read('web/app/components/ProductShell.tsx')).not.toContain('/ai-plan');
});

test('the fake AI placeholder experience is removed — no client-side fake generation ships', () => {
  // AiPlanningExperience faked a loading animation and never called the API;
  // it is deleted so nothing pretends to generate a plan (real generation is
  // the embedded assistant at /planner). See Failure #2 root cause.
  expect(fs.existsSync(path.join(ROOT, 'web/app/components/AiPlanningExperience.tsx'))).toBe(false);
});

test('the shared shell navigates to all planner surfaces including the assistant', () => {
  const shell = read('web/app/components/ProductShell.tsx');
  expect(shell).toContain('/repository');
  expect(shell).toContain('/board');
  expect(shell).toContain('/planner'); // the working unified AI assistant
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
  // even inside the embedded frame (same-origin localStorage). The seed
  // string itself lives in lib/embed-html.ts (shared with the embed=1
  // injection); the route wires it in via injectPlannerHtml — see
  // tests/ui/planner_legacy_embed.test.ts for the behavioral proof.
  const route = read('web/app/planner/legacy/route.ts');
  expect(route).toContain('injectPlannerHtml');
  const embedHtml = read('web/lib/embed-html.ts');
  expect(embedHtml).toContain('tau_theme');
  expect(embedHtml).toContain('prefers-color-scheme');
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

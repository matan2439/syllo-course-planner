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

test('/planner route serves the canonical HTML file', () => {
  const route = read('web/app/planner/route.ts');
  expect(route).toMatch(/app[/\\'",\s]+web[/\\'",\s]+semester_board_viewer\.html/);
});

test('landing page links to /planner', () => {
  const page = read('web/app/page.tsx');
  expect(page).toContain('/planner');
});

test('theme-aware logo assets exist at the documented convention paths', () => {
  expect(fs.existsSync(path.join(ROOT, 'web/public/brand/logo-light.svg'))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, 'web/public/brand/logo-dark.svg'))).toBe(true);
});

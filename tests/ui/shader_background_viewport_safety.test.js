/**
 * Guards the fix for a real, verified bug: .syllo-bg's -10% inset overscan
 * (needed so the drift animation's scale(1.02) never reveals a hard edge)
 * made its own fixed-position box 20% larger than the viewport in both
 * dimensions. With no clipping boundary, Chromium included that oversized
 * box when computing document.documentElement.scrollHeight/scrollWidth,
 * producing a genuine ~81px vertical + ~21px horizontal phantom scroll on
 * every ProductShell route at mobile widths (verified: 0/0 on /planner/legacy,
 * which has no ShaderGradientBackground — confirms total isolation here).
 *
 * Fix: .syllo-bg itself becomes the viewport-exact (inset:0), overflow:hidden
 * clip boundary; the overscanned, animated background moves to .syllo-bg::before
 * (position:absolute, inset:-10%, relative to the clipping parent). Same
 * rendered pixels and drift headroom — ShaderGradientBackground.tsx needs no
 * change, since the class name on its single <div> is unchanged.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CSS = 'web/app/globals.css';
const COMPONENT = 'web/app/components/ShaderGradientBackground.tsx';

test('.syllo-bg is a viewport-exact, non-overscanned clip boundary', () => {
  const css = read(CSS);
  const match = css.match(/(?<!:)\.syllo-bg\s*\{([^}]*)\}/);
  expect(match).not.toBeNull();
  const body = match[1];
  expect(body).toMatch(/position:\s*fixed/);
  expect(body).toMatch(/inset:\s*0\b/); // not -10% — must not itself overscan
  expect(body).toMatch(/overflow:\s*hidden/);
});

test('the overscanned, animated layer moved to .syllo-bg::before, clipped by the parent', () => {
  const css = read(CSS);
  const match = css.match(/\.syllo-bg::before\s*\{([^}]*)\}/s);
  expect(match).not.toBeNull();
  const body = match[1];
  expect(body).toMatch(/position:\s*absolute/);
  expect(body).toMatch(/inset:\s*-10%/); // the preserved drift-safety overscan
  expect(body).toContain('animation: syllo-drift');
  expect(body).toContain('var(--syllo-bg-image)');
});

test('ShaderGradientBackground needs no change — same single .syllo-bg div', () => {
  const src = read(COMPONENT);
  expect(src).toContain('className="syllo-bg"');
});

test('the fix does not touch reduced-motion or theme handling', () => {
  const css = read(CSS);
  expect(css).toContain('prefers-reduced-motion');
  expect(css).toContain('--syllo-bg-image');
});

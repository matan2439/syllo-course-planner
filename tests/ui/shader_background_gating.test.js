/**
 * Route gating for the real WebGL ShaderGradient background.
 *
 * The shader renders on the visible app-shell/content routes, but the
 * fullBleed legacy embeds stay lightweight, while the canonical unified
 * planner explicitly keeps the visible product background. /planner/legacy
 * has no ProductShell at all.
 *
 * These are source-level wiring assertions (no board fixture needed), matching
 * the style of web_next_wiring / shader_background_viewport_safety.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('ProductShell derives a lightweight-background flag from fullBleed and passes it down', () => {
  const shell = read('web/app/components/ProductShell.tsx');
  expect(shell).toMatch(/preferLightweightBackground\s*\?\?\s*fullBleed/);
  expect(shell).toMatch(/<ShaderGradientBackground\s+lightweight=\{/);
});

test('ShaderGradientBackground gates the WebGL scene on the lightweight prop', () => {
  const bg = read('web/app/components/ShaderGradientBackground.tsx');
  expect(bg).toContain('lightweight');
  expect(bg).toContain('ShaderScene');
  // WebGL is skipped when lightweight (and only mounts client-side).
  expect(bg).toMatch(/!lightweight/);
  expect(bg).toContain("ssr: false");
  // The CSS fallback / clip box is always present.
  expect(bg).toContain('className="syllo-bg"');
});

test('/planner explicitly keeps the product background for the unified workspace', () => {
  const page = read('web/app/planner/page.tsx');
  expect(page).toContain('preferLightweightBackground={false}');
  expect(page).toContain('UnifiedPlannerWorkspace');
});

test('the shader scene never intercepts input and uses the documented waterPlane config', () => {
  const scene = read('web/app/components/ShaderScene.tsx');
  expect(scene).toContain("pointerEvents=\"none\"");
  expect(scene).toContain("type=\"waterPlane\"");
});

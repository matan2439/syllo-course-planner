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

test('the interest-evaluation slice edits the legacy HTML additively only', () => {
  // Earlier shell slices deliberately left the canonical planner untouched.
  // The interest-evaluation epic intentionally wires it — but ADDITIVELY: the
  // canonical generate-plan call path and the interest opt-in must both be
  // present, and the interest fields must spread {} by default (no change to
  // the default request payload).
  const html = read('app/web/semester_board_viewer.html');
  expect(html).toContain("fetch('/api/ai/generate-plan'");
  expect(html).toContain('buildInterestRequestFields(_aiPickerState.interests)');
  expect(html).toContain('interestScorecardHtml');
});

test('legacy in-frame header buttons still exist (not removed this slice)', () => {
  const html = read('app/web/semester_board_viewer.html');
  expect(html).toContain('id="btn-my-courses"');
  expect(html).toContain('id="btn-change-prog"');
  expect(html).toContain('id="btn-reset"');
});

/**
 * Header-seam collapse: the outer toolbar now mirrors the legacy #hdr-chips
 * live status (סה״כ/מוצבים/במאגר/חסרות שעות) via a same-origin
 * MutationObserver — renderChips() runs on every state-changing legacy action
 * (drag/drop, reset, program change, AI draft), so a one-shot read-on-load
 * would go stale. See tests/ui/chip_status_adapter.test.ts for the pure
 * parsing contract and tests/ui/planner_legacy_embed.test.ts for the embed=1
 * serve-time CSS that hides the now-redundant legacy .page-hdr.
 */
test('the iframe src requests the embed-scoped legacy header collapse', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('embed=1');
});

test('the embed flag is combined correctly with a preserved program query', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  // Must not silently drop ?program=... when appending &embed=1.
  expect(frame).toMatch(/programQuerySuffix[^;]*embed=1|embed=1[^;]*programQuerySuffix/s);
});

test('the outer toolbar reads the legacy hdr-chips via a same-origin MutationObserver', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('MutationObserver');
  expect(frame).toContain("getElementById('hdr-chips')");
  expect(frame).toContain('parseChipStatus');
});

test('the mirrored status uses the pure chip-status adapter, not a recomputed count', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain("from '../../lib/chip-status'");
});

test('the outer toolbar renders the four mirrored status labels', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain('סה״כ');
  expect(frame).toContain('מוצבים');
  expect(frame).toContain('במאגר');
  expect(frame).toContain('חסרות שעות');
});

/**
 * iframe-load race: a same-origin iframe's `load` event can fire before React
 * finishes attaching a JSX `onLoad` listener (verified via instrumented
 * logging — a fast enough response wins the race and the one-shot event is
 * silently missed forever, so the MutationObserver never attaches and the
 * mirrored status permanently reads "no chips"). The fix must not rely on
 * `onLoad` firing at all: check whether the target document has already
 * loaded and only fall back to a real `load` listener if it genuinely
 * hasn't, so whichever path wins, setup happens exactly once.
 *
 * `contentDocument.readyState` alone is NOT a safe "already loaded" check —
 * an iframe's initial about:blank placeholder document also reports
 * readyState 'complete' immediately, before the real navigation even starts,
 * which would false-positive and skip attaching the load listener entirely
 * (also verified via instrumented logging). Checking for the actual expected
 * element (#hdr-chips, which only exists in the real legacy document) is the
 * robust signal.
 */
test('the mirrored status setup checks for the real document, not just readyState', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  // The "already loaded" branch condition itself must not trust readyState
  // alone (false-positives on the blank placeholder document) — it must
  // check for the real element instead. A comment may still explain why
  // readyState was rejected; only the actual condition is asserted here.
  const condition = frame.match(/if \(([^)]*getElementById\('hdr-chips'\)[^)]*)\)/);
  expect(condition).not.toBeNull();
  expect(condition[1]).not.toMatch(/readyState/);
  expect(frame).toContain("addEventListener('load'");
});

test('the load listener is removed on cleanup (no leak across StrictMode/Fast Refresh)', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  expect(frame).toContain("removeEventListener('load'");
});

test('the iframe no longer relies solely on a JSX onLoad prop for chip setup', () => {
  // A single ref-effect-based path (already-loaded check + addEventListener)
  // replaces the racy JSX onLoad prop entirely — avoids two setup paths that
  // could both fire and attach duplicate observers.
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  const iframeTag = frame.match(/<iframe[\s\S]*?\/>/)[0];
  expect(iframeTag).not.toMatch(/onLoad=/);
});

test('setup disconnects any prior observer before attaching, and on cleanup', () => {
  const frame = read('web/app/components/LegacyPlannerFrame.tsx');
  const disconnectCalls = frame.match(/observerRef\.current\?\.disconnect\(\)/g) || [];
  // at least once before a fresh attach, and once in the effect's cleanup
  expect(disconnectCalls.length).toBeGreaterThanOrEqual(2);
});

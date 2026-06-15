/**
 * Phase 2C — overload badge rendering in the AI plan preview.
 *
 * Extracts the badge helper body from the viewer source, runs it with the
 * shared thresholds (SOFT_LOAD_MAX=22, HARD_LOAD_CAP=26, ABSOLUTE_MAX_REASONABLE=30),
 * and asserts that a 27h semester renders the red "חריגה חסומה" blocking
 * badge — i.e. the user sees a clear per-semester signal alongside the
 * top-of-page error.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function loadBadgeFn() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const consts = {};
  for (const name of ['SOFT_LOAD_MIN', 'SOFT_LOAD_MAX', 'HARD_LOAD_CAP', 'ABSOLUTE_MAX_REASONABLE']) {
    const m = html.match(new RegExp(`\\bconst ${name}\\s*=\\s*(\\d+)\\s*;`));
    if (!m) throw new Error(`constant ${name} not found in viewer`);
    consts[name] = Number(m[1]);
  }
  const m = html.match(/const overloadBadgeHtml = \(hrs\) => \{([\s\S]*?)\n\s\s\};/);
  if (!m) throw new Error('overloadBadgeHtml helper not found in viewer');
  const body = m[1];
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'hrs', 'SOFT_LOAD_MAX', 'HARD_LOAD_CAP', 'ABSOLUTE_MAX_REASONABLE',
    body,
  );
  return (hrs) => fn(hrs, consts.SOFT_LOAD_MAX, consts.HARD_LOAD_CAP, consts.ABSOLUTE_MAX_REASONABLE);
}

// Variant that also injects `effectiveMaxHours` so we can assert the preview
// badge's warning threshold tracks the user-configurable preferred max — i.e.
// the badge stays in parity with the board load-bar (semColHtml uses
// preferredMax). Blocked/absolute thresholds remain the fixed constants.
function loadBadgeFnWithPrefMax(effectiveMaxHours) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const consts = {};
  for (const name of ['SOFT_LOAD_MAX', 'HARD_LOAD_CAP', 'ABSOLUTE_MAX_REASONABLE']) {
    const m = html.match(new RegExp(`\\bconst ${name}\\s*=\\s*(\\d+)\\s*;`));
    consts[name] = Number(m[1]);
  }
  const m = html.match(/const overloadBadgeHtml = \(hrs\) => \{([\s\S]*?)\n\s\s\};/);
  const body = m[1];
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'hrs', 'SOFT_LOAD_MAX', 'HARD_LOAD_CAP', 'ABSOLUTE_MAX_REASONABLE', 'effectiveMaxHours',
    body,
  );
  return (hrs) => fn(hrs, consts.SOFT_LOAD_MAX, consts.HARD_LOAD_CAP, consts.ABSOLUTE_MAX_REASONABLE, effectiveMaxHours);
}

describe('preview badge ↔ board load-bar parity (preferred-max denominator)', () => {
  test('with preferred max 20, a 21h semester shows "עומס גבוה" (matches board "over" tier)', () => {
    const badge = loadBadgeFnWithPrefMax(20);
    expect(badge(21)).toContain('עומס גבוה');
  });

  test('with preferred max 20, a 20h semester is still "עומס תקין"', () => {
    const badge = loadBadgeFnWithPrefMax(20);
    expect(badge(20)).toContain('עומס תקין');
  });

  test('changing preferred max to 24 keeps 23h "תקין" but is capped at SOFT_LOAD_MAX for the warning', () => {
    const badge = loadBadgeFnWithPrefMax(24);
    // warnAt = min(SOFT_LOAD_MAX=22, 24) = 22, so 23 already warns.
    expect(badge(23)).toContain('עומס גבוה');
    expect(badge(22)).toContain('עומס תקין');
  });

  test('blocked/absolute thresholds stay fixed regardless of preferred max', () => {
    const badge = loadBadgeFnWithPrefMax(20);
    expect(badge(27)).toContain('חריגה חסומה');
    expect(badge(31)).toContain('חריגה לא סבירה');
  });
});

describe('Phase 2C — overload badge', () => {
  const badge = loadBadgeFn();

  test('21 ש"ש → "עומס תקין" badge', () => {
    const html = badge(21);
    expect(html).toContain('עומס תקין');
    expect(html).toContain('21');
  });

  test('24 ש"ש → "עומס גבוה" amber warning badge', () => {
    const html = badge(24);
    expect(html).toContain('עומס גבוה');
    expect(html).toContain('24');
  });

  test('27h proposal preview shows per-semester "חריגה חסומה" blocking badge', () => {
    const html = badge(27);
    expect(html).toContain('חריגה חסומה');
    expect(html).toContain('27');
  });

  test('31 ש"ש → "חריגה לא סבירה" absolute-error badge', () => {
    const html = badge(31);
    expect(html).toContain('חריגה לא סבירה');
    expect(html).toContain('31');
  });
});

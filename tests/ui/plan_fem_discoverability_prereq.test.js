/**
 * plan_fem_discoverability_prereq.test.js
 *
 * Commit 1 (correctness): discoverability of 0542-4223 "מבוא לאלמנטים סופיים"
 * and the general OR-aware prerequisite parser.
 *
 * Part A — discoverability / mustInclude
 *   D01 resolveCourseMentionsLocal finds 0542-4223 for "מבוא לאלמנטים סופיים"
 *   D02 ... for "אלמנטים סופיים" (partial)
 *   D03 ... for "אלמנתים סופיים" (typo)
 *   D04 ... for "FEM"
 *   D05 ... for "finite elements"
 *   D06 ... for "05424223" (dashless id) and "0542-4223" (dashed)
 *   D07 extractPlanningIntentLocal("אני רוצה לקחת מבוא לאלמנטים סופיים").mustIncludeCourseIds ∋ 0542-4223
 *   D08 must-include ids come first in requested_course_ids (before domain courses)
 *   D09 sidebar search blob for 0542-4223 contains fem / finite elements / dashless id
 *
 * Part B — OR-aware prerequisite parser
 *   P01 0542-4223 has NO enforced in-scope prereq (its "(1) OR (2)" is foundational-satisfied)
 *   P02 0542-4226 prereq_groups enforce 0542-4223 (in-scope), drop foundational 0542-2200
 *   P03 prereqsSatisfiedForPlacementLocal: 0542-4223 placeable with no earlier in-scope course
 *   P04 0542-4226 not satisfied when 0542-4223 absent; satisfied when 0542-4223 earlier
 *   P05 auditDraftLegality rejects 0542-4226 before 0542-4223; accepts when ordered
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert  = () => {};
  window.fetch  = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return dom;
}

function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval(
          'typeof state!=="undefined"&&!!state&&!!state.semesters' +
          '&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0',
        )) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

const FEM = '0542-4223';

// ── Part A — discoverability ──────────────────────────────────────────────────
describe('Part A — resolveCourseMentionsLocal + mustInclude discover 0542-4223', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  const resolves = (text) => JSON.parse(window.eval(
    `JSON.stringify(resolveCourseMentionsLocal(${JSON.stringify(text)}))`,
  ));

  test('D01 — "מבוא לאלמנטים סופיים" → 0542-4223', () => {
    expect(resolves('מבוא לאלמנטים סופיים')).toContain(FEM);
  });
  test('D02 — "אלמנטים סופיים" (partial) → 0542-4223', () => {
    expect(resolves('אני רוצה אלמנטים סופיים')).toContain(FEM);
  });
  test('D03 — "אלמנתים סופיים" (typo) → 0542-4223', () => {
    expect(resolves('אלמנתים סופיים')).toContain(FEM);
  });
  test('D04 — "FEM" → 0542-4223', () => {
    expect(resolves('I want FEM')).toContain(FEM);
  });
  test('D05 — "finite elements" → 0542-4223', () => {
    expect(resolves('add finite elements please')).toContain(FEM);
  });
  test('D06 — id tokens (dashless + dashed) → 0542-4223', () => {
    expect(resolves('05424223')).toContain(FEM);
    expect(resolves('0542-4223')).toContain(FEM);
  });

  test('D07 — "אני רוצה לקחת מבוא לאלמנטים סופיים" → mustIncludeCourseIds ∋ 0542-4223', () => {
    const must = JSON.parse(window.eval(
      `JSON.stringify(extractPlanningIntentLocal('אני רוצה לקחת מבוא לאלמנטים סופיים').mustIncludeCourseIds)`,
    ));
    expect(must).toContain(FEM);
  });

  test('D08 — must-include ids come first in requested_course_ids', () => {
    const res = JSON.parse(window.eval(`(function(){
      const i = extractPlanningIntentLocal('תכניס לי FEM וגם תכן');
      return JSON.stringify({ must: i.mustIncludeCourseIds, req: i.requested_course_ids });
    })()`));
    expect(res.must.length).toBeGreaterThan(0);
    expect(res.req.slice(0, res.must.length)).toEqual(res.must);
  });

  test('D09 — sidebar search blob for 0542-4223 contains fem / finite elements / dashless id', () => {
    const blob = window.eval(`_repoSearchText(courseMap['${FEM}'], courseMap['${FEM}'].name_he)`);
    expect(blob).toContain('fem');
    expect(blob).toContain('finite elements');
    expect(blob).toContain('05424223');
  });

  test('D10 — exclusion wins: "בלי מבוא לאלמנטים סופיים" → not a must-include', () => {
    const must = JSON.parse(window.eval(
      `JSON.stringify(extractPlanningIntentLocal('בלי מבוא לאלמנטים סופיים').mustIncludeCourseIds)`,
    ));
    expect(must).not.toContain(FEM);
  });
});

// ── Part B — OR-aware prerequisite parser ──────────────────────────────────────
describe('Part B — OR-aware prerequisite parser (foundational reduction)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('P01 — 0542-4223 has no enforced in-scope prereq ("(1) OR (2)" is foundational-satisfied)', () => {
    const res = JSON.parse(window.eval(`(function(){
      const c = courseMap['${FEM}'];
      return JSON.stringify({ groups: c.prereq_groups || null, flat: c.prerequisites || [] });
    })()`));
    expect(res.groups).toEqual([]);
    expect(res.flat).toEqual([]);
  });

  test('P02 — 0542-4226 enforces in-scope 0542-4223 and drops foundational 0542-2200', () => {
    const res = JSON.parse(window.eval(`(function(){
      const c = courseMap['0542-4226'];
      return JSON.stringify({ groups: c.prereq_groups || [], flat: c.prerequisites || [] });
    })()`));
    // 0542-4223 must be enforced; 0542-2200 (year-2 foundational) must NOT appear.
    expect(res.flat).toContain('0542-4223');
    expect(res.flat).not.toContain('0542-2200');
    const flatGroups = res.groups.flat();
    expect(flatGroups).toContain('0542-4223');
    expect(flatGroups).not.toContain('0542-2200');
  });

  test('P03 — 0542-4223 placeable with no earlier in-scope course', () => {
    const ok = window.eval(`prereqsSatisfiedForPlacementLocal('${FEM}', 0, {}, new Set()).ok`);
    expect(ok).toBe(true);
  });

  test('P04 — 0542-4226 unmet without 0542-4223; met when 0542-4223 earlier', () => {
    const res = JSON.parse(window.eval(`(function(){
      const completed = new Set(['0542-3620']); // mandatory מעבר חם assumed done
      const without = prereqsSatisfiedForPlacementLocal('0542-4226', 1, {}, completed);
      const withFem = prereqsSatisfiedForPlacementLocal('0542-4226', 1, { '${FEM}': 0 }, completed);
      return JSON.stringify({ without: without.ok, withFem: withFem.ok, unmet: without.unsatisfied });
    })()`));
    expect(res.without).toBe(false);
    expect(res.unmet).toContain(FEM);
    expect(res.withFem).toBe(true);
  });

  test('P05 — auditDraftLegality rejects 0542-4226 before 0542-4223; accepts when ordered', () => {
    const res = JSON.parse(window.eval(`(function(){
      const completed = new Set(['0542-3620']);
      const bad = auditDraftLegality(
        { semesters: [{ semester_id: 'year_3_semester_b', course_ids: ['0542-4226'] }] },
        { completedCourseIds: completed });
      const good = auditDraftLegality(
        { semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['${FEM}'] },
          { semester_id: 'year_3_semester_b', course_ids: ['0542-4226'] },
        ] },
        { completedCourseIds: completed });
      return JSON.stringify({
        bad: bad.missingPrerequisites.map(p => p.course_id),
        good: good.missingPrerequisites.map(p => p.course_id),
      });
    })()`));
    expect(res.bad).toContain('0542-4226');
    expect(res.good).not.toContain('0542-4226');
  });
});

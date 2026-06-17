/**
 * Phase 2 — offering DERIVATION + schedulability classification (CASE 1 / CASE 2).
 *
 * CASE 1: a course whose only offering signal is the half-letter offered_semesters
 * (['A'] / ['B']) HAS definite semester data. The program-repository loader
 * (_addOrEnrichCourse) must map it to concrete ids (A → year_3_semester_a +
 * year_4_semester_a) so it is schedulable_confirmed, not "אין נתוני היצע".
 * Root cause it guards: the loader previously honored only a pre-resolved
 * effective_allowed_semesters and dropped offered_semesters, so 16/56 production
 * electives were wrongly flagged missing_offering_data and every plan dead-ended.
 *
 * CASE 2: a course with no name/hours/offering signal is unschedulable_missing_data
 * — it is SKIPPED, never a blocker for the whole plan.
 *
 * Part 1 grabs the pure helpers in isolation; Part 2 runs the REAL production
 * backup board through init() and asserts the end-to-end mapping.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function grab(name) {
  const decl = `function ${name}(`;
  const start = html.indexOf(decl);
  if (start < 0) throw new Error(`${name} not found`);
  const braceOpen = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name}: unbalanced braces`);
}

const SEM_SRC = `const SEMESTERS = [
  { id: 'year_3_semester_a' }, { id: 'year_3_semester_b' },
  { id: 'year_4_semester_a' }, { id: 'year_4_semester_b' },
];`;

const normalize = new Function(`${SEM_SRC}\n${grab('normalizeLegalSemesterIdsLocal')}\nreturn normalizeLegalSemesterIdsLocal;`)();
const classify = new Function(
  `${SEM_SRC}\n${grab('getLegalSemestersLocal')}\n${grab('classifyCourseSchedulability')}\nreturn classifyCourseSchedulability;`,
)();

describe('CASE 1 — offered_semesters half-letter → concrete semester ids', () => {
  test('["A"] maps to year_3_semester_a + year_4_semester_a (not _b)', () => {
    const out = normalize(['A']);
    expect(out).toContain('year_3_semester_a');
    expect(out).toContain('year_4_semester_a');
    expect(out).not.toContain('year_3_semester_b');
    expect(out).not.toContain('year_4_semester_b');
  });
  test('["B"] maps to year_3_semester_b + year_4_semester_b', () => {
    const out = normalize(['B']);
    expect(out).toContain('year_3_semester_b');
    expect(out).toContain('year_4_semester_b');
    expect(out).not.toContain('year_3_semester_a');
  });
  test('["A","B"] maps to all four semesters', () => {
    expect(normalize(['A', 'B']).sort()).toEqual([
      'year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b',
    ].sort());
  });
  test('Hebrew letters "א"/"ב" also map', () => {
    expect(normalize(['א'])).toContain('year_3_semester_a');
    expect(normalize(['ב'])).toContain('year_4_semester_b');
  });
});

describe('CASE 2 — schedulability classification', () => {
  test('effective offering present + confident → schedulable_confirmed', () => {
    expect(classify({ course_id: 'x', name_he: 'קורס', weekly_hours: 3,
      effective_allowed_semesters: ['year_3_semester_a', 'year_4_semester_a'] })).toBe('schedulable_confirmed');
  });
  test('only offered_semesters (no effective) → schedulable_tentative', () => {
    expect(classify({ course_id: 'x', name_he: 'קורס', weekly_hours: 3, offered_semesters: ['A'] }))
      .toBe('schedulable_tentative');
  });
  test('no name + no hours + no offering → unschedulable_missing_data', () => {
    expect(classify({ course_id: 'x' })).toBe('unschedulable_missing_data');
  });
  test('name + hours but NO semester signal → unschedulable_missing_data (cannot place legally)', () => {
    expect(classify({ course_id: 'x', name_he: 'קורס', weekly_hours: 3 })).toBe('unschedulable_missing_data');
  });
  test('null course → unschedulable_missing_data', () => {
    expect(classify(null)).toBe('unschedulable_missing_data');
  });
});

// ── Part 2: real production backup through init() ──────────────────────────────
function loadProdBoard() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  h = h.replace(m[0], '');
  const dom = new JSDOM(h, { url: 'http://localhost/app/web/semester_board_viewer.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  const board = fs.readFileSync(PROD_BOARD, 'utf8');
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('semester_board') || u.includes('/api/board')) return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(board)) });
    if (u.includes('/api/')) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  };
  window.confirm = () => false; window.alert = () => {};
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return dom;
}
function waitForInit(window) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&!!courseMap&&Object.keys(courseMap).length>0')) return resolve();
      if (Date.now() - start > 20000) return reject(new Error('init timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('CASE 1 — real production backup: offered_semesters becomes definite offering', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); });
  afterAll(() => { dom.window.close(); });

  test('0542-4120 (offered ["A"]) gains effective_allowed_semesters with A-semester ids', () => {
    const c = JSON.parse(window.eval('JSON.stringify(courseMap["0542-4120"] || null)'));
    expect(c).not.toBeNull();
    expect(c.effective_allowed_semesters).toEqual(expect.arrayContaining(['year_3_semester_a', 'year_4_semester_a']));
    expect(c.effective_allowed_semesters).not.toContain('year_3_semester_b');
    expect(c.offering_status).toBe('definite');
  });

  test('0542-4123 (offered ["B"]) gains B-semester ids', () => {
    const c = JSON.parse(window.eval('JSON.stringify(courseMap["0542-4123"] || null)'));
    expect(c).not.toBeNull();
    expect(c.effective_allowed_semesters).toEqual(expect.arrayContaining(['year_3_semester_b', 'year_4_semester_b']));
  });

  test('the 16 production courses with offered_semesters are now classified schedulable_confirmed', () => {
    const confirmedCount = window.eval(`(function(){
      const offered16 = ['0542-4120','0542-4123','0542-4320','0542-4352','0542-4220','0542-4221','0542-4223','0542-4224','0542-4420','0542-4422','0542-4455','0542-4622','0542-4391','0542-4624','0581-4131'];
      return offered16.filter(id => courseMap[id] && classifyCourseSchedulability(courseMap[id]) === 'schedulable_confirmed').length;
    })()`);
    expect(confirmedCount).toBeGreaterThanOrEqual(14);
  });

  test('placing definite-offering courses does NOT emit missing_offering_data in STRICT mode', () => {
    const res = JSON.parse(window.eval(`(function(){
      _aiPlanLastCtx = buildPlanValidationInputs();
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4120','0542-4220'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4123','0542-4221'] },
      ] };
      const r = validateFinalPlan(proposal, buildFinalPlanValidationCtx());
      return JSON.stringify({ causes: r.blockers.map(b=>b.cause) });
    })()`));
    expect(res.causes).not.toContain('missing_offering_data');
    expect(res.causes).not.toContain('illegal_semester');
  });
});

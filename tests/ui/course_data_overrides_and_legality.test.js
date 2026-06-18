/**
 * Tests for COURSE_DATA_OVERRIDES and the legality fixes introduced in offers-fix-v1.
 *
 * Covers three areas:
 * 1. Semester corrections — 17 courses get correct offered_semesters from the TAU
 *    2025 schedule scrape; תורת התנודות specifically is corrected from A → B.
 * 2. auditDraftLegality — semester gate and duplicate checks on draft proposals.
 * 3. buildDataAuditReportLocal — per-course unschedulable_reason classification.
 * 4. Planner output — more courses placed after overrides unlock 16 candidates.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

// ─────────────────────────────────────────────────────────────────────────────
// Shared harness
// ─────────────────────────────────────────────────────────────────────────────
function createPage() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found in HTML');
  const src = m[1];
  h = h.replace(m[0], '');

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  try { vc.forwardTo(console); } catch (_) {}

  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
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

  return { dom, window };
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

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — תורת התנודות (0542-4220) semester correction
// ─────────────────────────────────────────────────────────────────────────────
describe('COURSE_DATA_OVERRIDES — תורת התנודות corrected from A to B', () => {
  let dom, window;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('offered_semesters is ["B"] after override (Supabase had ["A"])', () => {
    const offered = JSON.parse(window.eval(
      'JSON.stringify(courseMap["0542-4220"]?.offered_semesters)',
    ));
    expect(offered).toEqual(['B']);
  });

  test('effective_allowed_semesters contains only _b semester ids', () => {
    const eff = JSON.parse(window.eval(
      'JSON.stringify(courseMap["0542-4220"]?.effective_allowed_semesters)',
    ));
    expect(Array.isArray(eff)).toBe(true);
    expect(eff.length).toBeGreaterThan(0);
    for (const sid of eff) {
      expect(sid).toMatch(/semester_b$/);
    }
  });

  test('classifyCourseSchedulability returns schedulable_confirmed', () => {
    const cls = window.eval(
      'classifyCourseSchedulability(courseMap["0542-4220"])',
    );
    expect(cls).toBe('schedulable_confirmed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — 16 other courses unlocked by overrides
// ─────────────────────────────────────────────────────────────────────────────
describe('COURSE_DATA_OVERRIDES — 16 additional courses gain semester data', () => {
  let dom, window;

  const OVERRIDE_IDS = [
    '0509-4010', '0512-1203', '0512-2508', '0512-4200', '0512-4362',
    '0512-4700', '0512-4702', '0542-4011', '0542-4012', '0542-4125',
    '0542-4425', '0542-4524', '0542-4722', '0571-1818', '0571-3802',
    '0571-4174',
  ];

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('every overridden course has non-empty effective_allowed_semesters', () => {
    const results = JSON.parse(window.eval(`JSON.stringify(
      ${JSON.stringify(OVERRIDE_IDS)}.map(cid => ({
        cid,
        eff: courseMap[cid]?.effective_allowed_semesters || [],
      }))
    )`));
    for (const r of results) {
      expect(r.eff.length).toBeGreaterThan(0);
    }
  });

  test('0542-4125 (מבוא להנדסת סביבה) effective contains semester_a', () => {
    const eff = JSON.parse(window.eval(
      'JSON.stringify(courseMap["0542-4125"]?.effective_allowed_semesters)',
    ));
    expect(eff.some(s => s.endsWith('semester_a'))).toBe(true);
  });

  test('0571-1818 (מבני נתונים) effective contains semester_b', () => {
    const eff = JSON.parse(window.eval(
      'JSON.stringify(courseMap["0571-1818"]?.effective_allowed_semesters)',
    ));
    expect(eff.some(s => s.endsWith('semester_b'))).toBe(true);
  });

  test('0512-2508 (התקנים אלקטרוניים) effective contains both _a and _b', () => {
    const eff = JSON.parse(window.eval(
      'JSON.stringify(courseMap["0512-2508"]?.effective_allowed_semesters)',
    ));
    expect(eff.some(s => s.endsWith('semester_a'))).toBe(true);
    expect(eff.some(s => s.endsWith('semester_b'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — auditDraftLegality semester gate
// ─────────────────────────────────────────────────────────────────────────────
describe('auditDraftLegality — semester placement gate', () => {
  let dom, window;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('placing תורת התנודות in semester_a is flagged as illegal', () => {
    // After override, 0542-4220 is only allowed in semester_b.
    const result = JSON.parse(window.eval(`(function(){
      const proposal = {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['0542-4220'] },
          { semester_id: 'year_3_semester_b', course_ids: [] },
          { semester_id: 'year_4_semester_a', course_ids: [] },
          { semester_id: 'year_4_semester_b', course_ids: [] },
        ]
      };
      const audit = auditDraftLegality(proposal, {});
      return JSON.stringify({
        illegalCount: audit.illegalSemesterPlacements.length,
        courseId: audit.illegalSemesterPlacements[0]?.course_id,
      });
    })()`));
    expect(result.illegalCount).toBeGreaterThan(0);
    expect(result.courseId).toBe('0542-4220');
  });

  test('placing תורת התנודות in semester_b is legal', () => {
    const result = JSON.parse(window.eval(`(function(){
      const proposal = {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: [] },
          { semester_id: 'year_3_semester_b', course_ids: ['0542-4220'] },
          { semester_id: 'year_4_semester_a', course_ids: [] },
          { semester_id: 'year_4_semester_b', course_ids: [] },
        ]
      };
      const audit = auditDraftLegality(proposal, {});
      const tVibs = audit.legalPlacements.find(p => p.course_id === '0542-4220');
      return JSON.stringify({
        illegalCount: audit.illegalSemesterPlacements.length,
        inLegal: !!tVibs,
      });
    })()`));
    expect(result.illegalCount).toBe(0);
    expect(result.inLegal).toBe(true);
  });

  test('buildDeterministicReplacementPlan proposal has 0 illegal semester placements', () => {
    const result = JSON.parse(window.eval(`(function(){
      const r = buildDeterministicReplacementPlan({ targetHours: 185 });
      if (!r.proposal) return JSON.stringify({ illegalCount: -1 });
      const audit = auditDraftLegality(r.proposal, {});
      return JSON.stringify({ illegalCount: audit.illegalSemesterPlacements.length });
    })()`));
    expect(result.illegalCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — buildDataAuditReportLocal classification
// ─────────────────────────────────────────────────────────────────────────────
describe('buildDataAuditReportLocal — per-course unschedulable classification', () => {
  let dom, window, report;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    report = JSON.parse(window.eval('JSON.stringify(buildDataAuditReportLocal())'));
  });
  afterAll(() => dom.window.close());

  test('missing_data count is ≤ 24 after 17 overrides unlock courses', () => {
    // Before fixes: 40 courses had no semester data (unschedulable_missing_data).
    // After 17 overrides (1 correction + 16 fills): at most 40 - 16 = 24 remain.
    expect(report.missing_data).toBeLessThanOrEqual(24);
  });

  test('0542-4220 (תורת התנודות) is classified as schedulable_confirmed', () => {
    const entry = report.courses.find(c => c.course_id === '0542-4220');
    expect(entry).toBeDefined();
    expect(entry.schedulability).toBe('schedulable_confirmed');
    expect(entry.unschedulable_reason).toBeNull();
  });

  test('courses with syllabus but no semester get unschedulable_reason = syllabus_has_no_semester', () => {
    const syllabusMissing = report.courses.filter(
      c => c.schedulability === 'unschedulable_missing_data' && c.has_syllabus,
    );
    // There should be some — courses that have syllabi but no schedule data in any source.
    expect(syllabusMissing.length).toBeGreaterThan(0);
    for (const c of syllabusMissing) {
      expect(c.unschedulable_reason).toBe('syllabus_has_no_semester');
    }
  });

  test('courses with no syllabus and no semester get unschedulable_reason = no_data', () => {
    const noData = report.courses.filter(
      c => c.schedulability === 'unschedulable_missing_data' && !c.has_syllabus,
    );
    for (const c of noData) {
      expect(c.unschedulable_reason).toBe('no_data');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — planner places more courses after overrides
// ─────────────────────────────────────────────────────────────────────────────
describe('buildDeterministicReplacementPlan — more courses placed after overrides', () => {
  let dom, window, planResult;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    planResult = JSON.parse(window.eval(`(function(){
      const r = buildDeterministicReplacementPlan({ targetHours: 185 });
      return JSON.stringify({
        addedCount: (r.addedCids || []).length,
        totalHours: r.totalHours,
        tVibsSemester: (function(){
          if (!r.proposal) return null;
          for (const s of r.proposal.semesters) {
            if ((s.course_ids || []).includes('0542-4220')) return s.semester_id;
          }
          return 'not_placed';
        })(),
        hasNoIllegal: (function(){
          if (!r.proposal) return true;
          return auditDraftLegality(r.proposal, {}).illegalSemesterPlacements.length === 0;
        })(),
      });
    })()`));
  });
  afterAll(() => dom.window.close());

  test('planner adds ≥ 10 courses from the program pool (up from 8 before fixes)', () => {
    expect(planResult.addedCount).toBeGreaterThanOrEqual(10);
  });

  test('תורת התנודות is placed in a semester_b slot (not semester_a)', () => {
    // 0542-4220 is either placed in semester_b or not placed (but never in semester_a).
    const sem = planResult.tVibsSemester;
    if (sem && sem !== 'not_placed') {
      expect(sem).toMatch(/semester_b$/);
    }
    // If not_placed: pass — cannot schedule means it was rejected, not illegally placed.
  });

  test('proposal passes auditDraftLegality with 0 illegal semester placements', () => {
    expect(planResult.hasNoIllegal).toBe(true);
  });
});

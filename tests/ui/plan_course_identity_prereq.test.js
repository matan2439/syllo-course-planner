/**
 * plan_course_identity_prereq.test.js
 *
 * Tests for three production correctness bugs fixed in data-normalize-v3:
 *
 *  Part 1 — Course identity / rendering guard
 *    T01  Course with missing name_he → classifyCourseSchedulability = unschedulable_missing_data
 *    T02  isCourseRenderable returns false for nameless course
 *    T03  isCourseRenderable returns true for well-formed course
 *    T04  courseMap entries for 0542-4124/0542-4191 are unschedulable and not renderable
 *
 *  Part 2 — Must-include: explicit course name in user text
 *    T05  extractPlanningIntentLocal detects "מבוא לאלמנטים סופיים" → mustIncludeCourseIds
 *    T06  The detected must-include id appears first in requested_course_ids
 *    T07  Must-include course 0542-4223 appears in the replacement plan when legal
 *
 *  Part 3 — Prerequisite chain enforcement (COURSE_PREREQ_OVERRIDES)
 *    T08  COURSE_PREREQ_OVERRIDES applied: courseMap['0542-4226'].prerequisites includes 0542-4223
 *    T09  auditDraftLegality flags 0542-4226 as missingPrerequisite when 0542-4223 absent
 *    T10  auditDraftLegality accepts 0542-4226 when 0542-4223 is in an earlier semester
 *    T11  buildDeterministicReplacementPlan never places 0542-4226 before 0542-4223
 *    T12  Board sidebar contains no course card with empty/missing name label
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

// ── Part 1 — Course identity / rendering guard ────────────────────────────────

describe('Part 1 — course identity: classifyCourseSchedulability and isCourseRenderable', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('T01 — nameless course → unschedulable_missing_data', () => {
    const cls = window.eval(`(function(){
      const fake = { course_id: '0542-9999', name_he: null, weekly_hours: 3,
                     offered_semesters: ['A'],
                     effective_allowed_semesters: ['year_3_semester_a'] };
      return classifyCourseSchedulability(fake);
    })()`);
    expect(cls).toBe('unschedulable_missing_data');
  });

  test('T02 — isCourseRenderable returns false for nameless course', () => {
    const result = window.eval(
      `isCourseRenderable({ course_id: '0542-9998', name_he: null, weekly_hours: 3 })`,
    );
    expect(result).toBe(false);
  });

  test('T03 — isCourseRenderable returns true for course with name_he', () => {
    const result = window.eval(
      `isCourseRenderable({ course_id: '0542-4223', name_he: 'מבוא לאלמנטים סופיים', weekly_hours: 4 })`,
    );
    expect(result).toBe(true);
  });

  test('T04 — courseMap: 0542-4124 and 0542-4191 are unschedulable and not renderable', () => {
    const result = JSON.parse(window.eval(`(function(){
      return JSON.stringify(['0542-4124','0542-4191'].map(cid => ({
        cid,
        cls:        courseMap[cid] ? classifyCourseSchedulability(courseMap[cid]) : 'absent',
        renderable: courseMap[cid] ? isCourseRenderable(courseMap[cid]) : false,
      })));
    })()`));
    for (const r of result) {
      expect(r.cls).toBe('unschedulable_missing_data');
      expect(r.renderable).toBe(false);
    }
  });
});

// ── Part 2 — Must-include: explicit course name extraction ────────────────────

describe('Part 2 — extractPlanningIntentLocal: explicit course name → mustIncludeCourseIds', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('T05 — "מבוא לאלמנטים סופיים" in text → mustIncludeCourseIds includes 0542-4223', () => {
    const result = JSON.parse(window.eval(`(function(){
      const intent = extractPlanningIntentLocal('אני רוצה ללמוד מבוא לאלמנטים סופיים');
      return JSON.stringify({ must: intent.mustIncludeCourseIds });
    })()`));
    expect(result.must).toContain('0542-4223');
  });

  test('T06 — must-include course appears first in requested_course_ids', () => {
    const result = JSON.parse(window.eval(`(function(){
      const intent = extractPlanningIntentLocal('אני רוצה ללמוד מבוא לאלמנטים סופיים');
      return JSON.stringify({ must: intent.mustIncludeCourseIds, first: intent.requested_course_ids[0] });
    })()`));
    expect(result.must.length).toBeGreaterThan(0);
    expect(result.first).toBe(result.must[0]);
  });

  test('T07 — must-include 0542-4223 appears in replacement plan when legal', () => {
    const result = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: 'אני רוצה ללמוד מבוא לאלמנטים סופיים' };
      const plan = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      return JSON.stringify({ added: plan.addedCids });
    })()`));
    expect(result.added).toContain('0542-4223');
  });
});

// ── Part 3 — Prerequisite chain enforcement ───────────────────────────────────

describe('Part 3 — COURSE_PREREQ_OVERRIDES and prerequisite chain', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('T08 — courseMap[0542-4226].prerequisites includes 0542-4223 after override', () => {
    const prereqs = JSON.parse(window.eval(
      `JSON.stringify((courseMap['0542-4226'] || {}).prerequisites || [])`,
    ));
    expect(prereqs).toContain('0542-4223');
  });

  test('T09 — auditDraftLegality flags 0542-4226 as missing-prereq when 0542-4223 absent', () => {
    const result = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4226'] },
      ]};
      const audit = auditDraftLegality(proposal, { completedCourseIds: new Set() });
      return JSON.stringify({ missing: audit.missingPrerequisites.map(p => p.course_id) });
    })()`));
    expect(result.missing).toContain('0542-4226');
  });

  test('T10 — auditDraftLegality accepts 0542-4226 when 0542-4223 is in an earlier semester', () => {
    const result = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['0542-4223'] },
        { semester_id: 'year_3_semester_b', course_ids: ['0542-4226'] },
      ]};
      // 0542-3620 (מעבר חום) is extracted from 0542-4226's syllabus_prerequisites_he
      // and is a placed mandatory course — mark it completed so only the 4223→4226
      // ordering constraint is under test.
      const audit = auditDraftLegality(proposal, { completedCourseIds: new Set(['0542-3620']) });
      return JSON.stringify({ missing: audit.missingPrerequisites.map(p => p.course_id) });
    })()`));
    expect(result.missing).not.toContain('0542-4226');
  });

  test('T11 — replacement plan never places 0542-4226 before 0542-4223', () => {
    const result = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: 'חוזק ואלמנטים סופיים' };
      const plan = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      let idx4223 = -1, idx4226 = -1;
      (plan.proposal || { semesters: plan.semesters || [] }).semesters.forEach((s, i) => {
        if ((s.course_ids||[]).includes('0542-4223')) idx4223 = i;
        if ((s.course_ids||[]).includes('0542-4226')) idx4226 = i;
      });
      return JSON.stringify({ added: plan.addedCids, idx4223, idx4226 });
    })()`));
    if (result.idx4226 !== -1) {
      expect(result.idx4223).not.toBe(-1);
      expect(result.idx4223).toBeLessThan(result.idx4226);
    }
  });

  test('T12 — sidebar repo cards have no empty name', () => {
    window.eval(`renderSidebar();`);
    const wraps = dom.window.document.querySelectorAll('.repo-card-wrap');
    for (const wrap of wraps) {
      const text = wrap.textContent.trim();
      expect(text.length).toBeGreaterThan(0);
      const nameEls = wrap.querySelectorAll('[class*="name"], .card-name, .card-title');
      for (const el of nameEls) {
        expect(el.textContent.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

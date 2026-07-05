/**
 * plan_movable_mandatory_and_overload.test.js
 *
 * Topic B (movable mandatory courses) and item 4 (overload transparency).
 *
 * Phase-1 finding: repairPlanLoad/_isMovableForBalance ALREADY correctly
 * implement movable-mandatory rearrangement (semester_board_viewer.html
 * ~13590-13629/13794+) — a flexible mandatory course is moved between legal
 * semesters to balance load, with a per-course Hebrew explanation
 * ("הוזז קורס חובה גמיש X מ-A ל-B לאיזון עומס"), exactly matching the ticket's
 * required behavior. Confirmed via the real catalog audit: every mandatory
 * course in the current Mechanical Engineering 2027 catalog has either a
 * single effective_allowed_semesters entry (genuinely no legal alternative
 * this year) or is the one annual course (atomic bundle, not "choose one of
 * several" semantics) — so "מעבר חום appearing fixed" is data-correct, not a
 * planner bug. These tests use SYNTHETIC ctx.courses (since no real course
 * currently has a genuine multi-semester legal option) to prove the
 * mechanism is correct and locked against regression.
 *
 * The genuine gap found: a real overload (year_3_semester_a = 26 ש"ש of pure
 * mandatory courses, vs a 25 ש"ש user preference, confirmed via the real
 * production catalog with zero contamination) was never explained — silently
 * exceeding the user's stated max. Fixed in buildDeterministicReplacementPlan
 * by reading repairPlanLoad's own unmovedOverloaded report (which already
 * had everything needed: per-course movability + reasons) after all repairs
 * settle, and surfacing it as a warning.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function createPageSetup() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
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
  window.fetch = (url) => {
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

function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

describe('B — movable mandatory courses (synthetic data, real mechanism)', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('test_fixed_mandatory_not_moved', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ]};
      const courses = { SYN_FIXED: { hours: 30, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true } };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const semA = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_a');
      return JSON.stringify({ stillInA: semA.course_ids.includes('SYN_FIXED') });
    })()`));
    expect(r.stillInA).toBe(true);
  });

  test('test_movable_mandatory_can_move_between_allowed_semesters', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_FLEX', 'SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ]};
      const courses = {
        SYN_FLEX:  { hours: 15, name_he: 'קורס סינתטי גמיש', placement_policy: 'flexible', is_mandatory: true, effective_allowed_semesters: ['year_3_semester_a','year_3_semester_b'] },
        SYN_FIXED: { hours: 15, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true },
      };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const semA = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_a');
      const semB = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_b');
      return JSON.stringify({ repaired: res.repaired, inA: semA.course_ids.includes('SYN_FLEX'), inB: semB.course_ids.includes('SYN_FLEX'), moveLog: res.moveLog });
    })()`));
    expect(r.repaired).toBe(true);
    expect(r.inB).toBe(true);
    expect(r.inA).toBe(false);
    expect(r.moveLog.some(m => m.course_id === 'SYN_FLEX' && m.accepted && m.is_mandatory)).toBe(true);
  });

  test('test_movable_mandatory_not_moved_to_illegal_semester', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_FLEX', 'SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
        { semester_id: 'year_4_semester_a', course_ids: [] },
      ]};
      const courses = {
        // Only legal in A (its own current semester) — no real alternative,
        // even though policy is 'flexible'. Must stay put.
        SYN_FLEX:  { hours: 15, name_he: 'קורס סינתטי גמיש', placement_policy: 'flexible', is_mandatory: true, effective_allowed_semesters: ['year_3_semester_a'] },
        SYN_FIXED: { hours: 15, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true },
      };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const semA = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_a');
      const semB = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_b');
      const semD = res.proposal.semesters.find(s=>s.semester_id==='year_4_semester_a');
      return JSON.stringify({ inA: semA.course_ids.includes('SYN_FLEX'), inB: semB.course_ids.includes('SYN_FLEX'), inD: semD.course_ids.includes('SYN_FLEX') });
    })()`));
    expect(r.inA).toBe(true);
    expect(r.inB).toBe(false);
    expect(r.inD).toBe(false);
  });

  test('test_movable_mandatory_respects_max_weekly_hours', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_FLEX', 'SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: ['SYN_OTHER'] }, // already at 18
      ]};
      const courses = {
        SYN_FLEX:  { hours: 15, name_he: 'קורס סינתטי גמיש', placement_policy: 'flexible', is_mandatory: true, effective_allowed_semesters: ['year_3_semester_a','year_3_semester_b'] },
        SYN_FIXED: { hours: 15, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true },
        SYN_OTHER: { hours: 18, name_he: 'קורס אחר', placement_policy: 'elective' },
      };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const hoursOf = sid => { const s = res.proposal.semesters.find(x=>x.semester_id===sid); return s.course_ids.reduce((sum,cid)=>sum+(courses[cid]?.hours||0),0); };
      return JSON.stringify({ aHours: hoursOf('year_3_semester_a'), bHours: hoursOf('year_3_semester_b') });
    })()`));
    // Moving SYN_FLEX (15h) into B (already 18h) would make B=33 — WORSE than
    // A's original 30 (newTargetHours=33 >= maxHours=30, the `helps` check
    // fails). The balancer must correctly decline this move rather than
    // create a new, worse overload — confirmed by B staying at its original
    // 18h (untouched) and A staying at its original 30h (move rejected).
    expect(r.bHours).toBe(18);
    expect(r.aHours).toBe(30);
  });

  test('test_movable_mandatory_explained_in_summary', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_FLEX', 'SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ]};
      const courses = {
        SYN_FLEX:  { hours: 15, name_he: 'מעבר חום סינתטי', placement_policy: 'flexible', is_mandatory: true, effective_allowed_semesters: ['year_3_semester_a','year_3_semester_b'] },
        SYN_FIXED: { hours: 15, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true },
      };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const accepted = res.moveLog.find(m => m.course_id === 'SYN_FLEX' && m.accepted);
      return JSON.stringify({ reason: accepted ? accepted.reason : null });
    })()`));
    expect(r.reason).toContain('מעבר חום סינתטי');
    expect(r.reason).toMatch(/הוזז|העברה/);
    expect(r.reason).toContain('לאיזון עומס');
  });

  test('test_annual_mandatory_bundle_not_broken (repairPlanLoad never moves an annual course as a half)', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['SYN_ANNUAL', 'SYN_FIXED'] },
        { semester_id: 'year_3_semester_b', course_ids: ['SYN_ANNUAL'] },
      ]};
      const courses = {
        SYN_ANNUAL: { hours: 4, name_he: 'קורס שנתי סינתטי', placement_policy: 'annual', is_annual: true, is_mandatory: true, spans_semesters: ['year_3_semester_a','year_3_semester_b'] },
        SYN_FIXED:  { hours: 28, name_he: 'קורס סינתטי קבוע', placement_policy: 'fixed', is_mandatory: true },
      };
      const ctx = { maxHoursPerSemester: 20, courses, pinnedCourseIds: new Set(), completedCourseIds: new Set() };
      const res = repairPlanLoad(proposal, ctx);
      const semA = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_a');
      const semB = res.proposal.semesters.find(s=>s.semester_id==='year_3_semester_b');
      return JSON.stringify({ inA: semA.course_ids.includes('SYN_ANNUAL'), inB: semB.course_ids.includes('SYN_ANNUAL') });
    })()`));
    // Annual course must remain in BOTH (never moved as a single half), even
    // though semester A is overloaded and the annual course has 'two' entries.
    expect(r.inA).toBe(true);
    expect(r.inB).toBe(true);
  });
});

describe('item 4 — overload transparency (real catalog, zero contamination)', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a structurally irreducible mandatory overload is explained, not silently exceeded', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 25 } });
      const semA = plan.proposal.semesters.find(s => s.semester_id === 'year_3_semester_a');
      const hours = (semA.course_ids||[]).reduce((s,cid)=>s+(hoursForCourseId(cid)||0),0);
      return JSON.stringify({ hours, warnings: plan.proposal.warnings_he || [] });
    })()`));
    if (r.hours > 25) {
      expect(r.warnings.some(w => w.includes('25') && (w.includes('חובה') || w.includes('עומס')))).toBe(true);
    } else {
      // If the fixture's seed data changes and no longer overloads this
      // semester, this assertion would be vacuous — fail loudly instead of
      // silently passing on a stale premise.
      throw new Error('expected year_3_semester_a to exceed 25 ש"ש in this fixture; got ' + r.hours);
    }
  });

  test('regression: no overload warning when the semester is within the user max', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { max_weekly_hours: 40 } });
      return JSON.stringify({ warnings: plan.proposal.warnings_he || [] });
    })()`));
    expect(r.warnings.some(w => w.includes('עומס') && w.includes('40'))).toBe(false);
  });
});

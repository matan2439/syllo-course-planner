/**
 * Tests for hard-exclusion handling (exclude-v1).
 *
 * Explicit user exclusions are HARD constraints: a course the user said "אל תשבץ"
 * must never appear in the generated plan — not as a category course, not as
 * שער-רוח, not as filler to reach 185. The planner must also avoid overfilling
 * past 185 and must not overload semesters past the workload cap with new courses.
 *
 * Covers acceptance criteria 1–8 and the 11 required tests.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const THERMO2 = '0542-4120'; // תרמודינמיקה (2)
const EXCLUDE_TEXT = 'אני רוצה להתמקד בתכן, חוזק, זרימה, מעבר חום ורעידות. אל תשבץ תרמודינמיקה (2)';
const MAX_HOURS = 20;

function createPage() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  try { vc.forwardTo(console); } catch (_) {}

  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
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
// Suite 1 — parsing + synonym matching (Tests 1, 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('parseHardExclusionsFromUserText — detection + synonyms', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('Test 1 — "לא לשבץ תרמודינמיקה (2)" resolves to 0542-4120', () => {
    window.__t = 'בבקשה לא לשבץ תרמודינמיקה (2) בתוכנית';
    const ids = JSON.parse(window.eval('JSON.stringify(parseHardExclusionsFromUserText(window.__t).courseIds)'));
    expect(ids).toContain(THERMO2);
  });

  test('Test 2 — synonym "תרמו 2" maps to תרמודינמיקה (2)', () => {
    window.__t = 'אל תשבץ תרמו 2';
    const ids = JSON.parse(window.eval('JSON.stringify(parseHardExclusionsFromUserText(window.__t).courseIds)'));
    expect(ids).toContain(THERMO2);
  });

  test('Test 2b — English "exclude Thermodynamics 2" maps to תרמודינמיקה (2)', () => {
    window.__t = 'please exclude Thermodynamics 2 from the plan';
    const ids = JSON.parse(window.eval('JSON.stringify(parseHardExclusionsFromUserText(window.__t).courseIds)'));
    expect(ids).toContain(THERMO2);
  });

  test('proximity — a focus term ("רעידות") before the trigger is NOT excluded', () => {
    // "להתמקד ב…רעידות … אל תשבץ תרמודינמיקה (2)" must exclude only thermo, not vibrations.
    window.__t = EXCLUDE_TEXT;
    const ids = JSON.parse(window.eval('JSON.stringify(parseHardExclusionsFromUserText(window.__t).courseIds)'));
    expect(ids).toContain(THERMO2);
    expect(ids).not.toContain('0542-4220'); // תורת התנודות (vibrations) — wanted, not excluded
  });

  test('no trigger → no exclusions (a pure focus request excludes nothing)', () => {
    window.__t = 'אני רוצה להתמקד במעבר חום וזרימה';
    const ids = JSON.parse(window.eval('JSON.stringify(parseHardExclusionsFromUserText(window.__t).courseIds)'));
    expect(ids).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — enforcement in each candidate-selection function (Tests 3, 4, 5)
// ─────────────────────────────────────────────────────────────────────────────
describe('hard-exclude is enforced in every fill function', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  function runFn(fnName, optsExtra) {
    return JSON.parse(window.eval(`(function(){
      const planContext = buildPlanContext();
      const analysis = buildCompletionAnalysisLocal(planContext);
      const ctx = buildPlanValidationInputs();
      const proposal = { semesters: mapToProposalSemesters(state.semesters || {}) };
      const opts = {
        courses: ctx.courses,
        maxHoursPerSemester: ${MAX_HOURS},
        knownSemesterIds: SEMESTERS.map(s => s.id),
        completedCourseIds: new Set(),
        hardExcludeCourseIds: new Set(['${THERMO2}']),
        requestedCourseIds: ['${THERMO2}'],
        ${optsExtra || ''}
      };
      const r = ${fnName}(proposal, analysis, opts);
      const cids = (r.proposal.semesters||[]).flatMap(s=>s.course_ids||[]);
      return JSON.stringify({ present: cids.includes('${THERMO2}') });
    })()`));
  }

  test('Test 3 — repairAddHoursToDegreeLocal never adds a hard-excluded course', () => {
    expect(runFn('repairAddHoursToDegreeLocal').present).toBe(false);
  });

  test('Test 4 — repairAddGeneralCoursesLocal never adds a hard-excluded course', () => {
    expect(runFn('repairAddGeneralCoursesLocal').present).toBe(false);
  });

  test('Test 4b — repairAddMissingElectivesLocal never adds a hard-excluded course', () => {
    expect(runFn('repairAddMissingElectivesLocal').present).toBe(false);
  });

  test('Test 4c — repairAddRequestedDomainCoursesLocal skips a hard-excluded focus course', () => {
    const res = JSON.parse(window.eval(`(function(){
      const planContext = buildPlanContext();
      const analysis = buildCompletionAnalysisLocal(planContext);
      const ctx = buildPlanValidationInputs();
      const proposal = { semesters: mapToProposalSemesters(state.semesters || {}) };
      const opts = {
        courses: ctx.courses, maxHoursPerSemester: ${MAX_HOURS},
        knownSemesterIds: SEMESTERS.map(s => s.id), completedCourseIds: new Set(),
        hardExcludeCourseIds: new Set(['${THERMO2}']),
        requestedCourseIds: ['${THERMO2}'],
      };
      const r = repairAddRequestedDomainCoursesLocal(proposal, analysis, opts);
      const cids = (r.proposal.semesters||[]).flatMap(s=>s.course_ids||[]);
      const rej = (r.rejected||[]).find(x => x.course_id === '${THERMO2}');
      return JSON.stringify({ present: cids.includes('${THERMO2}'), reason: rej && rej.reason });
    })()`));
    expect(res.present).toBe(false);
    expect(res.reason).toBe('hard_excluded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — full deterministic plan respects exclusions, overfill & workload
// ─────────────────────────────────────────────────────────────────────────────
describe('buildDeterministicReplacementPlan — exclusions, overfill, workload', () => {
  let dom, window, plan;
  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    window.__t = EXCLUDE_TEXT;
    plan = JSON.parse(window.eval(`(function(){
      const parsed = parseHardExclusionsFromUserText(window.__t);
      _aiPlanLastPreferences = { extra_request_he: window.__t, strongly_avoided_course_ids: parsed.courseIds };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const semLoads = (r.proposal.semesters||[]).map(s => ({
        id: s.semester_id,
        hours: (s.course_ids||[]).reduce((sum,cid)=>sum+(courseMap[cid]?(courseMap[cid].weekly_hours||courseMap[cid].semester_hours||0):0),0),
      }));
      const beforeCids = Object.values(state.semesters||{}).flat();
      return JSON.stringify({
        allCids: (r.proposal.semesters||[]).flatMap(s=>s.course_ids||[]),
        addedCids: r.addedCids,
        totalHours: r.totalHours, targetHours: r.targetHours,
        domainsSatisfied: (r.domainReport||[]).filter(d=>d.satisfied).map(d=>d.domain),
        semLoads, beforeCids,
        hardExcluded: r.hardExcludedCourseIds,
      });
    })()`));
  });
  afterAll(() => dom.window.close());

  test('Test 5 — hard-excluded תרמודינמיקה (2) is absent from the full plan', () => {
    expect(plan.allCids).not.toContain(THERMO2);
    expect(plan.hardExcluded).toContain(THERMO2);
  });

  test('Test 6 — focus domains are still satisfied despite the exclusion', () => {
    expect(plan.domainsSatisfied).toEqual(
      expect.arrayContaining(['design', 'strength', 'fluids', 'heat', 'vibrations']),
    );
  });

  test('Test 8 — the plan does not overfill past the 185 target', () => {
    expect(plan.totalHours).toBeLessThanOrEqual(plan.targetHours);
  });

  test('Test 9 — no NEWLY-added course pushes a semester past the workload cap', () => {
    // The committed board may already exceed the cap (fixed mandatory year-3 load),
    // but the planner must not ADD courses to a semester that is over the cap, nor
    // create a new over-cap semester via its additions.
    const beforeBySem = {};
    // Reconstruct per-semester pre-existing hours is complex; instead assert that
    // any semester ABOVE the cap contains only pre-existing (committed) courses.
    const before = new Set(plan.beforeCids);
    const overCap = plan.semLoads.filter(s => s.hours > MAX_HOURS);
    for (const s of overCap) {
      // Every course in an over-cap semester must be a committed-board course.
      const semCids = JSON.parse(window.eval(`(function(){
        const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
        const sem = (r.proposal.semesters||[]).find(x => x.semester_id === '${s.id}');
        return JSON.stringify(sem ? sem.course_ids : []);
      })()`));
      for (const cid of semCids) {
        expect(before.has(cid)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — draft activation / board DOM (Tests 6, 10)
// ─────────────────────────────────────────────────────────────────────────────
describe('board DOM does not render a hard-excluded course', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('Test 10 — after building with exclusion, the board has no תרמודינמיקה (2) card', () => {
    window.__t = EXCLUDE_TEXT;
    window.eval(`(function(){
      const parsed = parseHardExclusionsFromUserText(window.__t);
      _aiPlanLastPreferences = { extra_request_he: window.__t, strongly_avoided_course_ids: parsed.courseIds };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      activateProposalDraft(r.proposal, { isTentative: r.tentativeCids.length>0, tentativeCourseIds: r.tentativeCids });
    })()`);
    const cardIds = JSON.parse(window.eval(`JSON.stringify(
      [...document.querySelectorAll('#board .course-card')].map(c => c.dataset.courseId).filter(Boolean)
    )`));
    expect(cardIds).not.toContain(THERMO2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — exclusion via prior chat ("אל תשבץ") survives into the plan (Test 7)
// ─────────────────────────────────────────────────────────────────────────────
describe('strongly_avoided_course_ids (prior chat exclusion) is a hard constraint', () => {
  let dom, window;
  beforeAll(async () => { ({ dom, window } = createPage()); await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('Test 7 — a strongly-avoided course is never reintroduced by deterministic repair', () => {
    const res = JSON.parse(window.eval(`(function(){
      // No exclusion text — exclusion comes purely from the prior-chat avoid list.
      _aiPlanLastPreferences = { extra_request_he: 'מעבר חום וזרימה', strongly_avoided_course_ids: ['${THERMO2}'] };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const cids = (r.proposal.semesters||[]).flatMap(s=>s.course_ids||[]);
      return JSON.stringify({ present: cids.includes('${THERMO2}'), hardExcluded: r.hardExcludedCourseIds });
    })()`));
    expect(res.present).toBe(false);
    expect(res.hardExcluded).toContain(THERMO2);
  });
});

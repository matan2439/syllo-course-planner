/**
 * catalog_reliability_audit.test.js
 *
 * Locks the behavior of auditCourseCatalogForPlannerReliability() (Phase 6
 * data-trust-layer audit).
 *
 * Real finding from running this audit against the production board backup:
 * the annual lab course 0542-3792 (הנדסת ניסויים ומדידות - מעבדה) is NOT
 * flagged is_annual/placement_policy:'annual' there — it's 'flexible' with no
 * spans_semesters, and the backup's raw committed board lists it in only ONE
 * semester slot (year_3_semester_b), not both. This is a data gap in that
 * specific snapshot file (named "_pre_sync"), not a planner logic bug —
 * confirmed live in-browser that with the LOCAL catalog board JSON (which
 * DOES carry correct is_annual/spans_semesters for this course), the planner
 * renders and validates it as a correct 2-span bundle. Because the backup
 * places it in only ONE slot (not duplicated across two), the generic
 * "duplicate placement without an annual flag" cross-check below cannot
 * detect THIS specific failure mode (a missing slot, not an extra one) — that
 * is a documented limitation, not a false claim of detection.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
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

describe('auditCourseCatalogForPlannerReliability — Phase 6 data-trust audit', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('returns the full report shape with all required sections', () => {
    const r = JSON.parse(window.eval('JSON.stringify(auditCourseCatalogForPlannerReliability())'));
    expect(r).toHaveProperty('totalCourses');
    expect(r).toHaveProperty('year12FixedCurriculumCourses');
    expect(r).toHaveProperty('missingSemesterData.count');
    expect(r).toHaveProperty('missingAssessmentData.count');
    expect(r).toHaveProperty('missingPrerequisiteData.count');
    expect(r).toHaveProperty('annualCourses.count');
    expect(r).toHaveProperty('annualMetadataInconsistencies.count');
    expect(r).toHaveProperty('impossibleToSchedule.count');
    expect(r).toHaveProperty('inconsistentHours.count');
    expect(r.totalCourses).toBeGreaterThan(0);
  });

  test('years-1/2 fixed curriculum is counted separately (24 courses, not run through year-3/4 trust checks)', () => {
    const r = JSON.parse(window.eval('JSON.stringify(auditCourseCatalogForPlannerReliability())'));
    expect(r.year12FixedCurriculumCourses).toBe(24);
  });

  test('documents the real production-backup finding: 0542-3792 is in the board but not flagged annual, and the backup only places it in one semester slot (so the duplicate-placement cross-check correctly does not fire — there is no duplicate to find)', () => {
    const r = JSON.parse(window.eval(`(function(){
      const c = courseMap['0542-3792'];
      const placedIn = [];
      for (const [semId, ids] of Object.entries(state.semesters)) if ((ids||[]).includes('0542-3792')) placedIn.push(semId);
      return JSON.stringify({ exists: !!c, isAnnualFlagged: c ? isAnnualCourse(c) : null, placementPolicy: c ? c.placement_policy : null, placedIn });
    })()`));
    expect(r.exists).toBe(true);
    expect(r.isAnnualFlagged).toBe(false);
    expect(r.placedIn.length).toBe(1);
  });

  test('the duplicate-placement cross-check fires for a course placed in 2+ semesters of the same year without an is_annual flag (the failure mode it CAN detect)', () => {
    const r = JSON.parse(window.eval(`(function(){
      // Force a duplicate placement of a real non-annual elective across both
      // year-3 semesters, without setting is_annual, to exercise the cross-check.
      const cid = '0542-4220';
      state.semesters['year_3_semester_a'] = [...(state.semesters['year_3_semester_a']||[]), cid];
      state.semesters['year_3_semester_b'] = [...(state.semesters['year_3_semester_b']||[]), cid];
      const result = auditCourseCatalogForPlannerReliability();
      state.semesters['year_3_semester_a'] = state.semesters['year_3_semester_a'].filter(x=>x!==cid);
      state.semesters['year_3_semester_b'] = state.semesters['year_3_semester_b'].filter(x=>x!==cid);
      return JSON.stringify(result);
    })()`));
    const flagged = r.annualMetadataInconsistencies.courses.find(c => c.course_id === '0542-4220');
    expect(flagged).toBeTruthy();
    expect(flagged.issue).toContain('not flagged is_annual');
  });

  test('a course correctly flagged is_annual with a real 2-entry spans_semesters produces no inconsistency for itself', () => {
    const r = JSON.parse(window.eval(`(function(){
      // Synthesize a clean annual course directly in courseMap and re-run the audit.
      courseMap['__test_annual__'] = { course_id: '__test_annual__', name_he: 'test annual', is_annual: true,
        placement_policy: 'annual', spans_semesters: ['year_3_semester_a', 'year_3_semester_b'] };
      const result = auditCourseCatalogForPlannerReliability();
      delete courseMap['__test_annual__'];
      return JSON.stringify(result);
    })()`));
    const flaggedClean = r.annualMetadataInconsistencies.courses.find(c => c.course_id === '__test_annual__');
    expect(flaggedClean).toBeUndefined();
    const inAnnualList = r.annualCourses.courses.find(c => c.course_id === '__test_annual__');
    expect(inAnnualList).toBeTruthy();
    expect(inAnnualList.requiredSpans).toEqual(['year_3_semester_a', 'year_3_semester_b']);
  });
});

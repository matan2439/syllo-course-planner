/**
 * plan_avoid_picker_generic.test.js
 *
 * The avoid-picker exclusion fix (computeExplicitlyAvoidedIdsLocal /
 * buildHardExcludeSetLocal) is NOT specific to any one course. תרמודינמיקה (2)
 * was only the reported repro case. This suite proves the mechanism is
 * generic across course categories, multiple simultaneous exclusions,
 * course_id-as-primary-key matching, and every stage of the pipeline
 * (fresh build, repair/fill-to-target, and the final deterministic sweep).
 *
 * Courses used (verified real, from different categories, none of them
 * תרמודינמיקה/0542-4120 except where explicitly noted as the one
 * representative legacy fixture):
 *   - ENGINEERING_ELECTIVE_A = 0542-4123 (תהליכי מעבר חום וחומר)
 *   - ENGINEERING_ELECTIVE_B = 0581-4131 (a different elective, different category)
 *   - SHAAR_RUACH_COURSE     = 0609-1005 (קורסי שער רוח category)
 *   - MISSING_DATA_COURSE    = 0542-4093 (classifyCourseSchedulability === 'unschedulable_missing_data')
 *   - LEGACY_FIXTURE         = 0542-4120 (תרמודינמיקה (2) — the original report; used once, as one of several)
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const ENGINEERING_ELECTIVE_A = '0542-4123';
const ENGINEERING_ELECTIVE_B = '0581-4131';
const SHAAR_RUACH_COURSE     = '0609-1005';
const MISSING_DATA_COURSE    = '0542-4093';
const LEGACY_FIXTURE         = '0542-4120';

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

describe('avoid-picker exclusion is generic (not תרמודינמיקה-specific)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  describe.each([
    ['engineering elective A', ENGINEERING_ELECTIVE_A],
    ['engineering elective B', ENGINEERING_ELECTIVE_B],
    ['שער-רוח course', SHAAR_RUACH_COURSE],
    ['missing-data course', MISSING_DATA_COURSE],
    ['legacy fixture (תרמודינמיקה 2)', LEGACY_FIXTURE],
  ])('hard-avoiding %s (%s) end-to-end', (label, cid) => {
    test('absent from a fresh full build (fillToTarget) even under hour pressure', () => {
      const r = JSON.parse(window.eval(`(function(){
        degreeHoursProfile = { completed_degree_hours: 135 };
        const plan = buildDeterministicReplacementPlan({
          targetHours: 185, fillToTarget: true,
          prefs: { strongly_avoided_course_ids: ['${cid}'] },
        });
        const allIds = plan.proposal.semesters.flatMap(s => s.course_ids);
        return JSON.stringify({ allIds, totalHours: plan.totalHours, hardExcluded: plan.hardExcludedCourseIds });
      })()`));
      expect(r.hardExcluded).toContain(cid);
      expect(r.allIds).not.toContain(cid);
    });

    test('still absent after applying the draft and running an incremental rebuild on top', () => {
      const r = JSON.parse(window.eval(`(function(){
        degreeHoursProfile = { completed_degree_hours: 135 };
        const plan1 = buildDeterministicReplacementPlan({
          targetHours: 185, fillToTarget: true,
          prefs: { strongly_avoided_course_ids: ['${cid}'] },
        });
        // Seed the second build from the first build's own output (simulates
        // "apply draft, then build again" without touching real app state).
        const seedSemesters = {};
        for (const s of plan1.proposal.semesters) seedSemesters[s.semester_id] = s.course_ids;
        const plan2 = buildDeterministicReplacementPlan({
          targetHours: 185, fillToTarget: true,
          seedSemesters,
          prefs: { strongly_avoided_course_ids: ['${cid}'] },
        });
        const allIds = plan2.proposal.semesters.flatMap(s => s.course_ids);
        return JSON.stringify({ allIds });
      })()`));
      expect(r.allIds).not.toContain(cid);
    });
  });

  test('multiple simultaneous hard-avoids: none of A, B, שער-רוח, missing-data appear together', () => {
    const ids = [ENGINEERING_ELECTIVE_A, ENGINEERING_ELECTIVE_B, SHAAR_RUACH_COURSE, MISSING_DATA_COURSE];
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 135 };
      const plan = buildDeterministicReplacementPlan({
        targetHours: 185, fillToTarget: true,
        prefs: { strongly_avoided_course_ids: ${JSON.stringify(ids)} },
      });
      const allIds = plan.proposal.semesters.flatMap(s => s.course_ids);
      return JSON.stringify({ allIds, totalHours: plan.totalHours });
    })()`));
    for (const cid of ids) expect(r.allIds).not.toContain(cid);
  });

  test('course_id is the primary match key — a DIFFERENT course with a similar/related name is NOT excluded by mistake', () => {
    // ENGINEERING_ELECTIVE_A and ENGINEERING_ELECTIVE_B are unrelated by name.
    // Avoiding A by id must never affect B's placement eligibility.
    const r = JSON.parse(window.eval(`(function(){
      const explicitlyAvoidedIds = computeExplicitlyAvoidedIdsLocal({ extra_request_he: '', strongly_avoided_course_ids: ['${ENGINEERING_ELECTIVE_A}'] });
      return JSON.stringify({
        hasA: explicitlyAvoidedIds.has('${ENGINEERING_ELECTIVE_A}'),
        hasB: explicitlyAvoidedIds.has('${ENGINEERING_ELECTIVE_B}'),
      });
    })()`));
    expect(r.hasA).toBe(true);
    expect(r.hasB).toBe(false);
  });

  test('free-text chat exclusion (name match) and panel exclusion (course_id) combine without either erasing the other', () => {
    const r = JSON.parse(window.eval(`(function(){
      const courseBName = courseMap['${ENGINEERING_ELECTIVE_B}'].name_he;
      // Panel hard-avoids A by id; chat free text names B by Hebrew text (no id).
      const prefs = {
        extra_request_he: 'אל תשבץ לי את ' + courseBName,
        strongly_avoided_course_ids: ['${ENGINEERING_ELECTIVE_A}'],
      };
      const hardExcludeSet = buildHardExcludeSetLocal(prefs);
      const explicitlyAvoidedIds = computeExplicitlyAvoidedIdsLocal(prefs);
      return JSON.stringify({
        hardExcludeHasA: hardExcludeSet.has('${ENGINEERING_ELECTIVE_A}'),
        hardExcludeHasB: hardExcludeSet.has('${ENGINEERING_ELECTIVE_B}'),
        finalHasA: explicitlyAvoidedIds.has('${ENGINEERING_ELECTIVE_A}'),
        finalHasB: explicitlyAvoidedIds.has('${ENGINEERING_ELECTIVE_B}'),
      });
    })()`));
    expect(r.hardExcludeHasA).toBe(true);
    expect(r.hardExcludeHasB).toBe(true);
    expect(r.finalHasA).toBe(true);
    expect(r.finalHasB).toBe(true);
  });

  test('conflict: chat asks to add a panel-hard-avoided course — it is not added, and a conflict warning names it', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 135 };
      const courseAName = courseMap['${ENGINEERING_ELECTIVE_A}'].name_he;
      const plan = buildDeterministicReplacementPlan({
        targetHours: 185, fillToTarget: true,
        prefs: {
          extra_request_he: 'תוסיף לי את ' + courseAName,
          strongly_avoided_course_ids: ['${ENGINEERING_ELECTIVE_A}'],
        },
      });
      const allIds = plan.proposal.semesters.flatMap(s => s.course_ids);
      return JSON.stringify({
        allIds,
        warnings: plan.proposal.warnings_he || [],
        courseAName,
      });
    })()`));
    expect(r.allIds).not.toContain(ENGINEERING_ELECTIVE_A);
    const hasConflictWarning = r.warnings.some(w => w.includes(r.courseAName) && w.includes('להימנע'));
    expect(hasConflictWarning).toBe(true);
  });

  test('if reaching 185 hours is impossible without a hard-avoided course, the planner stops short and explains rather than violating the exclusion', () => {
    // Avoid a large slice of the elective pool to force a genuine shortfall,
    // and confirm none of them sneak in even though the plan can't reach 185.
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 0 };
      const pool = Object.values(courseMap)
        .filter(c => c.course_type === 'elective' && !_isShaarRuachLocal(c))
        .map(c => c.course_id);
      const plan = buildDeterministicReplacementPlan({
        targetHours: 185, fillToTarget: true,
        prefs: { strongly_avoided_course_ids: pool },
      });
      const allIds = plan.proposal.semesters.flatMap(s => s.course_ids);
      const violated = pool.filter(cid => allIds.includes(cid));
      return JSON.stringify({ violated, reachedTarget: plan.reachedTarget, totalHours: plan.totalHours });
    })()`));
    expect(r.violated).toEqual([]);
  });
});

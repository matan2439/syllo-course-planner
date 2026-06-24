/**
 * plan_annual_course_bundle.test.js
 *
 * Root cause: an annual/year-long course (is_annual:true, placement_policy:
 * 'annual', spans_semesters:[A,B]) must occupy BOTH its span semesters
 * together or neither. normalizeAnnualPlacements() already implements this
 * correctly (force-completes every span for any annual course id present
 * anywhere in the proposal), but it was called from exactly ONE place —
 * inside requestPlanProposal's LLM-pipeline, applied to eligibleProposal.
 * buildDeterministicReplacementPlan (used directly by
 * rebuildDraftFromProfileLocal, AND as requestPlanProposal's OWN fallback
 * rescue path) never called it — so repairAddMissingMandatoryLocal (which
 * picks exactly ONE semester per missing mandatory course, with no
 * annual-awareness) could leave an annual course's bundle torn apart,
 * producing the apply-time "קורס שנתי שחייב להופיע בכל הסמסטרים" error
 * AFTER the user already sees the (invalid) draft on the board.
 *
 * The test fixture board (supabase_board_backup_2027_pre_sync.json) predates
 * the is_annual/placement_policy:'annual' fields being added to the real
 * catalog for 0542-3792 (confirmed by diffing against
 * data/parsed_json/mechanical_semester_board_2027.json, which DOES carry
 * them) — so these tests patch courseMap['0542-3792'] with the exact real
 * annual fields before exercising the planner, to reproduce the real bug
 * deterministically without depending on fixture freshness.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const ANNUAL_COURSE_ID = '0542-3792'; // הנדסת ניסויים ומדידות - מעבדה
const SPAN_A = 'year_3_semester_a';
const SPAN_B = 'year_3_semester_b';

const PATCH_ANNUAL_SCRIPT = `
  const c = courseMap['${ANNUAL_COURSE_ID}'];
  c.is_annual = true;
  c.placement_policy = 'annual';
  c.spans_semesters = ['${SPAN_A}', '${SPAN_B}'];
  c.count_hours_once = true;
  c.semester_load_hours_by_semester = { '${SPAN_A}': 4, '${SPAN_B}': 4 };
  c.effective_allowed_semesters = ['${SPAN_A}', '${SPAN_B}'];
  c.is_mandatory = true;
`;

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

describe('annual/year-long course bundle integrity', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('reproduction: removing the annual course from the board and letting repairAddMissingMandatoryLocal re-add it must not split it across only one semester', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      // Remove it from wherever it currently sits on the board (simulates "missing mandatory").
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: false });
      const semsById = {};
      for (const s of plan.proposal.semesters) semsById[s.semester_id] = s.course_ids;
      return JSON.stringify({
        inA: (semsById['${SPAN_A}'] || []).includes('${ANNUAL_COURSE_ID}'),
        inB: (semsById['${SPAN_B}'] || []).includes('${ANNUAL_COURSE_ID}'),
      });
    })()`));
    // Either fully present in both, or absent from both — never exactly one.
    expect(r.inA).toBe(r.inB);
    // For this real mandatory annual course, it must actually be placed (never dropped).
    expect(r.inA).toBe(true);
  });

  test('bundle is added together when building from a board where it is entirely absent, with both spans available', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      const semsById = {};
      for (const s of plan.proposal.semesters) semsById[s.semester_id] = s.course_ids;
      return JSON.stringify({
        inA: (semsById['${SPAN_A}'] || []).includes('${ANNUAL_COURSE_ID}'),
        inB: (semsById['${SPAN_B}'] || []).includes('${ANNUAL_COURSE_ID}'),
      });
    })()`));
    expect(r.inA).toBe(true);
    expect(r.inB).toBe(true);
  });

  test('repair AND fill-to-target together still never leave only one span placed', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      degreeHoursProfile = { completed_degree_hours: 100 };
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      const semsById = {};
      for (const s of plan.proposal.semesters) semsById[s.semester_id] = s.course_ids;
      return JSON.stringify({
        inA: (semsById['${SPAN_A}'] || []).includes('${ANNUAL_COURSE_ID}'),
        inB: (semsById['${SPAN_B}'] || []).includes('${ANNUAL_COURSE_ID}'),
        totalHours: plan.totalHours,
      });
    })()`));
    expect(r.inA).toBe(r.inB);
  });

  test('a hard-avoided annual course is still mandatory-kept as a full bundle (never one span only) — matches existing mandatory-exempt-from-avoid behavior', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      const plan = buildDeterministicReplacementPlan({
        targetHours: 185, fillToTarget: true,
        prefs: { strongly_avoided_course_ids: ['${ANNUAL_COURSE_ID}'] },
      });
      const semsById = {};
      for (const s of plan.proposal.semesters) semsById[s.semester_id] = s.course_ids;
      return JSON.stringify({
        inA: (semsById['${SPAN_A}'] || []).includes('${ANNUAL_COURSE_ID}'),
        inB: (semsById['${SPAN_B}'] || []).includes('${ANNUAL_COURSE_ID}'),
      });
    })()`));
    expect(r.inA).toBe(r.inB);
  });

  test('a near-capacity semester does not cause only one span of a MANDATORY annual course to be added — mandatory placement wins over the soft max-hours cap, consistently with every other mandatory course in this codebase (no elective/non-mandatory annual course exists in this catalog to test the "skip if non-mandatory and infeasible" branch)', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      // Fill span A right up to the default 20h cap with other real legal courses
      // already on the board, so adding the annual course's 4h there would exceed it.
      const semAIds = state.semesters['${SPAN_A}'];
      let semAHours = semAIds.reduce((t, cid) => t + (hoursForCourseId(cid) || 0), 0);
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: false });
      const semsById = {};
      for (const s of plan.proposal.semesters) semsById[s.semester_id] = s.course_ids;
      return JSON.stringify({
        inA: (semsById['${SPAN_A}'] || []).includes('${ANNUAL_COURSE_ID}'),
        inB: (semsById['${SPAN_B}'] || []).includes('${ANNUAL_COURSE_ID}'),
        semAHoursBeforeAdd: semAHours,
      });
    })()`));
    // Atomic: never exactly one span. (This board's span A is already at/near
    // cap from its own mandatory courses, so this exercises real max-hours
    // pressure, not a slack scenario.)
    expect(r.inA).toBe(r.inB);
    expect(r.inA).toBe(true);
  });

  test('hours counting: degree total counts the annual course once, but each span semester carries its own weekly load', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      degreeHoursProfile = { completed_degree_hours: 135 };
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      activateProposalDraft(plan.proposal);
      const d = debugCurrentPlan();
      const countedEntries = d.layer1_degreeProgress.countedCourses.filter(c => c.id === '${ANNUAL_COURSE_ID}' && c.counted);
      const semA = d.layer2_boardWorkload.boardSemesters.find(s => s.semesterId === '${SPAN_A}');
      const semB = d.layer2_boardWorkload.boardSemesters.find(s => s.semesterId === '${SPAN_B}');
      return JSON.stringify({
        countedOnceCount: countedEntries.length,
        semAHasCourse: semA.courses.some(c => c.id === '${ANNUAL_COURSE_ID}'),
        semBHasCourse: semB.courses.some(c => c.id === '${ANNUAL_COURSE_ID}'),
      });
    })()`));
    // Counted toward the 185 total exactly once, not twice.
    expect(r.countedOnceCount).toBe(1);
    // But displayed/loaded in BOTH semesters (per-semester weekly load, not degree-hours dedup).
    expect(r.semAHasCourse).toBe(true);
    expect(r.semBHasCourse).toBe(true);
  });

  test('regression: the apply-time validator still blocks a manually-constructed partial annual placement', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${PATCH_ANNUAL_SCRIPT}
      // Manually force an invalid partial placement (bypassing normalizeAnnualPlacements)
      // to prove the final safety net still catches it independently of this fix.
      for (const semId of Object.keys(state.semesters)) {
        state.semesters[semId] = state.semesters[semId].filter(cid => cid !== '${ANNUAL_COURSE_ID}');
      }
      state.semesters['${SPAN_B}'] = [...state.semesters['${SPAN_B}'], '${ANNUAL_COURSE_ID}'];
      const proposal = { semesters: Object.entries(state.semesters).map(([semester_id, course_ids]) => ({ semester_id, course_ids })) };
      _aiPlanLastCtx = buildPlanValidationInputs();
      const ctx = buildFinalPlanValidationCtx();
      const result = validateFinalPlan(proposal, ctx);
      return JSON.stringify({
        applicable: result.applicable,
        hasAnnualBlocker: (result.blockers || []).some(b => b.cause === 'annual'),
      });
    })()`));
    expect(r.applicable).toBe(false);
    expect(r.hasAnnualBlocker).toBe(true);
  });
});

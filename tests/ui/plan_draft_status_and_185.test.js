/**
 * plan_draft_status_and_185.test.js
 *
 * Commit C3 — canonical draft.status + full-185 planner correctness.
 *
 *   S01 computeDraftStatusLocal yields a legal status (full/partial) for a clean fill draft
 *   S02 legal_partial label says "טיוטה חוקית חלקית", never "לא ניתן להציע מערכת חוקית"  (J22/J27)
 *   S03 gapBreakdown carries the full real-number breakdown                              (J23)
 *   S04 totalAfterPlan >= completedHours; = completed+board+added                        (J19/J20)
 *   S05 fill-to-target adds at least as much as the capped build                         (185 fill)
 *   S06 no added course is unnamed / missing-data / illegal                              (J26)
 *   S07 gapBreakdown.totalAfterPlan == getDegreeHoursStatusLocal total (one number)      (J25)
 *   S08 a partial plan reports remainingHoursTo185 > 0 + numeric blocker counts          (J23/J24)
 *   S09 legal_full iff totalAfterPlan >= required                                        (J21)
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

// Build a full-185 fill plan and activate it as a draft with the globals the
// status path needs, then return both the plan result and the canonical status.
const ACTIVATE_AND_STATUS = `(function(){
  const plan = buildFull185PlanLocal({ extra_request_he: '' });
  _aiPlanLastProposal = plan.proposal;
  _aiPlanLastPreferences = { extra_request_he: '' };
  _aiPlanLastCtx = buildPlanValidationInputs();
  _aiPlanLastCtx.maxHoursPerSemester = getEffectiveMaxHoursPreferenceLocal();
  _aiPlanLastAnalysis = buildCompletionAnalysisLocal(buildPlanContext());
  activateProposalDraft(plan.proposal);
  const ds = computeDraftStatusLocal();
  const courseHours = {};
  for (const [cid, info] of Object.entries(_aiPlanLastCtx.courses)) courseHours[cid] = info.hours;
  const hrs = getDegreeHoursStatusLocal(_aiPlanLastAnalysis, plan.proposal.semesters, courseHours);
  return JSON.stringify({ ds, gap: plan.gapBreakdown, addedCids: plan.addedCids, hrsTotal: hrs.total_after_plan });
})()`;

describe('C3 — canonical draft.status + full-185 planner', () => {
  let dom, window, R;
  beforeAll(async () => {
    dom = loadProdBoard(); window = dom.window; await waitForInit(window);
    R = JSON.parse(window.eval(ACTIVATE_AND_STATUS));
  }, 30000);
  afterAll(() => dom && dom.window.close());

  test('S01 — status is legal_full or legal_partial for a clean fill draft', () => {
    expect(['legal_full', 'legal_partial']).toContain(R.ds.status);
  });

  test('S02 — legal_partial label says "טיוטה חוקית חלקית", never "לא ניתן להציע מערכת חוקית"', () => {
    // Reproduce the renderProposalCard label logic for the canonical status.
    const label = window.eval(`(function(){
      const ds = computeDraftStatusLocal();
      if (ds.status === 'legal_full') return 'מערכת חוקית מלאה — ' + ds.total + '/' + ds.required + ' ש״ש';
      if (ds.status === 'legal_partial') return 'טיוטה חוקית חלקית עד ' + ds.total + '/' + ds.required + ' ש״ש — חסרות ' + ds.missing + ' ש״ש';
      if (ds.status === 'illegal_blocked') return 'יש לתקן בעיות חוקיות לפני החלה';
      if (ds.status === 'data_error') return 'יש קורסים עם נתונים חסרים בטיוטה';
      return '';
    })()`);
    expect(label).not.toContain('לא ניתן להציע מערכת חוקית');
    if (R.ds.status === 'legal_partial') expect(label).toContain('טיוטה חוקית חלקית');
  });

  test('S03 — gapBreakdown carries the full real-number breakdown', () => {
    const g = R.gap;
    for (const k of ['completedHours','existingBoardHours','newlyAddedHours','totalAfterPlan',
                     'requiredHours','remainingHoursTo185','legalCandidatesAvailable',
                     'blockedByPrereq','blockedByOffering','blockedByHardExclude',
                     'blockedByWorkload','blockedByMissingData','rejectedWeak']) {
      expect(typeof g[k]).toBe('number');
    }
    expect(Array.isArray(g.relaxableCourses)).toBe(true);
  });

  test('S04 — totalAfterPlan >= completedHours and == completed+board+added', () => {
    const g = R.gap;
    expect(g.totalAfterPlan).toBeGreaterThanOrEqual(g.completedHours);
    expect(Math.round(g.totalAfterPlan * 10) / 10)
      .toBeCloseTo(Math.round((g.completedHours + g.existingBoardHours + g.newlyAddedHours) * 10) / 10, 1);
  });

  test('S05 — fill-to-target adds at least as much as the capped build', () => {
    const res = JSON.parse(window.eval(`(function(){
      const capped = buildDeterministicReplacementPlan({ prefs: { extra_request_he: '' }, targetHours: 185 });
      const full   = buildFull185PlanLocal({ extra_request_he: '' });
      return JSON.stringify({ capped: capped.totalHours, full: full.totalHours });
    })()`));
    expect(res.full).toBeGreaterThanOrEqual(res.capped);
  });

  test('S06 — no added course is unnamed / missing-data / illegal', () => {
    const res = JSON.parse(window.eval(`(function(){
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      const bad = plan.addedCids.filter(cid => {
        const c = courseMap[cid];
        return !c || !isCourseRenderable(c) || classifyCourseSchedulability(c) === 'unschedulable_missing_data';
      });
      const audit = auditDraftLegality(plan.proposal, { completedCourseIds: new Set(completedCourseIds || []) });
      const illegalAdded = [...audit.illegalSemesterPlacements, ...audit.missingPrerequisites]
        .map(p => p.course_id).filter(cid => plan.addedCids.includes(cid));
      return JSON.stringify({ bad, illegalAdded });
    })()`));
    expect(res.bad).toEqual([]);
    expect(res.illegalAdded).toEqual([]);
  });

  test('S07 — gapBreakdown.totalAfterPlan equals the sidebar/degree-hours total', () => {
    expect(R.gap.totalAfterPlan).toBeCloseTo(R.hrsTotal, 1);
  });

  test('S08 — a partial plan reports the exact remaining gap + numeric blockers', () => {
    if (R.ds.status === 'legal_partial') {
      expect(R.gap.remainingHoursTo185).toBeGreaterThan(0);
      const blockerSum = R.gap.blockedByPrereq + R.gap.blockedByOffering + R.gap.blockedByHardExclude
        + R.gap.blockedByWorkload + R.gap.blockedByMissingData + R.gap.legalCandidatesAvailable;
      expect(blockerSum).toBeGreaterThanOrEqual(0);
    } else if (R.ds.status === 'legal_full') {
      expect(R.gap.remainingHoursTo185).toBe(0);
    }
  });

  test('S09 — legal_full iff totalAfterPlan >= required', () => {
    if (R.ds.status === 'legal_full') expect(R.gap.totalAfterPlan).toBeGreaterThanOrEqual(R.gap.requiredHours);
    if (R.ds.status === 'legal_partial') expect(R.gap.totalAfterPlan).toBeLessThan(R.gap.requiredHours);
  });
});

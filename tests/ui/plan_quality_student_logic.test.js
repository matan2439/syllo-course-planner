/**
 * plan_quality_student_logic.test.js
 *
 * Planner-quality harness encoding the student-planner PRIORITY ORDER:
 *   1. hard constraints (prereqs, hard-avoid, offering semester, mandatory, categories)
 *   2. PRIMARY: reach ≥185 verified degree hours whenever legally possible
 *   3. minimize peak load / move flexible courses (toward the user's preferred max)
 *   4. prefer requested domains; avoid unrelated electives unless needed
 *   5. among similar-value legal alternatives prefer lower difficulty; a high-difficulty
 *      course may be used ONLY when required to complete the degree, and must be explained
 *
 * The decisive prior-behavior reversal locked here: degree completion now OUTRANKS
 * grade-safety. Previously fillToDegreeTargetLocal left a 182/185 gap rather than place
 * a risk≥0.9 course; now it places the LOWEST-risk such course as a last resort to reach
 * the target and flags it, instead of shipping an incomplete degree.
 *
 * Part A evidence baked into the heat-transfer audit: a "flexible mandatory" course
 * offered in only ONE semester this year (effective_allowed_semesters length 1) is NOT
 * movable — exercised here with a SYNTHETIC single-offering course (data-independent).
 * מעבר חם (0542-3620), long used as the real example, was proven by the authoritative
 * TAU listing (groups 01/02 = Semester A, 05/06/07 = Semester B) to be offered in BOTH
 * year-3 semesters; the old "Semester A only" was a single-group offering-override bug.
 * With the corrected offering the load-balance pass MOVES it to its emptier legal half.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

const THERMO     = '0542-4120'; // תרמודינמיקה (2) — hard-avoid course
const HEAT_MAND  = '0542-3620'; // מעבר חם — flexible mandatory, authoritatively offered in BOTH year-3 semesters
const HEAT_ELEC  = '0542-4123'; // תהליכי מעבר חום וחומר — elective, genuinely 2 legal semesters

function loadPage() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  html = html.replace(m[0], '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(BOARD_JSON, 'utf8'))) });
    }
    if (u.includes('/api/')) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  };
  window.confirm = () => false; window.alert = () => {};
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return dom;
}
function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try { if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve(); } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1+2. Degree completion is PRIMARY — it outranks grade-safety and the soft max.
//      A scenario whose only path to 185 needs a high-risk course must COMPLETE
//      (and flag it), not ship an incomplete 182/185 plan.
// ─────────────────────────────────────────────────────────────────────────────
describe('degree completion outranks grade-safety and soft max workload', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('completion outranks grade-safety: a placeable risk≥0.9 course that is the ONLY gap-closer is placed as last resort (was: left short)', () => {
    // Clean mechanism test of fillToDegreeTargetLocal — a synthetic high-risk, no-prereq
    // elective is the only way to close a small gap. The grade-safety gate must DEFER it
    // but the last-resort pass must PLACE it (completion is primary) and flag it, rather
    // than leave the degree incomplete. (Mirrors the prior over-selection scenario, but
    // asserts the NEW priority: complete-and-flag, not stop-short.)
    const r = JSON.parse(window.eval(`(function(){
      const HARD = 'QTEST-HARD-FILLER';
      courseMap[HARD] = { course_id: HARD, name_he: 'קורס קשה למילוי', weekly_hours: 4, course_type: 'elective',
        tau_factor_avg_grade: 55, prerequisites: [], missing_prerequisites: [],
        effective_allowed_semesters: ['year_4_semester_b'], allowed_semesters: ['year_4_semester_b'], offered_semesters: ['B'] };
      // Confirm the synthetic course is genuinely high-risk.
      const risk = _gradeRiskScoreLocal(courseMap[HARD]).risk;
      const analysis = buildCompletionAnalysisLocal(buildPlanContext());
      const ctx = buildPlanValidationInputs();
      ctx.courses[HARD] = { hours: 4, course_type: 'elective', effective_allowed_semesters: ['year_4_semester_b'] };
      // A near-complete proposal needing exactly this one 4-hour course (target shrunk so
      // the synthetic course is the sole legal gap-closer).
      const baseTotal = buildPlanContextFromState({ proposalSemesters: mapToProposalSemesters(state.semesters) }).totalAfterPlan;
      const proposal = { semesters: mapToProposalSemesters(state.semesters) };
      const target = baseTotal + 4;
      // Make the synthetic high-risk course the ONLY legal gap-closer: hard-exclude
      // every other non-mandatory course so the fill cannot reach target with a safer one.
      const placedNow = new Set(proposal.semesters.flatMap(s=>s.course_ids||[]));
      const hardExclude = new Set(Object.keys(courseMap).filter(cid => {
        const c = courseMap[cid];
        return cid !== HARD && c && c.course_type !== 'mandatory' && !c.is_mandatory && !placedNow.has(cid);
      }));
      const res = fillToDegreeTargetLocal(proposal, analysis, {
        courses: ctx.courses, maxHoursPerSemester: 25, knownSemesterIds: SEMESTERS.map(s=>s.id),
        completedCourseIds: new Set(), hardExcludeCourseIds: hardExclude,
        userIntentProfile: { mustIncludeCourseIds: [] }, requiredHours: target,
      });
      const placedIds = res.proposal.semesters.flatMap(s=>s.course_ids||[]);
      const total = buildPlanContextFromState({ proposalSemesters: res.proposal.semesters }).totalAfterPlan;
      return JSON.stringify({
        risk, target, total,
        hardPlaced: placedIds.includes(HARD),
        lastResort: (res.lastResortHighRiskPlaced||[]).map(x=>x.course_id),
      });
    })()`));
    expect(r.risk).toBeGreaterThanOrEqual(0.9);          // synthetic course really is high-risk
    expect(r.total).toBeGreaterThanOrEqual(r.target);     // PRIMARY: target reached
    expect(r.hardPlaced).toBe(true);                      // the high-risk gap-closer WAS placed
    expect(r.lastResort).toContain('QTEST-HARD-FILLER');  // and flagged as last-resort
  });

  test('user max 25 with an unavoidable 26 ש״ש mandatory semester → complete-but-needs-approval, NOT an incomplete downgrade', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: ['0542-4220','0542-4223'], unwanted: ['${THERMO}'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const p = sidebarQuickActionPrefs(); p.max_weekly_hours = 25; _aiPlanLastPreferences = p; _aiUserIntentProfile = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const ds = computeDraftStatusLocal();
      const semH = Object.entries(state.proposalDraft.semesters).map(([sid,ids])=>({sid,h:(ids||[]).reduce((t,c)=>t+(hoursForCourseId(c)||0),0)}));
      return JSON.stringify({ status: ds.status, total: ds.total, peak: Math.max(...semH.map(s=>s.h)) });
    })()`));
    expect(r.status).toBe('legal_full');     // complete, not downgraded to partial
    expect(r.total).toBeGreaterThanOrEqual(185);
    // The 26 peak (fixed mandatory) is tolerated for completion, not a reason to fail.
    expect(r.peak).toBeLessThanOrEqual(26);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Load balancing — a genuinely movable course IS moved to reduce peak.
// ─────────────────────────────────────────────────────────────────────────────
describe('load balancing moves genuinely-movable courses', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('a course with a legal alternative semester that lowers peak is moved', () => {
    const r = JSON.parse(window.eval(`(function(){
      const FAKE = 'QTEST-MOVABLE';
      courseMap[FAKE] = { course_id: FAKE, name_he: 'בחירה ניידת', weekly_hours: 4, course_type: 'elective',
        effective_allowed_semesters: ['year_3_semester_a','year_4_semester_b'], allowed_semesters: ['year_3_semester_a','year_4_semester_b'] };
      const ctx = buildPlanValidationInputs();
      ctx.courses[FAKE] = { hours: 4, effective_allowed_semesters: ['year_3_semester_a','year_4_semester_b'], course_type: 'elective', name_he: 'בחירה ניידת' };
      ctx.maxHoursPerSemester = 25;
      const proposal = { semesters: mapToProposalSemesters(state.semesters) };
      const a = proposal.semesters.find(s => s.semester_id === 'year_3_semester_a');
      a.course_ids = [...a.course_ids, FAKE];
      const res = repairPlanLoad(proposal, ctx);
      const afterSem = res.proposal.semesters.find(s => (s.course_ids||[]).includes(FAKE)).semester_id;
      return JSON.stringify({ moved: afterSem !== 'year_3_semester_a' });
    })()`));
    expect(r.moved).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4+5. No fake flexibility / heat-transfer audit — flexible-labelled mandatory
//      courses that are offered in ONE semester this year are correctly immovable,
//      and the summary explains the legal-semester limitation.
// ─────────────────────────────────────────────────────────────────────────────
describe('heat-transfer flexibility audit (no fake flexibility)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('מעבר חם is authoritatively offered in BOTH year-3 semesters (corrected offering provenance)', () => {
    const r = JSON.parse(window.eval(`(function(){
      const c = courseMap['${HEAT_MAND}'];
      const legal = getLegalSemestersLocal(c, SEMESTERS.map(s=>s.id)).semesters;
      return JSON.stringify({
        name: c.name_he, allowed: c.allowed_semesters, offered: c.offered_semesters,
        effective: c.effective_allowed_semesters, legal, confidence: c.offering_source_confidence,
      });
    })()`));
    expect(r.offered).toEqual(expect.arrayContaining(['A', 'B']));
    expect(r.effective).toEqual(expect.arrayContaining(['year_3_semester_a', 'year_3_semester_b']));
    expect(r.legal).toEqual(expect.arrayContaining(['year_3_semester_a', 'year_3_semester_b']));
  });

  test('a genuinely single-offering flexible-mandatory course IS immovable (invariant, synthetic)', () => {
    const r = JSON.parse(window.eval(`(function(){
      const c = { course_id: 'SYN-1SEM', name_he: 'חובה גמישה חד-סמסטרית', weekly_hours: 4,
        course_type: 'mandatory', placement_policy: 'flexible',
        allowed_semesters: ['year_3_semester_a','year_3_semester_b'],
        program_allowed_semesters: ['year_3_semester_a','year_3_semester_b'],
        offered_semesters: ['A'], effective_allowed_semesters: ['year_3_semester_a'] };
      const legal = getLegalSemestersLocal(c, SEMESTERS.map(s=>s.id)).semesters;
      return JSON.stringify({ legal });
    })()`));
    expect(r.legal).toEqual(['year_3_semester_a']); // offering pins the one legal semester
  });

  test('the heat-transfer ELECTIVE (תהליכי מעבר חום וחומר) IS genuinely movable (2 legal semesters)', () => {
    const r = JSON.parse(window.eval(`(function(){
      const c = courseMap['${HEAT_ELEC}'];
      const legal = getLegalSemestersLocal(c, SEMESTERS.map(s=>s.id)).semesters;
      return JSON.stringify({ legalCount: legal.length, legal });
    })()`));
    expect(r.legalCount).toBeGreaterThanOrEqual(2);
  });

  test('with corrected offering the ME Y3A peak is REDUCED in the APPLIED plan (מעבר חם moved to legal Semester B)', () => {
    // Previously this scenario produced an "irreducible 26/25" peak the summary had to
    // explain — but that irreducibility was a DATA ARTIFACT of the single-group offering
    // bug (מעבר חם wrongly pinned to Semester A). With the corrected authoritative data the
    // existing load-repair moves מעבר חם to Semester B and the peak is resolved IN THE
    // ACTUAL applied proposal (state.proposalDraft), not only a discarded summary clone.
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: ['0542-4220','0542-4223'], unwanted: ['${THERMO}'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const p = sidebarQuickActionPrefs(); p.max_weekly_hours = 25; _aiPlanLastPreferences = p; _aiUserIntentProfile = null;
      state.proposalDraft = null;
      rebuildDraftFromProfileLocal({ fillToTarget: true });
      const arr = x => Object.entries(x||{}).map(([k,v]) => ({ id:k, ids: Array.isArray(v)?v:(v&&v.course_ids)||[] }));
      const load = s => s.ids.reduce((a,c)=>a+((courseMap[c]?.weekly_hours)||0),0);
      const applied = arr(state.proposalDraft.semesters);
      const total = buildPlanContextFromState({ proposalSemesters: applied.map(s=>({semester_id:s.id, course_ids:s.ids})) }).totalAfterPlan;
      return JSON.stringify({ heatSem: (applied.find(s=>s.ids.includes('${HEAT_MAND}'))||{}).id, maxLoad: Math.max(...applied.map(load)), total });
    })()`));
    expect(r.heatSem).toBe('year_3_semester_b'); // moved off the over-cap Y3A to its now-legal B
    expect(r.maxLoad).toBeLessThanOrEqual(25);    // the 26/25 peak is gone in the applied plan
    expect(r.total).toBeGreaterThanOrEqual(185);  // degree still complete (pure relocation, no shed)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6+7. Difficulty / off-topic — among similar legal alternatives the lower-risk /
//      more-relevant course wins; דינמיקה ובקרה is not force-picked on a loose match.
// ─────────────────────────────────────────────────────────────────────────────
describe('difficulty / off-topic preference', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('with a grade target set, a lower-risk course scores higher than a higher-risk one of equal domain value', () => {
    const r = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('דגש על חוזק', { gradeTarget: 85 });
      const easy = { course_id: 'E', name_he: 'קל', tau_factor_avg_grade: 88 };
      const hard = { course_id: 'H', name_he: 'קשה', tau_factor_avg_grade: 62 };
      const sEasy = scoreCourseAgainstIntentProfileLocal(easy, profile).score;
      const sHard = scoreCourseAgainstIntentProfileLocal(hard, profile).score;
      return JSON.stringify({ sEasy, sHard });
    })()`));
    expect(r.sEasy).toBeGreaterThan(r.sHard);
  });

  test('דינמיקה ובקרה של מערכות is NOT selected in the canonical ME scenario (no loose-keyword force-pick)', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: ['0542-4220','0542-4223'], unwanted: ['${THERMO}'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const p = sidebarQuickActionPrefs(); p.max_weekly_hours = 25; _aiPlanLastPreferences = p; _aiUserIntentProfile = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const placed = plan.proposal.semesters.flatMap(s=>s.course_ids||[]);
      const dyn = placed.some(cid => (courseMap[cid]?.name_he||'').includes('דינמיקה ובקרה'));
      return JSON.stringify({ dyn });
    })()`));
    expect(r.dyn).toBe(false);
  });
});

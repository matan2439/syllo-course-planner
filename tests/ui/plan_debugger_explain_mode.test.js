/**
 * plan_debugger_explain_mode.test.js
 *
 * Planner Debugger / Explain Mode — debugCurrentPlan() is a READ-ONLY 7-layer audit
 * that proves, with exact data, why the current board looks the way it does. These
 * tests verify the debugger is internally consistent (its totals match the sidebar /
 * AI summary / canonical context) and exposes the required explanation fields.
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
const RESET = `degreeHoursProfile = { completed_degree_hours: null, general_required_hours: null, general_completed_hours: null };
  userCourseStatuses = {}; _boardCompletedIds = []; state.proposalDraft = null;`;

describe('Planner Debugger / Explain Mode — debugCurrentPlan()', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('1 — debugCurrentPlan exists and returns the 7 layers', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      const d = debugCurrentPlan();
      return JSON.stringify({ type: typeof window.debugCurrentPlan, keys: Object.keys(d) });
    })()`));
    expect(r.type).toBe('function');
    for (const k of ['layer1_degreeProgress','layer2_boardWorkload','layer3_requirements',
                     'layer4_candidatePipeline','layer5_selectedExplanation','layer6_comparison','layer7_stateFreshness']) {
      expect(r.keys).toContain(k);
    }
  });

  test('2 — debug total equals the sidebar total', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const d = debugCurrentPlan();
      const sidebar = computeProgramProgress().plannedHours;
      return JSON.stringify({ debug: d.layer1_degreeProgress.totalCountedHours, sidebar });
    })()`));
    expect(r.debug).toBeCloseTo(r.sidebar, 1);
  });

  test('3 — debug total equals the AI-summary / canonical total', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const d = debugCurrentPlan();
      const canonical = buildPlanContextFromState({}).totalAfterPlan;
      return JSON.stringify({ debug: d.layer1_degreeProgress.totalCountedHours, canonical });
    })()`));
    expect(r.debug).toBeCloseTo(r.canonical, 1);
  });

  test('4 — countedCourses (counted:true) sum equals totalCountedHours', () => {
    for (const manual of [null, 90]) {
      const r = JSON.parse(window.eval(`(function(){ ${RESET}
        ${manual == null ? '' : 'degreeHoursProfile = { completed_degree_hours: ' + manual + ' };'}
        const d = debugCurrentPlan();
        const l1 = d.layer1_degreeProgress;
        const sum = l1.countedCourses.filter(c=>c.counted).reduce((s,c)=>s+(c.hours||0),0);
        return JSON.stringify({ sum: Math.round(sum*10)/10, total: l1.totalCountedHours, formula: l1.formula });
      })()`));
      expect(r.sum).toBeCloseTo(r.total, 1); // proves: total = X + Y + Z - D
    }
  });

  test('5 — board displayed hours equal the sum of visible course hours', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      const d = debugCurrentPlan();
      const rows = d.layer2_boardWorkload.boardSemesters;
      const sumRows = rows.reduce((s,row)=>s+row.displayedHours,0);
      const sumCourses = rows.reduce((s,row)=>s+row.courses.reduce((t,c)=>t+(c.hours||0),0),0);
      return JSON.stringify({ sumRows: Math.round(sumRows*10)/10, sumCourses: Math.round(sumCourses*10)/10, total: d.layer2_boardWorkload.totalDisplayedBoardHours });
    })()`));
    expect(r.sumCourses).toBeCloseTo(r.sumRows, 1);
    expect(r.total).toBeCloseTo(r.sumRows, 1);
  });

  test('6 — duplicates are listed (counted:false) and not double-counted', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      // mark a board course completed → it must appear once counted, once as duplicate(false)
      const boardCid = Object.values(state.semesters).flat().find(c=>hoursForCourseId(c)>0);
      userCourseStatuses[boardCid] = { status: 'completed' };
      const d = debugCurrentPlan();
      const entries = d.layer1_degreeProgress.countedCourses.filter(c=>c.id===boardCid);
      const countedTrue = entries.filter(e=>e.counted).length;
      return JSON.stringify({ boardCid, total: entries.length, countedTrue });
    })()`));
    expect(r.total).toBeGreaterThanOrEqual(2);  // appears in completed + existingBoard
    expect(r.countedTrue).toBe(1);              // counted exactly once
  });

  test('7 — שער-רוח cap is shown and flagged as enforced (≤ cap)', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      const d = debugCurrentPlan();
      return JSON.stringify(d.layer3_requirements.shaarRuach);
    })()`));
    expect(r.cap).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(r.cap + 0.01);
    expect(r.exceeded).toBe(false);
  });

  test('8 — missing-offering-data courses are listed in the candidate pipeline', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      const d = debugCurrentPlan();
      const md = d.layer4_candidatePipeline.candidates.filter(c=>c.blockers.missingOfferingData);
      const thermal = d.layer4_candidatePipeline.candidates.find(c=>c.id==='0542-4135');
      return JSON.stringify({ count: md.length, summary: d.layer4_candidatePipeline.summary.blockedByMissingData, thermalBlocked: thermal ? thermal.blockers.missingOfferingData : null });
    })()`));
    expect(r.count).toBeGreaterThan(0);
    expect(r.summary).toBe(r.count);
    expect(r.thermalBlocked).toBe(true); // 0542-4135 תכן תרמי — missing offered_semesters
  });

  test('9 — selected courses include selectedBecause + alternativesConsidered + named hard courses', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: 'דגש על חוזק ותכן, ממוצע 82' });
      activateProposalDraft(plan.proposal);
      _aiUserIntentProfile = plan.userIntentProfile;
      _aiPlanLastProposal = plan.proposal;
      const d = debugCurrentPlan();
      const sel = d.layer5_selectedExplanation;
      const withReasons = sel.filter(s=>Array.isArray(s.selectedBecause) && s.selectedBecause.length && Array.isArray(s.alternativesConsidered));
      return JSON.stringify({ selCount: sel.length, withReasons: withReasons.length, named: d.layer5_namedHardCourses.length, namedFound: d.layer5_namedHardCourses.filter(n=>n.found).length });
    })()`));
    expect(r.selCount).toBeGreaterThan(0);
    expect(r.withReasons).toBe(r.selCount);
    expect(r.named).toBe(7);            // all 7 requested names traced
    expect(r.namedFound).toBeGreaterThan(0);
  });

  test('10 — a completed course is never listed as a selectable candidate', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      const elective = Object.keys(courseMap).find(c=>courseMap[c].name_he && (courseMap[c].course_type||'elective')!=='mandatory' && hoursForCourseId(c)>0);
      userCourseStatuses[elective] = { status: 'completed' };
      const d = debugCurrentPlan();
      const cand = d.layer4_candidatePipeline.candidates.find(c=>c.id===elective);
      return JSON.stringify({ elective, completedAlready: cand ? cand.blockers.completedAlready : null, selected: cand ? cand.selected : null });
    })()`));
    expect(r.completedAlready).toBe(true);
  });

  test('11 — stale draft state is detected when the last proposal diverges from the board', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      // seed a last proposal that does NOT match the current (no-draft) board
      _aiPlanLastProposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['__ghost_course__'] }] };
      const d = debugCurrentPlan();
      return JSON.stringify({ stale: d.layer7_stateFreshness.staleDraftDetected, mismatch: d.layer7_stateFreshness.stateMismatchDetected, build: d.buildMarker });
    })()`));
    expect(r.stale).toBe(true);
    expect(r.mismatch).toBe(true);
    expect(typeof r.build).toBe('string');
  });

  test('12 — manual-plan fixture produces a clear audit via auditPlanLocal', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      // manual fixture = the current committed board (a known-legal plan)
      const manual = Object.entries(state.semesters).map(([id,ids])=>({ semester_id:id, course_ids:[...ids] }));
      const a = auditPlanLocal(manual);
      return JSON.stringify({ keys: Object.keys(a), total: a.totalDegreeHours, hard: a.hardCourseCount, sr: a.shaarRuach.total, maxLoad: a.maxSemesterLoad });
    })()`));
    for (const k of ['totalDegreeHours','boardHours','categories','shaarRuach','missingRequirements','hardCourseCount','avgGradeRisk','maxSemesterLoad']) {
      expect(r.keys).toContain(k);
    }
    expect(typeof r.total).toBe('number');
  });

  test('13 — AI vs manual comparison lists differences', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: 'דגש על חוזק' });
      activateProposalDraft(plan.proposal);
      // manual fixture = just the committed board (fewer courses) → differences must appear
      const manual = Object.entries(state.semesters).map(([id,ids])=>({ semester_id:id, course_ids:[...ids] }));
      const d = debugCurrentPlan({ manualPlan: manual });
      const c = d.layer6_comparison;
      return JSON.stringify({ hasAi: !!c.aiPlanAudit, hasManual: !!c.manualPlanAudit, diffs: Array.isArray(c.differences), diffCount: (c.differences||[]).length });
    })()`));
    expect(r.hasAi).toBe(true);
    expect(r.hasManual).toBe(true);
    expect(r.diffs).toBe(true);
    expect(r.diffCount).toBeGreaterThan(0);
  });

  test('14 — legal_partial output explains exactly what prevents legal_full', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      activateProposalDraft(plan.proposal);
      const ds = computeDraftStatusLocal();
      const d = debugCurrentPlan();
      return JSON.stringify({ status: ds.status, why: d.whyNotLegalFull || null });
    })()`));
    if (r.status !== 'legal_full') {
      expect(r.why).not.toBeNull();
      expect(r.why).toHaveProperty('remainingHours');
      expect(r.why).toHaveProperty('blockedByMissingData');
      expect(r.why).toHaveProperty('legalNonShaarRuachCandidatesLeft');
    } else {
      expect(true).toBe(true);
    }
  });

  test('15 — below-185 with no fittable non-שער-רוח candidate is explained (data-limited)', () => {
    const r = JSON.parse(window.eval(`(function(){ ${RESET}
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      activateProposalDraft(plan.proposal);
      const d = debugCurrentPlan();
      const total = d.layer1_degreeProgress.totalCountedHours;
      const why = d.whyNotLegalFull;
      // If below target, the debugger must show WHY adding more is blocked.
      return JSON.stringify({ total, below: total < 185, why });
    })()`));
    if (r.below) {
      expect(r.why).not.toBeNull();
      // either no legal engineering candidate remains, or they are blocked by missing data
      expect(r.why.legalNonShaarRuachCandidatesLeft === 0 || r.why.blockedByMissingData > 0).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});

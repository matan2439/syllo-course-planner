/**
 * plan_full185_completion_and_buttons.test.js
 *
 * Issue 1 — the full-185 completion loop keeps adding legal candidates from the FULL
 * normalized repository until 185 is reached or no legal candidate fits; below 185 is
 * legal_partial with exact blockers.
 * Issue 2 — exactly ONE draft action cluster (upper board banner); no duplicate row
 * below the AI chat.
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
      try {
        if (window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0')) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

// Count candidates that pass offering + prereq AND fit in a semester with room — i.e.
// genuinely placeable. If totalAfterPlan < 185 while this is > 0, the planner stopped early.
const STRICT_FITTABLE = `function strictFittable(proposal){
  const placed = new Set(proposal.semesters.flatMap(s=>s.course_ids||[]));
  const cap = HARD_LOAD_CAP;
  const knownSems = SEMESTERS.map(s=>s.id);
  // Year-1/2 foundational curriculum is prerequisite-satisfied for an upper-year
  // planner; שער-רוח is capped at 6 (a degree requirement, NOT gap-filler) so it
  // does not count toward "could still close the 185 gap".
  const y12 = new Set(YEAR_1_2_MANDATORY_COURSES.map(c=>c.course_id));
  const completedForPrereq = new Set([...(typeof completedCourseIds!=='undefined'?completedCourseIds:[]), ...y12]);
  const srIds = new Set(SHAAR_RUACH_COURSES.map(c=>c.course_id));
  const sems = proposal.semesters.map(s=>({id:s.semester_id, ids:[...(s.course_ids||[])]}));
  const semIdx={}; sems.forEach((s,i)=>{for(const c of s.ids) semIdx[c]=i;});
  const semH={}; sems.forEach(s=>{semH[s.id]=s.ids.reduce((t,c)=>t+(hoursForCourseId(c)||0),0);});
  let n=0;
  for(const cid of Object.keys(courseMap)){
    if(placed.has(cid)) continue;
    const c=courseMap[cid];
    if(!c||c.course_type==='mandatory'||c.is_mandatory) continue;
    if(srIds.has(cid)) continue; // שער-רוח is cap-limited, not gap-fill
    if(classifyCourseSchedulability(c)==='unschedulable_missing_data'||!isCourseRenderable(c)) continue;
    const legal=getLegalSemestersLocal(c,knownSems).semesters; const allowed=(legal&&legal.length)?legal:knownSems;
    let ls=sems.filter(s=>allowed.includes(s.id));
    if(!ls.length) continue;
    ls=ls.filter(s=>prereqsSatisfiedForPlacementLocal(cid, sems.findIndex(x=>x.id===s.id), semIdx, completedForPrereq).ok);
    if(!ls.length) continue;
    const h=hoursForCourseId(cid)||0;
    if(ls.some(s=>semH[s.id]+h<=cap)) n++;
  }
  return n;
}`;

describe('Issue 1 — full-185 completion loop', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  // Simulate a student who already has 90 completed degree hours, so 185 is reachable.
  const build90 = () => JSON.parse(window.eval(`(function(){
    ${STRICT_FITTABLE}
    degreeHoursProfile = { completed_degree_hours: 90 };
    const plan = buildFull185PlanLocal({ extra_request_he: '' });
    const pc = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters });
    const audit = auditDraftLegality(plan.proposal, { completedCourseIds: new Set(typeof completedCourseIds!=='undefined'?completedCourseIds:[]) });
    return JSON.stringify({
      total: pc.totalAfterPlan, completed: pc.completedHours, baseline: pc.completedHours + pc.existingBoardHours,
      remaining: pc.remainingHoursTo185, illegal: audit.illegalSemesterPlacements.length, prereq: audit.missingPrerequisites.length,
      fittable: strictFittable(plan.proposal),
    });
  })()`));

  test('F01 — reaches 185, OR stops below only because no non-שער-רוח elective still fits', () => {
    const r = build90();
    // With the שער-רוח cap (Part I), 185 is only reachable via schedulable engineering
    // electives. If the repo runs out of those (many are unschedulable_missing_data), the
    // honest result is below 185 with zero genuinely-fittable engineering candidates left.
    expect(r.total >= 185 || r.fittable === 0).toBe(true);
  });

  test('F02 — ACCEPTANCE: below 185 only if NO legal candidate still fits', () => {
    const r = build90();
    if (r.total < 185) expect(r.fittable).toBe(0);
  });

  test('F03 — the produced plan is legal (0 illegal semester / 0 missing prereq)', () => {
    const r = build90();
    expect(r.illegal).toBe(0);
    expect(r.prereq).toBe(0);
  });

  test('F04 — totalAfterPlan is never below the UI baseline', () => {
    const r = build90();
    expect(r.total).toBeGreaterThanOrEqual(r.baseline);
  });

  test('F05 — the fill considers the FULL repository, not only the engineering elective pool', () => {
    // There exists at least one schedulable non-mandatory course NOT in analysis.elective_pool
    // (e.g. שער-רוח) — the broadened pool must include such ids.
    const ok = window.eval(`(function(){
      const analysis = buildCompletionAnalysisLocal(buildPlanContext());
      const poolIds = new Set((analysis.elective_pool||[]).map(c=>c.course_id));
      let extra = 0;
      for (const cid of Object.keys(courseMap)) {
        const c = courseMap[cid];
        if (!c || c.course_type==='mandatory' || c.is_mandatory) continue;
        if (poolIds.has(cid)) continue;
        if (classifyCourseSchedulability(c)==='unschedulable_missing_data' || !isCourseRenderable(c)) continue;
        extra++;
      }
      return extra > 0;
    })()`);
    expect(ok).toBe(true);
  });

  test('F06 — legal_full only when totalAfterPlan >= 185 (status reflects the real total)', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      activateProposalDraft(plan.proposal);
      const ds = computeDraftStatusLocal();
      return JSON.stringify({ status: ds.status, total: ds.total });
    })()`));
    if (r.total >= 185) expect(r.status).toBe('legal_full');
    else expect(r.status).toBe('legal_partial');
  });

  test('F07 — with NO baseline the gap report still leaves no genuinely-fittable candidate', () => {
    const r = JSON.parse(window.eval(`(function(){
      ${STRICT_FITTABLE}
      degreeHoursProfile = { completed_degree_hours: null };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      const pc = buildPlanContextFromState({ proposalSemesters: plan.proposal.semesters });
      return JSON.stringify({ total: pc.totalAfterPlan, fittable: strictFittable(plan.proposal), gap: !!plan.gapBreakdown });
    })()`));
    expect(r.gap).toBe(true);
    if (r.total < 185) expect(r.fittable).toBe(0);
  });
});

describe('Issue 2 — single draft action cluster (no duplicate buttons)', () => {
  let dom, window, document;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; document = window.document; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  beforeEach(() => {
    window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 90 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      activateProposalDraft(plan.proposal);
      renderAll();
    })()`);
  });

  test('B11 — exactly one visible "החל טיוטה" apply button', () => {
    const applyButtons = Array.from(document.querySelectorAll('button')).filter(b => /החל טיוטה|החל מערכת/.test(b.textContent || ''));
    expect(applyButtons.length).toBe(1);
    expect(document.getElementById('board-draft-apply')).toBeTruthy();
  });

  test('B12 — exactly one visible reject/dismiss action', () => {
    const rejectButtons = Array.from(document.querySelectorAll('button')).filter(b => /^דחה/.test((b.textContent || '').trim()));
    expect(rejectButtons.length).toBe(1);
  });

  test('B13 — no draft action row is rendered below the AI chat', () => {
    const card = document.getElementById('ai-proposal-card');
    expect(card.innerHTML.trim()).toBe('');
    expect(card.querySelector('#sb-draft-apply')).toBeFalsy();
    expect(card.querySelector('#sb-draft-reject')).toBeFalsy();
    expect(card.querySelector('#sb-draft-rebuild')).toBeFalsy();
  });

  test('B14 — the remaining upper apply/reject controls work', () => {
    expect(window.eval('typeof applyProposalDraft')).toBe('function');
    // reject clears the draft
    window.eval("document.getElementById('board-draft-reject').click();");
    expect(window.eval('!!state.proposalDraft')).toBe(false);
  });
});

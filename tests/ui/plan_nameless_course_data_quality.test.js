/**
 * plan_nameless_course_data_quality.test.js
 *
 * Production finding: 0542-4124 and 0542-4191 (real catalog records with
 * name_he: null, weekly_hours: null — TAU catalog scrape found nothing) were
 * visible as "קורס חסר — נדרש ייבוא מידע" board cards on production.
 *
 * Root-cause investigation (confirmed via the real live /api/board/
 * mechanical_engineering_2027 catalog, 69 courses, both ids present):
 *
 *  - The course repository (sidebar) ALREADY correctly filters nameless
 *    courses via isCourseRenderable (semester_board_viewer.html:3534/3488) —
 *    this surface was never broken.
 *  - buildDeterministicReplacementPlan's OWN candidate-selection helpers
 *    ALREADY correctly exclude nameless courses (classifyCourseSchedulability
 *    returns 'unschedulable_missing_data' for a course with no name_he) —
 *    confirmed via direct reproduction with the real 69-course catalog
 *    injected into a clean test harness: fillToTarget never selected either
 *    id, even with both present in courseMap/state.repo.
 *  - buildPlanContext() — the payload sent to the LLM — DID leak nameless
 *    courses as legitimate "candidates" for category_requirements and
 *    general_course_requirements (שער רוח), because those candidate filters
 *    only checked "not already placed" and "not excluded", never data
 *    quality. A real LLM, told "here are legal candidates for this category,
 *    reach 185 ש״ש", has no way to know name_he:null means "don't pick this".
 *  - The LLM-ACCEPTANCE pipeline (requestPlanProposal's main flow:
 *    applyExplicitAvoidPostFilterLocal -> applyEligibilityPostFilterLocal ->
 *    enforceLegalPlacementsLocal) had NO defense-in-depth filter against
 *    classifyCourseSchedulability === 'unschedulable_missing_data', unlike
 *    buildDeterministicReplacementPlan (step 5), which already has exactly
 *    this check. So if the LLM ever proposed a nameless id (plausible, given
 *    the leaked candidate list above), nothing downstream would catch it
 *    before the board.
 *  - Board rendering of an EXISTING-on-board nameless course showed a normal-
 *    looking card with placeholder text ("⚠ שם קורס חסר — נדרש ייבוא מידע")
 *    rather than excluding it and surfacing a distinct data-audit warning.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const NAMELESS_1 = '0542-4124';
const NAMELESS_2 = '0542-4191';

function injectNamelessCourses(window) {
  window.eval(`
    courseMap['${NAMELESS_1}'] = { course_id:'${NAMELESS_1}', name_he:null, weekly_hours:null, offered_semesters:[], is_mandatory:false, placement_policy:'elective', category_id:'other_specialization', program_category_id:'other_specialization' };
    courseMap['${NAMELESS_2}'] = { course_id:'${NAMELESS_2}', name_he:null, weekly_hours:null, offered_semesters:[], is_mandatory:false, placement_policy:'elective', category_id:'other_specialization', program_category_id:'other_specialization' };
    if (!state.repo.includes('${NAMELESS_1}')) state.repo.push('${NAMELESS_1}');
    if (!state.repo.includes('${NAMELESS_2}')) state.repo.push('${NAMELESS_2}');
    if (programRequirements && programRequirements.categories) {
      const cat = programRequirements.categories.find(c => c.category_id === 'other_specialization');
      if (cat && !cat.course_ids.includes('${NAMELESS_1}')) cat.course_ids.push('${NAMELESS_1}', '${NAMELESS_2}');
    }
  `);
}

function createPageSetup(aiResponseFn) {
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
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(aiResponseFn ? aiResponseFn(window) : { semesters: [], warnings_he: [] }) });
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

describe('test_nameless_courses_not_in_repository', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a nameless course injected into state.repo never renders as a repository card', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    window.eval('renderSidebar();');
    const html = window.eval('document.getElementById("repo-list") ? document.getElementById("repo-list").innerHTML : document.body.innerHTML');
    expect(html).not.toContain(NAMELESS_1);
    expect(html).not.toContain(NAMELESS_2);
  });
});

describe('test_nameless_courses_not_in_ai_candidate_pool', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('buildPlanContext never sends a nameless course as a category/general candidate to the LLM', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    const r = JSON.parse(window.eval(`(function(){
      const ctx = buildPlanContext();
      const catCandidates = (ctx.category_requirements||[]).flatMap(c => c.candidates||[]).map(c=>c.course_id);
      const generalCandidates = (ctx.general_course_requirements && ctx.general_course_requirements.candidates || []).map(c=>c.course_id);
      return JSON.stringify({ catCandidates, generalCandidates });
    })()`));
    expect(r.catCandidates).not.toContain(NAMELESS_1);
    expect(r.catCandidates).not.toContain(NAMELESS_2);
    expect(r.generalCandidates).not.toContain(NAMELESS_1);
    expect(r.generalCandidates).not.toContain(NAMELESS_2);
  });
});

describe('test_nameless_courses_not_in_generated_draft', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('deterministic fill-to-target never places a nameless course even under hour pressure', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      return JSON.stringify({ allIds });
    })()`));
    expect(r.allIds).not.toContain(NAMELESS_1);
    expect(r.allIds).not.toContain(NAMELESS_2);
  });

  test('the LLM-accepted pipeline strips a nameless course even if the LLM proposes it', async () => {
    ({ dom, window } = createPageSetup((win) => {
      const sems = JSON.parse(win.eval(`JSON.stringify(SEMESTERS.map(s=>({semester_id:s.id, course_ids:[...(state.semesters[s.id]||[])]})))`));
      const ya = sems.find(s => s.semester_id === 'year_4_semester_a');
      if (ya) ya.course_ids.push(NAMELESS_1, NAMELESS_2);
      return { semesters: sems, warnings_he: [] };
    }));
    await waitForInit(window);
    injectNamelessCourses(window);
    window.eval(`window.__done = false; degreeHoursProfile = { completed_degree_hours: 128.5 }; requestPlanProposal({ action_type:'full_plan' }, 'full_plan').then(()=>{window.__done=true;}).catch(e=>{window.__err=String(e); window.__done=true;});`);
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); if (window.eval('window.__done === true')) break; }
    const r = JSON.parse(window.eval(`(function(){
      const draftActive = !!(state.proposalDraft && state.proposalDraft.semesters);
      const sems = draftActive ? state.proposalDraft.semesters : state.semesters;
      const allIds = Object.values(sems).flat();
      return JSON.stringify({ allIds });
    })()`));
    expect(r.allIds).not.toContain(NAMELESS_1);
    expect(r.allIds).not.toContain(NAMELESS_2);
  });
});

describe('test_nameless_courses_not_counted_toward_degree_hours', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('hoursForCourseId / degree progress never counts a nameless course even if force-placed', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    const r = JSON.parse(window.eval(`(function(){
      const h = hoursForCourseId('${NAMELESS_1}');
      return JSON.stringify({ hours: h });
    })()`));
    // weekly_hours is genuinely null for this course — must not silently become
    // a positive number that inflates degree-hours accounting.
    expect(r.hours == null || r.hours === 0).toBe(true);
  });
});

describe('test_existing_board_nameless_course_is_flagged_not_normal_card', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a nameless course already placed on the committed board is excluded from the normal card render and surfaced as a data-audit warning', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    window.eval(`state.semesters['year_3_semester_a'] = [...new Set([...(state.semesters['year_3_semester_a']||[]), '${NAMELESS_1}'])]; state.repo = state.repo.filter(c => c !== '${NAMELESS_1}'); renderBoard();`);
    const r = JSON.parse(window.eval(`(function(){
      const boardHtml = document.getElementById('board').innerHTML;
      const hasNormalCard = boardHtml.includes('data-cid="${NAMELESS_1}"') || boardHtml.includes("data-cid='${NAMELESS_1}'");
      const hasAuditWarning = boardHtml.includes('מידע חסר') && boardHtml.includes('יבוא');
      return JSON.stringify({ hasNormalCard, hasAuditWarning, hasPlaceholderText: boardHtml.includes('קורס חסר') });
    })()`));
    expect(r.hasNormalCard).toBe(false);
    expect(r.hasAuditWarning).toBe(true);
  });
});

describe('test_summary_never_mentions_nameless_course_as_scheduled', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('the deterministic-rescue chat message never lists a nameless course as שובצו/נוספו', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    injectNamelessCourses(window);
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true });
      const focusStr = _formatDomainFocusHe(plan.domainReport);
      return JSON.stringify({ focusStr, confirmedCids: plan.confirmedCids, tentativeCids: plan.tentativeCids });
    })()`));
    expect(r.focusStr).not.toContain(NAMELESS_1);
    expect(r.focusStr).not.toContain(NAMELESS_2);
    expect(r.confirmedCids).not.toContain(NAMELESS_1);
    expect(r.tentativeCids).not.toContain(NAMELESS_1);
  });
});

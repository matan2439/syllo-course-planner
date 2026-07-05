/**
 * Command execution — recognized corrective chat commands must become a
 * STRUCTURED state change that the deterministic planner ACTUALLY EXECUTES
 * (gated by validateFinalPlan), not chat-only acknowledgements.
 *
 * Covers the two previously-DEAD fields now consumed by the pipeline:
 *   - requested_moves       → applyRequestedMovesLocal (relocate to legal sem)
 *   - semester_load_targets → repairPlanLoad 'reduce' bias (shed a movable course)
 * Plus: execute-on-command with an existing draft (rebuild via the gate, no
 * fake user bubble), the deterministic change summary, and the preserved
 * שלח-no-autobuild contract for ambiguous text.
 *
 * Assertions are behaviour-level: they check the SCHEDULE actually changed,
 * not merely that a message was posted.
 *
 * Same jsdom harness as plan_chat_no_autobuild.test.js.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

function loadPage() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const scriptSrc = scriptMatch[1];
  html = html.replace(scriptMatch[0], '');

  const dom = new JSDOM(html, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    if (u.includes('/api/')) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  };
  window.confirm = () => { throw new Error('confirm should not be called'); };
  window.alert = () => { throw new Error('alert should not be called'); };

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = scriptSrc;
  window.document.body.appendChild(scriptEl);
  return dom;
}

function waitForInit(window) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const ready = window.eval('typeof state !== "undefined" && !!state && !!state.semesters');
      if (ready) return resolve();
      if (Date.now() - start > 20000) return reject(new Error('init() did not complete in time'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('Command execution — requested_moves + semester_load_targets consumed', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
    window.setSidebarTab('ai');
  });

  afterEach(() => { dom.window.close(); });

  // ── 1) requested_moves: legal target → course ends up there ────────────────
  test('requested_moves: a course in sem X with a LEGAL requested move ends up in sem Y', () => {
    const out = window.eval(`(function(){
      var proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['C1'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ], warnings_he: [] };
      // C1 is legal in BOTH semesters → move A→B is allowed.
      courseMap['C1'] = { course_id:'C1', name_he:'קורס בדיקה', course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] };
      var courses = { C1: { hours: 3, course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] } };
      var r = applyRequestedMovesLocal(proposal, { C1: 'year_3_semester_b' }, { courses: courses });
      var bySem = {};
      r.proposal.semesters.forEach(function(s){ bySem[s.semester_id] = s.course_ids; });
      return JSON.stringify({ moved: r.moved, skipped: r.skipped, bySem: bySem });
    })()`);
    const parsed = JSON.parse(out);
    // SCHEDULE actually changed: C1 left A, now in B.
    expect(parsed.bySem['year_3_semester_a']).not.toContain('C1');
    expect(parsed.bySem['year_3_semester_b']).toContain('C1');
    expect(parsed.moved).toEqual([{ course_id: 'C1', from: 'year_3_semester_a', to: 'year_3_semester_b' }]);
  });

  test('requested_moves: ILLEGAL target → NOT moved + recorded as skipped', () => {
    const out = window.eval(`(function(){
      var proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['C2'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ], warnings_he: [] };
      // C2 is ONLY offered in semester A → move to B is illegal.
      courseMap['C2'] = { course_id:'C2', name_he:'קורס א בלבד', course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a'] };
      var courses = { C2: { hours: 3, course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a'] } };
      var r = applyRequestedMovesLocal(proposal, { C2: 'year_3_semester_b' }, { courses: courses });
      var bySem = {};
      r.proposal.semesters.forEach(function(s){ bySem[s.semester_id] = s.course_ids; });
      return JSON.stringify({ moved: r.moved, skipped: r.skipped, bySem: bySem });
    })()`);
    const parsed = JSON.parse(out);
    // Unchanged: C2 stays in A.
    expect(parsed.bySem['year_3_semester_a']).toContain('C2');
    expect(parsed.bySem['year_3_semester_b']).not.toContain('C2');
    expect(parsed.moved).toEqual([]);
    expect(parsed.skipped.some(s => s.course_id === 'C2' && s.reason === 'illegal_target')).toBe(true);
  });

  test('requested_moves: idempotent — a course already in its target is left untouched (no spurious move)', () => {
    const out = window.eval(`(function(){
      var proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: [] },
        { semester_id: 'year_3_semester_b', course_ids: ['C3'] },
      ], warnings_he: [] };
      courseMap['C3'] = { course_id:'C3', name_he:'כבר ביעד', course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] };
      var courses = { C3: { hours: 3, course_type:'elective',
        effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] } };
      var r = applyRequestedMovesLocal(proposal, { C3: 'year_3_semester_b' }, { courses: courses });
      return JSON.stringify({ moved: r.moved });
    })()`);
    expect(JSON.parse(out).moved).toEqual([]);
  });

  // ── 2) semester_load_targets 'reduce' → lower load after repairPlanLoad ─────
  test("semester_load_targets reduce: flagged semester has LOWER load than WITHOUT the flag, legality preserved", () => {
    const out = window.eval(`(function(){
      // Two semesters, neither over the cap. Sem A holds two movable electives;
      // both are ALSO legal in B, so the 'reduce' bias can relocate one.
      function mkProposal(){ return { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['E1','E2'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ] }; }
      var courses = {
        E1: { hours: 4, course_type:'elective', placement_policy:'elective',
              effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] },
        E2: { hours: 4, course_type:'elective', placement_policy:'elective',
              effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] },
      };
      var baseCtx = {
        maxHoursPerSemester: 26,
        courses: courses,
        pinnedCourseIds: new Set(),
        completedCourseIds: new Set(),
      };
      function loadA(prop){
        var sem = prop.semesters.find(function(s){ return s.semester_id==='year_3_semester_a'; });
        return getSemesterLoadLocal(sem, courses);
      }
      // Without the flag: the balancer leaves a non-overloaded semester alone.
      var noFlag = repairPlanLoad(mkProposal(), Object.assign({}, baseCtx));
      var loadNoFlag = loadA(noFlag.proposal);
      // With the flag: 'reduce' should shed a movable elective to B.
      var withFlag = repairPlanLoad(mkProposal(), Object.assign({}, baseCtx, {
        semesterLoadTargets: { year_3_semester_a: 'reduce' },
      }));
      var loadWithFlag = loadA(withFlag.proposal);
      // Legality: every E* still sits in a legal semester.
      var bySem = {};
      withFlag.proposal.semesters.forEach(function(s){ s.course_ids.forEach(function(c){ bySem[c]=s.semester_id; }); });
      var legalOk = ['E1','E2'].every(function(c){
        return courses[c].effective_allowed_semesters.indexOf(bySem[c]) >= 0;
      });
      return JSON.stringify({ loadNoFlag: loadNoFlag, loadWithFlag: loadWithFlag, legalOk: legalOk });
    })()`);
    const parsed = JSON.parse(out);
    expect(parsed.loadWithFlag).toBeLessThan(parsed.loadNoFlag);
    expect(parsed.legalOk).toBe(true);
  });

  test("semester_load_targets reduce: never sheds a course to a destination that would overload it", () => {
    const out = window.eval(`(function(){
      // Sem B is already near the cap; moving E1 (4h) would push it over 26 → must NOT move.
      var proposal = { semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['E1'] },
        { semester_id: 'year_3_semester_b', course_ids: ['BIG'] },
      ] };
      var courses = {
        E1:  { hours: 4, course_type:'elective', placement_policy:'elective',
               effective_allowed_semesters:['year_3_semester_a','year_3_semester_b'] },
        BIG: { hours: 24, course_type:'elective', placement_policy:'elective',
               effective_allowed_semesters:['year_3_semester_b'] },
      };
      var ctx = { maxHoursPerSemester: 26, courses: courses,
        pinnedCourseIds: new Set(), completedCourseIds: new Set(),
        semesterLoadTargets: { year_3_semester_a: 'reduce' } };
      var r = repairPlanLoad(proposal, ctx);
      var bySem = {};
      r.proposal.semesters.forEach(function(s){ s.course_ids.forEach(function(c){ bySem[c]=s.semester_id; }); });
      return JSON.stringify({ e1Sem: bySem['E1'] });
    })()`);
    // No legal destination with room → E1 stays put.
    expect(JSON.parse(out).e1Sem).toBe('year_3_semester_a');
  });

  // ── 4) change summary: reflects an ACTUAL move + varies on repeat ──────────
  test('change summary reflects an actual moved course and is a stable structured message', () => {
    const out = window.eval(`(function(){
      _aiChatMessages = [];
      _planChangeSummaryNonce = 0;
      courseMap['M1'] = { course_id:'M1', name_he:'קורס שעבר' };
      var prev = { semesters: [
        { semester_id:'year_3_semester_a', course_ids:['M1'] },
        { semester_id:'year_3_semester_b', course_ids:[] },
      ] };
      var next = { semesters: [
        { semester_id:'year_3_semester_a', course_ids:[] },
        { semester_id:'year_3_semester_b', course_ids:['M1'] },
      ] };
      postPlanChangeSummary(prev, next, {});
      var first = _aiChatMessages[_aiChatMessages.length-1].text;
      // Repeat the SAME diff — the concise structured summary (Part B) is now
      // deterministic (no rotating cosmetic opener), so identical input → identical
      // scannable output.
      postPlanChangeSummary(prev, next, {});
      var second = _aiChatMessages[_aiChatMessages.length-1].text;
      return JSON.stringify({ first: first, second: second });
    })()`);
    const parsed = JSON.parse(out);
    // Mentions the actual moved course + its destination, under "מה השתנה".
    expect(parsed.first).toContain('קורס שעבר');
    expect(parsed.first).toContain('סמסטר');
    expect(parsed.first).toContain('מה השתנה');
    // Deterministic, stable output for identical input.
    expect(parsed.second).toBe(parsed.first);
  });

  test('change summary lists added and removed courses derived from the real diff', () => {
    const out = window.eval(`(function(){
      _aiChatMessages = [];
      _planChangeSummaryNonce = 0;
      courseMap['ADD'] = { course_id:'ADD', name_he:'קורס שנוסף' };
      courseMap['REM'] = { course_id:'REM', name_he:'קורס שהוסר' };
      var prev = { semesters: [ { semester_id:'year_3_semester_a', course_ids:['REM'] } ] };
      var next = { semesters: [ { semester_id:'year_3_semester_a', course_ids:['ADD'] } ] };
      postPlanChangeSummary(prev, next, {});
      return _aiChatMessages[_aiChatMessages.length-1].text;
    })()`);
    expect(out).toContain('קורס שנוסף');
    expect(out).toContain('קורס שהוסר');
  });

  // ── 3) execute-on-command: recognized command + existing draft → rebuild ───
  test('recognized command WITH a draft mutates the draft directly (DraftPatch) — course removed, recorded, no fake bubble', async () => {
    // New contract: a recognized correction with an active draft is applied as a
    // DraftPatch that DIRECTLY mutates the draft (no second confirm, no gate spy).
    window.eval('detectClarificationNeeds = () => null;');
    window.eval('detectAmbiguousPlanningInstruction = () => [];');
    // Seed an existing draft containing a NON-mandatory elective to be excluded
    // (a mandatory course cannot be removed — it is required).
    const cid = window.eval("Object.keys(courseMap).find(k => courseMap[k] && courseMap[k].name_he && (courseMap[k].course_type||'elective')!=='mandatory' && !courseMap[k].is_mandatory)");
    window.eval("state.proposalDraft = { semesters: { year_3_semester_a: ['" + cid + "'] }, repo: [] };");

    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'אל תשבץ את ' + cid;
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));

    // The board actually changed: the course is no longer in the draft.
    expect(window.eval(`Object.values(state.proposalDraft.semesters).flat().indexOf('${cid}') >= 0`)).toBe(false);
    // The exclusion is recorded as a hard constraint (state change).
    expect(window.eval(`_aiPickerState.strongUnwanted.indexOf('${cid}') >= 0`)).toBe(true);
    expect(window.eval(`(_aiUserIntentProfile.hardExcludeCourseIds||[]).indexOf('${cid}') >= 0`)).toBe(true);
    // No fake user bubble with the build-button label was inserted.
    expect(window.eval('_aiChatMessages.some(m => m.role === "user" && m.text && m.text.indexOf("בנה מערכת מחדש") >= 0)')).toBe(false);
  });

  // ── contract preserved: ambiguous text (fb.handled === false) → no autobuild ─
  test('CONTRACT: plain ambiguous preference text (fb.handled===false) does NOT auto-build even with a draft', async () => {
    window.eval('detectClarificationNeeds = () => null;');
    window.eval('window.__rppCalls = 0; requestPlanProposal = function(){ window.__rppCalls++; return Promise.resolve(); };');
    window.eval('window.__rpfdCalls = 0; if (typeof requestPlanProposalFromDraft !== "undefined") { requestPlanProposalFromDraft = function(){ window.__rpfdCalls++; return Promise.resolve(); }; }');
    window.eval("state.proposalDraft = { semesters: { year_3_semester_a: [] }, repo: [] };");

    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'אני רוצה משהו יותר מעניין בבקשה';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));

    expect(window.eval('window.__rppCalls')).toBe(0);
    expect(window.eval('window.__rpfdCalls')).toBe(0);
    const logEl = document.getElementById('ai-chat-log');
    const chips = Array.from(logEl.querySelectorAll('button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });
});

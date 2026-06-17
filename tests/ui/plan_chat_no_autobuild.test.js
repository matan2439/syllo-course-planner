/**
 * Issue 1 — the chat "שלח" button must NOT auto-build a plan from free-text
 * preference messages. It persists the message into
 * _aiPlanLastPreferences.extra_request_he and offers an explicit
 * "בנה מערכת מחדש" chip. Only the explicit build button / 'rebuild-plan' /
 * 'build-plan' quick action calls requestPlanProposal.
 *
 * Uses the same jsdom harness as semester_board_ai_chat.test.js.
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

describe('Issue 1 — שלח does not auto-build', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
    window.setSidebarTab('ai');
    // Spy on BOTH build entry points. Any call here would be an auto-build.
    window.eval('window.__rppCalls = 0; requestPlanProposal = function(...a){ window.__rppCalls++; return Promise.resolve(); };');
    window.eval('window.__rpfdCalls = 0; if (typeof requestPlanProposalFromDraft !== "undefined") { requestPlanProposalFromDraft = function(...a){ window.__rpfdCalls++; return Promise.resolve(); }; }');
  });

  afterEach(() => { dom.window.close(); });

  test('plain free-text preference: persists extra_request_he, offers build chip, does NOT call requestPlanProposal', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    const pref = 'אני רוצה חוזק ויברציות וזרימה, לא רוצה תרמודינמיקה כקורס בחירה, ממוצע מעל 82';
    input.value = pref;

    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    // No auto-build happened.
    expect(window.eval('window.__rppCalls')).toBe(0);

    // The user's message was persisted as the preference.
    const stored = window.eval('(_aiPlanLastPreferences && _aiPlanLastPreferences.extra_request_he) || ""');
    expect(stored).toContain('תרמודינמיקה');

    // The user bubble was appended.
    const logEl = document.getElementById('ai-chat-log');
    expect(logEl.querySelector('.ai-chat-bubble.user')).toBeTruthy();

    // No proposal draft / loading was created.
    expect(window.eval('!!(state && state.proposalDraft)')).toBe(false);
    expect(logEl.querySelector('.ai-chat-bubble.assistant.loading')).toBeFalsy();

    // An explicit "בנה מערכת מחדש" build chip is offered.
    const chips = Array.from(logEl.querySelectorAll('.ai-quick-reply, button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });

  test('Test 1 — analyses preference (no avoid): no build, draft unchanged, prefs updated, chip offered', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    const draftBefore = window.eval('JSON.stringify(state.proposalDraft || null)');
    const lastPropBefore = window.eval('JSON.stringify(_aiPlanLastProposal || null)');

    input.value = 'אני רוצה להתעסק באנליזות חוזק ויברציות וזרימה, ממוצע מעל 82';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    expect(window.eval('window.__rppCalls')).toBe(0);
    expect(window.eval('window.__rpfdCalls')).toBe(0);
    const logEl = document.getElementById('ai-chat-log');
    expect(logEl.querySelector('.ai-chat-bubble.user')).toBeTruthy();
    expect(window.eval('(_aiPlanLastPreferences && _aiPlanLastPreferences.extra_request_he) || ""')).toContain('ויברציות');
    expect(window.eval('JSON.stringify(state.proposalDraft || null)')).toBe(draftBefore);
    expect(window.eval('JSON.stringify(_aiPlanLastProposal || null)')).toBe(lastPropBefore);
    const chips = Array.from(logEl.querySelectorAll('.ai-quick-reply, button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });

  test('Test 2 — imperative "build me a plan": no build, offers explicit build action', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'בנה לי מערכת לפי ההעדפות האלה';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('window.__rppCalls')).toBe(0);
    expect(window.eval('window.__rpfdCalls')).toBe(0);
    const logEl = document.getElementById('ai-chat-log');
    const chips = Array.from(logEl.querySelectorAll('.ai-quick-reply, button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });

  test('Test 2b (REGRESSION) — clarification continuation (pending != null) STILL does not build', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    const draftBefore = window.eval('JSON.stringify(state.proposalDraft || null)');

    // First send triggers a clarification question (sets _aiPendingPlanningRequest).
    input.value = 'אני רוצה מערכת טובה יותר';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    // Force the pending state so the continuation path is exercised deterministically.
    window.eval('_aiPendingPlanningRequest = "אני רוצה מערכת טובה יותר"; _aiClarificationAnswered = false;');

    // The answer send re-enters with pending != null — this is the bypass path.
    input.value = 'ממוצע מעל 85';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));

    expect(window.eval('window.__rppCalls')).toBe(0);
    expect(window.eval('window.__rpfdCalls')).toBe(0);
    expect(window.eval('JSON.stringify(state.proposalDraft || null)')).toBe(draftBefore);
    // Combined planningText persisted.
    expect(window.eval('(_aiPlanLastPreferences && _aiPlanLastPreferences.extra_request_he) || ""')).toContain('85');
  });

  test('Test 4 — board/draft state unchanged after a plain send', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    const boardBefore = window.eval('JSON.stringify(state.semesters)');
    const draftBefore = window.eval('JSON.stringify(state.proposalDraft || null)');
    input.value = 'חשוב לי ממוצע גבוה';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('JSON.stringify(state.semesters)')).toBe(boardBefore);
    expect(window.eval('JSON.stringify(state.proposalDraft || null)')).toBe(draftBefore);
  });

  test('Issue A — REAL DOM click + general-intent message + LLM JSON proposal block does NOT auto-apply', async () => {
    // Stub callAiStream to return a response containing a ```json proposal block
    // (the exact manual bug — Q&A JSON auto-apply).
    window.eval('window.__activateCalls = 0; activateProposalDraft = function(p){ window.__activateCalls++; };');
    window.eval(`callAiStream = function(){ return Promise.resolve('בטח, הנה הצעה:\\n\\n\\u0060\\u0060\\u0060json\\n{"semesters":[{"semester_id":"year_3_semester_a","course_ids":["0542-2600"]}],"rationale_he":"x"}\\n\\u0060\\u0060\\u0060'); };`);
    // A question-style message classifies as a general intent (not planning).
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    const draftBefore = window.eval('JSON.stringify(state.proposalDraft || null)');
    input.value = 'מה ההבדל בין שני קורסי התרמודינמיקה?';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));

    expect(window.eval('window.__rppCalls')).toBe(0);
    expect(window.eval('window.__rpfdCalls')).toBe(0);
    expect(window.eval('window.__activateCalls')).toBe(0);
    expect(window.eval('JSON.stringify(state.proposalDraft || null)')).toBe(draftBefore);
    // Raw JSON must not be shown; a rebuild chip is offered instead.
    const logEl = document.getElementById('ai-chat-log');
    const assistantTexts = Array.from(logEl.querySelectorAll('.ai-chat-bubble.assistant')).map(b => b.textContent).join('\n');
    expect(assistantTexts).not.toContain('```json');
    const chips = Array.from(logEl.querySelectorAll('button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });

  test('Issue B — איפוס שיחה reset clears AI/planning state but preserves board + course statuses', async () => {
    // Seed stale state.
    window.eval(`
      _aiPendingPlanningRequest = 'x';
      _aiClarificationAnswered = true;
      _aiPlanLastValidation = { errors: ['e'] };
      _aiPlanLastProposal = { semesters: [] };
      _aiPickerState = { wanted: ['a'], unwanted: ['b'], strongUnwanted: ['b'], shaarRuachAssessmentPref: 'x', _initialized: true };
      state.proposalDraft = { semesters: { year_3_semester_a: ['0542-2600'] }, repo: [] };
      postAssistantMessage('stale message');
    `);
    // Commit some course statuses + capture board.
    window.eval(`userCourseStatuses = { '0542-2600': { status: 'completed' } };`);
    const boardBefore = window.eval('JSON.stringify(state.semesters)');
    const statusesBefore = window.eval('JSON.stringify(userCourseStatuses)');

    const resetBtn = document.getElementById('sidebar-reset-chat');
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.textContent).toContain('איפוס שיחה');
    // Auto-confirm requestUserConfirmation.
    window.eval('requestUserConfirmation = (o) => o.onConfirm && o.onConfirm();');
    resetBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));

    expect(window.eval('_aiPendingPlanningRequest')).toBeNull();
    expect(window.eval('_aiClarificationAnswered')).toBe(false);
    expect(window.eval('_aiPlanLastValidation')).toBeNull();
    expect(window.eval('_aiPlanLastProposal')).toBeNull();
    expect(window.eval('JSON.stringify(_aiPickerState)')).toBe(JSON.stringify({ wanted: [], unwanted: [], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true }));
    expect(window.eval('state.proposalDraft')).toBeNull();
    // The stale message is gone (a fresh greeting from renderAiTab is allowed).
    expect(window.eval('_aiChatMessages.some(m => m.text === "stale message")')).toBe(false);
    // Preserved.
    expect(window.eval('JSON.stringify(state.semesters)')).toBe(boardBefore);
    expect(window.eval('JSON.stringify(userCourseStatuses)')).toBe(statusesBefore);
  });

  test('Issue C — explicit avoid by name: resolves id, post-filter drops elective, keeps mandatory', async () => {
    // resolveAvoidedCourseIdsLocal resolves "תרמודינמיקה (2)" to its id.
    const ids = window.eval(`(function(){
      var m = {};
      m['T2'] = { course_id: 'T2', name_he: 'תרמודינמיקה (2)', course_type: 'elective' };
      m['T1'] = { course_id: 'T1', name_he: 'תרמודינמיקה (1)', course_type: 'elective' };
      m['HEAT'] = { course_id: 'HEAT', name_he: 'מעבר חום', course_type: 'mandatory' };
      return JSON.stringify([...resolveAvoidedCourseIdsLocal('לא רוצה תרמודינמיקה (2)', m)]);
    })()`);
    expect(JSON.parse(ids)).toEqual(['T2']);

    // pickBestCandidate skips it when an alternative exists.
    const picked = window.eval(`(function(){
      var cands = [
        { course_id: 'T2', name_he: 'תרמודינמיקה (2)' },
        { course_id: 'ALT', name_he: 'מכניקת הזורמים' },
      ];
      var unwanted = new Set(['T2']);
      var c = _pickBestCandidateLocal(cands, unwanted, '');
      return c && c.course_id;
    })()`);
    expect(picked).toBe('ALT');

    // Final post-filter: elective avoided id removed, mandatory avoided kept w/ rationale.
    const out = window.eval(`(function(){
      var proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['T2','HEAT','ALT'] }], warnings_he: [] };
      var ctxCourses = { T2: { is_mandatory: false, course_type: 'elective' }, HEAT: { is_mandatory: true, course_type: 'mandatory' }, ALT: { is_mandatory: false } };
      courseMap['T2'] = { course_id:'T2', name_he:'תרמודינמיקה (2)', course_type:'elective' };
      courseMap['HEAT'] = { course_id:'HEAT', name_he:'מעבר חום', course_type:'mandatory' };
      var r = applyExplicitAvoidPostFilterLocal(proposal, new Set(['T2','HEAT']), ctxCourses);
      return JSON.stringify({ ids: r.proposal.semesters[0].course_ids, removed: r.removed, kept: r.keptMandatory, warns: r.proposal.warnings_he });
    })()`);
    const parsed = JSON.parse(out);
    expect(parsed.ids).toContain('HEAT');
    expect(parsed.ids).not.toContain('T2');
    expect(parsed.removed).toEqual(['T2']);
    expect(parsed.kept).toEqual(['HEAT']);
    expect(parsed.warns.some(w => w.includes('מעבר חום') && w.includes('חובה'))).toBe(true);
  });

  test("Issue 3 — clicking rebuild posts a STATUS message, not a fake user 'בנה מערכת מחדש' bubble", async () => {
    window.eval('detectAmbiguousPlanningInstruction = () => [];');
    document.getElementById('sidebar-chat-input').value = '';
    const logEl = document.getElementById('ai-chat-log');

    const buildBtn = document.getElementById('sidebar-build-from-scratch');
    buildBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // Existing board → inline chat confirmation; confirm it to proceed.
    window.eval('if (_pendingBuildProceed) handleQuickReply({ action: "confirm-build-yes", label: "כן, בנה מערכת" })');
    await new Promise(r => setTimeout(r, 60));

    // No USER bubble with the button label was inserted.
    const userTexts = Array.from(logEl.querySelectorAll('.ai-chat-bubble.user')).map(b => b.textContent);
    expect(userTexts.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(false);
    // No persisted USER chat message equals the button label.
    expect(window.eval('_aiChatMessages.some(m => m.role === "user" && m.text && m.text.indexOf("בנה מערכת מחדש") >= 0)')).toBe(false);
    // A non-user STATUS message was posted, and it is flagged isStatus so it is
    // never treated as a user instruction.
    expect(window.eval('_aiChatMessages.some(m => m.isStatus === true && m.role === "assistant")')).toBe(true);
    // The build path ran.
    expect(window.eval('window.__rppCalls')).toBeGreaterThanOrEqual(1);
  });

  test("Issue 6 — 'אל תשבץ X' updates avoid list (unwanted + strongUnwanted)", async () => {
    window.eval('detectClarificationNeeds = () => null;');
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    // Pick a real course id present in courseMap with a course entry.
    const cid = window.eval('Object.keys(courseMap).find(k => courseMap[k] && courseMap[k].course_id)');
    input.value = `אל תשבץ את ${cid}`;
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval(`_aiPickerState.unwanted.indexOf('${cid}') >= 0`)).toBe(true);
    expect(window.eval(`_aiPickerState.strongUnwanted.indexOf('${cid}') >= 0`)).toBe(true);
    // Offers an explicit rebuild chip, never auto-builds.
    expect(window.eval('window.__rppCalls')).toBe(0);
    const logEl = document.getElementById('ai-chat-log');
    const chips = Array.from(logEl.querySelectorAll('button')).map(b => b.textContent);
    expect(chips.some(t => t && t.includes('בנה מערכת מחדש'))).toBe(true);
  });

  test("Issue 6 — 'פחות עומס בשנה ג סמסטר א' sets a per-semester load preference", async () => {
    window.eval('detectClarificationNeeds = () => null;');
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'פחות עומס בשנה ג סמסטר א';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('!!(_aiPlanLastPreferences && _aiPlanLastPreferences.balance_load)')).toBe(true);
    expect(window.eval("(_aiPlanLastPreferences.semester_load_targets || {})['year_3_semester_a']")).toBe('reduce');
    expect(window.eval('window.__rppCalls')).toBe(0);
  });

  test("Issue 6 — 'תשלים קורסי בחירה לבד' sets auto-fill preference", async () => {
    window.eval('detectClarificationNeeds = () => null;');
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'תשלים קורסי בחירה לבד';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('!!(_aiPlanLastPreferences && _aiPlanLastPreferences.auto_fill_electives)')).toBe(true);
    expect(window.eval('window.__rppCalls')).toBe(0);
  });

  test("Issue 6 — 'אני לא יכול לקחת קורסי מצטיינים' sets is_honors_student=false", async () => {
    window.eval('detectClarificationNeeds = () => null;');
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'אני לא יכול לקחת קורסי מצטיינים';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('_aiPlanLastPreferences.is_honors_student')).toBe(false);
    expect(window.eval('window.__rppCalls')).toBe(0);
  });

  test("Issue 6 — feedback-triggered rebuild still goes through the explicit gate (validateFinalPlan)", async () => {
    // After updating state via feedback, clicking the offered rebuild chip runs
    // the explicit build path (requestPlanProposal → gateProposalActivation).
    window.eval('detectAmbiguousPlanningInstruction = () => [];');
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'תשלים קורסי בחירה לבד';
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    // Click the rebuild chip from the assistant message.
    window.eval('handleQuickReply({ label: "בנה מערכת מחדש", action: "rebuild-plan" })');
    await new Promise(r => setTimeout(r, 30));
    // Existing board → inline chat confirmation; confirm it to proceed.
    window.eval('if (_pendingBuildProceed) handleQuickReply({ action: "confirm-build-yes", label: "כן, בנה מערכת" })');
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('window.__rppCalls')).toBeGreaterThanOrEqual(1);
  });

  test("'rebuild-plan' quick action DOES reach the build path", async () => {
    // Avoid clarification questions diverting the flow.
    window.eval('detectAmbiguousPlanningInstruction = () => [];');
    // Ensure the chat input is empty so no clarification path triggers.
    document.getElementById('sidebar-chat-input').value = '';
    window.eval('handleQuickReply({ label: "בנה מערכת מחדש", action: "rebuild-plan" })');
    await new Promise(r => setTimeout(r, 30));

    // With an existing board, an inline chat confirmation is shown — confirm it.
    window.eval('if (_pendingBuildProceed) handleQuickReply({ action: "confirm-build-yes", label: "כן, בנה מערכת" })');
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('window.__rppCalls')).toBeGreaterThanOrEqual(1);
  });
});

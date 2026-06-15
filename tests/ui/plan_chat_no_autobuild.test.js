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

  test("'rebuild-plan' quick action DOES reach the build path", async () => {
    // Avoid clarification questions diverting the flow.
    window.eval('detectAmbiguousPlanningInstruction = () => [];');
    // Ensure the chat input is empty so no clarification path triggers.
    document.getElementById('sidebar-chat-input').value = '';
    window.eval('handleQuickReply({ label: "בנה מערכת מחדש", action: "rebuild-plan" })');
    await new Promise(r => setTimeout(r, 30));

    // With an existing board, a confirm card is shown — click "בנה מערכת".
    const confirmCard = document.getElementById('ai-build-confirm');
    if (confirmCard) {
      const confirmBtn = confirmCard.querySelector('[data-uc-confirm]');
      if (confirmBtn) confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 60));
    expect(window.eval('window.__rppCalls')).toBeGreaterThanOrEqual(1);
  });
});

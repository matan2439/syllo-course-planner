/**
 * jsdom harness for the AI chat thread UI in app/web/semester_board_viewer.html.
 *
 * Loads the real HTML/script (same pattern as semester_board_mycourses.test.js)
 * and drives the AI tab chat input/build button to prove:
 *  - sending a message renders a user bubble synchronously and a loading bubble
 *    while the request is pending, then replaces it with the result/error,
 *  - the build button shows staged progress text while pending,
 *  - chat history persists across tab switches,
 *  - the chat thread auto-scrolls to bottom,
 *  - default AI panel render has no dead/empty leftover containers,
 *  - the degree-selection click does not throw/hang,
 *  - loading state is cleared in `finally` even on synchronous throw,
 *  - no duplicate click handlers across multiple renderAiTab() calls.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

function loadPage({ fetchImpl } = {}) {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');

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

  window.fetch = fetchImpl || ((url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  });

  window.confirm = () => { throw new Error('confirm should not be called'); };
  window.alert = () => {};

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

describe('AI chat thread UI', () => {
  let dom, window, document, fetchCalls;

  beforeEach(async () => {
    fetchCalls = [];
    dom = loadPage({
      fetchImpl: (url, opts) => {
        const u = String(url);
        fetchCalls.push({ url: u, opts });
        if (u.includes('mechanical_semester_board_2027.json')) {
          const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');
          return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
        }
        if (u.includes('/api/ai/') || u.includes('/api/')) {
          // Never resolves within the test unless explicitly controlled —
          // default: reject quickly so handlers complete.
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
      },
    });
    window = dom.window;
    document = window.document;
    await waitForInit(window);
    window.setSidebarTab('ai');
  });

  afterEach(() => {
    dom.window.close();
  });

  test('default AI panel render has no empty/dead leftover containers', () => {
    const confirmEl = document.getElementById('ai-build-confirm');
    expect(confirmEl).toBeFalsy(); // not created until a build is confirmed

    expect(document.getElementById('sb-panel-ai').innerHTML).not.toContain('renderRepairDiagnosticsHtml');
    expect(document.getElementById('sb-panel-ai').innerHTML).not.toContain('renderMissingRequirementsHtml');

    // Default panel basics present.
    expect(document.getElementById('sidebar-build-from-scratch')).toBeTruthy();
    expect(document.getElementById('ai-chat-log')).toBeTruthy();
    expect(document.getElementById('sidebar-chat-input')).toBeTruthy();
    expect(document.getElementById('sidebar-chat-send')).toBeTruthy();

    const proposalCard = document.getElementById('ai-proposal-card');
    expect(proposalCard.innerHTML.trim()).toBe('');
  });

  test('sending a message appends a user bubble synchronously, then error on rejection', async () => {
    // Force a synchronous throw inside the handler to exercise the error path.
    window.eval('detectAiIntent = () => { throw new Error("boom"); }');

    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'שלום';

    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // User bubble appended synchronously.
    const logEl = document.getElementById('ai-chat-log');
    expect(logEl.querySelector('.ai-chat-bubble.user')).toBeTruthy();

    await new Promise(r => setTimeout(r, 20));

    // Error bubble shown, loading removed, button re-enabled.
    expect(logEl.querySelector('.ai-chat-bubble.assistant.loading')).toBeFalsy();
    const errorBubble = logEl.querySelector('.ai-chat-bubble.assistant.error');
    expect(errorBubble).toBeTruthy();
    expect(errorBubble.textContent).toContain('שגיאה:');
    expect(sendBtn.disabled).toBe(false);
  });

  test('sending a message shows a loading bubble while a slower async request is pending', async () => {
    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    // Force the general Q&A path (callAiStream), which awaits fetch —
    // giving us a pending window to observe the loading bubble.
    window.eval('detectClarificationNeeds = () => null; detectAiIntent = () => ({ type: "general_qa" });');
    input.value = 'מה לדעתך?';

    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const logEl = document.getElementById('ai-chat-log');
    expect(logEl.querySelector('.ai-chat-bubble.user')).toBeTruthy();
    expect(logEl.querySelector('.ai-chat-bubble.assistant.loading')).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);

    await new Promise(r => setTimeout(r, 50));
    expect(sendBtn.disabled).toBe(false);
  });

  test('chat thread scrolls to bottom after appending a message', () => {
    const logEl = document.getElementById('ai-chat-log');
    // jsdom doesn't compute real layout — stub scrollHeight.
    Object.defineProperty(logEl, 'scrollHeight', { configurable: true, value: 1234 });
    window.postUserMessage('הודעה לבדיקה');
    expect(logEl.scrollTop).toBe(1234);
  });

  test('Build System click shows staged progress text while pending', async () => {
    const btn = document.getElementById('sidebar-build-from-scratch');
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // Existing/empty board build shows an inline chat confirmation — confirm it.
    window.eval('if (_pendingBuildProceed) handleQuickReply({ action: "confirm-build-yes", label: "כן, בנה מערכת" })');

    const statusEl = document.getElementById('ai-build-status');
    expect(statusEl.hidden).toBe(false);

    const stages = ['אוסף העדפות', 'שולח בקשה', 'בודק דרישות', 'בודק חוקיות', 'יוצר טיוטה', 'מסיים'];
    expect(stages.some(s => statusEl.textContent.includes(s))).toBe(true);

    await new Promise(r => setTimeout(r, 50));

    // Build button re-enabled and status hidden after failure.
    expect(document.getElementById('sidebar-build-from-scratch').disabled).toBe(false);
    expect(document.getElementById('ai-build-status').hidden).toBe(true);
  });

  test('chat history persists across simulated tab switch', () => {
    window.postUserMessage('הודעה ראשונה');
    window.postAssistantMessage('תשובה');

    window.setSidebarTab('repo');
    window.setSidebarTab('ai');

    const logEl = document.getElementById('ai-chat-log');
    const bubbles = logEl.querySelectorAll('.ai-chat-bubble');
    const texts = [...bubbles].map(b => b.textContent);
    expect(texts).toContain('הודעה ראשונה');
    expect(texts).toContain('תשובה');
  });

  test('degree-selection click does not throw or hang', () => {
    // Open the program-select modal and click a program card.
    expect(() => window.showModal()).not.toThrow();
    const modalTitle = document.getElementById('prog-modal-title');
    expect(modalTitle).toBeTruthy();

    const card = document.querySelector('.prog-item');
    expect(card).toBeTruthy();
    expect(() => card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))).not.toThrow();
  });

  test('loading state cleared in finally even if an inner helper throws synchronously', async () => {
    window.eval('detectAiIntent = () => { throw new Error("inner failure"); }');

    const input = document.getElementById('sidebar-chat-input');
    const sendBtn = document.getElementById('sidebar-chat-send');
    input.value = 'בדיקה';

    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));

    expect(sendBtn.disabled).toBe(false);
    const logEl = document.getElementById('ai-chat-log');
    expect(logEl.querySelector('.ai-chat-bubble.assistant.loading')).toBeFalsy();
    expect(logEl.querySelector('.ai-chat-bubble.assistant.error')).toBeTruthy();
  });

  test('only one click listener registered per button across multiple renderAiTab() calls', () => {
    const input = document.getElementById('sidebar-chat-input');
    input.value = '';

    let calls = 0;
    const orig = window.handleSidebarChatSend;
    window.handleSidebarChatSend = function (providedMessage) {
      calls++;
      return orig.call(this, providedMessage);
    };

    // Re-render the AI tab several times (as happens on state changes).
    window.renderAiTab();
    window.renderAiTab();
    window.renderAiTab();

    const sendBtn = document.getElementById('sidebar-chat-send');
    // Empty input — handler returns early without side effects, but we can
    // still verify it's only invoked once per click.
    sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(calls).toBe(1);
  });
});

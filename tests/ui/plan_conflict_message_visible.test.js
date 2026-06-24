/**
 * plan_conflict_message_visible.test.js
 *
 * Root cause: the panel-vs-chat hard-avoid conflict warning was correctly
 * computed into proposal.warnings_he (buildDeterministicReplacementPlan /
 * requestPlanProposal's post-LLM filter), but NEITHER chat-message
 * constructor that renders the resulting draft (activateTentativeDraft via
 * buildPlanningFallback, and the deterministic-replacement fallback message
 * in requestPlanProposal) ever read proposal.warnings_he — so the warning
 * existed in data but was never shown to the user. Fixed by threading
 * warnings_he through buildPlanningFallback's returned draft and echoing it
 * in both message constructors.
 *
 * This test forces the SAME fallback path exercised live (AI proposal fails
 * validation -> deterministic replacement plan) with a chat message that
 * both hard-avoids and asks to add the same course, and asserts the
 * resulting CHAT MESSAGE (not just the internal proposal object) contains
 * the conflict explanation.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const COURSE_ID = '0542-4123'; // תהליכי מעבר חום וחומר — an engineering elective, not Thermodynamics

function createPageSetup(getFetchResponse) {
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
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(getFetchResponse()) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window, injectScript: () => {} };
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

function waitForChat(window, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const len = window.eval('(typeof _aiChatMessages !== "undefined") ? _aiChatMessages.length : -1');
        if (len > 0) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('chat message timeout'));
      setTimeout(tick, 30);
    };
    tick();
  });
}

describe('panel-vs-chat hard-avoid conflict warning is visible in the actual chat message', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('an intentionally invalid AI proposal forces the deterministic-replacement fallback, whose chat message includes the conflict warning', async () => {
    const setup = createPageSetup(() => ({ semesters: [], warnings_he: [] })); // empty -> forces fallback
    ({ dom, window } = setup);
    await waitForInit(window);

    const courseName = window.eval(`courseMap['${COURSE_ID}'].name_he`);
    window.eval(`requestPlanProposal({
      action_type: 'full_plan',
      extra_request_he: 'תוסיף לי את ' + ${JSON.stringify(courseName)},
      strongly_avoided_course_ids: ['${COURSE_ID}'],
      unwanted_course_ids: ['${COURSE_ID}'],
    }, 'full_plan').catch(()=>{})`);
    await waitForChat(window);
    await new Promise(r => setTimeout(r, 200));

    const msgs = JSON.parse(window.eval(`JSON.stringify((_aiChatMessages||[]).map(m => m.text || ''))`));
    const joined = msgs.join('\n');
    expect(joined).toContain(courseName);
    expect(joined).toContain('להימנע');
  });
});

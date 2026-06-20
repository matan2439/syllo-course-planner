/**
 * Canonical draft.status rendering (replaces the old "compact blocked panel").
 *
 * Per the consistency requirement, renderProposalCard derives its label and
 * apply-ability from ONE canonical computeDraftStatusLocal():
 *   - legal_partial → "טיוטה חוקית חלקית עד X/185", apply button shown, and the
 *     contradictory "לא ניתן להציע מערכת חוקית" / "ניתן להחיל" labels are gone.
 *   - illegal_blocked → no apply button; recovery via rebuild/chat.
 * Detailed plan explanation lives in chat, not in a detached sidebar panel.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadPage() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const src = m[1];
  html = html.replace(m[0], '');
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert = () => {};
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network down'));
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
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('canonical draft.status — sidebar card', () => {
  let dom, window, document;
  beforeEach(async () => { dom = loadPage(); window = dom.window; document = window.document; await waitForInit(window); });
  afterEach(() => dom.window.close());

  // Build a real legal partial draft and render the card.
  function renderLegalPartialCard() {
    return window.eval(`(function(){
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      _aiPlanLastProposal = plan.proposal;
      _aiPlanLastPreferences = { extra_request_he: '' };
      activateProposalDraft(plan.proposal);
      renderAiTab();
      renderProposalCard();
      return computeDraftStatusLocal().status;
    })()`);
  }

  test('legal draft: the lower #ai-proposal-card renders nothing (no duplicate cluster)', () => {
    const status = renderLegalPartialCard();
    expect(['legal_full', 'legal_partial']).toContain(status);
    const card = document.getElementById('ai-proposal-card');
    // Issue 2 — the card under the chat is empty: no buttons, no status/explanation.
    expect(card.innerHTML.trim()).toBe('');
    expect(card.querySelector('#sb-draft-apply')).toBeFalsy();
    expect(card.querySelector('#sb-draft-rebuild')).toBeFalsy();
    // The single action cluster is the upper board banner.
    expect(document.getElementById('board-draft-apply')).toBeTruthy();
    expect(document.getElementById('board-draft-reject')).toBeTruthy();
  });

  test('no contradictory "לא ניתן להציע מערכת חוקית" label anywhere for a legal draft', () => {
    renderLegalPartialCard();
    expect(document.getElementById('ai-proposal-card').innerHTML).not.toContain('לא ניתן להציע מערכת חוקית');
  });

  test('no detached editing controls remain', () => {
    renderLegalPartialCard();
    expect(document.getElementById('sb-draft-ask')).toBeFalsy();
    expect(document.getElementById('sb-draft-full')).toBeFalsy();
    expect(document.getElementById('sidebar-draft-instruction')).toBeFalsy();
    expect(document.getElementById('sidebar-open-full-preview')).toBeFalsy();
  });
});

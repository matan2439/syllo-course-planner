/**
 * Issue 3 — the cluttered metrics-heavy sidebar draft card ("חסום — יש לתקן
 * בעיות חוקיות" + groupedDiag + degree-progress + chips + status-summary +
 * duplicate apply/ask/full buttons) must NOT be the main blocked experience.
 *
 * When the active draft is blocked, renderProposalCard now renders only a
 * COMPACT panel: title 'לא ניתן להציע מערכת חוקית', ONE short reason, and a
 * single main action — NO metrics dump, NO duplicate buttons. The AI chat is
 * the primary recovery experience.
 *
 * Uses the same jsdom harness as the other UI tests.
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

describe('Issue 3 — sidebar blocked draft card is compact, chat is primary', () => {
  let dom, window, document;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    document = window.document;
    await waitForInit(window);
  });

  afterEach(() => { dom.window.close(); });

  function setupBlockedDraft() {
    // Make the active draft blocked by forcing a validation with errors.
    window.eval(`
      _aiPlanLastValidation = { errors: ['חריגה בעומס: סמסטר אחד מגיע ל-27 ש"ש (מעל המגבלה).'], warnings: [], blocked: true, overloadBlocked: true, completeness: { incomplete: true, reasons: ['עומס חורג'] } };
      // Stub draft evaluation so renderProposalCard sees a blocked draft.
      evaluateDraftProposal = function() { return { proposal: { semesters: [] }, errors: _aiPlanLastValidation.errors, warnings: [], completeness: _aiPlanLastValidation.completeness }; };
      state.proposalDraft = { semesters: {}, repo: [] };
      // Render the AI sidebar panel (which contains #ai-proposal-card) first.
      renderAiTab();
      renderProposalCard();
    `);
  }

  test('renders compact blocked panel (title + ONE reason) — no metrics dump', () => {
    setupBlockedDraft();
    const card = document.getElementById('ai-proposal-card');
    const panel = card.querySelector('[data-testid="blocked-compact-panel"]');
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.ai-plan-blocked-title').textContent).toContain('לא ניתן להציע מערכת חוקית');

    // NO cluttered verbose label
    expect(card.innerHTML).not.toContain('יש לתקן בעיות חוקיות');
    // NO metrics dump (status-summary / chips row)
    expect(card.querySelector('.sb-status-summary')).toBeFalsy();
    expect(card.querySelector('.draft-chips-row')).toBeFalsy();
  });

  test('no duplicate action buttons in the blocked area (single main action)', () => {
    setupBlockedDraft();
    const card = document.getElementById('ai-proposal-card');
    // Old verbose card had apply + reject + ask + full (4 buttons). Compact
    // panel has a single main action.
    const buttons = card.querySelectorAll('button');
    expect(buttons.length).toBeLessThanOrEqual(1);
    expect(card.querySelector('#sb-draft-apply')).toBeFalsy(); // no apply on a blocked plan
  });
});

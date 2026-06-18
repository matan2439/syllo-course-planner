/**
 * E2E — the planner RECOVERS from a bad AI proposal.
 *
 * Root cause this guards: requestPlanProposal seeds the deterministic repair
 * chain from the AI's proposal. When the AI returns unschedulable / missing-data
 * / out-of-pool courses, the strict gate fails and buildPlanningFallback — which
 * keys off the AI proposal's placements — returns null. The flow historically
 * dead-ended at diagnoseBuildBlock, which only DESCRIBES failure.
 *
 * The fix: before diagnoseBuildBlock, the flow now calls
 * buildDeterministicReplacementPlan, which ignores the bad AI proposal and
 * re-seeds the proven completion chain (mandatory → electives → שער רוח →
 * 185-hour fill → legality → balance) from the CURRENT COMMITTED BOARD, drawing
 * candidates from the program pool (courseMap). The result is rendered on the
 * board as an editable draft.
 *
 * These tests load the REAL HTML with the REAL ME-2027 production backup, stub
 * the AI endpoint with a deliberately bad proposal, and assert the recovery.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

// ─────────────────────────────────────────────────────────────────────────────
// Harness (same two-step factory used by plan_e2e_message_path.test.js).
// ─────────────────────────────────────────────────────────────────────────────
function createPageSetup(fetchOverride, plannerLogs) {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found in HTML');
  const src = m[1];
  h = h.replace(m[0], '');

  const vc = new VirtualConsole();
  try { vc.forwardTo(console); } catch (_) { /* older jsdom */ }
  if (plannerLogs) {
    vc.on('log', (...args) => {
      const tag = args[0];
      if (typeof tag === 'string' && (tag.startsWith('[planner-e2e-trace]') || tag.startsWith('[planner-version]'))) {
        plannerLogs.push({ tag, data: args[1] });
      }
    });
  }

  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert  = () => {};

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  window.fetch = fetchOverride || ((url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  });

  return {
    dom, window,
    injectScript: () => {
      const s = window.document.createElement('script');
      s.textContent = src;
      window.document.body.appendChild(s);
    },
  };
}

function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval(
          'typeof state!=="undefined"&&!!state&&!!state.semesters' +
          '&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0',
        )) return resolve();
      } catch (_) { /* not ready */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

function waitForChat(window, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const len = window.eval('(typeof _aiChatMessages !== "undefined") ? _aiChatMessages.length : -1');
        if (len > 0) return resolve();
      } catch (_) { /* not ready */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('chat message timeout'));
      setTimeout(tick, 30);
    };
    tick();
  });
}

function getAssistantMsgs(window) {
  try {
    const msgs = JSON.parse(window.eval('JSON.stringify(_aiChatMessages)'));
    return msgs.filter(m => m.role === 'assistant').map(m => m.text || m.content || '');
  } catch { return []; }
}

function makeAiFetch(proposal) {
  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  return (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(proposal) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
}

const OLD_DEAD_END = /אין נתוני היצע סמסטר ודאיים ל-\d+ קורסים/;

// Proposal whose course IDs are NOT in the program pool. The repair chain seeded
// from this proposal produces nothing usable → buildPlanningFallback returns null.
const BAD_PROPOSAL_UNKNOWN = {
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['NOPE_1', 'NOPE_2'] },
    { semester_id: 'year_3_semester_b', course_ids: ['NOPE_3'] },
  ],
  warnings_he: [],
};

// Proposal that is completely empty — the AI returned nothing placeable.
const BAD_PROPOSAL_EMPTY = { semesters: [], warnings_he: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — bad (out-of-pool) AI proposal → deterministic rescue.
// ─────────────────────────────────────────────────────────────────────────────
describe('recovers from a bad AI proposal (out-of-pool courses)', () => {
  let dom, window, plannerLogs;

  beforeAll(async () => {
    plannerLogs = [];
    const setup = createPageSetup(makeAiFetch(BAD_PROPOSAL_UNKNOWN), plannerLogs);
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
    window.eval('renderAiTab()');
    window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(window);
    await new Promise(r => setTimeout(r, 150));
  });
  afterAll(() => dom.window.close());

  test('the deterministic replacement planner was attempted', () => {
    const log = plannerLogs.find(l => l.data && l.data.messagePath === 'attempting deterministic replacement plan');
    expect(log).toBeDefined();
  });

  test('it found valid replacement candidates in the program pool', () => {
    const log = plannerLogs.find(l => l.data && l.data.messagePath === 'replacement candidates count');
    expect(log).toBeDefined();
    expect(log.data.count).toBeGreaterThan(0);
  });

  test('it selected ≥1 course to add', () => {
    const log = plannerLogs.find(l => l.data && l.data.messagePath === 'replacement selected count');
    expect(log).toBeDefined();
    expect(log.data.count).toBeGreaterThan(0);
  });

  test('the board DOM contains newly planned course cards', () => {
    const log = plannerLogs.find(l => l.data && l.data.messagePath === 'replacement rendered cards count');
    expect(log).toBeDefined();
    expect(log.data.count).toBeGreaterThan(0);
    const cards = window.document.querySelectorAll('#board .course-card').length;
    expect(cards).toBeGreaterThan(0);
  });

  test('a proposalDraft overlay is active on the board', () => {
    expect(window.eval('!!state.proposalDraft')).toBe(true);
  });

  test('the final assistant message is NOT only a dead-end diagnostic', () => {
    const msgs = getAssistantMsgs(window);
    expect(msgs.length).toBeGreaterThan(0);
    const last = msgs[msgs.length - 1];
    expect(OLD_DEAD_END.test(last)).toBe(false);
    expect(/לא נמצאו מספיק קורסים מאומתים/.test(last)).toBe(false);
    // It is one of the two replacement messages.
    const isReplacement = /בניתי מערכת חלופית/.test(last) || /הצלחתי להגיע ל-\d+\/\d+ ש/.test(last);
    expect(isReplacement).toBe(true);
  });

  test('a total-hours summary (X/185) is shown', () => {
    const hoursLog = plannerLogs.find(l => l.data && l.data.messagePath === 'replacement total hours');
    expect(hoursLog).toBeDefined();
    expect(hoursLog.data.target).toBe(185);
    expect(typeof hoursLog.data.hours).toBe('number');
    const msgs = getAssistantMsgs(window).join('\n');
    expect(/\d+\/185/.test(msgs)).toBe(true);
  });

  test('the dead-end diagnoseBuildBlock branch did NOT fire', () => {
    const deadEnd = plannerLogs.find(l => l.data && l.data.messagePath === 'FAILURE_VALIDATION/diagnoseBuildBlock');
    expect(deadEnd).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — empty AI proposal → fallback planner selects valid alternatives.
// ─────────────────────────────────────────────────────────────────────────────
describe('recovers when ALL AI candidates are invalid (empty proposal)', () => {
  let dom, window, plannerLogs;

  beforeAll(async () => {
    plannerLogs = [];
    const setup = createPageSetup(makeAiFetch(BAD_PROPOSAL_EMPTY), plannerLogs);
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
    window.eval('renderAiTab()');
    window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(window);
    await new Promise(r => setTimeout(r, 150));
  });
  afterAll(() => dom.window.close());

  test('the planner selects valid alternatives from courseMap (≥1 course)', () => {
    // An empty AI proposal still runs the repair chain on the board, which may
    // already produce a SUCCESS_WITH_CHANGES draft. Either way, the user must
    // end with a plan (draft active) and never the old dead-end text.
    const hasDraft = window.eval('!!state.proposalDraft');
    const cards = window.document.querySelectorAll('#board .course-card').length;
    expect(hasDraft || cards > 0).toBe(true);
  });

  test('no old dead-end text is shown', () => {
    const hasOld = getAssistantMsgs(window).some(t => OLD_DEAD_END.test(t));
    expect(hasOld).toBe(false);
  });

  test('buildDeterministicReplacementPlan is callable and returns a structured result', () => {
    // Direct unit-style call through the live page to assert the contract.
    const res = JSON.parse(window.eval(`(function(){
      const r = buildDeterministicReplacementPlan({ targetHours: 185 });
      return JSON.stringify({
        hasProposal: !!r.proposal && Array.isArray(r.proposal.semesters),
        addedIsArray: Array.isArray(r.addedCids),
        target: r.targetHours,
        candidates: r.candidatesConsidered,
        totalIsNumber: typeof r.totalHours === 'number',
      });
    })()`));
    expect(res.hasProposal).toBe(true);
    expect(res.addedIsArray).toBe(true);
    expect(res.target).toBe(185);
    expect(res.candidates).toBeGreaterThan(0);
    expect(res.totalIsNumber).toBe(true);
  });
});

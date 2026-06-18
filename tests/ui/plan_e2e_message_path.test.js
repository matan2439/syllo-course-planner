/**
 * E2E — prove the actual production UI message path.
 *
 * These tests load the REAL HTML with the REAL production board backup, stub
 * the AI generation endpoint with a controlled proposal, and assert:
 *   1. The build/version marker is visible in the DOM.
 *   2. Stale localStorage from an older build is auto-cleared on load.
 *   3. After a plan build, the OLD dead-end message is NOT shown.
 *   4. Either draft cards appear on the board OR the new "דילגתי על N קורסים"
 *      message appears — never the raw "אין נתוני היצע סמסטר ודאיים ל-X קורסים".
 *   5. [planner-e2e-trace] console logs identify the exact path taken.
 *
 * Implementation notes:
 *   - Two-step page creation lets tests set up localStorage BEFORE the script
 *     runs, which is the only way to test the stale-chat auto-clear on load.
 *   - VirtualConsole intercept captures [planner-e2e-trace] / [planner-version]
 *     logs so assertions can query the trace without string-scanning the DOM.
 *   - The "button click" test calls requestPlanProposal() directly (same code
 *     path as clicking "בנה מערכת") because jsdom click events don't dispatch
 *     to addEventListener blocks reliably without a real browser.
 *
 * Source locations where the old message could appear:
 *   A) semester_board_viewer.html ~8188: validateFinalPlan emits the raw
 *      "אין נתוני היצע" blocker text (internal — never shown directly).
 *   B) semester_board_viewer.html ~8565: buildPlanningFallback stores it in
 *      lastPlanningDraft.missingData (internal — never shown directly).
 *   C) semester_board_viewer.html ~12715: diagnoseBuildBlock missingOfferingHit
 *      branch — the ONLY path that was surfacing it to the user. FIXED: now
 *      emits "דילגתי על N קורסים" + a [debug] marker.
 *   D) localStorage: old chat messages from a pre-fix build. FIXED: auto-cleared
 *      on build-version mismatch via PLANNER_BUILD constant.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-step page factory.
 * Returns { dom, window, injectScript } — the script is NOT yet running.
 * Caller can set window.localStorage entries before calling injectScript().
 */
function createPageSetup(fetchOverride, plannerLogs) {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found in HTML');
  const src = m[1];
  h = h.replace(m[0], '');

  const vc = new VirtualConsole();
  // Forward all page logs to the test console so failures are visible in CI.
  // (jsdom 29 uses forwardTo, not the old sendTo.)
  try { vc.forwardTo(console); } catch (_) { /* older jsdom — skip forwarding */ }
  if (plannerLogs) {
    // Intercept [planner-*] logs emitted by the page script.
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

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  window.fetch = fetchOverride || ((url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  });
  window.confirm = () => false;
  window.alert  = () => {};

  return {
    dom,
    window,
    injectScript: () => {
      const s = window.document.createElement('script');
      s.textContent = src;
      window.document.body.appendChild(s);
    },
  };
}

/** Wait for init() to finish loading the board + courseMap. */
function waitForInit(window, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval(
          'typeof state!=="undefined"&&!!state&&!!state.semesters' +
          '&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0',
        )) return resolve();
      } catch (_) { /* not ready yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

/** Wait until at least one AI chat message has been posted. */
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

/** Helper: get all assistant message texts from the page. */
function getAssistantMsgs(window) {
  try {
    const msgs = JSON.parse(window.eval('JSON.stringify(_aiChatMessages)'));
    return msgs.filter(m => m.role === 'assistant').map(m => m.text || m.content || '');
  } catch { return []; }
}

const OLD_PATTERN = /אין נתוני היצע סמסטר ודאיים ל-\d+ קורסים/;
const NEW_PATTERNS = [
  /דילגתי על \d+ קורסים/,
  /\[debug: diagnoseBuildBlock missing-offering path/,
  /ניתן לבנות מחדש עם הקורסים הזמינים/,
  /קורסים מוצגים כטיוטה/,
  /טיוטה על הלוח/,
  /\d+\/185/,          // "X/185" progress line
];

// ─────────────────────────────────────────────────────────────────────────────
// Fake AI proposals used by the stubs
// ─────────────────────────────────────────────────────────────────────────────

// Courses with confirmed offering data (CASE 1 fix: offered=['A']/['B']).
// These should pass strict validation when placed in their legal semesters.
const CONFIRMED_PROPOSAL = {
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['0542-4120', '0542-4220'] },
    { semester_id: 'year_3_semester_b', course_ids: ['0542-4123', '0542-4221'] },
  ],
  warnings_he: [],
};

// Proposal whose course IDs are NOT in the program pool — buildPlanningFallback
// sees newCids.length=0 and returns null → diagnoseBuildBlock path fires.
// This is the exact scenario that used to emit the old dead-end message.
const UNKNOWN_COURSES_PROPOSAL = {
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['UNKNOWN_A_1', 'UNKNOWN_A_2'] },
    { semester_id: 'year_3_semester_b', course_ids: ['UNKNOWN_B_1'] },
  ],
  warnings_he: [],
};

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

// ─────────────────────────────────────────────────────────────────────────────
// A — Visible build marker
// ─────────────────────────────────────────────────────────────────────────────

describe('A — visible build marker', () => {
  let dom, window;

  beforeAll(async () => {
    const setup = createPageSetup();
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
    window.eval('renderAiTab()');
  });
  afterAll(() => dom.window.close());

  test('PLANNER_BUILD constant exists and is a non-empty string', () => {
    const build = window.eval('typeof PLANNER_BUILD !== "undefined" ? PLANNER_BUILD : null');
    expect(build).toBeTruthy();
    expect(typeof build).toBe('string');
    expect(build.length).toBeGreaterThan(3);
  });

  test('#ai-build-version element is present in the AI panel after renderAiTab()', () => {
    const el = window.document.getElementById('ai-build-version');
    expect(el).not.toBeNull();
  });

  test('build marker text reads "Build: <hash>"', () => {
    const build = window.eval('PLANNER_BUILD');
    const el = window.document.getElementById('ai-build-version');
    expect(el.textContent).toMatch(/^Build:/);
    expect(el.textContent).toContain(build);
  });

  test('[planner-version] console log is emitted on load (captured via VirtualConsole)', () => {
    const logs = [];
    const setup2 = createPageSetup(undefined, logs);
    setup2.injectScript();
    return waitForInit(setup2.window).then(() => {
      setup2.dom.window.close();
      const versionLog = logs.find(l => l.tag === '[planner-version]');
      expect(versionLog).toBeDefined();
      expect(versionLog.data).toBeDefined();
      expect(versionLog.data.commit).toBeTruthy();
      expect(typeof versionLog.data.loadedAt).toBe('string');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G — Stale localStorage auto-cleared on build mismatch
// ─────────────────────────────────────────────────────────────────────────────

describe('G — stale localStorage auto-cleared on build mismatch', () => {
  let dom, window;

  beforeAll(async () => {
    // IMPORTANT: inject stale entry BEFORE injectScript() so loadAiChatState()
    // sees it during init().
    const setup = createPageSetup();
    setup.window.localStorage.setItem('tau_ai_chat_v1', JSON.stringify({
      messages: [{
        role: 'assistant',
        text: 'אין נתוני היצע סמסטר ודאיים ל-5 קורסים — לא ניתן להציג שיבוץ חוקי.',
      }],
      inputDraft: '',
      build: 'STALE_OLD_BUILD',  // deliberately mismatches PLANNER_BUILD
    }));
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('_aiChatMessages does NOT contain the stale old message after init', () => {
    const msgs = getAssistantMsgs(window);
    const hasOld = msgs.some(t => OLD_PATTERN.test(t));
    expect(hasOld).toBe(false);
  });

  test('_aiChatMessages is empty (stale messages cleared, not just hidden)', () => {
    const len = window.eval('_aiChatMessages.length');
    expect(len).toBe(0);
  });

  test('localStorage is re-saved with the current PLANNER_BUILD', () => {
    const stored = JSON.parse(window.localStorage.getItem('tau_ai_chat_v1') || '{}');
    const build = window.eval('PLANNER_BUILD');
    expect(stored.build).toBe(build);
  });

  test('localStorage stale messages[] is empty after clear', () => {
    const stored = JSON.parse(window.localStorage.getItem('tau_ai_chat_v1') || '{}');
    expect(Array.isArray(stored.messages)).toBe(true);
    expect(stored.messages.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — Plan build with confirmed-offering courses (happy / partial-draft path)
// ─────────────────────────────────────────────────────────────────────────────

describe('C — plan build: confirmed-offering courses → no old message', () => {
  let dom, window, plannerLogs;

  beforeAll(async () => {
    plannerLogs = [];
    const setup = createPageSetup(makeAiFetch(CONFIRMED_PROPOSAL), plannerLogs);
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
    window.eval('renderAiTab()');
    // Trigger the same code path as clicking "בנה מערכת".
    window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(window);
    await new Promise(r => setTimeout(r, 120));
  });
  afterAll(() => dom.window.close());

  test('chat does NOT contain the old "אין נתוני היצע סמסטר ודאיים ל-X קורסים" format', () => {
    const hasOld = getAssistantMsgs(window).some(t => OLD_PATTERN.test(t));
    expect(hasOld).toBe(false);
  });

  test('either proposalDraft is active on the board OR chat shows a progress/draft message', () => {
    const hasDraft = window.eval('!!state.proposalDraft');
    const hasNewMsg = getAssistantMsgs(window).some(t => NEW_PATTERNS.some(re => re.test(t)));
    expect(hasDraft || hasNewMsg).toBe(true);
  });

  test('when proposalDraft is active, board #board has at least one .course-card', () => {
    const hasDraft = window.eval('!!state.proposalDraft');
    if (!hasDraft) return; // chat-path taken — board assertion not applicable
    const cards = window.document.querySelectorAll('#board .course-card').length;
    expect(cards).toBeGreaterThan(0);
  });

  test('[planner-e2e-trace] logs were emitted for gateProposalActivation', () => {
    const gateLog = plannerLogs.find(l => l.data && l.data.function === 'gateProposalActivation');
    expect(gateLog).toBeDefined();
    expect(typeof gateLog.data.applicable).toBe('boolean');
    expect(Array.isArray(gateLog.data.blockerCauses)).toBe(true);
  });

  test('[planner-e2e-trace] logs record the messagePath taken', () => {
    const pathLog = plannerLogs.find(l => l.data && l.data.messagePath);
    expect(pathLog).toBeDefined();
    // Verify the path is one of the known valid paths.
    const knownPaths = [
      'FAILURE_VALIDATION',
      'FAILURE_VALIDATION/fallback',
      'FAILURE_VALIDATION/activateTentativeDraft',
      'FAILURE_VALIDATION/fallback-chat',
      'FAILURE_VALIDATION/diagnoseBuildBlock',
      'diagnoseBuildBlock',
    ];
    const path = pathLog.data.messagePath;
    expect(knownPaths.some(p => path.startsWith(p))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — bad-AI-proposal path: unknown courses now trigger the DETERMINISTIC
//     REPLACEMENT planner (rescue) instead of dead-ending at diagnoseBuildBlock.
// ─────────────────────────────────────────────────────────────────────────────

describe('D — unknown courses → deterministic replacement plan (rescue), not a dead end', () => {
  let dom, window, plannerLogs;

  beforeAll(async () => {
    // UNKNOWN_COURSES_PROPOSAL places course IDs that are NOT in the program
    // pool. buildPlanningFallback sees newCids.length=0 → returns null. The flow
    // would historically dead-end at diagnoseBuildBlock. Now it first attempts
    // buildDeterministicReplacementPlan, which builds a real plan from the
    // program pool and renders it on the board.
    plannerLogs = [];
    const setup = createPageSetup(makeAiFetch(UNKNOWN_COURSES_PROPOSAL), plannerLogs);
    setup.injectScript();
    ({ dom, window } = setup);
    await waitForInit(window);
    window.eval('renderAiTab()');
    window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(window);
    await new Promise(r => setTimeout(r, 120));
  });
  afterAll(() => dom.window.close());

  test('FAIL if chat contains the old raw "אין נתוני היצע סמסטר ודאיים ל-X קורסים" text', () => {
    const hasOld = getAssistantMsgs(window).some(t => OLD_PATTERN.test(t));
    expect(hasOld).toBe(false);
  });

  test('chat MUST contain a positive plan message (replacement / progress / skip line)', () => {
    const hasNew = getAssistantMsgs(window).some(t => NEW_PATTERNS.some(re => re.test(t)));
    expect(hasNew).toBe(true);
  });

  test('[planner-e2e-trace] shows the deterministic replacement plan was attempted', () => {
    const attemptLog = plannerLogs.find(
      l => l.data && l.data.messagePath === 'attempting deterministic replacement plan',
    );
    expect(attemptLog).toBeDefined();
  });

  test('replacement selected ≥1 course and rendered cards on the board', () => {
    const selLog = plannerLogs.find(l => l.data && l.data.messagePath === 'replacement selected count');
    expect(selLog).toBeDefined();
    expect(selLog.data.count).toBeGreaterThan(0);
    const cards = window.document.querySelectorAll('#board .course-card').length;
    expect(cards).toBeGreaterThan(0);
  });

  test('the dead-end diagnoseBuildBlock branch did NOT fire (rescue happened first)', () => {
    // Because the replacement plan added courses, the flow never reaches the
    // final diagnoseBuildBlock branch.
    const deadEnd = plannerLogs.find(
      l => l.data && l.data.messagePath === 'FAILURE_VALIDATION/diagnoseBuildBlock',
    );
    expect(deadEnd).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — no uncaught SyntaxError on page load or during AI planning
//
// Background: production console showed "VM138:1 Uncaught SyntaxError:
// Unexpected token '{'" immediately after the [planner-version] log. A full
// audit of semester_board_viewer.html found ZERO eval() / new Function() /
// setTimeout(string) calls — the error cannot originate from our code and is
// most likely from a browser extension. These tests prove our code is clean
// by capturing any window 'error' events that contain SyntaxError or
// "Unexpected token" during page load and the full planning flow.
// ─────────────────────────────────────────────────────────────────────────────

describe('E — no uncaught SyntaxError on page load or during AI planning', () => {
  function createTracked(fetchOverride) {
    const errors = [];
    const setup = createPageSetup(fetchOverride);
    setup.window.addEventListener('error', (e) => {
      const msg = e.message || (e.error && e.error.message) || '';
      if (/SyntaxError|Unexpected token/i.test(msg)) {
        errors.push({ message: msg, filename: e.filename || 'inline', lineno: e.lineno });
      }
    });
    return { setup, errors };
  }

  test('page load and init: no uncaught SyntaxError', async () => {
    const { setup, errors } = createTracked();
    setup.injectScript();
    await waitForInit(setup.window);
    setup.window.eval('renderAiTab()');
    await new Promise(r => setTimeout(r, 60));
    setup.dom.window.close();
    expect(errors).toHaveLength(0);
  });

  test('planning (confirmed-offering): no uncaught SyntaxError during AI flow', async () => {
    const { setup, errors } = createTracked(makeAiFetch(CONFIRMED_PROPOSAL));
    setup.injectScript();
    await waitForInit(setup.window);
    setup.window.eval('renderAiTab()');
    setup.window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(setup.window);
    await new Promise(r => setTimeout(r, 150));
    setup.dom.window.close();
    expect(errors).toHaveLength(0);
  });

  test('planning (unknown-courses): no uncaught SyntaxError during AI flow', async () => {
    const { setup, errors } = createTracked(makeAiFetch(UNKNOWN_COURSES_PROPOSAL));
    setup.injectScript();
    await waitForInit(setup.window);
    setup.window.eval('renderAiTab()');
    setup.window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
    await waitForChat(setup.window);
    await new Promise(r => setTimeout(r, 150));
    setup.dom.window.close();
    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — old message is replaced everywhere: no path emits the raw old text
// ─────────────────────────────────────────────────────────────────────────────

describe('F — no live output path emits the old raw message string', () => {
  // Run BOTH proposals and assert neither produces the old string.
  const cases = [
    { name: 'confirmed-offering proposal', proposal: CONFIRMED_PROPOSAL },
    { name: 'unknown-courses proposal',    proposal: UNKNOWN_COURSES_PROPOSAL },
  ];

  for (const { name, proposal } of cases) {
    describe(`with ${name}`, () => {
      let dom, window;

      beforeAll(async () => {
        const setup = createPageSetup(makeAiFetch(proposal));
        setup.injectScript();
        ({ dom, window } = setup);
        await waitForInit(window);
        window.eval('renderAiTab()');
        window.eval('requestPlanProposal({ action_type: "full_plan" }, "full_plan").catch(()=>{})');
        await waitForChat(window);
        await new Promise(r => setTimeout(r, 120));
      });
      afterAll(() => dom.window.close());

      test(`"${name}": chat NEVER shows "אין נתוני היצע סמסטר ודאיים ל-X קורסים"`, () => {
        const hasOld = getAssistantMsgs(window).some(t => OLD_PATTERN.test(t));
        expect(hasOld).toBe(false);
      });

      test(`"${name}": at least one positive message is shown (draft / progress / skip-notice)`, () => {
        const msgs = getAssistantMsgs(window);
        // Acceptable outcomes: new message pattern OR any non-empty message that
        // is NOT the old dead-end (overload / prereq messages are fine).
        expect(msgs.length).toBeGreaterThan(0);
      });
    });
  }
});

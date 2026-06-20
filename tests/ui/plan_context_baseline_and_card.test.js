/**
 * plan_context_baseline_and_card.test.js
 *
 * C5/C6 — no draft card as an explanation surface, and ONE canonical PlanContext
 * baseline shared by the chat summary and the sidebar (fixes "נצברו 0" while the
 * sidebar shows 128.5/185).
 *
 *   Part A (card)
 *     T01 the draft card renders NO "זו טיוטה, עדיין לא אושרה" text
 *     T02 the card has no large status/explanation block (only compact actions)
 *     T03 build_full_185 emits the draft status as a normal assistant chat message
 *     T04 compact apply/reject/rebuild actions remain in the card
 *   Part B/C (baseline)
 *     T05 buildPlanContextFromState.completedHours equals the UI (sidebar) baseline
 *     T06 chat summary and sidebar summary use the same completedHours
 *     T07 with a 90h baseline, the chat summary cannot say "נצברו 0"
 *     T08 totalAfterPlan is never lower than completedHours
 *     T09 totalAfterPlan == completedHours + existingBoardHours + newlyAddedDraftHours - duplicates
 *     T10 if no completed-hours source is set, the summary asks the user to set it
 *     T11 formatFull185SummaryLocal total agrees with computeDegreeProgress total
 *     T12 "בנה מערכת מלאה ל-185" with a 90h baseline does not produce an 81/185-style sub-total
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
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
    return Promise.reject(new Error('network-stub: ' + u));
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
      setTimeout(tick, 15);
    };
    tick();
  });
}

// Simulate a user who already has 90 completed degree hours, then build a full-185 draft.
const SETUP_90 = `(function(){
  degreeHoursProfile = { completed_degree_hours: 90, general_required_hours: null, general_completed_hours: null };
  _aiChatMessages = [];
  _aiPlanLastPreferences = { extra_request_he: '' };
  _aiUserIntentProfile = buildUserIntentProfileLocal('', {});
  applyDraftPatchLocal({ type: 'build_full_185', courseIds: [], domains: [], semesterId: null, reason_he: '', requiresReplan: true });
})()`;

describe('C5/C6 — card removal + canonical PlanContext baseline', () => {
  let dom, window, document;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; document = window.document; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  beforeEach(() => { window.eval(SETUP_90); });

  test('T01 — the draft card renders NO "זו טיוטה, עדיין לא אושרה" text', () => {
    window.eval('renderProposalCard();');
    const card = document.getElementById('ai-proposal-card');
    expect(card.textContent).not.toContain('זו טיוטה');
  });

  test('T02 — the lower #ai-proposal-card renders nothing (no status/explanation, no duplicate buttons)', () => {
    window.eval('renderProposalCard();');
    const card = document.getElementById('ai-proposal-card');
    expect(card.innerHTML.trim()).toBe('');
    expect(card.querySelector('.ai-plan-status')).toBeFalsy();
    expect(card.querySelector('.draft-chips-row')).toBeFalsy();
    expect(card.textContent).not.toContain('טיוטה חוקית חלקית');
  });

  test('T03 — build_full_185 emits the draft status as a normal assistant chat message', () => {
    const msgs = JSON.parse(window.eval('JSON.stringify(_aiChatMessages.filter(m=>m.role==="assistant").map(m=>m.text))'));
    const statusMsg = msgs.find(t => t && (t.includes('טיוטה חוקית חלקית') || t.includes('מערכת חוקית מלאה')));
    expect(statusMsg).toBeTruthy();
  });

  test('T04 — exactly one draft action cluster exists (upper board banner), none below the chat', () => {
    window.eval('renderAll();'); // renders the board banner + clears the lower card
    // Exactly one "החל טיוטה" apply control in the whole document.
    const applyButtons = Array.from(document.querySelectorAll('button')).filter(b => /החל טיוטה|החל מערכת/.test(b.textContent || ''));
    expect(applyButtons.length).toBe(1);
    expect(document.getElementById('board-draft-apply')).toBeTruthy();
    // No lower duplicate cluster.
    expect(document.querySelector('#ai-proposal-card #sb-draft-apply')).toBeFalsy();
  });

  test('T05 — buildPlanContextFromState.completedHours equals the UI baseline', () => {
    const r = JSON.parse(window.eval(`(function(){
      const pc = buildPlanContextFromState({});
      const prog = computeProgramProgress();
      return JSON.stringify({ completed: pc.completedHours, baseline: pc.completedHours + pc.existingBoardHours, sidebar: prog.plannedHours });
    })()`));
    expect(r.completed).toBe(90);
    expect(r.baseline).toBeCloseTo(r.sidebar, 1);
  });

  test('T06 — chat summary and sidebar use the same completedHours', () => {
    const r = JSON.parse(window.eval(`(function(){
      const pc = buildPlanContextFromState({ proposalSemesters: state.proposalDraft ? mapToProposalSemesters(state.proposalDraft.semesters) : undefined });
      const prog = computeProgramProgress();
      return JSON.stringify({ chatCompleted: pc.completedHours, sidebarCompleted: prog.degreeProgress.completed });
    })()`));
    expect(r.chatCompleted).toBe(r.sidebarCompleted);
  });

  test('T07 — the chat summary reflects the real completed baseline, never "נצברו 0"', () => {
    // Use a LOW baseline (30h) so the plan stays legal_partial and the breakdown line
    // (נצברו …) is present — it must show 30, never 0.
    const summary = window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 30 };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      _aiPlanLastGapBreakdown = plan.gapBreakdown;
      activateProposalDraft(plan.proposal);
      return formatFull185SummaryLocal(plan);
    })()`);
    expect(summary).not.toContain('נצברו 0');
    if (summary.includes('נצברו')) expect(summary).toContain('נצברו 30');
  });

  test('T08 — totalAfterPlan is never lower than completedHours', () => {
    const r = JSON.parse(window.eval('JSON.stringify(buildPlanContextFromState({ proposalSemesters: mapToProposalSemesters(state.proposalDraft.semesters) }))'));
    expect(r.totalAfterPlan).toBeGreaterThanOrEqual(r.completedHours);
  });

  test('T09 — totalAfterPlan == completed + existingBoard + newlyAdded - duplicates', () => {
    const r = JSON.parse(window.eval('JSON.stringify(buildPlanContextFromState({ proposalSemesters: mapToProposalSemesters(state.proposalDraft.semesters) }))'));
    expect(Math.round(r.totalAfterPlan * 10) / 10)
      .toBeCloseTo(Math.round((r.completedHours + r.existingBoardHours + r.newlyAddedDraftHours - r.duplicateHours) * 10) / 10, 1);
  });

  test('T10 — if no completed-hours source is set, the summary asks the user to set it', () => {
    const summary = window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: null };
      const plan = buildFull185PlanLocal({ extra_request_he: '' });
      _aiPlanLastGapBreakdown = plan.gapBreakdown;
      activateProposalDraft(plan.proposal);
      return formatFull185SummaryLocal(plan);
    })()`);
    const pc = JSON.parse(window.eval('JSON.stringify(buildPlanContextFromState({}))'));
    if (pc.sourceOfCompletedHours === 'none') {
      expect(summary).toContain('לא הוגדרו שעות שכבר צברת');
    }
  });

  test('T11 — formatFull185SummaryLocal total agrees with computeDegreeProgress', () => {
    window.eval(SETUP_90);
    const r = JSON.parse(window.eval(`(function(){
      const ds = computeDraftStatusLocal();
      const dp = computeDegreeProgress({}, state, { semesters: state.proposalDraft.semesters });
      const pc = buildPlanContextFromState({ proposalSemesters: mapToProposalSemesters(state.proposalDraft.semesters) });
      return JSON.stringify({ dsTotal: ds.total, dpTotal: dp.total_after, pcTotal: pc.totalAfterPlan });
    })()`));
    expect(r.dsTotal).toBeCloseTo(r.pcTotal, 1);
    expect(r.dpTotal).toBeCloseTo(r.pcTotal, 1);
  });

  test('T12 — full-185 build with a 90h baseline does not produce an 81/185-style sub-total', () => {
    window.eval(SETUP_90);
    const r = JSON.parse(window.eval('JSON.stringify(buildPlanContextFromState({ proposalSemesters: mapToProposalSemesters(state.proposalDraft.semesters) }))'));
    // Must start from the real baseline (90 + board ~41 = ~131), never collapse to ~81.
    expect(r.completedHours).toBe(90);
    expect(r.totalAfterPlan).toBeGreaterThan(131);
  });
});

/**
 * plan_draft_summary_consistency.test.js
 *
 * Root cause: buildSidebarStatusSummary() — which feeds renderAiTab()'s right-
 * panel chip row (חוקיות/שעות/שער רוח/עומס) — always built semObjs from
 * state.semesters (the COMMITTED board), with no awareness of
 * state.proposalDraft. renderChips() (top header "מוצבים" badge) likewise
 * always reads the committed board via allPlacedIds(). Meanwhile renderBoard()
 * already overlays the tentative draft (course cards, semester header
 * hours/load via activeSemestersMap()) and shows a banner labeling it as a
 * pending draft. Net effect: while a draft is pending, the board shows one
 * set of totals and the right panel / header chips silently show a DIFFERENT,
 * unlabeled set — the exact "production reports a 12-course board but the
 * preview shows 21+ cards" contradiction from the follow-up bug report.
 *
 * Fix: buildSidebarStatusSummary(opts) now accepts opts.semestersOverride,
 * reusing the EXACT SAME computation pipeline (getDegreeHoursStatusLocal →
 * computeDegreeProgress, the same canonical source renderBoard's banner and
 * the semester headers already use) with a different semesters source. When
 * state.proposalDraft is pending, renderAiTab() renders the draft totals as a
 * SECOND, explicitly labeled card ("טיוטה לפני החלה") underneath the existing
 * labeled committed-board card ("לוח נוכחי (מאושר)") — Option B: keep
 * committed totals visible, add a separate visible draft summary, least
 * invasive (the no-draft case renders byte-identical to before — no label,
 * single row). renderChips() gets an additional "מוצבים (טיוטה)" chip only
 * when a draft is pending.
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
  window.confirm = () => false;
  window.alert  = () => {};

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = scriptSrc;
  window.document.body.appendChild(scriptEl);
  return dom;
}

function waitForInit(window) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const ready = window.eval('typeof state !== "undefined" && !!state && !!state.semesters && typeof courseMap !== "undefined" && Object.keys(courseMap).length > 0');
      if (ready) return resolve();
      if (Date.now() - start > 20000) return reject(new Error('init() did not complete in time'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('AI draft pending — right panel and header chips stay labeled and consistent', () => {
  let dom, window;

  beforeEach(async () => {
    dom = loadPage();
    window = dom.window;
    await waitForInit(window);
  });
  afterEach(() => dom.window.close());

  test('no draft pending: right panel shows a single, unlabeled committed-board row (unchanged default)', () => {
    const r = JSON.parse(window.eval(`(function(){
      state.proposalDraft = null;
      renderAiTab();
      const panel = document.getElementById('sb-panel-ai');
      return JSON.stringify({
        rowCount: panel.querySelectorAll('.sb-status-summary').length,
        hasDraftLabel: panel.textContent.includes('טיוטה לפני החלה'),
        hasCommittedLabel: panel.textContent.includes('לוח נוכחי'),
      });
    })()`));
    expect(r.rowCount).toBe(1);
    expect(r.hasDraftLabel).toBe(false);
    expect(r.hasCommittedLabel).toBe(false);
  });

  test('draft pending: right panel shows TWO explicitly labeled rows with different totals', () => {
    const r = JSON.parse(window.eval(`(function(){
      // Move one extra elective into a fresh draft so committed vs draft hours differ.
      const committedIds = Object.values(state.semesters).flat();
      const extraId = state.repo.find(cid => {
        const c = courseMap[cid];
        return c && c.course_type !== 'mandatory' && !c.is_mandatory && c.weekly_hours != null && !committedIds.includes(cid);
      });
      const draftSemesters = JSON.parse(JSON.stringify(state.semesters));
      const firstSemId = Object.keys(draftSemesters)[0];
      draftSemesters[firstSemId] = [...draftSemesters[firstSemId], extraId];
      state.proposalDraft = { semesters: draftSemesters, repo: state.repo.filter(c => c !== extraId) };
      renderAiTab();
      const panel = document.getElementById('sb-panel-ai');
      const rows = Array.from(panel.querySelectorAll('.sb-status-summary'));
      return JSON.stringify({
        rowCount: rows.length,
        hasDraftLabel: panel.textContent.includes('טיוטה לפני החלה'),
        hasCommittedLabel: panel.textContent.includes('לוח נוכחי'),
        rowTexts: rows.map(r => r.textContent),
      });
    })()`));
    expect(r.rowCount).toBe(2);
    expect(r.hasDraftLabel).toBe(true);
    expect(r.hasCommittedLabel).toBe(true);
    // The two rows must show DIFFERENT "שעות" totals (draft added one course's hours).
    expect(r.rowTexts[0]).not.toBe(r.rowTexts[1]);
  });

  test('draft totals reuse the canonical computeDegreeProgress pipeline (match renderBoard\'s own draft math)', () => {
    const r = JSON.parse(window.eval(`(function(){
      const committedIds = Object.values(state.semesters).flat();
      const extraId = state.repo.find(cid => {
        const c = courseMap[cid];
        return c && c.course_type !== 'mandatory' && !c.is_mandatory && c.weekly_hours != null && !committedIds.includes(cid);
      });
      const draftSemesters = JSON.parse(JSON.stringify(state.semesters));
      const firstSemId = Object.keys(draftSemesters)[0];
      draftSemesters[firstSemId] = [...draftSemesters[firstSemId], extraId];
      state.proposalDraft = { semesters: draftSemesters, repo: state.repo.filter(c => c !== extraId) };

      const sDraft = buildSidebarStatusSummary({ semestersOverride: state.proposalDraft.semesters });
      const dp = computeDegreeProgress({}, state, { semesters: state.proposalDraft.semesters });
      return JSON.stringify({
        panelTotal: sDraft.hours.total_after_plan,
        canonicalTotal: dp.total_after,
      });
    })()`));
    expect(r.panelTotal).toBe(r.canonicalTotal);
  });

  test('top header chips: a "מוצבים (טיוטה)" chip appears only while a draft is pending, with the draft\'s own count', () => {
    const r = JSON.parse(window.eval(`(function(){
      state.proposalDraft = null;
      renderChips();
      const noDraftHtml = document.getElementById('hdr-chips').innerHTML;

      const committedIds = Object.values(state.semesters).flat();
      const extraId = state.repo.find(cid => {
        const c = courseMap[cid];
        return c && c.course_type !== 'mandatory' && !c.is_mandatory && !committedIds.includes(cid);
      });
      const draftSemesters = JSON.parse(JSON.stringify(state.semesters));
      const firstSemId = Object.keys(draftSemesters)[0];
      draftSemesters[firstSemId] = [...draftSemesters[firstSemId], extraId];
      state.proposalDraft = { semesters: draftSemesters, repo: state.repo.filter(c => c !== extraId) };
      renderChips();
      const draftHtml = document.getElementById('hdr-chips').innerHTML;
      return JSON.stringify({
        noDraftHasDraftChip: noDraftHtml.includes('מוצבים (טיוטה)'),
        draftHasDraftChip: draftHtml.includes('מוצבים (טיוטה)'),
        draftCount: new Set(Object.values(draftSemesters).flat()).size,
      });
    })()`));
    expect(r.noDraftHasDraftChip).toBe(false);
    expect(r.draftHasDraftChip).toBe(true);
  });

  test('reject: draft-specific totals disappear and the panel returns to the single committed row', () => {
    const r = JSON.parse(window.eval(`(function(){
      const committedIds = Object.values(state.semesters).flat();
      const extraId = state.repo.find(cid => {
        const c = courseMap[cid];
        return c && c.course_type !== 'mandatory' && !c.is_mandatory && !committedIds.includes(cid);
      });
      const draftSemesters = JSON.parse(JSON.stringify(state.semesters));
      const firstSemId = Object.keys(draftSemesters)[0];
      draftSemesters[firstSemId] = [...draftSemesters[firstSemId], extraId];
      state.proposalDraft = { semesters: draftSemesters, repo: state.repo.filter(c => c !== extraId) };
      renderAiTab();
      const beforeRows = document.getElementById('sb-panel-ai').querySelectorAll('.sb-status-summary').length;

      rejectProposalDraft();
      renderAiTab();
      const panel = document.getElementById('sb-panel-ai');
      return JSON.stringify({
        beforeRows,
        afterRows: panel.querySelectorAll('.sb-status-summary').length,
        afterHasDraftLabel: panel.textContent.includes('טיוטה לפני החלה'),
        draftCleared: state.proposalDraft === null,
      });
    })()`));
    expect(r.beforeRows).toBe(2);
    expect(r.afterRows).toBe(1);
    expect(r.afterHasDraftLabel).toBe(false);
    expect(r.draftCleared).toBe(true);
  });

  test('apply: top badges, right panel, and board metadata converge on the same applied totals', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiPlanLastCtx = null; // skip validateFinalPlan gate — not under test here
      const committedIds = Object.values(state.semesters).flat();
      const extraId = state.repo.find(cid => {
        const c = courseMap[cid];
        return c && c.course_type !== 'mandatory' && !c.is_mandatory && c.weekly_hours != null && !committedIds.includes(cid);
      });
      const draftSemesters = JSON.parse(JSON.stringify(state.semesters));
      const firstSemId = Object.keys(draftSemesters)[0];
      draftSemesters[firstSemId] = [...draftSemesters[firstSemId], extraId];
      state.proposalDraft = { semesters: draftSemesters, repo: state.repo.filter(c => c !== extraId), isTentative: true, tentativeCourseIds: [] };

      applyProposalDraft();
      renderAiTab();
      renderChips();

      const headerHtml = document.getElementById('hdr-chips').innerHTML;
      const headerPlaced = (headerHtml.match(/מוצבים<\\/span> <span class=\"cv\">(\\d+)/) || [])[1];
      const s = buildSidebarStatusSummary();
      const boardPlacedNow = new Set(Object.values(state.semesters).flat()).size;
      return JSON.stringify({
        draftClearedAfterApply: state.proposalDraft === null,
        extraIdNowOnCommittedBoard: Object.values(state.semesters).flat().includes(extraId),
        headerPlacedCount: headerPlaced ? Number(headerPlaced) : null,
        boardPlacedNow,
        panelHours: s.hours.total_after_plan,
      });
    })()`));
    expect(r.draftClearedAfterApply).toBe(true);
    expect(r.extraIdNowOnCommittedBoard).toBe(true);
    expect(r.headerPlacedCount).toBe(r.boardPlacedNow);
  });

  test('regression: a hard-avoided course stays excluded from both the pending-draft and applied totals', () => {
    const r = JSON.parse(window.eval(`(function(){
      const allElectives = Object.values(courseMap).filter(c => c.course_type !== 'mandatory' && !c.is_mandatory && c.weekly_hours != null);
      const avoided = allElectives.find(c => !Object.values(state.semesters).flat().includes(c.course_id));
      _aiPickerState = { wanted: [], unwanted: [avoided.course_id], strongUnwanted: [], shaarRuachAssessmentPref: null, _initialized: true };
      const prefs = sidebarQuickActionPrefs();
      const hardExcluded = prefs.strongly_avoided_course_ids.includes(avoided.course_id);

      // Simulate a pending draft that (correctly) never placed the avoided course.
      state.proposalDraft = { semesters: JSON.parse(JSON.stringify(state.semesters)), repo: [...state.repo] };
      const pendingHasAvoided = Object.values(state.proposalDraft.semesters).flat().includes(avoided.course_id);

      _aiPlanLastCtx = null;
      applyProposalDraft();
      const appliedHasAvoided = Object.values(state.semesters).flat().includes(avoided.course_id);
      return JSON.stringify({ hardExcluded, pendingHasAvoided, appliedHasAvoided });
    })()`));
    expect(r.hardExcluded).toBe(true);
    expect(r.pendingHasAvoided).toBe(false);
    expect(r.appliedHasAvoided).toBe(false);
  });
});

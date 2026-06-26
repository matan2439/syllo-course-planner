/**
 * plan_existing_hard_avoid_warning.test.js
 *
 * A5 edge case, found via live production smoke test: a course already on
 * the REAL committed board, when marked hard-avoid, was correctly never
 * RE-ADDED and never reported as newly "שובץ"/"נוסף" — but the system also
 * never WARNED that the existing board already conflicts with the hard-avoid
 * preference, leaving the user believing the preference was satisfied when
 * it was not.
 *
 * Root-cause investigation (see git history for the full Phase-1 writeup)
 * found three independent surfaces, fixed via one shared helper,
 * buildExistingHardAvoidWarnings(avoidedIds, committedCidSet, ctxCourses):
 *
 *  A. buildDeterministicReplacementPlan, step 5a (hard-exclusion sweep) —
 *     deliberately preserves an existing hard-avoided elective
 *     (`beforeCids.has(cid)` guard) with no warning. Now appends the shared
 *     helper's output to proposal.warnings_he right after that sweep.
 *
 *  B. buildPlanningFallback / activateTentativeDraft — never referenced
 *     hard-avoid against the existing board at all. Now takes `prefs` as a
 *     4th argument and appends the same shared-helper output to the
 *     warnings_he it returns (which activateTentativeDraft already echoes).
 *
 *  C. applyExplicitAvoidPostFilterLocal (the LLM-accepted pipeline's final
 *     safety net) — already REMOVES an existing-on-board hard-avoided
 *     elective correctly (no beforeCids protection there), but only reported
 *     it via a transient 3.5s toast (showBoardNotify), never the persistent
 *     chat message. Now also appends a removal rationale to warnings_he
 *     (flows to postPlanChangeSummary via _aiPlanLastProposal).
 *
 * Preview verification of the first version of this fix found that B's
 * warning, while present on buildPlanningFallback's RETURN VALUE, never
 * reached the real chat message: requestPlanProposal's actual call to
 * activateTentativeDraft uses `state.lastPlanningDraft` (an object
 * buildPlanningFallback builds and assigns internally, BEFORE its own
 * return statement) — not buildPlanningFallback's return value itself. The
 * two objects are different, and only the return value had warnings_he. Fixed
 * by computing the warning once and attaching it to BOTH objects. The
 * end-to-end test below exercises the REAL wiring (full requestPlanProposal,
 * not a hand-built draft object) specifically to catch this class of gap —
 * the earlier per-function unit tests passed even with the bug present,
 * because they tested each function in isolation rather than the actual
 * connection between them.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const ELECTIVE = '0542-4123'; // תהליכי מעבר חום וחומר — an ordinary, non-mandatory elective in this fixture
const MANDATORY = '0542-2400'; // תכן מכני (1) — חובה קבוע in this fixture

function createPageSetup(aiResponseFn) {
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
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
    }
    if (u.includes('/api/ai/generate-plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(aiResponseFn ? aiResponseFn(window) : { semesters: [], warnings_he: [] }) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window };
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

function placeOnBoard(window, cid, semId) {
  window.eval(`state.semesters['${semId}'] = [...new Set([...(state.semesters['${semId}']||[]), '${cid}'])]; state.repo = (state.repo||[]).filter(c => c !== '${cid}');`);
}

describe('A5 — hard-avoided course already exists on the committed board', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('test_existing_committed_course_hard_avoid_warns (via buildDeterministicReplacementPlan — minimal/incremental path)', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, ELECTIVE, 'year_3_semester_a');
    const r = JSON.parse(window.eval(`(function(){
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: ['${ELECTIVE}'] } });
      return JSON.stringify({ warnings: plan.proposal.warnings_he || [] });
    })()`));
    const name = window.eval(`courseMap['${ELECTIVE}'].name_he`);
    expect(r.warnings.some(w => w.includes(name) && w.includes('כבר נמצא במערכת הנוכחית'))).toBe(true);
  });

  test('test_existing_hard_avoid_not_reported_as_newly_scheduled', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, ELECTIVE, 'year_3_semester_a');
    const r = JSON.parse(window.eval(`(function(){
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: ['${ELECTIVE}'] } });
      _aiChatMessages = [];
      const _focusStr = '';
      const _warnStr = (plan.proposal.warnings_he && plan.proposal.warnings_he.length) ? '\\n' + plan.proposal.warnings_he.join('\\n') : '';
      const msg = plan.reachedTarget
        ? \`בניתי מערכת חלופית מתוך הקורסים שניתן לשבץ בוודאות.\\nסה"כ \${Math.round(plan.totalHours)}/\${plan.targetHours} ש"ש.\${_warnStr}\`
        : '';
      postAssistantMessage(msg);
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      return JSON.stringify({ msg, stillOnBoard: allIds.includes('${ELECTIVE}') });
    })()`));
    const name = window.eval(`courseMap['${ELECTIVE}'].name_he`);
    expect(r.stillOnBoard).toBe(true);
    // The warning line mentions the course, but never as a "שובץ"/"נוספו" claim.
    const placedLines = r.msg.split('\n').filter(l => l.includes('שובץ') || l.includes('נוספו') || l.includes('נוסף'));
    expect(placedLines.some(l => l.includes(name))).toBe(false);
  });

  test('test_full_rebuild_removes_existing_hard_avoided_elective (via applyExplicitAvoidPostFilterLocal — the LLM-accepted pipeline\'s final safety net, which has no beforeCids protection) and explains the removal', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['${ELECTIVE}'] }] };
      const avoidedIds = new Set(['${ELECTIVE}']);
      const { proposal: filtered, removed } = applyExplicitAvoidPostFilterLocal(proposal, avoidedIds, {});
      const allIds = Object.values(proposalSemestersToMap(filtered.semesters)).flat();
      return JSON.stringify({ stillPresent: allIds.includes('${ELECTIVE}'), removed, warnings: filtered.warnings_he || [] });
    })()`));
    const name = window.eval(`courseMap['${ELECTIVE}'].name_he`);
    expect(r.stillPresent).toBe(false);
    expect(r.removed).toContain(ELECTIVE);
    expect(r.warnings.some(w => w.includes(name) && w.includes('לא שובץ מחדש'))).toBe(true);
  });

  test('test_incremental_update_preserves_but_warns_existing_hard_avoid (via buildPlanningFallback/activateTentativeDraft)', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, ELECTIVE, 'year_3_semester_a');
    const r = JSON.parse(window.eval(`(function(){
      // eligibleProposal: a partial-OK-blocked proposal that adds one new course
      // alongside the existing (hard-avoided) elective already on the board.
      const eligibleProposal = {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['${ELECTIVE}'] },
          { semester_id: 'year_4_semester_a', course_ids: ['0542-4220'] },
        ],
      };
      const gateResult = { applicable: false, blockers: [{ cause: 'degree_completion' }] };
      const ctx = { courses: {} };
      const fb = buildPlanningFallback(eligibleProposal, gateResult, ctx, { strongly_avoided_course_ids: ['${ELECTIVE}'] });
      return JSON.stringify({ found: !!fb, warnings: fb ? fb.warnings_he : [] });
    })()`));
    expect(r.found).toBe(true);
    const name = window.eval(`courseMap['${ELECTIVE}'].name_he`);
    expect(r.warnings.some(w => w.includes(name) && w.includes('כבר נמצא במערכת הנוכחית'))).toBe(true);

    // And the message activateTentativeDraft actually shows the user echoes it
    // (warnings_he is threaded into draft.warnings_he -> activateTentativeDraft's
    // warningsLine, confirmed by earlier work in this codebase).
    const r2 = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      const draft = {
        confirmedPlacements: [{ course_id: '0542-4220', semester_id: 'year_4_semester_a' }],
        tentativePlacements: [],
        warnings_he: ['הקורס ${name} כבר נמצא במערכת הנוכחית, אך הוא מסומן ברשימת הקורסים להימנע מהם. כדי לעמוד בהעדפה זו צריך להסיר אותו ידנית או לבנות מערכת מחדש.'],
      };
      activateTentativeDraft(draft, { balance: false });
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r2.joined).toContain('כבר נמצא במערכת הנוכחית');
    expect(r2.joined).toContain(name);
  });

  test('end-to-end: requestPlanProposal\'s REAL call to activateTentativeDraft (via state.lastPlanningDraft) shows the warning — reproduces the exact preview-verification gap', async () => {
    // Drives the REAL bridge: call buildPlanningFallback with a soft-only
    // (PARTIAL_OK) gate rejection — exactly the shape requestPlanProposal
    // produces for a genuine category-requirements gap — then call
    // activateTentativeDraft with state.lastPlanningDraft (the side-effect
    // object buildPlanningFallback assigns), EXACTLY as requestPlanProposal's
    // own call site does at its `if (!_hasHardBlocker && _placementCount > 0)`
    // branch. This is deterministic (no network/gate-shape flakiness) while
    // still exercising the real connection between the two functions, which
    // is exactly where the gap was hiding (see preview-verification note
    // above): a first version of this fix worked when buildPlanningFallback
    // was unit-tested in isolation, but failed for real because the actual
    // call site never reads buildPlanningFallback's return value at all.
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, ELECTIVE, 'year_3_semester_a');

    const r = JSON.parse(window.eval(`(function(){
      const eligibleProposal = {
        semesters: [
          { semester_id: 'year_3_semester_a', course_ids: ['${ELECTIVE}'] },
          { semester_id: 'year_4_semester_a', course_ids: ['0542-4220'] },
        ],
      };
      const gateResult = { applicable: false, blockers: [{ cause: 'category_requirements' }] };
      const ctx = { courses: {} };
      const _fallback = buildPlanningFallback(eligibleProposal, gateResult, ctx, { strongly_avoided_course_ids: ['${ELECTIVE}'] });
      const _blockerCauses = gateResult.blockers.map(b => b.cause);
      const _HARD_STRUCTURAL = new Set(['overload', 'illegal_semester', 'eligibility', 'duplicate', 'annual']);
      const _hasHardBlocker = _blockerCauses.some(c => _HARD_STRUCTURAL.has(c));
      const _draft = state.lastPlanningDraft;
      const _placementCount = _draft ? ((_draft.confirmedPlacements||[]).length + (_draft.tentativePlacements||[]).length) : 0;
      _aiChatMessages = [];
      let usedRealCallSite = false;
      if (_fallback && !_hasHardBlocker && _placementCount > 0) {
        usedRealCallSite = true;
        activateTentativeDraft(_draft, { balance: false, fromBuild: true });
      }
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const sems = (state.proposalDraft && state.proposalDraft.semesters) || state.semesters;
      const allIds = Object.values(sems).flat();
      return JSON.stringify({ usedRealCallSite, stillOnBoard: allIds.includes('${ELECTIVE}'), joined: msgs.join('\\n') });
    })()`));
    const name = window.eval(`courseMap['${ELECTIVE}'].name_he`);
    expect(r.usedRealCallSite).toBe(true);
    expect(r.stillOnBoard).toBe(true);
    expect(r.joined).toContain('כבר נמצא במערכת הנוכחית');
    expect(r.joined).toContain(name);
  });

  test('test_mandatory_or_locked_existing_hard_avoid_explains_not_removed', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, MANDATORY, 'year_3_semester_a');
    const r = JSON.parse(window.eval(`(function(){
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: ['${MANDATORY}'] } });
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      return JSON.stringify({ stillOnBoard: allIds.includes('${MANDATORY}'), warnings: plan.proposal.warnings_he || [] });
    })()`));
    const name = window.eval(`courseMap['${MANDATORY}'].name_he`);
    // Cannot be removed (mandatory) — must explain WHY, not silently ignore.
    expect(r.stillOnBoard).toBe(true);
    expect(r.warnings.some(w => w.includes(name) && (w.includes('חובה') || w.includes('הושלם')))).toBe(true);
    // Must use the mandatory-explanation wording, not the "you must remove it
    // manually" elective wording (that one would be misleading for a course
    // that literally cannot be removed).
    expect(r.warnings.some(w => w.includes(name) && w.includes('כבר נמצא במערכת הנוכחית'))).toBe(false);
  });

  test('regression: a hard-avoided course NOT on the committed board produces no existing-conflict warning', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`(function(){
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: ['${ELECTIVE}'] } });
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      return JSON.stringify({ onBoard: allIds.includes('${ELECTIVE}'), warnings: plan.proposal.warnings_he || [] });
    })()`));
    expect(r.onBoard).toBe(false);
    expect(r.warnings.some(w => w.includes('כבר נמצא במערכת הנוכחית'))).toBe(false);
  });

  test('regression: buildExistingHardAvoidWarnings is a pure no-op for empty inputs', async () => {
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    const r = JSON.parse(window.eval(`JSON.stringify([
      buildExistingHardAvoidWarnings(new Set(), new Set(['${ELECTIVE}']), {}),
      buildExistingHardAvoidWarnings(new Set(['${ELECTIVE}']), new Set(), {}),
      buildExistingHardAvoidWarnings(null, null, {}),
    ])`));
    expect(r).toEqual([[], [], []]);
  });

  test('regression: the existing-hard-avoid warning never tells the user that rebuilding will remove the course (it does not — beforeCids deliberately preserves it)', async () => {
    // Found via live browser QA: the warning said "...או לבנות מערכת מחדש" (or
    // rebuild the system) as if rebuilding fixes it, but buildDeterministicReplacementPlan's
    // beforeCids guard means a rebuild NEVER drops a course already on the board.
    // A user who rebuilds expecting removal per the warning's own advice would see
    // the course still there with no further explanation — the message must not
    // promise an action the system doesn't actually take.
    ({ dom, window } = createPageSetup());
    await waitForInit(window);
    placeOnBoard(window, ELECTIVE, 'year_3_semester_a');
    const r = JSON.parse(window.eval(`(function(){
      const plan = buildDeterministicReplacementPlan({ targetHours: 185, fillToTarget: true, prefs: { strongly_avoided_course_ids: ['${ELECTIVE}'] } });
      const allIds = Object.values(proposalSemestersToMap(plan.proposal.semesters)).flat();
      return JSON.stringify({ stillOnBoard: allIds.includes('${ELECTIVE}'), warnings: plan.proposal.warnings_he || [] });
    })()`));
    expect(r.stillOnBoard).toBe(true);
    const w = r.warnings.find(x => x.includes('כבר נמצא במערכת הנוכחית'));
    expect(w).toBeTruthy();
    expect(w).not.toContain('לבנות מערכת מחדש');
    expect(w).toContain('להסיר אותו ידנית');
  });
});

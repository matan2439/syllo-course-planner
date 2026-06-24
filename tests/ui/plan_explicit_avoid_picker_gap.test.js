/**
 * plan_explicit_avoid_picker_gap.test.js
 *
 * Root cause: requestPlanProposal()'s FINAL deterministic safety net
 * (applyExplicitAvoidPostFilterLocal) is fed `explicitlyAvoidedIds`, which is
 * built ONLY from resolveAvoidedCourseIdsLocal(prefs.extra_request_he) — i.e.
 * courses mentioned by name in the free-text chat box. It never looked at
 * prefs.strongly_avoided_course_ids / prefs.hard_exclude_course_ids, which is
 * exactly what the dedicated "קורסים שאני רוצה להימנע מהם" picker field
 * populates (see sidebarQuickActionPrefs() -> panelPrefs.strongly_avoided_course_ids).
 * So a course picked via that structured picker was only a SOFT scoring
 * signal during AI generation — if the AI proposal included it anyway,
 * nothing deterministic caught it before the draft was shown to the user.
 *
 * A true end-to-end repro (stub /api/ai/generate-plan, call requestPlanProposal,
 * inspect the final draft) was attempted, but the production board fixture's
 * strict validity gate (validateFinalPlan) rejects ANY synthetic proposal that
 * isn't already at full 185h completion with zero missing-offering-data and
 * zero semester overload — including the system's OWN best-effort deterministic
 * plan, which carries a pre-existing, unrelated mandatory-course semester
 * overload (year_3_semester_a = 27h, independently noted in an earlier session
 * as pre-existing/out of scope). Any imperfect synthetic proposal therefore
 * always falls through to buildDeterministicReplacementPlan — which already
 * enforces hardExcludeCourseIds correctly — silently masking this exact bug
 * rather than reproducing it. So this test instead exercises the precise
 * buggy computation directly: the merge of avoid-sources inside
 * requestPlanProposal, and the safety-net filter it feeds.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const AVOIDED_COURSE_ID = '0542-4120'; // תרמודינמיקה (2)

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

describe('explicit avoid-list (picker) gap in requestPlanProposal', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('explicitlyAvoidedIds (fed to the final safety-net filter) includes a picker-selected avoid course', () => {
    // Mirrors requestPlanProposal's exact merge logic at the point where
    // explicitlyAvoidedIds is computed and handed to
    // applyExplicitAvoidPostFilterLocal. No free-text avoid-intent phrase is
    // present — only the picker-style strongly_avoided_course_ids field, which
    // is how the dedicated avoid-list UI field actually populates prefs.
    const r = JSON.parse(window.eval(`(function(){
      const prefs = { extra_request_he: '', strongly_avoided_course_ids: ['${AVOIDED_COURSE_ID}'] };
      const fromFreeText = resolveAvoidedCourseIdsLocal(prefs.extra_request_he);
      const explicitlyAvoidedIds = computeExplicitlyAvoidedIdsLocal(prefs);
      return JSON.stringify({
        fromFreeTextHasIt: fromFreeText.has('${AVOIDED_COURSE_ID}'),
        finalSetHasIt: explicitlyAvoidedIds.has('${AVOIDED_COURSE_ID}'),
      });
    })()`));
    // Free-text resolution alone (the old behavior) never sees a picker-only id.
    expect(r.fromFreeTextHasIt).toBe(false);
    // The final set fed to the safety-net filter MUST include it regardless.
    expect(r.finalSetHasIt).toBe(true);
  });

  test('applyExplicitAvoidPostFilterLocal actually removes the course once handed the correct set', () => {
    const r = JSON.parse(window.eval(`(function(){
      const prefs = { extra_request_he: '', strongly_avoided_course_ids: ['${AVOIDED_COURSE_ID}'] };
      const explicitlyAvoidedIds = computeExplicitlyAvoidedIdsLocal(prefs);
      const proposal = { semesters: [{ semester_id: 'year_4_semester_a', course_ids: ['0542-4010', '${AVOIDED_COURSE_ID}'] }] };
      const { proposal: filtered, removed } = applyExplicitAvoidPostFilterLocal(proposal, explicitlyAvoidedIds, {});
      const remainingIds = filtered.semesters.flatMap(s => s.course_ids);
      return JSON.stringify({ removed, remainingIds });
    })()`));
    expect(r.removed).toContain(AVOIDED_COURSE_ID);
    expect(r.remainingIds).not.toContain(AVOIDED_COURSE_ID);
  });

  test('a mandatory course is still kept (with rationale) even if explicitly avoided', () => {
    const r = JSON.parse(window.eval(`(function(){
      const mandatoryCid = YEAR_1_2_MANDATORY_COURSES[0].course_id;
      const explicitlyAvoidedIds = new Set([mandatoryCid]);
      const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: [mandatoryCid] }] };
      const ctxCourses = { [mandatoryCid]: { is_mandatory: true } };
      const { proposal: filtered, keptMandatory } = applyExplicitAvoidPostFilterLocal(proposal, explicitlyAvoidedIds, ctxCourses);
      const remainingIds = filtered.semesters.flatMap(s => s.course_ids);
      return JSON.stringify({ keptMandatory, remainingIds, hasWarning: (filtered.warnings_he || []).length > 0 });
    })()`));
    expect(r.keptMandatory.length).toBe(1);
    expect(r.remainingIds.length).toBe(1);
    expect(r.hasWarning).toBe(true);
  });

  test('Hebrew spelling variants of the same course name normalize identically', () => {
    const r = JSON.parse(window.eval(`(function(){
      return JSON.stringify({
        a: _normalizeCourseNameLocal('ננו לוויינים 2'),
        b: _normalizeCourseNameLocal('ננו לווינים 2'),
        c: _normalizeCourseNameLocal('ננו לוויינות 2'),
        d: _normalizeCourseNameLocal('ננו לווינות 2'),
        withSubtitle: _normalizeCourseNameLocal('ננו לווינים: בין חינוך למדעים למהפכת החלל'),
      });
    })()`));
    expect(r.a).toBe(r.b);
    expect(r.a).toBe(r.c);
    expect(r.a).toBe(r.d);
    // A subtitle after a colon is a different (longer) string by design — the
    // normalizer folds spelling/punctuation, it does not strip subtitles — but
    // it must still contain the same canonical spelling of the course name.
    expect(r.withSubtitle).toContain('לוויינים');
  });
});

/**
 * DETERMINISTIC REPRODUCTION HARNESS (Steps 1 & 4 of the mass-removal /
 * annual-layout task).
 *
 * Loads the REAL app/web/semester_board_viewer.html + the REAL board JSON into
 * jsdom (same full-document pattern as semester_board_ai_chat.test.js), stubs
 * ONLY the non-deterministic LLM endpoint (/api/ai/generate-plan) with an empty
 * proposal, and then runs the actual `requestPlanProposal` so the entire
 * deterministic post-LLM chain executes against real data:
 *   normalize → repairAddMissingMandatory → repairAddMissingElectives →
 *   repairAddGeneral → repairAddHoursToDegree → replaceWeakElectives →
 *   moveFoundations → repairPlanLoad → repairPrerequisiteOrder →
 *   eligibility post-filter + refill → enforceLegalPlacementsLocal →
 *   exhaustive hours refill → normalizeAnnualPlacements → validateFinalPlan.
 *
 * It captures: validateFinalPlan {applicable, blockers}, the
 * enforceLegalPlacementsLocal blocked/relocated lists, how many courses are
 * removed as "no legal semester", and the annual course's placements — and the
 * rendered annual DOM element's classList + position.
 *
 * This harness is the regression test: it asserts NO mass-removal and a
 * proper annual layout. It must FAIL pre-fix and PASS post-fix.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

const EXTRA_REQUEST_HE =
  'אני רוצה להתמקד בעיקר בתכן ואנליזות חוזק, זרימה ורעידות, ופחות בתחום תרמודינמיקה ומעבר חום, אבל רוצה גם שממוצעי הציונים של הקורסים יהיו גבוהים מעל 82';

function loadPage(fetchImpl) {
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
  window.fetch = fetchImpl;
  window.confirm = () => true;
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
      if (Date.now() - start > 20000) return reject(new Error('init() did not complete'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

// Empty-seed LLM response: the deterministic chain must build the whole plan.
function emptyProposalResponse(window) {
  const semIds = window.eval('SEMESTERS.map(s => s.id)');
  return {
    ok: true,
    json: () => Promise.resolve({
      proposal: { semesters: semIds.map(id => ({ semester_id: id, course_ids: [] })) },
      blocked: false,
      errors: [],
    }),
  };
}

const CANONICAL_PREFS = {
  extra_request_he: EXTRA_REQUEST_HE,
  max_weekly_hours: 20,
  is_honors_student: false,
  balance_load: true,
};

async function runPipeline(window) {
  // Instrument enforceLegalPlacementsLocal to capture its blocked/relocated.
  window.eval(`
    window.__enforceCalls = [];
    (function(){
      const orig = enforceLegalPlacementsLocal;
      enforceLegalPlacementsLocal = function(proposal, opts){
        const r = orig(proposal, opts);
        window.__enforceCalls.push({
          blocked: JSON.parse(JSON.stringify(r.blocked || [])),
          relocated: JSON.parse(JSON.stringify(r.relocated || [])),
        });
        return r;
      };
    })();
  `);
  await window.requestPlanProposal({ ...CANONICAL_PREFS }, 'build_from_scratch');
}

function captureDiagnostics(window) {
  return window.eval(`(function(){
    const proposal = _aiPlanLastProposal;
    const ctx = (typeof buildFinalPlanValidationCtx === 'function') ? buildFinalPlanValidationCtx() : null;
    const finalPlan = (proposal && ctx) ? validateFinalPlan(proposal, ctx) : null;
    const enforce = window.__enforceCalls || [];
    const allBlocked = enforce.flatMap(c => c.blocked);
    const allReloc = enforce.flatMap(c => c.relocated);
    const removedNoLegal = allBlocked.filter(b => !b.mandatory);
    // annual placements
    const annualId = '0542-3792';
    const annualPlacements = (proposal && proposal.semesters || [])
      .filter(s => (s.course_ids||[]).includes(annualId)).map(s => s.semester_id);
    const completeness = _aiPlanLastValidation && _aiPlanLastValidation.completeness;
    const offeringBlockers = finalPlan ? finalPlan.blockers.filter(b => b.cause === 'missing_offering_data') : [];
    const nonOfferingBlockers = finalPlan ? finalPlan.blockers.filter(b => b.cause !== 'missing_offering_data') : [];
    return {
      applicable: finalPlan ? finalPlan.applicable : null,
      blockers: finalPlan ? finalPlan.blockers.map(b => ({cause:b.cause, message:b.message_he, course_ids:b.course_ids||null})) : [],
      offeringBlockerCount: offeringBlockers.length,
      offeringBlockerCourseCount: offeringBlockers.reduce((n,b) => n + ((b.course_ids||[]).length), 0),
      nonOfferingBlockerCauses: nonOfferingBlockers.map(b => b.cause),
      enforceBlockedCount: allBlocked.length,
      enforceRemovedNoLegal: removedNoLegal.map(b => ({id:b.course_id, name:b.name, legal:b.legal})),
      enforceRelocatedCount: allReloc.length,
      completenessReasons: completeness ? completeness.reasons : [],
      completenessIncomplete: completeness ? completeness.incomplete : null,
      annualPlacements,
      totalPlaced: (proposal && proposal.semesters||[]).reduce((n,s)=>n+(s.course_ids||[]).length,0),
    };
  })()`);
}

describe('REPRO — mass-removal in the deterministic plan chain (canonical inputs)', () => {
  let dom, window;
  let diag;

  beforeAll(async () => {
    dom = loadPage((url) => {
      const u = String(url);
      if (u.includes('mechanical_semester_board_2027.json')) {
        const boardJson = fs.readFileSync(BOARD_JSON_PATH, 'utf8');
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(boardJson)) });
      }
      if (u.includes('/api/ai/generate-plan')) return Promise.resolve(emptyProposalResponse(window));
      if (u.includes('/api/')) return Promise.reject(new Error('network down'));
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('nf') });
    });
    window = dom.window;
    await waitForInit(window);
    await runPipeline(window);
    diag = captureDiagnostics(window);
    // Visible during `jest --verbose` / on failure.
    // eslint-disable-next-line no-console
    console.log('REPRO DIAGNOSTICS:', JSON.stringify(diag, null, 2));
  }, 60000);

  afterAll(() => { dom && dom.window.close(); });

  test('the chain does NOT mass-remove valid courses as "no legal semester"', () => {
    // A tiny threshold is tolerated (genuinely unplaceable). "Mass" removal is >2.
    expect(diag.enforceRemovedNoLegal.length).toBeLessThanOrEqual(2);
  });

  test('blocked-completeness has no long per-course "no legal semester" removal list', () => {
    const noLegalLines = diag.completenessReasons.filter(r => /אין סמסטר חוקי/.test(r));
    // At most ONE grouped line, not N per-course lines.
    expect(noLegalLines.length).toBeLessThanOrEqual(1);
  });

  test('the annual course 0542-3792 is placed in BOTH of its span semesters', () => {
    expect(diag.annualPlacements.sort()).toEqual(['year_3_semester_a', 'year_3_semester_b']);
  });

  test('missing offering data is ONE grouped data-quality blocker, not N per-course lines', () => {
    // After the Step-2 data fix + planner preference, any residual
    // missing-offering-data must be a SINGLE grouped blocker (never one blocker
    // per course). In this empty-seed worst case the synthetic fill force-places
    // every repository course (incl. the genuinely-UNKNOWN ones), so a grouped
    // data-quality blocker is expected — but it must collapse to one message.
    expect(diag.offeringBlockerCount).toBeLessThanOrEqual(1);
    if (diag.offeringBlockerCount === 1) {
      // The single blocker carries the grouped course list and a grouped message.
      const b = diag.blockers.find(x => x.cause === 'missing_offering_data');
      expect(diag.offeringBlockerCourseCount).toBeGreaterThan(1);
      expect(b.message).toMatch(/קורסים|נתוני סמסטר/);
    }
  });

  test('the final plan is applicable OR carries only grouped/orthogonal blockers (no offering spam)', () => {
    if (!diag.applicable) {
      // At most ONE offering blocker (grouped). Remaining blockers are orthogonal
      // (e.g. overload from the synthetic everything-placed empty-seed fill) and
      // are not per-course offering spam.
      expect(diag.offeringBlockerCount).toBeLessThanOrEqual(1);
      const causes = new Set(diag.nonOfferingBlockerCauses);
      expect(causes.has('illegal_semester')).toBe(false);
    } else {
      expect(diag.applicable).toBe(true);
    }
  });

  test('validateFinalPlan STILL REJECTS a placed course with missing effective_allowed_semesters (no fallback)', () => {
    // Construct a minimal proposal placing a course that has NO
    // effective_allowed_semesters but DOES have program_allowed_semesters and
    // offered_semesters. The authority validator must NOT fall back to either —
    // it must block with missing_offering_data.
    const res = window.eval(`(function(){
      const ctx = buildFinalPlanValidationCtx();
      // pick a real placed mandatory semester id to host the synthetic course
      const semId = 'year_3_semester_a';
      const FAKE = '__test_no_offering__';
      // inject a synthetic course into the validation ctx courses map
      ctx.courses[FAKE] = {
        hours: 3,
        effective_allowed_semesters: null,        // missing → must block
        offered_semesters: ['A'],                 // present, but NOT sufficient
        program_allowed_semesters: [semId],       // present, but NO fallback allowed
        allowed_semesters: [semId],
        recommended_semester: null,
        missing_prerequisites: [],
        is_mandatory: false,
        placement_policy: 'elective',
        name_he: 'בדיקה ללא נתוני סמסטר',
      };
      const proposal = { semesters: [{ semester_id: semId, course_ids: [FAKE] }] };
      const r = validateFinalPlan(proposal, ctx);
      const blk = (r.blockers||[]).filter(b => (b.course_ids||[]).includes(FAKE));
      return {
        applicable: r.applicable,
        causes: blk.map(b => b.cause),
      };
    })()`);
    // The synthetic course must be blocked specifically for missing offering data,
    // proving no fallback to program_allowed_semesters / offered_semesters.
    expect(res.causes).toContain('missing_offering_data');
    expect(res.causes).not.toContain('illegal_semester'); // it was NOT silently legalized
  });
});

/**
 * plan_structural_gap_decision_text.test.js
 *
 * Agent Diagnosis Loop finding: postPlanChangeSummary's "actionable options"
 * section unconditionally suggested 'לאשר קורס בחירה אחד בסיכון גבוה מהרשימה,
 * או להמתין להשלמת נתוני סמסטר לקורסים החסומים' whenever hours weren't
 * satisfied — even in a real scenario where the server's generate-plan
 * response already reports every mandatory/category requirement satisfied
 * and the visible planning window's catalog fully exhausted (see
 * api/ai/generate-plan.ts's new structural-gap warning, tests/api/
 * generate_plan_structural_degree_gap_warning.test.ts). In that scenario
 * there is no elective left to approve and no course waiting on missing
 * data — the old advice was a dead end, actively misleading rather than
 * just incomplete.
 *
 * Fix: postPlanChangeSummary now checks proposal.warnings_he for the
 * server's structural-gap marker first and, when present, surfaces an
 * honest "this needs hours outside the visible window" message instead of
 * the generic (here, false) elective/missing-data suggestion.
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
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(BOARD_JSON_PATH, 'utf8'))) });
    }
    if (u.includes('/api/')) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });
  };
  window.confirm = () => false; window.alert = () => {};
  const s = window.document.createElement('script');
  s.textContent = scriptSrc;
  window.document.body.appendChild(s);
  return dom;
}

function waitForInit(window) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.eval('typeof state !== "undefined" && !!state && !!state.semesters && typeof courseMap !== "undefined" && Object.keys(courseMap).length > 0')) return resolve();
      if (Date.now() - start > 20000) return reject(new Error('init timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('postPlanChangeSummary — structural degree-gap decision text (Agent Diagnosis Loop finding)', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('server structural-gap warning present → honest "outside the visible window" message, NOT the risky-elective/missing-data suggestion', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      const warn = 'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (14/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.';
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [warn] };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).toContain('חלון הסמסטרים');
    expect(r.joined).not.toContain('לאשר קורס בחירה אחד בסיכון גבוה');
    expect(r.joined).not.toContain('להמתין להשלמת נתוני סמסטר');
  });

  test('regression: an ordinary partial plan (no structural-gap warning) still gets the original elective/missing-data suggestion', () => {
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [] };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }] };
      postPlanChangeSummary(prev, next, {});
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).toContain('לאשר קורס בחירה אחד בסיכון גבוה');
    expect(r.joined).not.toContain('חלון הסמסטרים המוצג כרגע');
  });

  test('Codex-caught regression (round 9): a STALE structural-gap marker carried over from an earlier repair step must not override a plan that later repairs already brought up to the required hours', () => {
    // requestPlanProposal's client-side repair/refill chain (e.g.
    // repairAddHoursToDegreeLocal) appends onto, never clears,
    // proposal.warnings_he — so newProposal can carry a structural-gap marker
    // from BEFORE a later repair step closed the gap. Force _hoursSatisfied
    // true (stubbing computeDegreeProgress, the same override-global
    // technique this suite's other tests already use for
    // gateProposalActivation/postStatusMessage) while still passing the
    // marker in warnings_he, to isolate exactly the staleness bug from any
    // real course-hours bookkeeping.
    const r = JSON.parse(window.eval(`(function(){
      _aiChatMessages = [];
      const warn = 'מיצית את כל הקורסים הזמינים בחלון התכנון הנוכחי (181/185 ש"ש) — הפער הנותר דורש קורסים שאינם זמינים בטווח הסמסטרים המוצג, לא בחירה נוספת מתוך הרשימה הקיימת.';
      _aiPlanLastProposal = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [warn] };
      const prev = { semesters: [{ semester_id:'year_3_semester_a', course_ids:[] }] };
      const next = { semesters: [{ semester_id:'year_3_semester_a', course_ids:['0542-4220'] }], warnings_he: [warn] };
      const _origProgress = computeDegreeProgress;
      computeDegreeProgress = () => ({ total_after: 185, required: 185 });
      try {
        postPlanChangeSummary(prev, next, {});
      } finally {
        computeDegreeProgress = _origProgress;
      }
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      return JSON.stringify({ joined: msgs.join('\\n') });
    })()`));
    expect(r.joined).not.toContain('חלון הסמסטרים המוצג כרגע');
    expect(r.joined).not.toContain('לאשר קורס בחירה אחד בסיכון גבוה');
  });
});

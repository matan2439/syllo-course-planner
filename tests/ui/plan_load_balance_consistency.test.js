/**
 * Applied-load-balance CONSISTENCY (coupled offering + repair-writeback slice).
 *
 * Root coupling this locks: with 0542-3620 corrected to A+B, the legacy builder
 * balances the fill against the HARD cap (so year_3_semester_a can end at 26),
 * then computes the USER-max overload report via repairPlanLoad — which MOVES
 * 0542-3620 to its now-legal Semester B — but historically DISCARDED that
 * repaired proposal. Net: the summary reported an acceptable/repaired result
 * while state.proposalDraft (what Apply uses) still kept the course in Semester A
 * at 26/25. This test compares the ACTUAL applied proposal loads/placements with
 * the validated result — never text alone.
 */
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');
const HEAT = '0542-3620';

function loadPage() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/); const src = m[1]; html = html.replace(m[0], '');
  const dom = new JSDOM(html, { url: 'http://localhost/app/web/semester_board_viewer.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  const { window } = dom; window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.fetch = (url) => { const u = String(url);
    if (u.includes('mechanical_semester_board_2027.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(BOARD, 'utf8'))) });
    if (u.includes('/api/')) return Promise.reject(new Error('down')); return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }); };
  window.confirm = () => false; window.alert = () => {};
  const s = window.document.createElement('script'); s.textContent = src; window.document.body.appendChild(s); return dom;
}
function waitForInit(window){return new Promise((res,rej)=>{const t0=Date.now();const tick=()=>{try{if(window.eval('typeof state!=="undefined"&&!!state&&!!state.semesters&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0'))return res();}catch(_){} if(Date.now()-t0>20000)return rej(new Error('timeout')); setTimeout(tick,15);};tick();});}

describe('applied load-balance consistency — corrected offering + repair writeback', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  function buildME() {
    return JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: [], unwanted: ['0542-4120'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const p = sidebarQuickActionPrefs(); p.max_weekly_hours = 25; _aiPlanLastPreferences = p; _aiUserIntentProfile = null;
      state.proposalDraft = null;
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const arr = x => Object.entries(x||{}).map(([k,v]) => ({ id:k, ids: Array.isArray(v)?v:(v&&v.course_ids)||[] }));
      const load = s => s.ids.reduce((a,c)=>a+((courseMap[c]?.weekly_hours)||0),0);
      const applied = arr(state.proposalDraft.semesters);
      const heatSem = (applied.find(s => s.ids.includes('${HEAT}'))||{}).id;
      const maxLoad = Math.max(...applied.map(load));
      const overCap = applied.filter(s => load(s) > 25.001).map(s => s.id + ':' + load(s));
      const warns = (plan.proposal.warnings_he||[]).join(' || ');
      const total = buildPlanContextFromState({ proposalSemesters: applied.map(s=>({semester_id:s.id, course_ids:s.ids})) }).totalAfterPlan;
      // A warning is "claimed" for a semester only if its id/label appears in warnings.
      const warnsMentionOverCap = overCap.some(o => warns.includes(_formatSemIdHe(o.split(':')[0])) || warns.includes(o.split(':')[0]));
      return JSON.stringify({ heatSem, maxLoad, overCap, warns, total, warnsMentionOverCap });
    })()`));
  }

  test('the applied proposal (state.proposalDraft) honors the user max via a REAL move, matching the summary', () => {
    const r = buildME();
    // The degree is still completed (no shedding — this was a pure relocation).
    expect(r.total).toBeGreaterThanOrEqual(185);
    // Half-hour precision preserved end-to-end (never rounded to an integer).
    expect(r.total % 0.5).toBe(0);
    expect(Number.isInteger(r.total)).toBe(false); // this plan genuinely lands on a .5
    // No first-semester bias: 0542-3620 is legal in year_3_semester_a (listed FIRST)
    // and year_3_semester_b; it moves to the EMPTIER B, not kept in the first-listed A.
    expect(r.heatSem).toBe('year_3_semester_b');
    // No semester in the applied plan silently exceeds the user max.
    expect(r.maxLoad).toBeLessThanOrEqual(25);
    // Consistency invariant: if the applied plan DID exceed the cap anywhere, the
    // summary must say so (never a silent overload).
    if (r.overCap.length) expect(r.warnsMentionOverCap).toBe(true);
  });
});

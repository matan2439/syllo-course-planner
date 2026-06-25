/**
 * plan_reliability_matrix.test.js
 *
 * Regression-locking invariants for the planner message/validation pipeline.
 * The headline production report (תרמודינמיקה (2) shown as "שובצו" although
 * hard-avoided) was re-verified on LIVE production and does NOT reproduce on
 * 90711e4 — thermo is excluded from the draft and the message. Per the agreed
 * plan, that invariant is LOCKED here with end-to-end tests (not a speculative
 * code fix), alongside the summary-integrity invariant, so the regression
 * cannot silently return through the LLM-accepted success path or the
 * deterministic-replacement rescue path.
 *
 * Drives the real requestPlanProposal end-to-end with a stubbed AI endpoint.
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const THERMO = '0542-4120'; // תרמודינמיקה (2)

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
      return Promise.resolve({ ok: true, json: () => Promise.resolve(aiResponseFn(window)) });
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

async function runRebuild(window, prefsJson) {
  window.eval(`
    window.__done = false;
    (async function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted:['0542-4220','0542-4223'], unwanted:['${THERMO}'], strongUnwanted:['${THERMO}'], shaarRuachAssessmentPref:'prefer_no_exam', _initialized:true };
      try { await requestPlanProposal(${prefsJson}, 'full_plan'); } catch(e){ window.__err = String(e); }
      window.__done = true;
    })();
  `);
  for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); if (window.eval('window.__done === true')) break; }
}

const PREFS = JSON.stringify({
  action_type: 'full_plan',
  extra_request_he: 'דגש על חוזק ותכן ומעבר חום, שער רוח בלי בחינה מסכמת',
  wanted_course_ids: ['0542-4220', '0542-4223'],
  must_include_course_ids: ['0542-4220', '0542-4223'],
  strongly_avoided_course_ids: [THERMO],
  unwanted_course_ids: [THERMO],
  max_weekly_hours: 25,
});

describe('planner reliability matrix — hard-avoid + summary integrity', () => {
  let dom, window;
  afterEach(() => { if (dom) dom.window.close(); });

  test('a hard-avoided course injected by the LLM proposal never appears in the draft or the "שובצו"/"נוספו" summary', async () => {
    // LLM ignores hard-avoid: returns the committed board + thermo + a heat-transfer course.
    ({ dom, window } = createPageSetup((win) => {
      const sems = JSON.parse(win.eval('JSON.stringify(SEMESTERS.map(s=>({semester_id:s.id, course_ids:[...(state.semesters[s.id]||[])]})))'));
      const ya = sems.find(s => s.semester_id === 'year_4_semester_a');
      if (ya) ya.course_ids.push(THERMO, '0542-4123');
      return { semesters: sems, warnings_he: [] };
    }));
    await waitForInit(window);
    await runRebuild(window, PREFS);

    const r = JSON.parse(window.eval(`(function(){
      const draftActive = !!(state.proposalDraft && state.proposalDraft.semesters);
      const sems = draftActive ? state.proposalDraft.semesters : state.semesters;
      const allIds = Object.values(sems).flat();
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const joined = msgs.join('\\n');
      // Lines that claim placement ("נוספו" / "שובצו").
      const placedLines = joined.split('\\n').filter(l => l.includes('נוספו') || l.includes('שובצו'));
      return JSON.stringify({ thermoInDraft: allIds.includes('${THERMO}'), placedLinesJoined: placedLines.join(' || ') });
    })()`));
    expect(r.thermoInDraft).toBe(false);
    // The hard-avoided course name must not appear in any placement-claiming line.
    expect(r.placedLinesJoined).not.toContain('תרמודינמיקה (2)');
  });

  test('summary integrity: every course named as placed ("נוספו") in the success summary exists in the final draft', async () => {
    // LLM returns a gate-valid complete-ish proposal (committed board + a couple legal electives).
    ({ dom, window } = createPageSetup((win) => {
      const sems = JSON.parse(win.eval('JSON.stringify(SEMESTERS.map(s=>({semester_id:s.id, course_ids:[...(state.semesters[s.id]||[])]})))'));
      const yb = sems.find(s => s.semester_id === 'year_3_semester_b');
      if (yb) yb.course_ids.push('0542-4220', '0542-4223');
      return { semesters: sems, warnings_he: [] };
    }));
    await waitForInit(window);
    await runRebuild(window, PREFS);

    const r = JSON.parse(window.eval(`(function(){
      const draftActive = !!(state.proposalDraft && state.proposalDraft.semesters);
      const sems = draftActive ? state.proposalDraft.semesters : state.semesters;
      const draftIds = new Set(Object.values(sems).flat());
      // Map every course name_he -> id once, to resolve names mentioned in the summary.
      const nameToId = {};
      for (const c of Object.values(courseMap)) if (c && c.name_he) nameToId[c.name_he] = c.course_id;
      const msgs = (_aiChatMessages||[]).map(mm => mm.text || '');
      const joined = msgs.join('\\n');
      // Find every known course name mentioned right after a "נוספו" placement claim,
      // and check it's actually in the draft. (Conservative: scan all names present in
      // any placement-claiming line.)
      const placedLines = joined.split('\\n').filter(l => l.includes('נוספו') || l.includes('שובצו'));
      const placedText = placedLines.join(' ');
      const claimedButMissing = [];
      for (const [name, id] of Object.entries(nameToId)) {
        if (name.length >= 5 && placedText.includes(name) && !draftIds.has(id)) claimedButMissing.push(name);
      }
      return JSON.stringify({ claimedButMissing });
    })()`));
    expect(r.claimedButMissing).toEqual([]);
  });
});

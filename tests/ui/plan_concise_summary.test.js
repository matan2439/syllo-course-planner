/**
 * plan_concise_summary.test.js
 *
 * Part B (summary quality) + Part A reporting requirements.
 *
 * Root cause of the long/duplicated summary: postPlanChangeSummary concatenated
 * the placement diff + "נותרו חסמים" blockers + EVERY proposal warning verbatim,
 * so the overload was stated twice (once as a blocker, once as a warning), the 3
 * separate "שער רוח … מידע חסר" lines were each appended, and there was no status
 * line, no section structure, and no actionable-options section.
 *
 * Fix: a single PURE formatter, buildConcisePlanSummaryLines(parts), produces the
 * required scannable structure — a status line, then ≤4-bullet sections
 * (מה השתנה / למה זה עדיין לא מושלם / החלטות שנדרשות ממך) and a compact
 * פרטים נוספים tail. Both summary paths (postPlanChangeSummary and the
 * deterministic formatFull185SummaryLocal) feed it, so neither can regress to a
 * wall of duplicated text.
 *
 * Part A finding locked here: in the ME-2027 catalog, מעבר חם (heat transfer,
 * 0542-3620) has exactly ONE legal semester (year_3_semester_a), so it is NOT a
 * movable course — the 26 ש״ש peak is structurally irreducible, and the summary
 * must say so with a concrete reason rather than pretend it can be balanced away.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const BOARD_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'parsed_json', 'mechanical_semester_board_2027.json');

const HEAT = '0542-3620'; // מעבר חם — single legal semester (year_3_semester_a)

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

describe('buildConcisePlanSummaryLines — pure structured formatter', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('full legal plan → ✅ status line, no partial/incomplete wording', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'full', total: 185, required: 185, missing: 0,
      changed: { added: ['א','ב'], removed: [], moved: [] },
      notPerfect: [], decisions: [], details: [],
    })`);
    expect(out).toContain('✅');
    expect(out).toContain('185/185');
    expect(out).not.toContain('טיוטה חלקית');
    expect(out).not.toContain('עדכנתי את המערכת');
  });

  test('183/185 → ⚠️ partial status line with exact missing hours, never ✅/complete', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'partial', total: 183, required: 185, missing: 2,
      changed: { added: ['א'], removed: [], moved: [] },
      notPerfect: ['חסרות 2 ש״ש'], decisions: ['להעלות את מקסימום העומס'], details: [],
    })`);
    expect(out).toContain('⚠️');
    expect(out).toContain('183/185');
    expect(out).toContain('חסרות 2');
    expect(out).not.toContain('✅');
    expect(out).not.toContain('מערכת תקינה');
    // Must NOT claim it added courses to COMPLETE the degree when it didn't reach 185.
    expect(out).not.toContain('נוספו קורסים כדי להשלים');
  });

  test('no legal plan → ❌ status line', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'none', total: 0, required: 185, missing: 185,
      changed: { added: [], removed: [], moved: [] }, notPerfect: [], decisions: [], details: [],
    })`);
    expect(out).toContain('❌');
    expect(out).toContain('אין מערכת חוקית');
  });

  test('each main section is capped at 4 bullets', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'partial', total: 180, required: 185, missing: 5,
      changed: { added: ['א','ב','ג','ד','ה','ו'], removed: [], moved: [] },
      notPerfect: ['n1','n2','n3','n4','n5','n6'],
      decisions: ['d1','d2','d3','d4','d5'],
      details: [],
    })`);
    // Count bullet lines under each section by splitting on the section headers.
    const bulletCount = (section) => {
      const body = out.split(section)[1] || '';
      const lines = body.split('\n').slice(1); // lines after the header
      let n = 0;
      for (const ln of lines) { if (ln.trim().startsWith('•')) n++; else if (ln.trim()) break; }
      return n;
    };
    expect(bulletCount('מה השתנה')).toBeLessThanOrEqual(4);
    expect(bulletCount('למה זה עדיין לא מושלם')).toBeLessThanOrEqual(4);
    expect(bulletCount('החלטות שנדרשות ממך')).toBeLessThanOrEqual(4);
  });

  test('duplicate bullets within a section are de-duplicated', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'partial', total: 183, required: 185, missing: 2,
      changed: { added: [], removed: [], moved: [] },
      notPerfect: ['שנה ג׳ — סמסטר א׳ עמוס: 26/25', 'שנה ג׳ — סמסטר א׳ עמוס: 26/25'],
      decisions: [], details: [],
    })`);
    const occurrences = (out.match(/עמוס: 26\/25/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('empty sections are omitted entirely (a clean full plan is just the status line)', () => {
    const out = window.eval(`buildConcisePlanSummaryLines({
      status: 'full', total: 185, required: 185, missing: 0,
      changed: { added: [], removed: [], moved: [] }, notPerfect: [], decisions: [], details: [],
    })`);
    expect(out).not.toContain('למה זה עדיין לא מושלם');
    expect(out).not.toContain('החלטות שנדרשות ממך');
    expect(out).not.toContain('פרטים נוספים');
  });
});

describe('postPlanChangeSummary — concise, de-duplicated integration', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('a built plan posts ONE structured message with a status line and no duplicated overload paragraph', () => {
    const r = JSON.parse(window.eval(`(function(){
      degreeHoursProfile = { completed_degree_hours: 128.5 };
      _aiPickerState = { wanted: ['0542-4220','0542-4223'], unwanted: ['0542-4120'], strongUnwanted: [], shaarRuachAssessmentPref: 'prefer_no_exam', _initialized: true };
      const p = sidebarQuickActionPrefs(); p.max_weekly_hours = 25; _aiPlanLastPreferences = p; _aiUserIntentProfile = null;
      state.proposalDraft = null;
      _aiChatMessages = [];
      const before = { semesters: mapToProposalSemesters(state.semesters) };
      const plan = rebuildDraftFromProfileLocal({ fillToTarget: true });
      const after = { semesters: mapToProposalSemesters(state.proposalDraft.semesters) };
      _aiPlanLastProposal = plan.proposal;
      postPlanChangeSummary(before, after, p);
      const msgs = _aiChatMessages.filter(m => m.role === 'assistant');
      const last = msgs[msgs.length - 1].text;
      // Count distinct overload mentions (semester over the user cap) — must be 1.
      const overloadMentions = (last.match(/26\\/25|מעל המקסימום|עמוס/g) || []).length;
      // Count שער-רוח "unknown exam" mentions — must be collapsed to at most 1.
      const shaarUnknown = (last.match(/מידע חסר/g) || []).length;
      return JSON.stringify({
        last,
        hasStatusLine: /✅|⚠️|❌/.test(last),
        notAWall: last.split('\\n').length < 18,
        noOldOpener: !last.includes('עדכנתי את המערכת'),
        overloadMentions, shaarUnknown,
      });
    })()`));
    expect(r.hasStatusLine).toBe(true);
    expect(r.noOldOpener).toBe(true);
    expect(r.notAWall).toBe(true);
    expect(r.shaarUnknown).toBeLessThanOrEqual(1);
  });
});

describe('Part A — load reduction is correct, and the irreducible case is explained', () => {
  let dom, window;
  beforeAll(async () => { dom = loadPage(); window = dom.window; await waitForInit(window); });
  afterAll(() => dom.window.close());

  test('positive: repairPlanLoad MOVES a genuinely movable course out of an over-cap semester', () => {
    const r = JSON.parse(window.eval(`(function(){
      // Synthetic elective with TWO legal semesters, parked in an over-cap semester.
      const FAKE = 'TEST-MOVABLE-1';
      courseMap[FAKE] = { course_id: FAKE, name_he: 'בחירה ניידת', weekly_hours: 4, course_type: 'elective',
        effective_allowed_semesters: ['year_3_semester_a','year_4_semester_b'], allowed_semesters: ['year_3_semester_a','year_4_semester_b'] };
      const ctx = buildPlanValidationInputs();
      ctx.courses[FAKE] = { hours: 4, effective_allowed_semesters: ['year_3_semester_a','year_4_semester_b'], course_type: 'elective', name_he: 'בחירה ניידת' };
      ctx.maxHoursPerSemester = 25;
      // year_3_semester_a fixed-mandatory load is already high; add the fake to push it over 25.
      const proposal = { semesters: mapToProposalSemesters(state.semesters) };
      const a = proposal.semesters.find(s => s.semester_id === 'year_3_semester_a');
      a.course_ids = [...a.course_ids, FAKE];
      const beforeSem = 'year_3_semester_a';
      const res = repairPlanLoad(proposal, ctx);
      const afterSem = res.proposal.semesters.find(s => (s.course_ids||[]).includes(FAKE)).semester_id;
      return JSON.stringify({ beforeSem, afterSem, moved: beforeSem !== afterSem });
    })()`));
    expect(r.moved).toBe(true);
  });

  test('negative: מעבר חם has one legal semester, is NOT moved, and the overload note states the concrete reason', () => {
    const r = JSON.parse(window.eval(`(function(){
      const ctx = buildPlanValidationInputs();
      ctx.maxHoursPerSemester = 25;
      const proposal = { semesters: mapToProposalSemesters(state.semesters) };
      const res = repairPlanLoad(proposal, ctx);
      const heatSemBefore = proposal.semesters.find(s => (s.course_ids||[]).includes('${HEAT}'))?.semester_id;
      const heatSemAfter = res.proposal.semesters.find(s => (s.course_ids||[]).includes('${HEAT}'))?.semester_id;
      const over = (res.unmovedOverloaded || []).find(o => o.semester_id === 'year_3_semester_a');
      const heatReason = over && (over.not_movable_reasons || []).find(x => x.course_id === '${HEAT}');
      return JSON.stringify({
        heatLegalSemesters: (courseMap['${HEAT}'].effective_allowed_semesters || []),
        heatMoved: heatSemBefore !== heatSemAfter,
        heatReason: heatReason ? heatReason.reason : null,
        overReported: !!over,
      });
    })()`));
    expect(r.heatLegalSemesters).toEqual(['year_3_semester_a']);
    expect(r.heatMoved).toBe(false);
    expect(r.overReported).toBe(true);
    expect(r.heatReason).toBe('no_legal_target');
  });
});

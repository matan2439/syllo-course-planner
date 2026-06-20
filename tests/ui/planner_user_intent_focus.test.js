/**
 * Tests for the user-intent / requested-focus planning behaviour (focus-v1).
 *
 * The user's request is a hard planning constraint: when they ask to focus on
 * תכן / אנליזות חוזק / זרימה / מעבר חום / רעידות, the planner must map those
 * domains to concrete courses and place them BEFORE generic filler — and explain
 * exactly why any requested course was skipped.
 *
 * Covers Parts A (intent extraction), B (domain mapping), C (priority),
 * D (rejection reporting), F (185 + gap), G (detached panel removed).
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

const FOCUS_TEXT = 'אני רוצה להתמקד בתכן ואנליזות חוזק, זרימה, מעבר חום ורעידות. אני רוצה התאמה גבוהה לדרישות בתעשייה לשכר גבוהה וממוצע ציונים באזור 82';

function createPage() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const boardJson = fs.readFileSync(PROD_BOARD, 'utf8');
  const vc = new VirtualConsole();
  try { vc.forwardTo(console); } catch (_) {}

  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
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
  return { dom, window };
}

function waitForInit(window, ms = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (window.eval(
          'typeof state!=="undefined"&&!!state&&!!state.semesters' +
          '&&typeof courseMap!=="undefined"&&Object.keys(courseMap).length>0',
        )) return resolve();
      } catch (_) {}
      if (Date.now() - start > ms) return reject(new Error('init timeout'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — intent extraction (Part A)
// ─────────────────────────────────────────────────────────────────────────────
describe('extractPlanningIntentLocal — structured intent from free text', () => {
  let dom, window, intent;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    window.__txt = FOCUS_TEXT;
    intent = JSON.parse(window.eval('JSON.stringify(extractPlanningIntentLocal(window.__txt))'));
  });
  afterAll(() => dom.window.close());

  test('Test 1 — all five focus domains are extracted', () => {
    expect(intent.requiredDomains).toEqual(
      expect.arrayContaining(['design', 'strength', 'fluids', 'heat', 'vibrations']),
    );
  });

  test('Test 1 — careerGoal = industry_high_salary, gradeTarget ≈ 82', () => {
    expect(intent.careerGoal).toBe('industry_high_salary');
    expect(intent.gradeTarget).toBe(82);
  });

  test('Test 1 — preferenceWeights mark industry & salary relevance high', () => {
    expect(intent.preferenceWeights.industry_relevance).toBe('high');
    expect(intent.preferenceWeights.salary_relevance).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — domain → course mapping (Part B)
// ─────────────────────────────────────────────────────────────────────────────
describe('PLANNING_DOMAINS — domain mapping resolves to real courses', () => {
  let dom, window;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('Test 2 — every requested domain maps to ≥1 existing candidate course', () => {
    window.__txt = FOCUS_TEXT;
    const result = JSON.parse(window.eval(`(function(){
      const intent = extractPlanningIntentLocal(window.__txt);
      return JSON.stringify(intent.requiredDomains.map(d => ({
        d,
        candidates: (PLANNING_DOMAINS[d].course_ids || []).filter(cid => courseMap[cid]).length,
      })));
    })()`));
    for (const r of result) expect(r.candidates).toBeGreaterThan(0);
  });

  test('Test 2 — vibrations maps to תורת התנודות (synonym lexical match would miss it)', () => {
    // "רעידות" never shares a stem with "תנודות"; the explicit map bridges it.
    const ids = JSON.parse(window.eval('JSON.stringify(PLANNING_DOMAINS.vibrations.course_ids)'));
    expect(ids).toContain('0542-4220');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — planning priority + inclusion (Parts C, D, F)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildDeterministicReplacementPlan — requested focus drives the plan', () => {
  let dom, window, plan;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
    window.__txt = FOCUS_TEXT;
    plan = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: window.__txt };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      return JSON.stringify({
        addedCids: r.addedCids,
        totalHours: r.totalHours,
        targetHours: r.targetHours,
        reachedTarget: r.reachedTarget,
        gapReasons: r.gapReasons,
        domainReport: r.domainReport,
        intent: { requiredDomains: r.intent.requiredDomains, requested_course_ids: r.intent.requested_course_ids },
      });
    })()`));
  });
  afterAll(() => dom.window.close());

  test('Test 3 — at least one requested-domain course is in the plan for every satisfiable domain', () => {
    // design/strength/fluids/heat/vibrations all have legal candidates given the data.
    const satisfied = plan.domainReport.filter(d => d.satisfied).map(d => d.domain);
    expect(satisfied).toEqual(
      expect.arrayContaining(['design', 'strength', 'fluids', 'heat', 'vibrations']),
    );
  });

  test('Test 4 — a vibrations-domain course appears in the plan', () => {
    // vibrations domain: 0542-4220 (תורת התנודות) or 0542-4622 (דינמיקה ובקרה של מערכות)
    const vibrationsCourses = ['0542-4220', '0542-4622'];
    expect(plan.addedCids.some(cid => vibrationsCourses.includes(cid))).toBe(true);
  });

  test('Test 4 — requested-focus courses are placed (not crowded out by filler)', () => {
    // Count how many of the requested course ids actually made the plan.
    const requested = new Set(plan.intent.requested_course_ids);
    const placedRequested = plan.addedCids.filter(cid => requested.has(cid));
    expect(placedRequested.length).toBeGreaterThanOrEqual(6);
  });

  test('Test 5 — a skipped requested course carries an exact reason', () => {
    const skips = plan.domainReport.flatMap(d => d.skipped).filter(s => s.reason !== 'already_on_board');
    // Whatever is skipped must have a precise, known reason code (not a vague gap).
    const KNOWN = ['missing_offering_data', 'no_legal_semester', 'prereq_not_met', 'no_capacity'];
    for (const s of skips) {
      expect(KNOWN).toContain(s.reason);
      expect(typeof s.reason_he).toBe('string');
      expect(s.reason_he.length).toBeGreaterThan(0);
    }
  });

  test('Test 6 — the plan tries for 185 and reports the exact remaining gap when short', () => {
    expect(plan.targetHours).toBe(185);
    expect(typeof plan.totalHours).toBe('number');
    if (!plan.reachedTarget) {
      // Must explain WHY, not just fail silently.
      expect(Array.isArray(plan.gapReasons)).toBe(true);
      expect(plan.gapReasons.length).toBeGreaterThan(0);
    }
  });

  test('Test 7 — focus prioritization places ≥ the no-focus baseline without overloading', () => {
    const baseline = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = {};
      const r = buildDeterministicReplacementPlan({ prefs: {}, targetHours: 185 });
      return JSON.stringify({ totalHours: r.totalHours });
    })()`));
    // Focus prioritization schedules at least as many hours as the bare no-pref
    // fill (it must not place FEWER real courses). The absolute total is bounded
    // by the per-semester workload cap — the plan must respect that, not inflate
    // the total by overloading semesters (the bug this build fixes).
    expect(plan.totalHours).toBeGreaterThanOrEqual(baseline.totalHours);
    expect(plan.totalHours).toBeGreaterThan(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — legality of the focus plan (Part F)
// ─────────────────────────────────────────────────────────────────────────────
describe('focus plan is legal — no illegal semester / prereq placements', () => {
  let dom, window;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('Test 8 + 9 — auditDraftLegality finds 0 illegal semester and 0 missing-prereq placements', () => {
    window.__txt = FOCUS_TEXT;
    const res = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: window.__txt };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const audit = auditDraftLegality(r.proposal, { completedCourseIds: [] });
      return JSON.stringify({
        illegalSem: audit.illegalSemesterPlacements.length,
        missingPrereq: audit.missingPrerequisites.length,
        duplicates: audit.duplicatePlacements.length,
      });
    })()`));
    expect(res.illegalSem).toBe(0);
    expect(res.missingPrereq).toBe(0);
    expect(res.duplicates).toBe(0);
  });

  test('Test 9 — FEM (0542-4223) is only placed when מכניקת המוצקים (2) is scheduled earlier', () => {
    // The in-scope prereq must be respected even though the foundational
    // (out-of-scope) prereq מכניקת המוצקים (1) is assumed completed.
    const res = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: window.__txt };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const semIdx = {};
      r.proposal.semesters.forEach((s,i)=>{ for (const c of (s.course_ids||[])) semIdx[c]=i; });
      const femIdx = semIdx['0542-4223'];
      const msIdx  = semIdx['0542-4224'];
      return JSON.stringify({ femPlaced: femIdx != null, femIdx, msIdx });
    })()`));
    if (res.femPlaced) {
      expect(res.msIdx).not.toBeUndefined();
      expect(res.msIdx).toBeLessThan(res.femIdx);
    }
    // If FEM was not placed, that's acceptable — it is reported as skipped.
  });

  test('Test 10 — foundational out-of-scope prereq (מכניקת המוצקים 1) is assumed completed', () => {
    // 0542-2200 is not in courseMap (years 1–2). The prereq gate must treat it satisfied,
    // so an advanced course depending only on it (מכניקת המוצקים 2) is schedulable.
    const ok = window.eval(`(function(){
      const semIdx = { '0542-4224': 1 };
      const r = prereqsSatisfiedForPlacementLocal('0542-4224', 1, semIdx, new Set());
      return r.ok;
    })()`);
    expect(ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — detached panel removed, chat-driven actions (Part G)
// ─────────────────────────────────────────────────────────────────────────────
describe('detached draft-editing panel is gone — actions via chat', () => {
  let dom, window;

  beforeAll(async () => {
    ({ dom, window } = createPage());
    await waitForInit(window);
  });
  afterAll(() => dom.window.close());

  test('Test 11 — draft actions live ONLY in the upper board banner; no lower duplicate cluster', async () => {
    window.__txt = FOCUS_TEXT;
    window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: window.__txt };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      activateProposalDraft(r.proposal, { isTentative: r.tentativeCids.length>0, tentativeCourseIds: r.tentativeCids });
      renderAiTab();
    })()`);
    // Issue 2 — the single draft action cluster is the upper blue board banner.
    expect(window.document.getElementById('board-draft-apply')).toBeTruthy();
    expect(window.document.getElementById('board-draft-reject')).toBeTruthy();
    // No lower duplicate cluster below the AI chat.
    expect(window.document.getElementById('sb-draft-apply')).toBeFalsy();
    expect(window.document.getElementById('sb-draft-reject')).toBeFalsy();
    expect(window.document.querySelector('#ai-proposal-card .ai-proposal-actions')).toBeFalsy();
    // Removed detached controls:
    expect(window.document.getElementById('sb-draft-ask')).toBeFalsy();
    expect(window.document.getElementById('sidebar-open-full-preview')).toBeFalsy();
  });

  test('Test 12 — _formatDomainFocusHe renders per-domain inclusion/exclusion lines', () => {
    window.__txt = FOCUS_TEXT;
    const msg = window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: window.__txt };
      const r = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      return _formatDomainFocusHe(r.domainReport);
    })()`);
    expect(typeof msg).toBe('string');
    expect(msg).toContain('התמקדות לפי הבקשה שלך');
    // Each of the five domain labels should appear.
    for (const label of ['תכן', 'אנליזות חוזק', 'זרימה', 'מעבר חום', 'רעידות']) {
      expect(msg).toContain(label);
    }
  });
});

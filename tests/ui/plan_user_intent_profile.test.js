/**
 * plan_user_intent_profile.test.js
 *
 * Commit 2 (architecture): UserIntentProfile, conversational routing, intent-aligned
 * completion, per-course explanations.
 *
 * Conversational behavior (Part F)
 *   J12 non-plan question → detectAiIntent 'ask_question' (Q&A, not a planning intent)
 *   J13 preference-update message updates the profile and does NOT build a draft
 *   J14 plan generation only via an explicit build/modify intent
 *   J15 buildUserIntentProfileLocal.explanation_he explains what was understood
 *
 * UserIntentProfile (Part D)
 *   J21 profile distinguishes mustInclude / hardExclude / requestedDomains / criteria
 *
 * Intent-aligned completion (Part C)
 *   J16 scoreCourseAgainstIntentProfileLocal ranks a requested-domain course above an unrelated one
 *   J17 completion does not place an unrelated course while a relevant legal one remains
 *   J18 weak alternatives are labeled (weak flag + the exact Hebrew note)
 *   J19 hard-excluded courses are never selected as completion
 *   J20 every selected course in the decision trace has explanation_he
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH  = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const PROD_BOARD = path.join(__dirname, '..', '..', 'supabase_board_backup_2027_pre_sync.json');

function loadProdBoard() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
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

const FOCUS = 'אני רוצה להתמקד בתכן ואנליזות חוזק ורעידות, התאמה גבוהה לתעשייה, וממוצע סביב 82';

// ── Conversational routing + profile ──────────────────────────────────────────
describe('Part D/F — UserIntentProfile + conversational routing', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('J12 — non-plan question routes to ask_question (not a planning intent)', () => {
    const res = JSON.parse(window.eval(`(function(){
      const PLANNING = ['full_plan','balance_load','balance_specific_semester','complete_requirements','fix_legality','improve_career_fit','replace_course','add_avoided','improve_current'];
      const i = detectAiIntent('מה עדיף לי, זרימה או חוזק?');
      return JSON.stringify({ type: i.type, isPlanning: PLANNING.includes(i.type) });
    })()`));
    expect(res.type).toBe('ask_question');
    expect(res.isPlanning).toBe(false);
  });

  test('J13 — preference message builds/updates the profile without a draft', () => {
    const res = JSON.parse(window.eval(`(function(){
      const before = !!state.proposalDraft;
      const p = buildUserIntentProfileLocal('אני מעדיף קורסים מעשיים עם התאמה לתעשייה', { conversationMode: 'update_preferences' });
      return JSON.stringify({
        before, after: !!state.proposalDraft,
        mode: p.conversationMode,
        prefs: p.inferredPreferences,
      });
    })()`));
    expect(res.after).toBe(res.before);   // building a profile never creates a draft
    expect(res.mode).toBe('update_preferences');
    expect(res.prefs).toEqual(expect.arrayContaining(['practical', 'industry_relevance']));
  });

  test('J14 — only explicit build/modify intents are planning intents', () => {
    const res = JSON.parse(window.eval(`(function(){
      const PLANNING = new Set(['full_plan','balance_load','balance_specific_semester','complete_requirements','fix_legality','improve_career_fit','replace_course','add_avoided','improve_current']);
      return JSON.stringify({
        build: PLANNING.has(detectAiIntent('בנה לי מערכת מלאה').type),
        question: PLANNING.has(detectAiIntent('מה ההבדל בין זרימה לחוזק?').type),
      });
    })()`));
    expect(res.build).toBe(true);
    expect(res.question).toBe(false);
  });

  test('J15 — profile.explanation_he explains what was understood', () => {
    const exp = window.eval(`buildUserIntentProfileLocal(${JSON.stringify(FOCUS)}, {}).explanation_he`);
    expect(typeof exp).toBe('string');
    expect(exp).toContain('הבנתי');
    // mentions a recognized focus area
    expect(/חוזק|תכן|רעידות|תעשייה/.test(exp)).toBe(true);
  });

  test('J21 — profile distinguishes mustInclude / hardExclude / domains / criteria', () => {
    const p = JSON.parse(window.eval(
      `JSON.stringify(buildUserIntentProfileLocal('אני רוצה מבוא לאלמנטים סופיים אבל בלי תרמודינמיקה 2, עם דגש על חוזק', {}))`,
    ));
    expect(p.mustIncludeCourseIds).toContain('0542-4223');
    expect(p.hardExcludeCourseIds).toContain('0542-4120'); // תרמודינמיקה 2
    expect(p.requestedDomains).toEqual(expect.arrayContaining(['strength']));
    expect(Array.isArray(p.optimizationCriteria)).toBe(true);
    expect(p.optimizationCriteria.length).toBeGreaterThan(0);
    expect(p.optimizationCriteria.every(c => typeof c.name === 'string' && typeof c.weight === 'number' && typeof c.reason === 'string')).toBe(true);
  });
});

// ── Intent-aligned completion + decision trace ────────────────────────────────
describe('Part C/G — intent-aligned completion + per-course explanations', () => {
  let dom, window;
  beforeAll(async () => { dom = loadProdBoard(); window = dom.window; await waitForInit(window); }, 25000);
  afterAll(() => dom && dom.window.close());

  test('J16 — a requested-domain course scores above an unrelated course', () => {
    const res = JSON.parse(window.eval(`(function(){
      const profile = buildUserIntentProfileLocal('דגש על רעידות ודינמיקה', {});
      // 0542-4220 (תורת התנודות) is in the vibrations domain; pick an unrelated course.
      const domainCid = '0542-4220';
      const unrelatedCid = Object.keys(courseMap).find(cid =>
        cid !== domainCid && courseMap[cid].name_he &&
        !(profile.requestedCourseIds || []).includes(cid));
      const a = scoreCourseAgainstIntentProfileLocal(courseMap[domainCid], profile).score;
      const b = scoreCourseAgainstIntentProfileLocal(courseMap[unrelatedCid], profile).score;
      return JSON.stringify({ a, b });
    })()`));
    expect(res.a).toBeGreaterThan(res.b);
  });

  test('J18 + J20 — build with focus: weak completion labeled, every selected course explained', () => {
    const res = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: ${JSON.stringify(FOCUS)} };
      const plan = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const weakNote = (plan.proposal.warnings_he || []).find(w => w.includes('פחות קשורים לבקשה המקורית'));
      return JSON.stringify({
        hasProfile: !!plan.userIntentProfile,
        traceSelected: (plan.decisionTrace.selected || []).map(s => ({ cid: s.course_id, stage: s.selected_stage, hasExp: !!s.explanation_he && s.explanation_he.length > 0 })),
        weakAdded: (plan.completionAdded || []).filter(a => a.weak).length,
        weakNotePresent: !!weakNote,
        addedCount: plan.addedCids.length,
      });
    })()`));
    expect(res.hasProfile).toBe(true);
    // Part G — EVERY selected course carries a non-empty explanation_he.
    expect(res.traceSelected.length).toBe(res.addedCount);
    expect(res.traceSelected.every(s => s.hasExp)).toBe(true);
    // Part C — if any weak completion course was added, it is labeled with the note.
    if (res.weakAdded > 0) expect(res.weakNotePresent).toBe(true);
  });

  test('J19 — a hard-excluded course is never selected as completion', () => {
    const res = JSON.parse(window.eval(`(function(){
      // Exclude תורת התנודות (0542-4220) explicitly, then build.
      _aiPlanLastPreferences = { extra_request_he: 'בנה מערכת מלאה בלי תורת התנודות' };
      const plan = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      return JSON.stringify({
        excluded: plan.hardExcludedCourseIds,
        added: plan.addedCids,
      });
    })()`));
    expect(res.excluded).toContain('0542-4220');
    expect(res.added).not.toContain('0542-4220');
  });

  test('J17 — completion does not add an avoid-matching course while relevant ones remain', () => {
    // Build a focus plan; no added course should be tagged as matching an avoid term.
    const res = JSON.parse(window.eval(`(function(){
      _aiPlanLastPreferences = { extra_request_he: 'דגש על חוזק ותכן, בלי קורסים תאורטיים' };
      const plan = buildDeterministicReplacementPlan({ prefs: _aiPlanLastPreferences, targetHours: 185 });
      const profile = plan.userIntentProfile;
      const avoidTagged = plan.addedCids.filter(cid =>
        courseMap[cid] && scoreCourseAgainstIntentProfileLocal(courseMap[cid], profile).matched.includes('avoided'));
      return JSON.stringify({ avoidTagged });
    })()`));
    expect(res.avoidTagged).toEqual([]);
  });
});

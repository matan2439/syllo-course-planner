/**
 * plan_agent_clarification_form.test.js
 *
 * Clarification ANSWER-LOOP UI slice — when the Academic Decision Agent returns
 * needsClarification, the legacy planner renders a Hebrew RTL answer FORM (not
 * just a passive question list), the user's answers are collected into the
 * existing {questionId, value} clarification_answers shape, and the resume
 * request re-sends use_academic_decision_agent:true + the same
 * academic_interest_profile alongside the answers.
 *
 * Pure, hoisted helpers carry the testable logic (mirroring the
 * interest-evaluation / agent-decision slices) so they run without the ~20s
 * board init:
 *   - clarificationFormHtml(clarification)      → Hebrew RTL form or ''
 *   - collectClarificationAnswers(rootEl)       → [{questionId, value}]
 *   - clarificationAnswersRequestField(answers) → {clarification_answers} | {}
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function loadPlannerGlobals() {
  let h = fs.readFileSync(HTML_PATH, 'utf8');
  const m = h.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No inline <script> found');
  const src = m[1];
  h = h.replace(m[0], '');

  const vc = new VirtualConsole();
  const dom = new JSDOM(h, {
    url: 'http://localhost/app/web/semester_board_viewer.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('tau_program', 'mechanical_engineering_2027');
  window.confirm = () => false;
  window.alert = () => {};
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/board') || u.includes('semester_board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.reject(new Error('network-stub: ' + u));
  };
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.body.appendChild(s);
  return { dom, window };
}

function ev(window, expr) {
  return JSON.parse(window.eval(`JSON.stringify(${expr})`));
}

let dom, window;
beforeAll(() => { ({ dom, window } = loadPlannerGlobals()); });
afterAll(() => { try { dom.window.close(); } catch (_) {} });

const CLARIFICATION = {
  needsClarification: true,
  missingInputs: [
    { field: 'completedCourses', critical: true, message: 'x' },
    { field: 'excludedCourses', critical: true, message: 'x' },
    { field: 'maxWeeklyHours', critical: false, message: 'x' },
    { field: 'track', critical: false, message: 'x' },
    { field: 'academicFocusAreas', critical: false, message: 'x' },
  ],
  questions: [
    { id: 'completed_courses', inputKey: 'completedCourseIds', required: true, critical: true, answerType: 'course_id_list', question: 'Which courses have you already completed?' },
    { id: 'excluded_courses', inputKey: 'excludedCourseIds', required: true, critical: true, answerType: 'course_id_list', question: 'Are there any courses you want to exclude from your plan?' },
    { id: 'max_weekly_hours', inputKey: 'maxWeeklyHours', required: false, critical: false, answerType: 'number', question: 'What is your maximum weekly course-hour limit?' },
    { id: 'track_or_focus', inputKey: 'track', required: false, critical: false, answerType: 'text', question: 'Which track or focus area are you pursuing?' },
    { id: 'academic_focus_areas', inputKey: 'academicInterestProfile.focusAreas', required: false, critical: false, answerType: 'multi_choice', question: 'Which academic areas are you most interested in focusing on?', options: [{ value: 'finite_elements', label: 'Finite Elements' }, { value: 'thermodynamics', label: 'Thermodynamics' }] },
  ],
};

function formHtml() {
  return window.eval(`clarificationFormHtml(${JSON.stringify(CLARIFICATION)})`);
}

// ── 13. Hebrew labels ─────────────────────────────────────────────────────────
describe('clarificationFormHtml — Hebrew RTL answer form', () => {
  test('13. questions render Hebrew labels (not the raw English prompt as visible text)', () => {
    const out = formHtml();
    expect(out).toContain('אילו קורסים כבר השלמת');            // completed_courses
    expect(out).toContain('להחריג');                          // excluded_courses
    expect(out).toContain('שעות');                            // max_weekly_hours
    expect(out).toContain('dir="rtl"');
  });

  test('14. answer controls render for known question types', () => {
    const out = formHtml();
    // course_id_list → LTR text input
    expect(out).toMatch(/data-question-id="completed_courses"[^>]*data-answer-type="course_id_list"/);
    expect(out).toContain('dir="ltr"');
    // number
    expect(out).toMatch(/type="number"[^>]*data-question-id="max_weekly_hours"|data-question-id="max_weekly_hours"[^>]*type="number"/);
    // multi_choice → a checkbox per option
    expect(out).toMatch(/type="checkbox"[^>]*value="finite_elements"|value="finite_elements"[^>]*type="checkbox"/);
    // a submit control exists
    expect(out).toMatch(/type="submit"/);
  });

  test('20. dynamic clarification text is HTML-escaped, not injected', () => {
    const evil = JSON.parse(JSON.stringify(CLARIFICATION));
    evil.questions[0].question = '<img src=x onerror=alert(1)>';
    const out = window.eval(`clarificationFormHtml(${JSON.stringify(evil)})`);
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  test('renders nothing when there is no pending clarification', () => {
    expect(window.eval(`clarificationFormHtml(null)`)).toBe('');
    expect(window.eval(`clarificationFormHtml({ needsClarification: false, questions: [] })`)).toBe('');
  });
});

// ── 15. Collecting answers into the clarification_answers shape ────────────────
describe('collectClarificationAnswers — reads the form into {questionId, value}', () => {
  function collect(mutate) {
    return ev(window, `(function(){
      var host = document.createElement('div');
      host.innerHTML = clarificationFormHtml(${JSON.stringify(CLARIFICATION)});
      document.body.appendChild(host);
      var form = host.querySelector('.agent-clarify-form') || host;
      (${mutate})(form);
      var out = collectClarificationAnswers(form);
      host.remove();
      return out;
    })()`);
  }

  test('15. text-list, number, text, and multi_choice answers are collected in the shared shape', () => {
    const answers = collect(function (form) {
      form.querySelector('[data-question-id="completed_courses"]').value = '0510.1234, 0512.5678';
      form.querySelector('[data-question-id="max_weekly_hours"]').value = '20';
      form.querySelector('[data-question-id="track_or_focus"]').value = 'design';
      form.querySelector('[data-question-id="academic_focus_areas"][value="finite_elements"]').checked = true;
    });
    const byId = Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
    expect(byId.completed_courses).toEqual(['0510.1234', '0512.5678']);
    expect(byId.max_weekly_hours).toBe(20);
    expect(byId.track_or_focus).toBe('design');
    expect(byId.academic_focus_areas).toEqual(['finite_elements']);
  });

  test('empty course_id_list submits [] (a valid "none" answer), blank number/text are omitted', () => {
    const answers = collect(function () {});
    const byId = Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
    // course_id_list always yields an array (empty = explicit "none")
    expect(byId.excluded_courses).toEqual([]);
    // blank optional number/text/multi are not sent
    expect('max_weekly_hours' in byId).toBe(false);
    expect('track_or_focus' in byId).toBe(false);
    expect('academic_focus_areas' in byId).toBe(false);
  });
});

// ── 16/17. Resume request preserves the agent flag + profile alongside answers ─
describe('resume request composition', () => {
  test('clarificationAnswersRequestField wraps answers, or {} when empty', () => {
    expect(ev(window, `clarificationAnswersRequestField([{questionId:'completed_courses',value:['A']}])`))
      .toEqual({ clarification_answers: [{ questionId: 'completed_courses', value: ['A'] }] });
    expect(ev(window, `clarificationAnswersRequestField([])`)).toEqual({});
    expect(ev(window, `clarificationAnswersRequestField(undefined)`)).toEqual({});
  });

  test('16 + 17. resume body keeps use_academic_decision_agent:true and the profile IDs, plus clarification_answers', () => {
    const body = ev(window, `(function(){
      return Object.assign(
        {},
        buildAgentPlanRequestFields({ focusAreas: ['finite_elements', 'mechanical_design'] }),
        clarificationAnswersRequestField([{ questionId: 'completed_courses', value: ['0510.1234'] }])
      );
    })()`);
    expect(body.use_academic_decision_agent).toBe(true);
    expect(body.academic_interest_profile.focusAreas).toEqual([{ area: 'finite_elements' }, { area: 'mechanical_design' }]);
    expect(body.clarification_answers).toEqual([{ questionId: 'completed_courses', value: ['0510.1234'] }]);
  });
});

// ── 18/21. Full academicDecisionHtml still renders the clarification safely ────
describe('academicDecisionHtml — clarification form integration', () => {
  test('18. a remaining clarification renders the form without crashing', () => {
    const decision = {
      clarification: {
        needsClarification: true,
        missingInputs: [{ field: 'excludedCourses', critical: true, message: 'x' }],
        questions: [{ id: 'excluded_courses', inputKey: 'excludedCourseIds', required: true, critical: true, answerType: 'course_id_list', question: 'Are there any courses you want to exclude from your plan?' }],
      },
      explanation: { mainRecommendation: 'דרוש מידע נוסף.', whyThisPlan: [], risksAndTradeoffs: [], missingData: [], suggestedNextActions: [] },
    };
    const out = window.eval(`academicDecisionHtml(${JSON.stringify(decision)})`);
    expect(out).toContain('שאלות הבהרה');
    expect(out).toContain('agent-clarify-form');
    expect(out).toContain('להחריג');
  });

  test('21. absent academicDecision remains safe (old UI unchanged)', () => {
    expect(window.eval(`academicDecisionHtml(null)`)).toBe('');
    expect(window.eval(`academicDecisionHtml(undefined)`)).toBe('');
  });
});

// ── source wiring guard — requestPlanProposal forwards clarification answers ───
describe('request wiring forwards clarification answers', () => {
  test('requestPlanProposal spreads clarificationAnswersRequestField into the generate-plan body', () => {
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    expect(src).toContain('clarificationAnswersRequestField(');
  });
});

// ── Codex review (PR #46): multi-step resume must not forget an earlier answer ─
// The clarification form only ever renders the CURRENTLY-unresolved questions
// (built from the latest academicDecision.clarification), so a submission only
// ever collects what's on screen right now. Without accumulation, answering
// track_or_focus in one submission and a different question (e.g.
// max_weekly_hours) in a later, separate submission would resend ONLY the
// second answer — silently forgetting the first, since the server has no
// durable session state either.
describe('renderAcademicDecision — clarification form accumulates answers across resumes', () => {
  test('a later submission (answering a different question) still resends an earlier answer', () => {
    const calls = window.eval(`(function(){
      window.__requestPlanProposalCalls = [];
      window.__origRequestPlanProposal = requestPlanProposal;
      requestPlanProposal = function(prefs, actionType, answers) {
        window.__requestPlanProposalCalls.push(answers);
        return Promise.resolve();
      };
      _aiClarificationAnswersSoFar = [];

      // renderAcademicDecision's target container is normally injected by
      // renderAiTab() (not run by this pure-helper test harness) — create it
      // directly, mirroring how the real sidebar template places it.
      if (!document.getElementById('ai-academic-decision')) {
        var container = document.createElement('div');
        container.id = 'ai-academic-decision';
        container.className = 'agent-decision-wrap';
        document.body.appendChild(container);
      }

      // Turn 1: form asks for track_or_focus (and one other, unanswered) question.
      _aiPlanLastAcademicDecision = {
        clarification: {
          needsClarification: true,
          missingInputs: [
            { field: 'track', critical: false, message: 'x' },
            { field: 'maxWeeklyHours', critical: false, message: 'x' },
          ],
          questions: [
            { id: 'track_or_focus', inputKey: 'track', required: false, critical: false, answerType: 'text', question: 'Which track or focus area are you pursuing?' },
            { id: 'max_weekly_hours', inputKey: 'maxWeeklyHours', required: false, critical: false, answerType: 'number', question: 'What is your maximum weekly course-hour limit?' },
          ],
        },
        explanation: { mainRecommendation: 'x', whyThisPlan: [], risksAndTradeoffs: [], missingData: [], suggestedNextActions: [] },
      };
      renderAcademicDecision();
      var form1 = document.getElementById('ai-academic-decision').querySelector('.agent-clarify-form');
      form1.querySelector('[data-question-id="track_or_focus"]').value = 'design';
      form1.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

      // Turn 2: server resolved track_or_focus (no longer asked); user now
      // answers the remaining max_weekly_hours question, in a SEPARATE submission.
      _aiPlanLastAcademicDecision = {
        clarification: {
          needsClarification: true,
          missingInputs: [{ field: 'maxWeeklyHours', critical: false, message: 'x' }],
          questions: [
            { id: 'max_weekly_hours', inputKey: 'maxWeeklyHours', required: false, critical: false, answerType: 'number', question: 'What is your maximum weekly course-hour limit?' },
          ],
        },
        explanation: { mainRecommendation: 'x', whyThisPlan: [], risksAndTradeoffs: [], missingData: [], suggestedNextActions: [] },
      };
      renderAcademicDecision();
      var form2 = document.getElementById('ai-academic-decision').querySelector('.agent-clarify-form');
      form2.querySelector('[data-question-id="max_weekly_hours"]').value = '20';
      form2.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

      var out = window.__requestPlanProposalCalls;
      requestPlanProposal = window.__origRequestPlanProposal;
      return out;
    })()`);
    const parsed = JSON.parse(JSON.stringify(calls));
    expect(parsed).toHaveLength(2);
    const byId1 = Object.fromEntries(parsed[0].map((a) => [a.questionId, a.value]));
    expect(byId1.track_or_focus).toBe('design');

    // The second (separate) submission must still carry the FIRST answer
    // forward, not just the newly-submitted one.
    const byId2 = Object.fromEntries(parsed[1].map((a) => [a.questionId, a.value]));
    expect(byId2.track_or_focus).toBe('design');
    expect(byId2.max_weekly_hours).toBe(20);
  });
});

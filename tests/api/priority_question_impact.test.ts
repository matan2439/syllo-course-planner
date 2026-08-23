/**
 * C5 — the impact-driven PRIORITY clarification.
 *
 * C1–C4 gave the student a bounded set of validated, non-dominated plans and a
 * truthful report that they trade off (`unresolvedTradeoff: true`,
 * `equal_confirmed_preferences`). What is missing is the DECISION: when two
 * confirmed objectives genuinely pull toward different legal plans, the student
 * has no way to say which of them matters more, and therefore no way to move
 * the recommendation. Choosing a card directly is the escape hatch — it is not
 * the same thing, because it expresses nothing durable about what they value
 * and cannot survive a Rebuild.
 *
 * Written RED first. The decisive proof is deliberately BEHAVIOURAL, not a
 * missing export: it walks the REAL typed conversation
 * (`DeterministicPreferenceElicitation` + `ConversationState`), tries every
 * answer the state machine will accept, and shows that no reachable typed
 * profile carries an explicit relative priority — and consequently that no
 * reachable conversation state can move the recommendation to the plan that
 * leads on the other objective.
 *
 * Fixture: the committed alternatives-preview corpus (a genuine topic-vs-project
 * trade-off). No network, no provider, no cache.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import {
  DeterministicPreferenceElicitation,
  type ElicitationAnswer,
  type ElicitationContext,
} from '../../api/ai/preference_elicitation';
import { initConversation, answerQuestion, type ConversationState } from '../../api/ai/conversation_state';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { resolveGroundedObjectiveSet } from '../../api/ai/grounded_objective_set';
import type { Preference, PreferenceProfile } from '../../api/ai/preference_model';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027; // the catalog year of program_id below
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ELECTIVES.map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: id === 'E1',
      course_type: id === 'E1' ? 'mandatory' : 'elective',
      placement_policy: id === 'E1' ? 'mandatory' : 'elective',
      offered_semesters: id === 'E1' ? [SEM_A] : [SEM_B], prerequisites: [],
    })),
  },
};

/**
 * The committed alternatives-preview corpus, verbatim: E2 is the only PROJECT
 * course and E3 the only ROBOTICS course, so {E1,E2} leads on project, {E1,E3}
 * leads on topic, and neither dominates the other.
 */
const CONTENT: Record<string, string> = {
  E1: 'תכן הנדסי בלבד.',
  E2: 'תכן הנדסי בלבד.',
  E3: 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת, משוב כוח.',
  E4: 'תכן הנדסי, מעבר חום וזרימה במחליפי החום.',
};
const DELIVERY: Record<string, string> = { E1: 'שיעור', E2: 'פרוייקט', E3: 'שיעור', E4: 'מעבדה' };

function doc(courseId: string, academicYear: number = YEAR): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=altprev${courseId}&year=${academicYear}`,
    contentHash: `sha_altprev_${courseId}_${academicYear}`,
    retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [DELIVERY[courseId]] },
    text: `אופן ההוראה ${DELIVERY[courseId]} תוכן הקורס ומטרתו ${CONTENT[courseId]} מטלות הקורס`,
  };
}

let MOCK_DOCUMENTS: SyllabusDocument[] = [];

function makeRes() {
  const res: any = {
    statusCode: 0, setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body } as any, res); return res; }

/** A confirmed, planner-eligible preference — exactly what the conversation produces. */
const confirmed = (id: string, category: string, affects: string, normalized: string): Preference => ({
  id, category, normalized, value: normalized, classification: 'soft_preference',
  confidence: 0.9, source: 'explicit_answer', confirmationStatus: 'confirmed',
  affects, mayAffectPlanningBeforeConfirmation: true,
});

const PROJECT_PREF = confirmed('course_feature_practical', 'course_feature', 'grounded_course_feature', 'project_based');
const TOPIC_PREF = confirmed('course_topic_interest', 'course_topic_interest', 'grounded_topic_interest', 'robotics');

/** Both objectives confirmed — the state in which the trade-off actually arises. */
const BOTH_CONFIRMED: PreferenceProfile = { version: 5, preferences: [PROJECT_PREF, TOPIC_PREF] };

const request = (profile: PreferenceProfile = BOTH_CONFIRMED, over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: {
    version: profile.version,
    preferences: profile.preferences.map((p) => ({
      id: p.id, category: p.category, normalized: p.normalized, value: p.value,
      classification: p.classification, confidence: p.confidence, source: p.source,
      confirmationStatus: p.confirmationStatus, affects: p.affects,
      mayAffectPlanningBeforeConfirmation: p.mayAffectPlanningBeforeConfirmation,
    })),
  },
  ...over,
});

const candidatesOf = (body: any) => body?.academicDecision?.candidates;
const alternativesOf = (body: any) => candidatesOf(body)?.alternatives ?? [];
const recommendedIdOf = (body: any) =>
  alternativesOf(body).find((a: any) => a.recommended)?.candidateId ?? null;

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = ELECTIVES.map((id) => doc(id)); });

// ── the situation the clarification exists for ───────────────────────────────

describe('C5/P0 — the trade-off is real, reported, and currently undecidable', () => {
  test('two non-dominated alternatives exist and the server reports the trade-off', async () => {
    const body = (await run(request()))._body;
    const composition = candidatesOf(body)?.groundedComposition;

    expect(composition?.unresolvedTradeoff).toBe(true);
    expect(composition?.reason).toBe('equal_confirmed_preferences');
    expect(composition?.objectiveIds).toEqual(
      expect.arrayContaining(['prefer_project_courses', 'prefer_topic_alignment']),
    );

    const alternatives = alternativesOf(body);
    expect(alternatives.length).toBeGreaterThanOrEqual(2);
    expect(alternatives.every((a: any) => a.nonDominated)).toBe(true);

    // One leads on project, another on topic — a genuine trade-off, not a
    // dominated pair dressed up as a choice.
    const scoreOn = (a: any, id: string) =>
      a.objectiveScores.find((s: any) => s.objectiveId === id)?.normalized ?? 0;
    const projectLeader = alternatives.find((a: any) => scoreOn(a, 'prefer_project_courses') > 0);
    const topicLeader = alternatives.find((a: any) => scoreOn(a, 'prefer_topic_alignment') > 0);
    expect(projectLeader).toBeDefined();
    expect(topicLeader).toBeDefined();
    expect(projectLeader.candidateId).not.toBe(topicLeader.candidateId);
    // Neither is better on both — that is what makes the priority answerable.
    expect(scoreOn(projectLeader, 'prefer_topic_alignment')).toBeLessThan(scoreOn(topicLeader, 'prefer_topic_alignment'));
    expect(scoreOn(topicLeader, 'prefer_project_courses')).toBeLessThan(scoreOn(projectLeader, 'prefer_project_courses'));
  });

  /**
   * THE RED.
   *
   * Walk the real typed conversation with everything the server actually
   * reported, try every answer it will accept, and look for ONE that records an
   * explicit relative priority in the typed profile. This is a statement about
   * decision capability: it does not name a module, an export or a component.
   */
  test('no reachable conversation answer records an explicit relative priority', async () => {
    const body = (await run(request()))._body;
    const found = await reachablePriorityAnswers(body, BOTH_CONFIRMED);

    expect(found.length).toBeGreaterThan(0);
  });

  /**
   * And the consequence: because no answer records a priority, no reachable
   * conversation state can move the recommendation onto the topic-leading plan.
   * Selecting a card can show it, but nothing the student can SAY changes what
   * the system recommends.
   */
  test('a reachable answer moves the recommendation to the other non-dominated plan', async () => {
    const body = (await run(request()))._body;
    const before = recommendedIdOf(body);
    expect(before).toBeTruthy();

    const found = await reachablePriorityAnswers(body, BOTH_CONFIRMED);
    expect(found.length).toBeGreaterThan(0);

    const recommendations = new Set<string>();
    for (const { profile } of found) {
      const rebuilt = (await run(request(profile)))._body;
      const after = recommendedIdOf(rebuilt);
      expect(after).toBeTruthy();
      recommendations.add(after!);
    }

    // At least one answer genuinely changes the recommendation, and every
    // objective in the trade-off is reachable as a choice.
    expect(recommendations.size).toBeGreaterThan(1);
    expect([...recommendations]).toContain(before);
  });
});

// ── the walk ────────────────────────────────────────────────────────────────

/**
 * Every answer the REAL state machine will accept, from the state the server's
 * own signals produce, that ends up recording an explicit relative priority in
 * the typed profile.
 *
 * Bounded: at most MAX_STEPS questions deep, and a question that yields nothing
 * is answered `indifferent` so the walk advances instead of stalling. Priority
 * is detected through the production resolver — `prioritySource` on the
 * resolved objective set — never by looking for a field name in the profile.
 */
const MAX_STEPS = 8;

async function reachablePriorityAnswers(
  body: any,
  seed: PreferenceProfile,
): Promise<Array<{ profile: PreferenceProfile; questionId: string; answer: ElicitationAnswer }>> {
  const elicit = new DeterministicPreferenceElicitation();
  const ctx = elicitationContextFrom(body);

  // Start from the profile the student already confirmed, exactly as the UI
  // would: the conversation owns it, and the two objectives are already in it.
  let state: ConversationState = initConversation(elicit, ctx);
  state = { ...state, profile: seed };
  state = answerNothing(state, elicit, ctx);

  const out: Array<{ profile: PreferenceProfile; questionId: string; answer: ElicitationAnswer }> = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const q = state.currentQuestion;
    if (!q) break;

    const answers: ElicitationAnswer[] = [
      ...(q.options ?? []).map((o) => ({ kind: 'choice', value: o.value }) as ElicitationAnswer),
      ...(q.allowIndifferent ? [{ kind: 'indifferent' } as ElicitationAnswer] : []),
    ];

    for (const answer of answers) {
      const next = answerQuestion(state, answer, elicit, ctx);
      if (carriesExplicitPriority(next.profile)) {
        out.push({ profile: next.profile, questionId: q.id, answer });
      }
    }

    // Advance past this question without letting the walk's own bookkeeping
    // become the thing under test.
    state = answerQuestion(state, { kind: 'indifferent' }, elicit, ctx);
  }
  return out;
}

/** Re-select the current question for a seeded profile without answering anything. */
function answerNothing(
  state: ConversationState,
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
): ConversationState {
  const q = elicit.selectNextQuestion(state.profile, ctx);
  return { ...state, currentQuestion: q, status: q ? 'question_pending' : 'ready_to_plan' };
}

/** The PRODUCTION judgment of "an explicit relative priority was supplied". */
function carriesExplicitPriority(profile: PreferenceProfile): boolean {
  const resolved = resolveGroundedObjectiveSet(effectivePlannerPreferences(profile));
  return resolved.prioritySource !== undefined;
}

/**
 * Exactly what the browser passes: every impact signal the server reported,
 * carried through verbatim. The conversation must never infer impact for itself.
 */
function elicitationContextFrom(body: any): ElicitationContext {
  const evidence = candidatesOf(body)?.evidence;
  return {
    ...(evidence?.groundedQuestionImpact ? { groundedFeatureImpact: evidence.groundedQuestionImpact } : {}),
    ...(evidence?.topicQuestionImpact ? { topicInterestImpact: evidence.topicQuestionImpact } : {}),
    // Any further impact signal the server reports is forwarded untouched, so
    // this walk keeps working as the contract grows and never has to know its
    // shape in advance.
    ...(evidence?.priorityQuestionImpact
      ? { objectivePriorityImpact: evidence.priorityQuestionImpact }
      : {}),
  } as ElicitationContext;
}

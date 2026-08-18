/**
 * M0 — the precedence defect, reproduced as LOST USER INTENT.
 *
 * `resolveGroundedObjective` returns ONE objective. Its structure is:
 *   1. collect delivery-feature preferences and topic preferences;
 *   2. if any delivery preference names a supported value, RETURN IMMEDIATELY;
 *   3. only if none did, fall through to topic interest.
 *
 * So a student who confirmed BOTH "I prefer project courses" AND "I'm
 * interested in robotics" has the robotics answer silently discarded — it is
 * not even reported in `excluded`. Downstream, `candidate_set` ranks on a
 * single `grounded.score` number, so architecturally only one objective can
 * ever reach ranking.
 *
 * These tests are written to FAIL against the current implementation. They
 * assert the behaviour the product policy requires, and each failure message
 * names a concrete plan the student should have been given and was not.
 *
 * The fixture is built so the two objectives do NOT conflict:
 *   E1 — neutral filler, present in every retained candidate
 *   E2 — project delivery, no topic content
 *   E3 — project delivery AND robotics content
 * Both retained candidates therefore score the SAME on project, and {E1,E3} is
 * strictly better on topic. {E1,E3} Pareto-dominates {E1,E2}: there is no
 * trade-off to adjudicate and no reason for the student not to get it.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { resolveGroundedObjective } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import type { Preference } from '../../api/ai/preference_model';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027;
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ELECTIVES.map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

function doc(courseId: string, delivery: string, content: string): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=multi${courseId}&year=${YEAR}`,
    contentHash: `sha_multi_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery} תוכן הקורס ומטרתו ${content} מטלות הקורס`,
  };
}

/** E2 and E3 are BOTH project courses; only E3 also covers robotics. */
const CORPUS = [
  doc('E1', 'שיעור', 'תכן הנדסי בלבד.'),
  doc('E2', 'פרוייקט', 'תכן הנדסי בלבד.'),
  doc('E3', 'פרוייקט', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'),
  doc('E4', 'שיעור', 'תכן הנדסי בלבד.'),
];

let MOCK_DOCUMENTS: SyllabusDocument[] = [];

const projectPref = (over: Partial<Preference> = {}): Preference => ({
  id: 'course_feature_practical', category: 'course_feature',
  normalized: 'project_based', value: 'project_based',
  classification: 'soft_preference', confidence: 0.9, source: 'explicit_answer',
  confirmationStatus: 'confirmed', affects: 'grounded_course_feature',
  mayAffectPlanningBeforeConfirmation: true, ...over,
});
const labPref = (over: Partial<Preference> = {}): Preference =>
  projectPref({ id: 'course_feature_laboratory', normalized: 'practical_laboratory', value: 'practical_laboratory', ...over });
const topicPref = (over: Partial<Preference> = {}): Preference => ({
  id: 'course_topic_interest', category: 'course_topic_interest',
  normalized: 'robotics', value: 'robotics',
  classification: 'soft_preference', confidence: 0.9, source: 'explicit_answer',
  confirmationStatus: 'confirmed', affects: 'grounded_topic_interest',
  mayAffectPlanningBeforeConfirmation: true, ...over,
});

/**
 * The contract this session must deliver: a SET of objectives. Read through a
 * cast so the suite compiles against today's single-objective result and fails
 * on BEHAVIOUR — the point is the lost plan, not the missing field.
 */
interface ObjectiveSetView {
  objectives?: Array<{ id: string; preferenceId: string }>;
}
const resolve = (prefs: Preference[], version = 5): ObjectiveSetView =>
  resolveGroundedObjective(effectivePlannerPreferences({ version, preferences: prefs })) as unknown as ObjectiveSetView;
const idsOf = (r: ObjectiveSetView) => (r.objectives ?? []).map((o) => o.id).sort();

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
const request = (prefs: Preference[], over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: { version: 5, preferences: prefs },
  ...over,
});
const placed = (b: any): string[] => (b.semesters ?? []).flatMap((s: any) => s.course_ids).sort();

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = CORPUS; });

describe('M0 — every confirmed objective must survive resolution', () => {
  test('a confirmed topic is NOT dropped when a delivery preference also exists', () => {
    expect(idsOf(resolve([projectPref(), topicPref()])))
      .toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
  });

  test('a dropped preference is never silently discarded — nothing is lost without a reason', () => {
    const both = resolve([projectPref(), topicPref()]);
    const ids = (both.objectives ?? []).map((o) => o.preferenceId).sort();
    expect(ids).toEqual(['course_feature_practical', 'course_topic_interest']);
  });

  test('preference ARRAY ORDER cannot decide which confirmed preference is honoured', () => {
    expect(idsOf(resolve([projectPref(), topicPref()])))
      .toEqual(idsOf(resolve([topicPref(), projectPref()])));
    expect(idsOf(resolve([projectPref(), topicPref()]))).toHaveLength(2);
  });

  test('two delivery preferences both survive — array order picks no winner', () => {
    expect(idsOf(resolve([labPref(), projectPref()])))
      .toEqual(['prefer_laboratory_courses', 'prefer_project_courses']);
    expect(idsOf(resolve([projectPref(), labPref()])))
      .toEqual(idsOf(resolve([labPref(), projectPref()])));
  });

  test('indifferent and unconfirmed preferences are still excluded, independently', () => {
    expect(idsOf(resolve([projectPref(), topicPref({ classification: 'indifferent' })])))
      .toEqual(['prefer_project_courses']);
  });
});

describe('M0 — the defect costs the student a real plan', () => {
  test('a candidate satisfying BOTH confirmed preferences is the one selected', async () => {
    // Both retained candidates contain a project course, so the project
    // objective cannot separate them. {E1,E3} additionally covers robotics —
    // it is at least as good on every objective and strictly better on one.
    const body = (await run(request([projectPref(), topicPref()])))._body;
    expect(placed(body)).toContain('E3');
  });

  test('the response reports BOTH objectives as active, not one', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const active = body.academicDecision?.groundedObjective;
    const ids = (active?.objectives ?? []).map((o: { id: string }) => o.id).sort();
    expect(ids).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
  });

  test('the explanation mentions BOTH confirmed preferences', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const text: string = body.academicDecision?.candidates?.groundedExplanationHe ?? '';
    expect(text).toMatch(/פרוי/);   // the project preference
    expect(text).toMatch(/רובוטיקה/); // the topic preference
  });

  test('with the topic preference ALONE the topic still decides', async () => {
    const body = (await run(request([topicPref()])))._body;
    expect(placed(body)).toContain('E3');
  });

  test('a hard exclusion of the both-satisfying course still wins over both objectives', async () => {
    const body = (await run(request([projectPref(), topicPref()], {
      preferences: { disallowed_course_ids: ['E3'] },
    })))._body;
    expect(placed(body)).not.toContain('E3');
  });
});

/**
 * M7 — a second confirmed preference must remain REACHABLE.
 *
 * Composition is worthless if the conversation stops asking once the first
 * grounded objective is known. Both impact probes are computed independently
 * over the candidates retained for THIS request, so answering one preference
 * re-evaluates — rather than silences — the other.
 */
describe('M7 — answering one preference does not silence the others', () => {
  test('with a topic already confirmed, the delivery probe is still computed and truthful', async () => {
    const body = (await run(request([topicPref()])))._body;
    const delivery = body.academicDecision.candidates.evidence.groundedQuestionImpact;
    // The probe is NOT suppressed by the topic answer — it is still emitted and
    // still describes the candidates retained for THIS request. In this corpus
    // every retained candidate holds exactly one project course (E2 and E3 are
    // both project), so delivery genuinely cannot separate them and the probe
    // truthfully says so. Reporting `false` here is the "do not ask when it
    // cannot change the outcome" rule working, not the question being silenced.
    expect(delivery).toBeDefined();
    expect(delivery.coverageSufficient).toBe(true);
    expect(delivery.distinguishesCandidates).toBe(false);
    expect(delivery.distinguishingObjectives).toEqual([]);
  });

  test('with a delivery preference already confirmed, topics are still probed', async () => {
    const body = (await run(request([projectPref()])))._body;
    const topic = body.academicDecision.candidates.evidence.topicQuestionImpact;
    expect(topic.distinguishingTopics).toContain('robotics');
  });

  test('both probes rest on the SAME snapshot as the ranking', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const ev = body.academicDecision.candidates.evidence;
    expect(ev.topicQuestionImpact.snapshotId).toBe(ev.snapshotId);
    for (const c of body.academicDecision.candidates.summaries) {
      expect(c.profileVersion).toBe(5);
    }
  });

  test('the composition metadata reaches the wire truthfully', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const comp = body.academicDecision.candidates.groundedComposition;
    expect(comp.objectiveIds).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
    expect(typeof comp.reason).toBe('string');
    expect(comp.dominatedCount + comp.nonDominatedCount).toBeGreaterThan(0);
  });
})

/**
 * M4 — a genuine TRADE-OFF must be represented, never resolved by precedence.
 *
 * Different corpus: E2 is a project course with no distinguishing topic, E3
 * covers robotics but is a lecture. Neither candidate dominates — each is
 * strictly better on a different objective. The old code would simply have let
 * delivery win because it came first; the composed policy must report the
 * conflict instead.
 */
describe('M4 — trade-offs are reported, not decided by objective order', () => {
  const TRADEOFF = [
    doc('E1', 'שיעור', 'תכן הנדסי בלבד.'),
    doc('E2', 'פרוייקט', 'תכן הנדסי בלבד.'),
    doc('E3', 'שיעור', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'),
    doc('E4', 'שיעור', 'תכן הנדסי בלבד.'),
  ];

  test('an unresolved trade-off is retained and reported truthfully', async () => {
    MOCK_DOCUMENTS = TRADEOFF;
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const comp = body.academicDecision.candidates.groundedComposition;
    expect(comp.objectiveIds).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
    expect(comp.unresolvedTradeoff).toBe(true);
    // Explicitly NOT a precedence outcome.
    expect(comp.reason).toBe('equal_confirmed_preferences');
    expect(comp.nonDominatedCount).toBeGreaterThanOrEqual(2);
  });

  test('the trade-off explanation says so, without claiming the student chose weights', async () => {
    MOCK_DOCUMENTS = TRADEOFF;
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const text: string = body.academicDecision.candidates.groundedExplanationHe ?? '';
    expect(text).toMatch(/אין חלופה חוקית שמצטיינת בכל ההעדפות/);
    expect(text).toMatch(/זו מדיניות הדירוג של המערכת, לא קביעה שלך/);
  });

  test('reversing the preference order does not change the selected plan', async () => {
    MOCK_DOCUMENTS = TRADEOFF;
    const forward = placed((await run(request([projectPref(), topicPref()])))._body);
    const reverse = placed((await run(request([topicPref(), projectPref()])))._body);
    expect(reverse).toEqual(forward);
  });

  test('one official document cited by two objectives is disclosed once', async () => {
    MOCK_DOCUMENTS = CORPUS; // E3 satisfies BOTH objectives from one document
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const sources = body.academicDecision.candidates.groundedSources;
    const keys = sources.map((s: { courseId: string; sourceRef: string }) => `${s.courseId}|${s.sourceRef}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
})

/**
 * C0/C1 — the exposed ALTERNATIVE SET.
 *
 * C0 traced the lifecycle: `generateCandidateSet` retains up to
 * DEFAULT_MAX_CANDIDATES = 3 validated, deduplicated combinations and computes a
 * full objective vector plus Pareto dominance for each. The response then emits
 * `summaries` carrying ids, differences and the raw `scoreVector` — but NOT the
 * plan state. So several legal, non-dominated plans exist internally, exactly
 * one reaches the user, and the UI could only "show" another by reconstructing
 * it from difference text, which is forbidden.
 *
 * These tests are written to FAIL first. They assert the product requirement:
 * several meaningfully different, validated, non-dominated combinations, built
 * under the SAME hard constraints, preference profile and evidence snapshot,
 * each complete enough to display and to Apply without regenerating.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { generatePlanResponseToModel } from '../../shared/planner/adapters';
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
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=alt${courseId}&year=${YEAR}`,
    contentHash: `sha_alt_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery} תוכן הקורס ומטרתו ${content} מטלות הקורס`,
  };
}

/**
 * A genuine TRADE-OFF corpus: E2 is a project course with no distinguishing
 * topic, E3 covers robotics but is a lecture. Neither candidate dominates, so
 * both belong on the Pareto front and both deserve to be shown.
 */
const TRADEOFF = [
  doc('E1', 'שיעור', 'תכן הנדסי בלבד.'),
  doc('E2', 'פרוייקט', 'תכן הנדסי בלבד.'),
  doc('E3', 'שיעור', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'),
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
const topicPref = (over: Partial<Preference> = {}): Preference => ({
  id: 'course_topic_interest', category: 'course_topic_interest',
  normalized: 'robotics', value: 'robotics',
  classification: 'soft_preference', confidence: 0.9, source: 'explicit_answer',
  confirmationStatus: 'confirmed', affects: 'grounded_topic_interest',
  mayAffectPlanningBeforeConfirmation: true, ...over,
});

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

/** The contract under construction, read loosely so failures are behavioural. */
interface AlternativeView {
  candidateId: string;
  normalizedIdentity: string;
  recommended: boolean;
  applyable: boolean;
  semesters: Array<{ semesterId: string; courseIds: string[] }>;
  constraintFingerprint: string;
  profileVersion: number;
  snapshotId: string;
  nonDominated: boolean;
  composedUtility: number;
  objectiveScores: Array<{ objectiveId: string; normalized: number }>;
  labelHe: string;
  differencesHe: string[];
  workload: { peakHours: number; totalHours: number; activePeriods: number };
}
const alternativesOf = (body: any): AlternativeView[] =>
  body?.academicDecision?.candidates?.alternatives ?? [];
const coursesOf = (a: AlternativeView) => a.semesters.flatMap((s) => s.courseIds).sort();

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = TRADEOFF; });

describe('C0 — several validated non-dominated plans exist, but only one is reachable', () => {
  test('the engine really does retain more than one validated combination', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    // Established fact, not the thing under test — it is what makes the gap real.
    expect(body.academicDecision.candidates.summaries.length).toBeGreaterThanOrEqual(2);
    expect(body.academicDecision.candidates.groundedComposition.nonDominatedCount).toBeGreaterThanOrEqual(2);
  });

  test('the user is offered every non-dominated alternative, not just the winner', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    expect(alts.length).toBeGreaterThanOrEqual(2);
    expect(alts.filter((a) => a.recommended)).toHaveLength(1);
  });

  test('each alternative carries its COMPLETE plan, so nothing is reconstructed client-side', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    for (const a of alts) {
      expect(a.semesters.length).toBeGreaterThan(0);
      expect(coursesOf(a).length).toBeGreaterThan(0);
      // The plan must match the identity it claims.
      expect(a.normalizedIdentity).toContain(coursesOf(a)[0]);
    }
  });

  test('the model exposes the alternatives to the browser', async () => {
    const model = generatePlanResponseToModel((await run(request([projectPref(), topicPref()])))._body);
    expect((model as unknown as { alternatives?: unknown[] }).alternatives?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('C1 — every exposed alternative is legal and comparable', () => {
  test('all alternatives share ONE constraint fingerprint, profile version and snapshot', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    expect(new Set(alts.map((a) => a.constraintFingerprint)).size).toBe(1);
    expect(new Set(alts.map((a) => a.profileVersion)).size).toBe(1);
    expect(new Set(alts.map((a) => a.snapshotId)).size).toBe(1);
  });

  test('every alternative is valid and applyable', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    for (const a of alts) expect(a.applyable).toBe(true);
  });

  test('alternatives are DISTINCT combinations, never repeats', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const identities = alts.map((a) => a.normalizedIdentity);
    expect(new Set(identities).size).toBe(identities.length);
    // "Meaningfully different" means different course sets or placements.
    expect(new Set(alts.map((a) => coursesOf(a).join(',')))).not.toEqual(new Set(['']));
  });

  test('a hard-EXCLUDED course appears in no alternative', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()], {
      preferences: { disallowed_course_ids: ['E3'] },
    })))._body);
    for (const a of alts) expect(coursesOf(a)).not.toContain('E3');
  });

  test('a hard-WANTED course constrains every alternative, and one plan is not a comparison', async () => {
    const body = (await run(request([projectPref(), topicPref()], {
      preferences: { disallowed_course_ids: [], wanted_course_ids: ['E3'] },
    })))._body;
    const alts = alternativesOf(body);
    // The wanted course is absolute: it is in the proposal and in every
    // alternative, whenever alternatives are offered at all.
    expect((body.semesters ?? []).flatMap((s: any) => s.course_ids)).toContain('E3');
    for (const a of alts) expect(coursesOf(a)).toContain('E3');
    // Forcing E3 leaves {E2,E3} — a project course that also covers robotics —
    // dominating both {E1,E3} placements. With ONE non-dominated plan there is
    // no legitimate choice to present, so no comparison is manufactured.
    expect(body.academicDecision.candidates.groundedComposition.nonDominatedCount).toBe(1);
    expect(alts).toEqual([]);
  });

  test('when several non-dominated plans survive, a wanted course is in all of them', async () => {
    // E1 is wanted; the remaining slot still admits genuinely different plans.
    const body = (await run(request([projectPref(), topicPref()], {
      preferences: { disallowed_course_ids: [], wanted_course_ids: ['E1'] },
    })))._body;
    const alts = alternativesOf(body);
    expect(alts.length).toBeGreaterThanOrEqual(2);
    for (const a of alts) expect(coursesOf(a)).toContain('E1');
  });

  test('the set is bounded and deterministic across repeated runs', async () => {
    const a = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const b = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.map((x) => x.candidateId)).toEqual(b.map((x) => x.candidateId));
  });

  test('the recommended alternative IS the selected proposal', async () => {
    const body = (await run(request([projectPref(), topicPref()])))._body;
    const alts = alternativesOf(body);
    const recommended = alts.find((a) => a.recommended)!;
    const placed = (body.semesters ?? []).flatMap((s: any) => s.course_ids).sort();
    expect(coursesOf(recommended)).toEqual(placed);
    expect(recommended.normalizedIdentity)
      .toBe(body.academicDecision.candidates.selectedNormalizedIdentity);
  });

  test('no search internals are promoted as alternative content', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const serialized = JSON.stringify(alts);
    expect(serialized).not.toMatch(/scoreVector|provenance|sha_alt|contentHash/);
  });

  test('with NO grounded objective a single plan is not dressed up as a comparison', async () => {
    MOCK_DOCUMENTS = [];
    const alts = alternativesOf((await run(request([])))._body);
    // Converged/indistinguishable outputs must not be presented as a choice.
    expect(alts.length === 0 || alts.length >= 2).toBe(true);
  });
});

describe('C2 — differences are derived from the plans themselves', () => {
  test('each alternative states a factual, non-generic label', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    for (const a of alts) {
      expect(typeof a.labelHe).toBe('string');
      expect(a.labelHe.length).toBeGreaterThan(0);
      // Planning INPUTS are never alternative identities.
      expect(a.labelHe).not.toMatch(/מאוזנ|מרוכז|balanced|compact|התוכנית הטובה|חכמה/);
    }
  });

  test('difference text names courses that really differ', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const rec = alts.find((a) => a.recommended)!;
    const other = alts.find((a) => !a.recommended)!;
    const onlyOther = coursesOf(other).filter((c) => !coursesOf(rec).includes(c));
    expect(other.differencesHe.join(' ')).toContain(onlyOther[0]);
  });

  test('workload metrics are computed from the alternative, not copied', async () => {
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    for (const a of alts) {
      expect(a.workload.totalHours).toBeGreaterThan(0);
      expect(a.workload.peakHours).toBeGreaterThan(0);
      expect(a.workload.activePeriods).toBeGreaterThan(0);
    }
  });
});

/**
 * Browser-acceptance defects (C2 labelling), found on a real trade-off fixture.
 *
 * 1. The plan that leads on TOPIC was labelled with the neutral ordinal
 *    "חלופה 2" instead of naming the topic. Root cause: the builder was handed
 *    the LEGACY single-objective `topicIds`, which is only populated when the
 *    topic objective happens to sort first — so with project + topic active it
 *    was undefined and the topic label could never be produced.
 * 2. Two different cards rendered the SAME label ("יותר קורסים פרויקטליים"),
 *    because a plan that merely TIES on an objective still counted as leading
 *    it. A label that does not distinguish is worse than a neutral one.
 */
describe('C2 — labels must name the real distinction, and must distinguish', () => {
  const TRADEOFF_LABELS = [
    doc('E1', 'שיעור', 'תכן הנדסי בלבד.'),
    doc('E2', 'פרוייקט', 'תכן הנדסי בלבד.'),
    doc('E3', 'שיעור', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'),
    doc('E4', 'שיעור', 'תכן הנדסי בלבד.'),
  ];

  test('the topic-leading alternative NAMES the topic', async () => {
    MOCK_DOCUMENTS = TRADEOFF_LABELS;
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const topicLeader = alts.find((a) => coursesOf(a).includes('E3'))!;
    expect(topicLeader.labelHe).toContain('רובוטיקה');
  });

  test('no two alternatives share a label', async () => {
    MOCK_DOCUMENTS = TRADEOFF_LABELS;
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const labels = alts.map((a) => a.labelHe);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('an alternative that merely TIES on an objective does not claim to lead it', async () => {
    MOCK_DOCUMENTS = TRADEOFF_LABELS;
    const alts = alternativesOf((await run(request([projectPref(), topicPref()])))._body);
    const project = alts.filter((a) => a.labelHe.includes('פרויקטליים'));
    // Two plans hold the same project course; only one may claim the headline.
    expect(project.length).toBeLessThanOrEqual(1);
  });
})

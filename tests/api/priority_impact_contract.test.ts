/**
 * C5/P1 — the typed priority-clarification IMPACT contract.
 *
 * The contract's whole purpose is to keep the decision on the server: a client
 * must never conclude that asking "which matters more?" is worthwhile from the
 * existence of two alternatives, from `unresolvedTradeoff`, from differences in
 * the objective vectors, or from card order. So these tests pin BOTH halves:
 *
 *   - the gate is exactly the eight documented conditions, and in particular a
 *     genuine unresolved trade-off is NOT sufficient on its own;
 *   - every option's predicted recommendation equals what the real handler
 *     actually recommends when that priority is supplied — checked by rebuilding
 *     against the real handler, not by re-deriving the prediction.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import {
  computePriorityQuestionImpact,
  EQUAL_IMPORTANCE_LABEL_HE,
  type PriorityQuestionImpact,
} from '../../api/ai/priority_impact';
import { EQUAL_IMPORTANCE, type ResolvedObjective } from '../../api/ai/grounded_objective_set';
import type { PlanCandidate } from '../../api/ai/candidate_set';
import type { Preference, PreferenceProfile } from '../../api/ai/preference_model';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';
import { generatePlanResponseToModel } from '../../shared/planner/adapters';
import { catalogRevision } from '../../shared/planner/model';
import { buildDraftVM } from '../../web/lib/planner/draft-vm';

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
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: id === 'E1',
      course_type: id === 'E1' ? 'mandatory' : 'elective',
      placement_policy: id === 'E1' ? 'mandatory' : 'elective',
      offered_semesters: id === 'E1' ? [SEM_A] : [SEM_B], prerequisites: [],
    })),
  },
};

const CONTENT: Record<string, string> = {
  E1: 'תכן הנדסי בלבד.',
  E2: 'תכן הנדסי בלבד.',
  E3: 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת, משוב כוח.',
  E4: 'תכן הנדסי, מעבר חום וזרימה במחליפי החום.',
};
const DELIVERY: Record<string, string> = { E1: 'שיעור', E2: 'פרוייקט', E3: 'שיעור', E4: 'מעבדה' };

function doc(courseId: string, over: Partial<{ content: string; delivery: string }> = {}): SyllabusDocument {
  const delivery = over.delivery ?? DELIVERY[courseId];
  const content = over.content ?? CONTENT[courseId];
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=altprev${courseId}&year=${YEAR}`,
    contentHash: `sha_altprev_${courseId}_${delivery}_${content.length}`,
    retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery} תוכן הקורס ומטרתו ${content} מטלות הקורס`,
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

const confirmed = (id: string, category: string, affects: string, normalized: string): Preference => ({
  id, category, normalized, value: normalized, classification: 'soft_preference',
  confidence: 0.9, source: 'explicit_answer', confirmationStatus: 'confirmed',
  affects, mayAffectPlanningBeforeConfirmation: true,
});

const PROJECT_PREF = confirmed('course_feature_practical', 'course_feature', 'grounded_course_feature', 'project_based');
const TOPIC_PREF = confirmed('course_topic_interest', 'course_topic_interest', 'grounded_topic_interest', 'robotics');
const BOTH: PreferenceProfile = { version: 5, preferences: [PROJECT_PREF, TOPIC_PREF] };

const request = (profile?: PreferenceProfile, over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  ...(profile
    ? {
        preference_profile: {
          version: profile.version,
          preferences: profile.preferences.map((p) => ({
            id: p.id, category: p.category, normalized: p.normalized, value: p.value,
            classification: p.classification, confidence: p.confidence, source: p.source,
            confirmationStatus: p.confirmationStatus, affects: p.affects,
            mayAffectPlanningBeforeConfirmation: p.mayAffectPlanningBeforeConfirmation,
          })),
        },
      }
    : {}),
  ...over,
});

const candidatesOf = (body: any) => body?.academicDecision?.candidates;
const impactOf = (body: any): PriorityQuestionImpact | undefined =>
  candidatesOf(body)?.evidence?.priorityQuestionImpact;
const recommendedIdOf = (body: any) =>
  (candidatesOf(body)?.alternatives ?? []).find((a: any) => a.recommended)?.candidateId ?? null;

/** The generic priority answer, as the conversation stores it. */
const priorityPref = (value: string): Preference =>
  confirmed('objective_priority', 'objective_priority', 'grounded_objective_priority', value);

const withPriority = (value: string): PreferenceProfile => ({
  version: BOTH.version + 1,
  preferences: [...BOTH.preferences, priorityPref(value)],
});

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = ELECTIVES.map((id) => doc(id)); });

// ── the contract, against the real handler ──────────────────────────────────

describe('C5/P1 — the handler emits a truthful priority-impact contract', () => {
  test('it names the impacted objectives, their labels, and one option each plus equal importance', async () => {
    const impact = impactOf((await run(request(BOTH)))._body)!;
    expect(impact).toBeDefined();
    expect(impact.category).toBe('objective_priority');
    expect(impact.impactedObjectiveIds.sort()).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
    expect(impact.eligible).toBe(true);
    expect(impact.changesRecommendation).toBe(true);
    expect(impact.alreadyAnswered).toBe(false);

    // Exactly the impacted objectives, plus ONE equal-importance option.
    expect(impact.options.map((o) => o.value).sort()).toEqual(
      [EQUAL_IMPORTANCE, 'prefer_project_courses', 'prefer_topic_alignment'].sort(),
    );
    expect(impact.options.filter((o) => o.value === EQUAL_IMPORTANCE)).toHaveLength(1);
    expect(impact.equalImportanceLabelHe).toBe(EQUAL_IMPORTANCE_LABEL_HE);
  });

  test('labels are derived from the SUPPORTED objectives and never expose an internal id', async () => {
    const impact = impactOf((await run(request(BOTH)))._body)!;
    for (const o of impact.options) {
      expect(o.labelHe.length).toBeGreaterThan(0);
      expect(o.labelHe).not.toBe(o.value);
      expect(o.labelHe).not.toMatch(/prefer_|_courses|_alignment|equal_importance/);
    }
    // The topic objective's label names the CONFIRMED topic, not the objective.
    const topic = impact.options.find((o) => o.value === 'prefer_topic_alignment')!;
    expect(topic.labelHe).toContain('רובוטיקה');
    const project = impact.options.find((o) => o.value === 'prefer_project_courses')!;
    expect(project.labelHe).toContain('פרויקט');
    expect(impact.objectiveLabels['prefer_topic_alignment']).toBe(topic.labelHe);
  });

  test('the trade-off explanation is factual and claims no plan is better', async () => {
    const impact = impactOf((await run(request(BOTH)))._body)!;
    expect(impact.tradeoffExplanationHe).toContain('אותן דרישות');
    expect(impact.tradeoffExplanationHe).toContain('רובוטיקה');
    expect(impact.tradeoffExplanationHe).not.toMatch(/הכי טוב|האופציה הטובה|מומלץ ביותר/);
  });

  test('it carries the snapshot and profile version the UI needs to detect staleness', async () => {
    const body = (await run(request(BOTH)))._body;
    const impact = impactOf(body)!;
    expect(impact.profileVersion).toBe(BOTH.version);
    expect(typeof impact.snapshotId).toBe('string');
    expect(impact.snapshotId.length).toBeGreaterThan(0);
    // The same snapshot every alternative was built against.
    for (const alt of candidatesOf(body).alternatives) expect(alt.snapshotId).toBe(impact.snapshotId);
  });

  /** The decisive property: the prediction must equal what actually happens. */
  test('every option predicts the recommendation the REAL handler then produces', async () => {
    const impact = impactOf((await run(request(BOTH)))._body)!;
    expect(impact.options.length).toBeGreaterThanOrEqual(3);

    for (const option of impact.options) {
      const rebuilt = (await run(request(withPriority(option.value))))._body;
      expect(recommendedIdOf(rebuilt)).toBe(option.recommendedCandidateId);
    }
  });

  test('equal importance predicts exactly the CURRENT recommendation', async () => {
    const body = (await run(request(BOTH)))._body;
    const impact = impactOf(body)!;
    const equal = impact.options.find((o) => o.value === EQUAL_IMPORTANCE)!;
    expect(equal.recommendedCandidateId).toBe(impact.currentRecommendedCandidateId);
    expect(equal.recommendedCandidateId).toBe(recommendedIdOf(body));
  });

  test('once answered the contract reports it and the question is no longer eligible', async () => {
    const impact = impactOf((await run(request(withPriority('prefer_topic_alignment'))))._body)!;
    expect(impact.alreadyAnswered).toBe(true);
    expect(impact.eligible).toBe(false);
    // Explicit equal importance is an ANSWER too — not the same as silence.
    const equalAnswered = impactOf((await run(request(withPriority(EQUAL_IMPORTANCE))))._body)!;
    expect(equalAnswered.alreadyAnswered).toBe(true);
    expect(equalAnswered.eligible).toBe(false);
  });

  test('FLAG-OFF and no-profile paths carry no priority contract at all', async () => {
    expect(impactOf((await run(request(BOTH, { use_academic_decision_agent: false })))._body)).toBeUndefined();
    expect(impactOf((await run(request()))._body)).toBeUndefined();
  });

  test('ONE confirmed objective is never a priority question', async () => {
    const single: PreferenceProfile = { version: 4, preferences: [TOPIC_PREF] };
    expect(impactOf((await run(request(single)))._body)).toBeUndefined();
  });
});

// ── the gate itself, unit-level and exhaustive ──────────────────────────────

const OBJECTIVES: ResolvedObjective[] = [
  { id: 'prefer_project_courses', preferenceId: 'p', kind: 'delivery', target: 'project_based', source: 'explicit_answer', profileVersion: 5 },
  { id: 'prefer_topic_alignment', preferenceId: 't', kind: 'topic', target: 'course_topic_interest', topicIds: ['robotics'], source: 'explicit_answer', profileVersion: 5 },
];

/** A minimal retained candidate — only what ranking and the gate actually read. */
function candidate(id: string, vector: number[], over: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id,
    policy: 'neutral',
    state: { semesters: {} } as never,
    valid: true,
    validationErrors: [],
    // Identical hard/legality/policy prefix ⇒ genuinely comparable.
    scoreVector: [1, 1, 1, 1, 1, 1, 0],
    normalizedIdentity: `identity_${id}`,
    rank: 0,
    provenance: 'test',
    differences: [],
    profileVersion: 5,
    rationaleHe: '',
    objectiveScores: vector.map((normalized, k) => ({
      objectiveId: OBJECTIVES[k].id, raw: normalized, denominator: 1, normalized,
      contributions: [], unknownCourseIds: [], variesBySectionCourseIds: [],
    })),
    composedUtility: vector.reduce((a, b) => a + b, 0) / (vector.length || 1),
    nonDominated: true,
    ...over,
  };
}

const compute = (candidates: PlanCandidate[], over: Record<string, unknown> = {}) =>
  computePriorityQuestionImpact({
    candidates,
    objectives: OBJECTIVES,
    recommendedCandidateId: candidates[0]?.id ?? 'A',
    snapshotId: 'snap_test',
    profileVersion: 5,
    alreadyAnswered: false,
    ...over,
  });

describe('C5/P1 — the eight eligibility conditions', () => {
  /** THE point of the whole contract. */
  test('an unresolved trade-off is NOT sufficient — priority must change the selection', () => {
    // A and B trade off (A better on project, B better on topic), and C is
    // strictly better than BOTH on project while tying on topic — so whichever
    // priority is chosen, C is recommended and the answer changes nothing.
    const impact = compute([
      candidate('C', [1, 0.5]),
      candidate('A', [0.5, 0]),
      candidate('B', [0, 0.5]),
    ], { recommendedCandidateId: 'C' })!;

    // The trade-off between A and B is real…
    expect(impact.impactedObjectiveIds.length).toBeGreaterThan(0);
    // …but every option lands on C, so there is nothing to ask.
    expect(new Set(impact.options.map((o) => o.recommendedCandidateId))).toEqual(new Set(['C']));
    expect(impact.changesRecommendation).toBe(false);
    expect(impact.eligible).toBe(false);
  });

  test('a DOMINATED candidate is never part of the decision', () => {
    const impact = compute([
      candidate('A', [0.5, 0.5]),
      candidate('B', [0, 0], { nonDominated: false }),
    ])!;
    expect(impact.eligible).toBe(false);
    expect(impact.changesRecommendation).toBe(false);
  });

  test('candidates that TIE on the objectives produce no question', () => {
    const impact = compute([candidate('A', [0.5, 0.5]), candidate('B', [0.5, 0.5])])!;
    expect(impact.impactedObjectiveIds).toEqual([]);
    expect(impact.options).toEqual([]);
    expect(impact.eligible).toBe(false);
  });

  test('a single alternative produces no question', () => {
    expect(compute([candidate('A', [0.5, 0])])!.eligible).toBe(false);
  });

  test('an objective every candidate ties on is not offered, even while active', () => {
    // Three objectives; the third separates nothing.
    const three: ResolvedObjective[] = [
      ...OBJECTIVES,
      { id: 'prefer_laboratory_courses', preferenceId: 'l', kind: 'delivery', target: 'practical_laboratory', source: 'explicit_answer', profileVersion: 5 },
    ];
    const mk = (id: string, v: number[]) => ({
      ...candidate(id, [v[0], v[1]]),
      objectiveScores: v.map((normalized, k) => ({
        objectiveId: three[k].id, raw: normalized, denominator: 1, normalized,
        contributions: [], unknownCourseIds: [], variesBySectionCourseIds: [],
      })),
    });
    const impact = computePriorityQuestionImpact({
      candidates: [mk('A', [0.5, 0, 0.25]), mk('B', [0, 0.5, 0.25])],
      objectives: three,
      recommendedCandidateId: 'A',
      snapshotId: 'snap_test', profileVersion: 5, alreadyAnswered: false,
    })!;
    expect(impact.impactedObjectiveIds).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
    expect(impact.options.map((o) => o.value)).not.toContain('prefer_laboratory_courses');
    expect(impact.eligible).toBe(true);
  });

  test('an already-answered priority closes the question', () => {
    expect(compute([candidate('A', [0.5, 0]), candidate('B', [0, 0.5])], { alreadyAnswered: true })!.eligible).toBe(false);
  });

  test('a blocking clarification outranks the optional question', () => {
    expect(
      compute([candidate('A', [0.5, 0]), candidate('B', [0, 0.5])], { blockedByHigherPriority: true })!.eligible,
    ).toBe(false);
  });

  test('an INVALID candidate is never part of the decision', () => {
    const impact = compute([
      candidate('A', [0.5, 0]),
      candidate('B', [0, 0.5], { valid: false, validationErrors: ['nope'] }),
    ])!;
    expect(impact.eligible).toBe(false);
  });

  test('candidates answering DIFFERENT hard questions are not compared', () => {
    // B satisfies fewer hard/legality/policy terms — it is not an alternative
    // to A, it is the answer to another question.
    const impact = compute([
      candidate('A', [0.5, 0]),
      candidate('B', [0, 0.5], { scoreVector: [0, 1, 1, 1, 1, 1, 0] }),
    ])!;
    expect(impact.eligible).toBe(false);
  });
});

describe('C5/P1 — order can never decide anything', () => {
  const A = candidate('A', [0.5, 0]);
  const B = candidate('B', [0, 0.5]);

  test('reversing CANDIDATE order changes nothing', () => {
    const forward = compute([A, B], { recommendedCandidateId: 'A' })!;
    const reversed = compute([B, A], { recommendedCandidateId: 'A' })!;
    expect(reversed.options).toEqual(forward.options);
    expect(reversed.eligible).toBe(forward.eligible);
    expect(reversed.impactedObjectiveIds).toEqual(forward.impactedObjectiveIds);
  });

  test('reversing OBJECTIVE order changes only presentation order, never outcomes', () => {
    const flip = (c: PlanCandidate): PlanCandidate => ({
      ...c,
      objectiveScores: [...(c.objectiveScores ?? [])].reverse(),
    });
    const reversed = computePriorityQuestionImpact({
      candidates: [flip(A), flip(B)],
      objectives: [...OBJECTIVES].reverse(),
      recommendedCandidateId: 'A',
      snapshotId: 'snap_test', profileVersion: 5, alreadyAnswered: false,
    })!;
    const forward = compute([A, B], { recommendedCandidateId: 'A' })!;

    expect(reversed.eligible).toBe(forward.eligible);
    expect(new Set(reversed.impactedObjectiveIds)).toEqual(new Set(forward.impactedObjectiveIds));
    // The SAME option → the SAME recommendation, whichever order they arrived in.
    for (const option of forward.options) {
      const mirror = reversed.options.find((o) => o.value === option.value)!;
      expect(mirror.recommendedCandidateId).toBe(option.recommendedCandidateId);
    }
  });
});

// ── the shared wire and adapter boundary ────────────────────────────────────

describe('C5/P1 — the contract survives the wire unmodified', () => {
  test('planResponseToModel preserves every option, label and prediction', async () => {
    const body = (await run(request(BOTH)))._body;
    const model = generatePlanResponseToModel(body);
    expect(model.priorityQuestionImpact).toEqual(impactOf(body));
  });

  test('the draft view model receives the SAME contract', async () => {
    const model = generatePlanResponseToModel((await run(request(BOTH)))._body);
    const draft = buildDraftVM(model, { catalogRevision: catalogRevision('r1'), semesters: [], courseCatalog: {} });
    expect(draft.priorityQuestionImpact).toEqual(model.priorityQuestionImpact);
  });

  test('no score internals, evidence ids or plan states cross the boundary', async () => {
    const model = generatePlanResponseToModel((await run(request(BOTH)))._body);
    const serialized = JSON.stringify(model.priorityQuestionImpact);
    expect(serialized).not.toMatch(/sha_|scoreVector|contributions|composedUtility|normalizedIdentity|semesters/);
  });

  test('a response WITHOUT the contract yields none rather than a fabricated one', () => {
    const model = generatePlanResponseToModel({
      semesters: [], moves: [], warnings_he: [], errors: [], blocked: false,
    } as never);
    expect(model.priorityQuestionImpact).toBeUndefined();
  });
});

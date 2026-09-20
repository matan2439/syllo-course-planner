/**
 * C5/P4 — what an explicit priority is allowed to change, and what it can never
 * touch.
 *
 * An explicit priority is a SOFT ranking policy. It reorders plans that are
 * already equal on completion, legality, mandatory/category requirements, hard
 * wanted/avoided courses, workload caps and the confirmed distribution policy —
 * and it can do nothing else. These tests prove both halves: that naming an
 * objective genuinely moves the recommendation onto the plan leading on it, and
 * that a hard exclusion of the very course that objective wants still wins.
 *
 * The mechanism is generic: laboratory, project and topic all travel the same
 * path, with no pair-specific field and therefore no possibility of a cycle.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { compareRankable, type RankableCandidate } from '../../api/ai/candidate_set';
import {
  EQUAL_IMPORTANCE,
  PRIORITY_BASE_WEIGHT,
  PRIORITY_PRIMARY_WEIGHT,
  objectiveRankKey,
} from '../../api/ai/grounded_objective_set';
import { explainGroundedComposition, type GroundedScore } from '../../api/ai/grounded_objectives';
import type { Preference, PreferenceProfile } from '../../api/ai/preference_model';
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

function doc(courseId: string): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=altprev${courseId}&year=${YEAR}`,
    contentHash: `sha_altprev_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
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

const confirmed = (id: string, category: string, affects: string, normalized: string): Preference => ({
  id, category, normalized, value: normalized, classification: 'soft_preference',
  confidence: 0.9, source: 'explicit_answer', confirmationStatus: 'confirmed',
  affects, mayAffectPlanningBeforeConfirmation: true,
});

const PROJECT = confirmed('course_feature_practical', 'course_feature', 'grounded_course_feature', 'project_based');
const LABORATORY = confirmed('course_feature_lab', 'course_feature', 'grounded_course_feature', 'practical_laboratory');
const TOPIC = confirmed('course_topic_interest', 'course_topic_interest', 'grounded_topic_interest', 'robotics');
const priorityPref = (value: string) =>
  confirmed('objective_priority', 'objective_priority', 'grounded_objective_priority', value);

const profile = (preferences: Preference[], version = 6): PreferenceProfile => ({ version, preferences });

const request = (p: PreferenceProfile, over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: {
    version: p.version,
    preferences: p.preferences.map((x) => ({
      id: x.id, category: x.category, normalized: x.normalized, value: x.value,
      classification: x.classification, confidence: x.confidence, source: x.source,
      confirmationStatus: x.confirmationStatus, affects: x.affects,
      mayAffectPlanningBeforeConfirmation: x.mayAffectPlanningBeforeConfirmation,
    })),
  },
  ...over,
});

const candidatesOf = (b: any) => b?.academicDecision?.candidates;
const alternativesOf = (b: any) => candidatesOf(b)?.alternatives ?? [];
const recommendedOf = (b: any) => alternativesOf(b).find((a: any) => a.recommended);
/** The course set of the plan the handler actually put on the board. */
const plannedCourses = (b: any): string[] =>
  [...new Set(((b?.semesters ?? []) as any[]).flatMap((s) => s.course_ids as string[]))].sort();
const scoreOn = (alt: any, id: string) =>
  alt?.objectiveScores?.find((s: any) => s.objectiveId === id)?.normalized ?? 0;

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });
beforeEach(() => { MOCK_DOCUMENTS = ELECTIVES.map(doc); });

// ── the priority genuinely decides ──────────────────────────────────────────

describe('C5/P4 — an explicit priority moves the recommendation onto its own leader', () => {
  test('topic priority recommends the TOPIC-leading plan; project priority the PROJECT-leading plan', async () => {
    const base = profile([PROJECT, TOPIC]);
    const equalRec = recommendedOf((await run(request(base)))._body);

    const topicBody = (await run(request(profile([...base.preferences, priorityPref('prefer_topic_alignment')], 7))))._body;
    const topicRec = recommendedOf(topicBody);
    expect(scoreOn(topicRec, 'prefer_topic_alignment')).toBeGreaterThan(0);
    // Every offered alternative is compared, so this is a real lead, not a label.
    for (const alt of alternativesOf(topicBody)) {
      expect(scoreOn(topicRec, 'prefer_topic_alignment')).toBeGreaterThanOrEqual(
        scoreOn(alt, 'prefer_topic_alignment'),
      );
    }

    const projectBody = (await run(request(profile([...base.preferences, priorityPref('prefer_project_courses')], 7))))._body;
    const projectRec = recommendedOf(projectBody);
    expect(scoreOn(projectRec, 'prefer_project_courses')).toBeGreaterThan(0);
    for (const alt of alternativesOf(projectBody)) {
      expect(scoreOn(projectRec, 'prefer_project_courses')).toBeGreaterThanOrEqual(
        scoreOn(alt, 'prefer_project_courses'),
      );
    }

    // The two priorities genuinely disagree — otherwise nothing was proven.
    expect(topicRec.candidateId).not.toBe(projectRec.candidateId);
    expect(equalRec.candidateId).toBe(projectRec.candidateId);
  });

  test('LABORATORY travels the identical generic mechanism', async () => {
    const base = profile([LABORATORY, TOPIC]);
    const labBody = (await run(request(profile([...base.preferences, priorityPref('prefer_laboratory_courses')], 7))))._body;
    const labRec = recommendedOf(labBody);
    for (const alt of alternativesOf(labBody)) {
      expect(scoreOn(labRec, 'prefer_laboratory_courses')).toBeGreaterThanOrEqual(
        scoreOn(alt, 'prefer_laboratory_courses'),
      );
    }
    // The composition reports the priority truthfully, by the SAME field the
    // delivery and topic objectives use.
    expect(candidatesOf(labBody).groundedComposition.reason).toBe('explicit_priority');
    expect(candidatesOf(labBody).groundedComposition.prioritySource).toBe('explicit_preference');
  });

  test('EQUAL IMPORTANCE restores the documented equal-mean policy exactly', async () => {
    const base = profile([PROJECT, TOPIC]);
    const unanswered = (await run(request(base)))._body;
    const explicit = (await run(request(profile([...base.preferences, priorityPref(EQUAL_IMPORTANCE)], 7))))._body;

    expect(recommendedOf(explicit).candidateId).toBe(recommendedOf(unanswered).candidateId);
    // The reason must NOT claim a priority decided — none did.
    expect(candidatesOf(explicit).groundedComposition.reason).toBe('equal_confirmed_preferences');
    expect(candidatesOf(explicit).groundedComposition.prioritySource).toBeUndefined();
    // …but the answer IS recorded, so the question is not asked again.
    expect(candidatesOf(explicit).evidence.priorityQuestionImpact.alreadyAnswered).toBe(true);
  });

  test('a priority naming an objective that is no longer active is inert', async () => {
    // The student once said topic mattered more, then removed the topic
    // preference. The stale priority describes a trade-off that no longer
    // exists; it must not silently reweight what remains.
    const body = (await run(request(profile([PROJECT, priorityPref('prefer_topic_alignment')], 8))))._body;
    expect(candidatesOf(body).groundedComposition.prioritySource).toBeUndefined();
    expect(candidatesOf(body).groundedComposition.reason).not.toBe('explicit_priority');
  });
});

// ── hard constraints are absolute ───────────────────────────────────────────

describe('C5/P4 — a priority can never outrank a hard constraint', () => {
  test('hard-excluding the prioritized objective’s own course still wins', async () => {
    const withPriority = profile([PROJECT, TOPIC, priorityPref('prefer_topic_alignment')], 7);

    // Without the exclusion the topic priority pulls E3 in.
    const free = (await run(request(withPriority)))._body;
    expect(plannedCourses(free)).toContain('E3');

    // E3 is the ONLY course carrying the prioritized topic. Excluding it must
    // win outright: the priority is a ranking policy, not a licence.
    const excluded = (await run(request(withPriority, { preferences: { disallowed_course_ids: ['E3'] } })))._body;
    expect(plannedCourses(excluded)).not.toContain('E3');
    expect(excluded.blocked).toBe(false);
    for (const alt of alternativesOf(excluded)) {
      expect(alt.semesters.flatMap((s: any) => s.courseIds)).not.toContain('E3');
    }
  });

  test('a workload cap still binds under an explicit priority', async () => {
    const withPriority = profile([PROJECT, TOPIC, priorityPref('prefer_topic_alignment')], 7);
    const capped = (await run(request(withPriority, { preferences: { disallowed_course_ids: [], max_weekly_hours: 4 } })))._body;
    // Every semester of the committed plan respects the cap the student set.
    for (const sem of capped.semesters) {
      expect(sem.course_ids.length).toBeLessThanOrEqual(1); // each elective is 4 ש״ש
    }
  });
});

// ── the explanation ─────────────────────────────────────────────────────────

describe('C5/P4 — the explanation states what the priority actually did', () => {
  test('it searches all legal alternatives for the secondary trade-off, not only the first tie', () => {
    const score = (courseId?: string, feature: 'topic' | 'projectDelivery' = 'topic'): GroundedScore => ({
      score: courseId ? 1 : 0,
      contributions: courseId ? [{
        courseId, feature, ...(feature === 'topic' ? { topicId: 'robotics' as const } : {}),
        sourceRef: `official:${courseId}`, academicYear: 2027,
      }] : [],
      unknownCourseIds: [], variesBySectionCourseIds: [],
    });
    const alternatives = [
      [score('TOPIC_TIE'), score()],
      [score(), score('PROJECT', 'projectDelivery')],
    ];
    const input = {
      objectives: [
        { id: 'prefer_topic_alignment', topicIds: ['robotics'] },
        { id: 'prefer_project_courses' },
      ],
      snapshotId: 'snap_explanation_choice',
      selected: [score('TOPIC'), score()],
      // The first legal alternative only ties. A later legal alternative is
      // genuinely stronger on the non-primary project objective.
      alternatives,
      reason: 'explicit_priority',
      primaryObjectiveId: 'prefer_topic_alignment',
    };
    const text = (explainGroundedComposition as any)(input);

    expect(text).toContain('חלופה חוקית אחרת עדיין מתאימה יותר');
    expect(text).toContain('פרויקט');
    expect((explainGroundedComposition as any)({ ...input, alternatives: [...alternatives].reverse() }))
      .toBe(text);
  });

  test('it names the chosen priority, the surviving trade-off, and the shared requirements', async () => {
    const body = (await run(request(profile([PROJECT, TOPIC, priorityPref('prefer_topic_alignment')], 7))))._body;
    const text: string = candidatesOf(body).groundedExplanationHe;

    expect(text).toContain('רובוטיקה');            // the objective they chose, by name
    expect(text).toContain('חשוב לך יותר');         // that THEY said it, not the system
    expect(text).toContain('אותן דרישות ומגבלות');  // hard requirements unchanged
    // The alternative that remains stronger on the other objective is named,
    // rather than the trade-off quietly disappearing once it was resolved.
    expect(text).toContain('חלופה חוקית אחרת');
    expect(text).toContain('פרויקט');
    // The explanation's claim about the alternative must disclose the official
    // source that proves that alternative's project delivery — selected-plan
    // evidence alone cannot support a comparative statement.
    expect(candidatesOf(body).groundedSources.map((source: any) => source.courseId))
      .toContain('E2');
    // It never claims the recommended plan is objectively better.
    expect(text).not.toMatch(/הטובה ביותר|האופטימלי|הכי טוב/);
  });

  test('with NO priority the explanation still describes equal importance as the SYSTEM’s policy', async () => {
    const body = (await run(request(profile([PROJECT, TOPIC]))))._body;
    const text: string = candidatesOf(body).groundedExplanationHe;
    expect(text).toContain('מדיניות הדירוג של המערכת');
    expect(text).not.toContain('חשוב לך יותר');
  });
});

// ── the ranking key itself ──────────────────────────────────────────────────

const rankable = (identity: string, vector: number[], scoreVector = [1, 1, 1, 1, 1, 1, 0]): RankableCandidate =>
  ({ scoreVector, normalizedIdentity: identity, vector });

describe('C5/P4 — the composition key is order-invariant and tie-stable', () => {
  test('with NO priority the key is exactly the equal-importance mean', () => {
    expect(objectiveRankKey([0.5, 0])).toEqual([0.25]);
    expect(objectiveRankKey([0.5, 0], [undefined, undefined])).toEqual([0.25]);
    // Symmetric ⇒ objective order cannot change it.
    expect(objectiveRankKey([0, 0.5])).toEqual(objectiveRankKey([0.5, 0]));
  });

  test('with a primary objective the key is [primary, mean(rest)]', () => {
    const p = [PRIORITY_PRIMARY_WEIGHT, PRIORITY_BASE_WEIGHT];
    expect(objectiveRankKey([0.5, 0], p)).toEqual([0.5, 0]);
    expect(objectiveRankKey([0, 0.5], p)).toEqual([0, 0.5]);
    // Three objectives: one primary tier, one shared tier — no cycles possible.
    expect(objectiveRankKey([1, 0, 0.5], [PRIORITY_PRIMARY_WEIGHT, PRIORITY_BASE_WEIGHT, PRIORITY_BASE_WEIGHT]))
      .toEqual([1, 0.25]);
  });

  test('an EXACT tie on the objectives falls to the canonical identity, priority or not', () => {
    const a = rankable('identity_a', [0.5, 0.5]);
    const b = rankable('identity_b', [0.5, 0.5]);
    const p = [PRIORITY_PRIMARY_WEIGHT, PRIORITY_BASE_WEIGHT];
    expect(compareRankable(a, b)).toBeLessThan(0);
    expect(compareRankable(a, b, p)).toBeLessThan(0);
    // …and the SAME winner whichever order they arrive in.
    expect([a, b].sort((x, y) => compareRankable(x, y, p))[0].normalizedIdentity).toBe('identity_a');
    expect([b, a].sort((x, y) => compareRankable(x, y, p))[0].normalizedIdentity).toBe('identity_a');
  });

  test('the hard/legality/policy prefix is compared BEFORE any objective key', () => {
    // `weak` is better on the prioritized objective but worse on completion.
    const strong = rankable('identity_strong', [0, 0], [1, 1, 1, 1, 1, 1, 0]);
    const weak = rankable('identity_weak', [1, 1], [0, 1, 1, 1, 1, 1, 0]);
    const p = [PRIORITY_PRIMARY_WEIGHT, PRIORITY_BASE_WEIGHT];
    expect(compareRankable(strong, weak, p)).toBeLessThan(0);
  });

  test('reversing CANDIDATE order cannot change the winner', () => {
    const a = rankable('identity_a', [0.5, 0]);
    const b = rankable('identity_b', [0, 0.5]);
    const topicFirst = [PRIORITY_BASE_WEIGHT, PRIORITY_PRIMARY_WEIGHT];
    expect([a, b].sort((x, y) => compareRankable(x, y, topicFirst))[0].normalizedIdentity).toBe('identity_b');
    expect([b, a].sort((x, y) => compareRankable(x, y, topicFirst))[0].normalizedIdentity).toBe('identity_b');
  });
});

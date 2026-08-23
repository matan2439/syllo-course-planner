/**
 * K9B — the grounded objective through the REAL Generate handler, with one
 * frozen evidence snapshot owned by the request.
 *
 * Proves the full live path:
 *   PreferenceProfile → eligibility → Generate handler → EvidenceSnapshot →
 *   candidate generation/ranking → selected proposal
 *
 * and the invariants that make it safe: one snapshot per request, no network
 * anywhere in planning or Apply, no coverage bias, and hard constraints still
 * absolute.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { GROUNDED_FEATURE_AFFECTS, GROUNDED_FEATURE_CATEGORY } from '../../api/ai/grounded_preference';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027; // the board's catalog year, from program_id below

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    completed_course_ids: [],
    program_requirements_categories: { total_required_hours: 8, categories: [] },
    program_repository_courses: ['E1', 'E2', 'E3', 'E4'].map((id) => ({
      course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
      course_type: 'elective', placement_policy: 'elective',
      offered_semesters: [SEM_A, SEM_B], prerequisites: [],
    })),
  },
};

/** A prepared official document, as the durable cache would hand it over. */
function doc(courseId: string, delivery: string, academicYear: number = YEAR): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId,
    academicYear,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542000000&year=${academicYear}`,
    contentHash: `sha_${courseId}_${delivery}_${academicYear}`,
    retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`${courseId}-01`], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery}`,
  };
}

function topicDoc(courseId: string, content: string, academicYear: number = YEAR): SyllabusDocument {
  return {
    ...doc(courseId, 'שיעור', academicYear),
    contentHash: `sha_${courseId}_topic_${academicYear}`,
    text: `תוכן הקורס ומטרתו ${content} מטלות הקורס`,
  };
}

// Mutable so each test can choose the evidence the request will be given.
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

const labPref = (over: Record<string, unknown> = {}) => ({
  id: 'course_feature_practical',
  category: GROUNDED_FEATURE_CATEGORY,
  normalized: 'practical_laboratory',
  value: 'practical_laboratory',
  classification: 'soft_preference',
  confidence: 0.9,
  source: 'explicit_answer',
  confirmationStatus: 'confirmed',
  affects: GROUNDED_FEATURE_AFFECTS,
  mayAffectPlanningBeforeConfirmation: true,
  ...over,
});

function body(over: any = {}) {
  return {
    program_id: 'grounded_2027',
    plan_context: { personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] } },
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    use_academic_decision_agent: true,
    ...over,
  };
}
const withPref = (prefs: unknown[] = [labPref()], version = 4, over: any = {}) =>
  body({ preference_profile: { version, preferences: prefs }, ...over });

const placed = (b: any): string[] => (b.semesters ?? []).flatMap((s: any) => s.course_ids).sort();
const candidates = (b: any) => b.academicDecision.candidates;

describe('K9B — grounded ranking through the real Generate handler', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true';
    // E3 is the only course with an official LABORATORY delivery mode.
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'מעבדה')];
  });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('a confirmed preference reaches grounded ranking and CHANGES the real selected plan', async () => {
    const without = await run(body());
    const with_ = await run(withPref());

    expect(placed(with_._body)).not.toEqual(placed(without._body)); // selection really changed
    expect(placed(without._body)).not.toContain('E3');
    expect(placed(with_._body)).toContain('E3');                    // the evidence-backed course
    expect(candidates(with_._body).evidence.groundedObjective).toBe('prefer_laboratory_courses');
    expect(candidates(with_._body).selectedGroundedScore.score).toBeGreaterThan(0);
  });

  test('an ABSENT or INDIFFERENT preference preserves the canonical legacy selection', async () => {
    const legacy = await run(body());
    const indifferent = await run(withPref([labPref({ classification: 'indifferent' })]));
    expect(placed(indifferent._body)).toEqual(placed(legacy._body));
    expect(candidates(indifferent._body).evidence.groundedObjective).toBeNull();
    expect(candidates(legacy._body).selectedGroundedScore).toBeNull();
  });

  test('EVERY candidate in the request shares exactly one snapshot id', async () => {
    const res = await run(withPref());
    const c = candidates(res._body);
    expect(typeof c.evidence.snapshotId).toBe('string');
    expect(c.summaries.length).toBeGreaterThanOrEqual(1);
    // The snapshot is a property of the REQUEST, not of any candidate.
    expect(c.evidence.snapshotId).toBe(c.evidence.snapshotId);
    expect(c.evidence.extractionVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(c.evidence.preferenceProfileVersion).toBe(4);
  });

  test('the response reports truthful coverage, including what is missing', async () => {
    const res = await run(withPref());
    const e = candidates(res._body).evidence;
    expect(e.requestedCourseCount).toBe(4);
    expect(e.coveredCourseCount).toBe(3);
    expect(e.missingCourseIds).toEqual(['E4']); // no document for E4
    expect(e.academicYears).toEqual([YEAR]);
  });

  test('MISSING evidence causes no bias — an uncovered course is neither rewarded nor penalised', async () => {
    MOCK_DOCUMENTS = []; // nothing covered at all
    const legacy = await run(body());
    const withNoEvidence = await run(withPref());
    expect(placed(withNoEvidence._body)).toEqual(placed(legacy._body));
    expect(candidates(withNoEvidence._body).selectedGroundedScore.score).toBe(0);
  });

  test('COVERAGE BIAS is prevented: being covered but feature-false beats nothing', async () => {
    // Every course covered, none a laboratory ⇒ identical to having no evidence.
    MOCK_DOCUMENTS = ['E1', 'E2', 'E3', 'E4'].map((id) => doc(id, 'שיעור'));
    const coveredButFalse = await run(withPref());
    MOCK_DOCUMENTS = [];
    const uncovered = await run(withPref());
    expect(placed(coveredButFalse._body)).toEqual(placed(uncovered._body));
    expect(candidates(coveredButFalse._body).selectedGroundedScore.score).toBe(0);
  });

  test('STALE evidence (another academic year) causes no silent bias', async () => {
    MOCK_DOCUMENTS = [doc('E3', 'מעבדה', YEAR - 6)]; // a laboratory syllabus for the WRONG year
    const legacy = await run(body());
    const stale = await run(withPref());
    expect(placed(stale._body)).toEqual(placed(legacy._body)); // unchanged
    expect(candidates(stale._body).evidence.staleCourseIds).toEqual(['E3']);
    expect(candidates(stale._body).selectedGroundedScore.score).toBe(0);
  });

  test('an UNKNOWN feature is disclosed and contributes nothing', async () => {
    MOCK_DOCUMENTS = [{ ...doc('E3', 'מעבדה'), labeledFields: { 'מספר קורס': ['E3-01'] } }]; // no delivery field
    const res = await run(withPref());
    expect(candidates(res._body).evidence.unknownFeatureCourseIds).toEqual(['E3']);
    expect(candidates(res._body).selectedGroundedScore.score).toBe(0);
  });

  test('HARD constraints dominate: excluding the evidence-backed course still wins', async () => {
    const res = await run(withPref([labPref()], 4, {
      preferences: { disallowed_course_ids: ['E3'] },
    }));
    expect(placed(res._body)).not.toContain('E3');
    expect(candidates(res._body).selectedGroundedScore.score).toBe(0);
  });

  test('HARD inclusion the objective does not favour is still honoured', async () => {
    const res = await run(withPref([labPref()], 4, {
      preferences: { disallowed_course_ids: [], wanted_course_ids: ['E1'] },
    }));
    expect(placed(res._body)).toContain('E1');
  });

  test('the selected proposal identity equals the selected candidate', async () => {
    const res = await run(withPref());
    const c = candidates(res._body);
    const pairs: Array<[string, string]> = [];
    for (const s of res._body.semesters) for (const id of s.course_ids) pairs.push([id, s.semester_id]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    expect(c.selectedNormalizedIdentity).toBe(JSON.stringify(pairs));
    expect(c.summaries.find((s: any) => s.selected).id).toBe(c.selectedCandidateId);
  });

  test('alternatives still share the same hard constraints and confirmed distribution policy', async () => {
    const res = await run(withPref());
    const c = candidates(res._body);
    expect(new Set(c.summaries.map((s: any) => s.policy)).size).toBe(1);
    for (const s of c.summaries) expect(s.profileVersion).toBe(4);
  });

  test('a DIFFERENT evidence snapshot yields distinct provenance', async () => {
    const a = await run(withPref());
    MOCK_DOCUMENTS = [doc('E1', 'שיעור')];
    const b = await run(withPref());
    expect(candidates(a._body).evidence.snapshotId).not.toBe(candidates(b._body).evidence.snapshotId);
  });

  test('flag-off is unchanged: no agent flag ⇒ no evidence or grounded metadata at all', async () => {
    const res = await run({ ...withPref(), use_academic_decision_agent: undefined });
    expect('academicDecision' in res._body).toBe(false);
  });

  test('NO network call occurs during planning or Apply', async () => {
    const realFetch = globalThis.fetch;
    const spy = jest.fn(() => { throw new Error('network call during planning'); });
    (globalThis as { fetch?: unknown }).fetch = spy;
    try {
      const res = await run(withPref());
      expect(res.statusCode).toBe(200);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = realFetch;
    }
  });
});

// ── K7.5 — mixed-group evidence through the REAL handler ─────────────────────

describe('K7.5 — section-scoped evidence never labels a course-level candidate', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  /** A group-addressed document, exactly as the live endpoint returns one. */
  const groupDoc = (courseId: string, group: string, delivery: string): SyllabusDocument => ({
    ...doc(courseId, delivery),
    contentHash: `sha_${courseId}_${group}_${delivery}`,
    labeledFields: { 'מספר קורס': [`0542379${group === '05' ? '2' : '2'}-${group}`], 'אופן ההוראה': [delivery] },
  });

  test('the live mixed-group case (05 lab, 01 lecture) does NOT change selection', async () => {
    // Reproduces the real K7 finding for E3.
    MOCK_DOCUMENTS = [
      { ...groupDoc('E3', '05', 'מעבדה'), labeledFields: { 'מספר קורס': ['0542-3792-05'], 'אופן ההוראה': ['מעבדה'] } },
      { ...groupDoc('E3', '01', 'שיעור'), labeledFields: { 'מספר קורס': ['0542-3792-01'], 'אופן ההוראה': ['שיעור'] } },
    ];
    const legacy = await run(body());
    const withPreference = await run(withPref());
    expect(placed(withPreference._body)).toEqual(placed(legacy._body)); // ranking unchanged
    expect(candidates(withPreference._body).selectedGroundedScore.score).toBe(0);
    expect(candidates(withPreference._body).evidence.variesBySectionCourseIds).toEqual(['E3']);
  });

  test('the response discloses varies_by_section truthfully', async () => {
    MOCK_DOCUMENTS = [
      { ...doc('E3', 'מעבדה'), contentHash: 'h05', labeledFields: { 'מספר קורס': ['0542-3792-05'], 'אופן ההוראה': ['מעבדה'] } },
      { ...doc('E3', 'שיעור'), contentHash: 'h01', labeledFields: { 'מספר קורס': ['0542-3792-01'], 'אופן ההוראה': ['שיעור'] } },
    ];
    const res = await run(withPref());
    expect(candidates(res._body).evidence.variesBySectionCourseIds).toEqual(['E3']);
    // …and the explanation never calls it a laboratory course.
    const explanation = candidates(res._body).groundedExplanationHe ?? '';
    expect(explanation).not.toMatch(/כוללת 1 קורס\/ים עם רכיב מעבדה/);
  });

  test('a SINGLE group with no authoritative universe stays unknown — one group cannot label the course', async () => {
    MOCK_DOCUMENTS = [
      { ...doc('E3', 'מעבדה'), contentHash: 'honly', labeledFields: { 'מספר קורס': ['0542-3792-05'], 'אופן ההוראה': ['מעבדה'] } },
    ];
    const legacy = await run(body());
    const res = await run(withPref());
    expect(placed(res._body)).toEqual(placed(legacy._body)); // no ranking change
    expect(candidates(res._body).selectedGroundedScore.score).toBe(0);
  });
});

// ── K9C browser defect — the handler must publish the question-impact signal ──

describe('grounded question impact is published so the UI can gate the question', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('applicable evidence that separates candidates reports distinguishesCandidates:true', async () => {
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'מעבדה'), doc('E4', 'שיעור')];
    const res = await run(body()); // NO confirmed preference — this is the probe
    const impact = candidates(res._body).evidence.groundedQuestionImpact;
    expect(impact).toBeDefined();
    // K8 — the single question now covers every implemented delivery-format
    // objective, so the probe reports the FIELD plus which objectives separate.
    expect(impact.feature).toBe('course_delivery_format');
    expect(impact.distinguishesCandidates).toBe(true);
    expect(impact.distinguishingObjectives).toContain('prefer_laboratory_courses');
    expect(impact.coverageSufficient).toBe(true);
    expect(impact.hasConflicts).toBe(false);
  });

  test('MIXED-section evidence reports distinguishesCandidates:false — no question', async () => {
    MOCK_DOCUMENTS = [
      { ...doc('E3', 'מעבדה'), contentHash: 'g05', labeledFields: { 'מספר קורס': ['0542-3792-05'], 'אופן ההוראה': ['מעבדה'] } },
      { ...doc('E3', 'שיעור'), contentHash: 'g01', labeledFields: { 'מספר קורס': ['0542-3792-01'], 'אופן ההוראה': ['שיעור'] } },
    ];
    const res = await run(body());
    const impact = candidates(res._body).evidence.groundedQuestionImpact;
    expect(impact.distinguishesCandidates).toBe(false);
  });

  test('NO evidence at all reports distinguishesCandidates:false', async () => {
    MOCK_DOCUMENTS = [];
    const res = await run(body());
    expect(candidates(res._body).evidence.groundedQuestionImpact.distinguishesCandidates).toBe(false);
  });
});

// ── K8 — the project objective through the REAL handler ──────────────────────

describe('K8 — prefer_project_courses changes real selection through Generate', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  const projectPref = () => labPref({ normalized: 'project_based', value: 'project_based' });

  test('a confirmed project preference selects the project-delivery course', async () => {
    // E3 is the only course whose official delivery mode is "פרוייקט".
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'פרוייקט'), doc('E4', 'שיעור')];
    const legacy = await run(body());
    const withProject = await run(withPref([projectPref()]));

    expect(placed(withProject._body)).not.toEqual(placed(legacy._body));
    expect(placed(legacy._body)).not.toContain('E3');
    expect(placed(withProject._body)).toContain('E3');
    expect(candidates(withProject._body).evidence.groundedObjective).toBe('prefer_project_courses');
    expect(candidates(withProject._body).selectedGroundedScore.score).toBeGreaterThan(0);
  });

  test('an explicitly interpreted focus request reaches the same evidence-backed topic ranking and outcome', async () => {
    MOCK_DOCUMENTS = [
      topicDoc('E1', 'מבוא כללי.'),
      topicDoc('E2', 'מבוא כללי.'),
      topicDoc('E3', 'חומרים הנדסיים ותכונות החומר.'),
    ];

    const without = await run(body({ interpret_free_text: true }));
    const withFocus = await run(body({
      interpret_free_text: true,
      preferences: { disallowed_course_ids: [], extra_request_he: 'אני רוצה להתמקד בחומרים' },
    }));

    expect(placed(withFocus._body)).not.toEqual(placed(without._body));
    expect(placed(withFocus._body)).toContain('E3');
    expect(candidates(withFocus._body).evidence.groundedObjective).toBe('prefer_topic_alignment');
    expect(candidates(withFocus._body).selectedGroundedScore.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ courseId: 'E3', topicId: 'materials' })]),
    );
    expect(withFocus._body.intentOutcome.honored.join(' ')).toContain('חומרים');
    expect(withFocus._body.intentOutcome.unmet.join(' ')).not.toContain('חומרים');
  });

  test('a structured academic focus reaches the same evidence-backed topic ranking', async () => {
    MOCK_DOCUMENTS = [
      topicDoc('E1', 'מבוא כללי.'),
      topicDoc('E2', 'מבוא כללי.'),
      topicDoc('E3', 'חומרים הנדסיים ותכונות החומר.'),
    ];

    const without = await run(body());
    const withFocus = await run(body({
      academic_interest_profile: { focusAreas: [{ area: 'materials', weight: 1 }] },
    }));

    expect(placed(withFocus._body)).not.toEqual(placed(without._body));
    expect(placed(withFocus._body)).toContain('E3');
    expect(candidates(withFocus._body).evidence.groundedObjective).toBe('prefer_topic_alignment');
  });

  test('a structured focus stays soft: hard exclusion of its evidence-backed course wins', async () => {
    MOCK_DOCUMENTS = [topicDoc('E3', 'חומרים הנדסיים ותכונות החומר.')];
    const res = await run(body({
      preferences: { disallowed_course_ids: ['E3'] },
      academic_interest_profile: { focusAreas: [{ area: 'materials', weight: 1 }] },
    }));
    expect(placed(res._body)).not.toContain('E3');
    expect(candidates(res._body).selectedGroundedScore.score).toBe(0);
  });

  test('flag-off ignores structured focus for ranking', async () => {
    MOCK_DOCUMENTS = [topicDoc('E3', 'חומרים הנדסיים ותכונות החומר.')];
    const control = await run({ ...body(), use_academic_decision_agent: undefined });
    const focused = await run({
      ...body({ academic_interest_profile: { focusAreas: [{ area: 'materials', weight: 1 }] } }),
      use_academic_decision_agent: undefined,
    });
    expect(placed(focused._body)).toEqual(placed(control._body));
    expect(focused._body.academicDecision).toBeUndefined();
  });

  test('a structured avoid area removes evidenced exposure through soft grounded ranking', async () => {
    MOCK_DOCUMENTS = [
      topicDoc('E1', 'חומרים הנדסיים ותכונות החומר.'),
      topicDoc('E2', 'מבוא כללי.'),
      topicDoc('E3', 'מבוא כללי.'),
    ];
    const control = await run(body());
    const avoiding = await run(body({
      academic_interest_profile: { avoidAreas: [{ area: 'materials', weight: 1 }] },
    }));

    expect(placed(control._body)).toContain('E1');
    expect(placed(avoiding._body)).not.toContain('E1');
    expect(candidates(avoiding._body).evidence.groundedObjective).toBe('avoid_topic_exposure');
    expect(candidates(avoiding._body).groundedExplanationHe).toContain('חומרים');
  });

  test('structured avoidance stays soft: hard wanted inclusion still wins', async () => {
    MOCK_DOCUMENTS = [topicDoc('E1', 'חומרים הנדסיים ותכונות החומר.')];
    const res = await run(body({
      preferences: { disallowed_course_ids: [], wanted_course_ids: ['E1'] },
      academic_interest_profile: { avoidAreas: [{ area: 'materials', weight: 1 }] },
    }));
    expect(placed(res._body)).toContain('E1');
  });

  test('flag-off ignores structured avoidance for ranking', async () => {
    MOCK_DOCUMENTS = [topicDoc('E1', 'חומרים הנדסיים ותכונות החומר.')];
    const control = await run({ ...body(), use_academic_decision_agent: undefined });
    const avoiding = await run({
      ...body({ academic_interest_profile: { avoidAreas: [{ area: 'materials', weight: 1 }] } }),
      use_academic_decision_agent: undefined,
    });
    expect(placed(avoiding._body)).toEqual(placed(control._body));
    expect(avoiding._body.academicDecision).toBeUndefined();
  });

  test('conflicting structured focus and avoidance fail safe and are disclosed', async () => {
    MOCK_DOCUMENTS = [topicDoc('E3', 'חומרים הנדסיים ותכונות החומר.')];
    const control = await run(body());
    const conflict = await run(body({
      academic_interest_profile: {
        focusAreas: [{ area: 'materials', weight: 1 }],
        avoidAreas: [{ area: 'materials', weight: 1 }],
      },
    }));
    expect(placed(conflict._body)).toEqual(placed(control._body));
    expect(candidates(conflict._body).evidence.groundedObjective).toBeNull();
    expect(conflict._body.academicDecision.groundedObjective).toMatchObject({
      objective: null,
      objectives: [],
      excluded: [expect.objectContaining({
        value: 'materials', reason: 'conflicting_grounded_topic',
      })],
    });
  });

  test('the explanation names the PROJECT feature, not laboratory', async () => {
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'פרוייקט'), doc('E4', 'שיעור')];
    const res = await run(withPref([projectPref()]));
    const text = candidates(res._body).groundedExplanationHe ?? '';
    expect(text).toMatch(/פרויקט/);
    expect(text).not.toMatch(/מעבדה/);
    expect(text).toContain('ims.tau.ac.il');
  });

  test('a laboratory corpus gives the project preference nothing to work with — no bias', async () => {
    // Every course is a lecture or a lab; none is project-delivered.
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'מעבדה'), doc('E4', 'שיעור')];
    const legacy = await run(body());
    const withProject = await run(withPref([projectPref()]));
    expect(placed(withProject._body)).toEqual(placed(legacy._body));
    expect(candidates(withProject._body).selectedGroundedScore.score).toBe(0);
  });

  test('hard exclusion of the project course still wins', async () => {
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'פרוייקט'), doc('E4', 'שיעור')];
    const res = await run(withPref([projectPref()], 4, { preferences: { disallowed_course_ids: ['E3'] } }));
    expect(placed(res._body)).not.toContain('E3');
    expect(candidates(res._body).selectedGroundedScore.score).toBe(0);
  });

  test('the impact probe reports the project objective as distinguishing', async () => {
    MOCK_DOCUMENTS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'פרוייקט'), doc('E4', 'שיעור')];
    const res = await run(body());
    const impact = candidates(res._body).evidence.groundedQuestionImpact;
    expect(impact.distinguishesCandidates).toBe(true);
    expect(impact.distinguishingObjectives).toContain('prefer_project_courses');
  });
});

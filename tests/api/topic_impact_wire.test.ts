/**
 * W1 — the topic-impact signal from the REAL handler all the way to the draft
 * view model the browser conversation reads.
 *
 * The engine proof (T5) established that a confirmed topic changes the selected
 * candidate. That says nothing about whether a real browser can ever learn a
 * topic question is worth asking. This suite pins the transport:
 *
 *   generate-plan response → shared wire contract → adapters →
 *   GeneratedPlanModel → draft view model
 *
 * Written RED first: at the time of writing the handler emits
 * `topicQuestionImpact` but `planResponseToModel` drops it, so the browser has
 * no way to know. The UI must never reconstruct this from the proposal, the
 * explanation text, or by recomputing candidate differences locally — the
 * server stays authoritative about what is impactful.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => MOCK_DOCUMENTS),
}));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { generatePlanResponseToModel } from '../../shared/planner/adapters';
import { catalogRevision } from '../../shared/planner/model';
import { buildDraftVM } from '../../web/lib/planner/draft-vm';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027; // the board's catalog year, from program_id below
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

/**
 * Offering-scoped official documents (no group suffix), so the fact applies to
 * exactly the object a candidate selects. Delivery mode is IDENTICAL on every
 * course, so the delivery objectives cannot distinguish anything and this suite
 * is genuinely about the topic signal.
 */
function doc(courseId: string, content: string, academicYear: number = YEAR): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId,
    academicYear,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542000${courseId.slice(1)}&year=${academicYear}`,
    contentHash: `sha_${courseId}_${academicYear}`,
    retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': ['שיעור'] },
    text: `אופן ההוראה שיעור תוכן הקורס ומטרתו ${content} מטלות הקורס`,
  };
}

/**
 * Every course states `תכן הנדסי`, so `engineering_design` is present in
 * official evidence but can NEVER separate two 2-course candidates — the exact
 * "present but not impactful" case the option list must exclude.
 */
const TOPIC_CORPUS = [
  doc('E1', 'תכן הנדסי, וכן תהליכי ייצור ועיבוד שבבי.'),
  doc('E2', 'תכן הנדסי בלבד.'),
  // Real 0542-4624 wording — a genuinely multi-topic course.
  doc('E3', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת, משוב כוח.'),
  doc('E4', 'תכן הנדסי, מעבר חום וזרימה במחליפי החום.'),
];

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

const request = (over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: { version: 3, preferences: [] },
  ...over,
});

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

const impactOf = (body: any) => body?.academicDecision?.candidates?.evidence?.topicQuestionImpact;

beforeEach(() => { MOCK_DOCUMENTS = TOPIC_CORPUS; });

describe('W1 — the handler emits a truthful topic-impact probe', () => {
  test('it reports the topics that genuinely separate retained candidates', async () => {
    const res = await run(request());
    const impact = impactOf(res._body);
    expect(impact).toBeDefined();
    expect(impact.distinguishesCandidates).toBe(true);
    // The retained candidates are {E1,E2} and {E1,E3}. Only a topic unique to
    // E3 can change the outcome, and BOTH of E3's topics do.
    // Vocabulary declaration order — deterministic, and a more meaningful
    // option ordering for a reader than alphabetical internal ids would be.
    expect(impact.distinguishingTopics).toEqual(['robotics', 'control']);
    // Present in official evidence, but on EVERY course — every candidate
    // scores the same, so it cannot separate anything.
    expect(impact.distinguishingTopics).not.toContain('engineering_design');
    // Present in evidence (E1), but E1 is in BOTH candidates — no difference.
    expect(impact.distinguishingTopics).not.toContain('manufacturing');
    // Present in evidence (E4), but E4 is in NEITHER retained candidate.
    expect(impact.distinguishingTopics).not.toContain('thermofluids');
    // In the vocabulary, but in no document at all.
    expect(impact.distinguishingTopics).not.toContain('solid_mechanics');
  });

  test('it carries the snapshot, coverage and profile version the UI needs', async () => {
    const impact = impactOf((await run(request()))._body);
    expect(impact.category).toBe('course_topic_interest');
    expect(impact.coverageSufficient).toBe(true);
    expect(impact.hasConflicts).toBe(false);
    expect(typeof impact.snapshotId).toBe('string');
    expect(impact.snapshotId.length).toBeGreaterThan(0);
    expect(impact.profileVersion).toBe(3);
    // Localized labels come from the server, so the UI never needs the
    // vocabulary and an internal id can never become a visible label.
    for (const id of impact.distinguishingTopics) {
      expect(typeof impact.topicLabels[id]).toBe('string');
      expect(impact.topicLabels[id]).not.toBe(id);
    }
  });

  test('with no evidence at all it reports nothing impactful', async () => {
    MOCK_DOCUMENTS = [];
    const impact = impactOf((await run(request()))._body);
    expect(impact.distinguishesCandidates).toBe(false);
    expect(impact.distinguishingTopics).toEqual([]);
    expect(impact.coverageSufficient).toBe(false);
  });

  test('STALE evidence (another catalog year) is inert', async () => {
    MOCK_DOCUMENTS = TOPIC_CORPUS.map((d) => doc(d.courseId, d.text, 2019));
    const impact = impactOf((await run(request()))._body);
    expect(impact.distinguishesCandidates).toBe(false);
    expect(impact.distinguishingTopics).toEqual([]);
  });

  test('an official syllabus two years earlier is usable only through the explicit descriptive freshness policy', async () => {
    MOCK_DOCUMENTS = TOPIC_CORPUS.map((d) => ({ ...d, academicYear: 2025, contentHash: `${d.contentHash}_2025` }));
    const body = (await run(request()))._body;
    const impact = impactOf(body);

    expect(impact.distinguishesCandidates).toBe(true);
    expect(impact.distinguishingTopics).toEqual(['robotics', 'control']);
    expect(body.academicDecision.candidates.evidence.historicalCourseIds).toEqual(ELECTIVES);
    expect(body.academicDecision.candidates.evidence.academicYears).toEqual([2025]);
    expect(body.academicDecision.candidates.evidence.historicalEvidenceNoticeHe).toContain('2025');
    expect(body.academicDecision.candidates.evidence.historicalEvidenceNoticeHe).toContain('2027');
    expect(body.academicDecision.candidates.evidence.historicalEvidenceNoticeHe).toContain('תיאורי');
  });

  test('AMBIGUOUS wording alone never becomes a distinguishing topic', async () => {
    // Real 0542-4391 wording: "בקרה" here means control of the solution process.
    MOCK_DOCUMENTS = [doc('E3', 'כלים לבקרה על מהלך הפתרון, בדיקת התכנסות.')];
    const impact = impactOf((await run(request()))._body);
    expect(impact.distinguishingTopics).not.toContain('control');
  });
});

describe('W1 — the signal survives the shared wire and adapter boundary', () => {
  test('planResponseToModel preserves the exact topic ids, labels and snapshot', async () => {
    const body = (await run(request()))._body;
    const model = generatePlanResponseToModel(body);
    const impact = impactOf(body);
    expect(model.topicQuestionImpact).toBeDefined();
    expect(model.topicQuestionImpact!.distinguishingTopics).toEqual(impact.distinguishingTopics);
    expect(model.topicQuestionImpact!.snapshotId).toBe(impact.snapshotId);
    expect(model.topicQuestionImpact!.topicLabels).toEqual(impact.topicLabels);
    expect(model.topicQuestionImpact!.profileVersion).toBe(impact.profileVersion);
  });

  test('the draft view model receives the SAME impact, unmodified', async () => {
    const model = generatePlanResponseToModel((await run(request()))._body);
    const draft = buildDraftVM(model, { catalogRevision: catalogRevision('r1'), semesters: [], courseCatalog: {} });
    expect(draft.topicQuestionImpact).toEqual(model.topicQuestionImpact);
  });

  test('no raw evidence id or score vector reaches the model', async () => {
    const model = generatePlanResponseToModel((await run(request()))._body);
    const serialized = JSON.stringify(model.topicQuestionImpact);
    expect(serialized).not.toMatch(/sha_|scoreVector|contributions/);
  });

  test('a response WITHOUT the probe yields no impact rather than a fabricated one', () => {
    const model = generatePlanResponseToModel({
      semesters: [], moves: [], warnings_he: [], errors: [], blocked: false,
    } as never);
    expect(model.topicQuestionImpact).toBeUndefined();
  });

  test('FLAG-OFF: the legacy path carries no topic impact at all', async () => {
    const res = await run(request({ use_academic_decision_agent: false }));
    expect(impactOf(res._body)).toBeUndefined();
    expect(generatePlanResponseToModel(res._body).topicQuestionImpact).toBeUndefined();
  });
});

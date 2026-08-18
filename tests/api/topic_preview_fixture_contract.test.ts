/**
 * Guard for the COMMITTED topic-preview evidence fixture.
 *
 * The browser acceptance for topic alignment depends on this fixture producing
 * a very specific, truthful signal. If the fixture, the topic mapper, or the
 * candidate search drifts, the Preview run would silently stop testing what it
 * claims to test — so the expected outcome is pinned here rather than trusted.
 *
 * Reads the fixture through the REAL durable-cache loader, so a malformed
 * manifest or object fails here rather than in a browser.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({
  loadPreparedEvidenceDocuments: jest.fn(() => FIXTURE_DOCUMENTS),
}));

import { join } from 'path';
import { readFileSync } from 'fs';
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { loadDocuments } from '../../api/ai/evidence_cache';

const FIXTURE_ROOT = join(__dirname, '..', '..', 'data', 'evidence_fixtures', 'topic_preview');
const { documents: FIXTURE_DOCUMENTS, corruptedHashes } = loadDocuments(FIXTURE_ROOT);

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'test_program_grounded_preview_2027.json'), 'utf-8'),
);

function makeRes() {
  const res: any = {
    statusCode: 0, setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}
const request = (over: Record<string, unknown> = {}) => ({
  program_id: 'test_program_grounded_preview_2027',
  plan_context: { personal_status: { completed: [], currently_taking: [] } },
  preferences: { disallowed_course_ids: [] },
  session_token: randomUUID(),
  use_academic_decision_agent: true,
  preference_profile: { version: 3, preferences: [] },
  ...over,
});
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body } as any, res); return res; }

const topicPref = (normalized: string, over: Record<string, unknown> = {}) => ({
  id: 'course_topic_interest', category: 'course_topic_interest',
  normalized, value: normalized, classification: 'soft_preference', confidence: 0.9,
  source: 'explicit_answer', confirmationStatus: 'confirmed',
  affects: 'grounded_topic_interest', mayAffectPlanningBeforeConfirmation: true,
  ...over,
});
const placed = (b: any): string[] => (b.semesters ?? []).flatMap((s: any) => s.course_ids).sort();

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

describe('the committed topic-preview fixture is loadable and complete', () => {
  test('it reads through the real durable cache with no corruption', () => {
    expect(corruptedHashes).toEqual([]);
    expect(FIXTURE_DOCUMENTS.map((d) => d.courseId).sort()).toEqual(['E1', 'E2', 'E3', 'E4']);
  });

  test('every document is OFFERING-scoped, so coverage is complete by construction', () => {
    for (const d of FIXTURE_DOCUMENTS) {
      expect(d.labeledFields['מספר קורס'][0]).not.toMatch(/-\d\d$/);
      expect(d.academicYear).toBe(2027);
    }
  });

  test('delivery mode is IDENTICAL everywhere, so only the topic question is live', async () => {
    const body = (await run(request()))._body;
    expect(body.academicDecision.candidates.evidence.groundedQuestionImpact.distinguishesCandidates).toBe(false);
  });
});

describe('the fixture produces exactly the signal the browser run asserts', () => {
  test('robotics and control distinguish; nothing else does', async () => {
    const impact = (await run(request()))._body.academicDecision.candidates.evidence.topicQuestionImpact;
    expect(impact.distinguishesCandidates).toBe(true);
    expect(impact.distinguishingTopics).toEqual(['robotics', 'control']);
    expect(impact.topicLabels).toEqual({ robotics: 'רובוטיקה', control: 'בקרה ומערכות' });
    expect(impact.coverageSufficient).toBe(true);
    expect(impact.hasConflicts).toBe(false);
  });

  test('a confirmed topic CHANGES the real selected plan', async () => {
    const canonical = placed((await run(request()))._body);
    const withTopic = placed((await run(request({
      preference_profile: { version: 4, preferences: [topicPref('robotics')] },
    })))._body);
    expect(canonical).not.toContain('E3');
    expect(withTopic).toContain('E3');
    expect(withTopic).not.toEqual(canonical);
  });

  test('INDIFFERENT restores the canonical selection', async () => {
    const canonical = placed((await run(request()))._body);
    const indifferent = placed((await run(request({
      preference_profile: { version: 4, preferences: [topicPref('robotics', { classification: 'indifferent' })] },
    })))._body);
    expect(indifferent).toEqual(canonical);
  });

  test('a HARD exclusion of the favoured course still wins over the topic', async () => {
    const body = (await run(request({
      preferences: { disallowed_course_ids: ['E3'] },
      preference_profile: { version: 4, preferences: [topicPref('robotics')] },
    })))._body;
    expect(placed(body)).not.toContain('E3');
  });
});

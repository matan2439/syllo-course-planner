/**
 * K9A — the typed GROUNDED COURSE-FEATURE preference and its single eligibility
 * mapping.
 *
 * The contract is deliberately GENERIC: the conversation and the request speak
 * about a course FEATURE (`course_feature` / `practical_laboratory`), never
 * about the planner's internal objective id. Exactly one boundary
 * (`resolveGroundedObjective`, alongside `resolveDistributionPolicy`) translates
 * an eligible typed preference into a planner objective, so the UI, handler and
 * planner can never reinterpret the same preference differently.
 *
 * The first test is the RED handler-level proof the brief asks for: a real,
 * confirmed native preference sent through the REAL Generate handler currently
 * cannot activate the grounded objective.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import {
  resolveGroundedObjective,
  GROUNDED_FEATURE_CATEGORY,
  GROUNDED_FEATURE_AFFECTS,
  SUPPORTED_GROUNDED_FEATURES,
} from '../../api/ai/grounded_preference';
import type { Preference, PreferenceProfile } from '../../api/ai/preference_model';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

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

/** The user-facing typed preference — a course FEATURE, not an objective id. */
const labPreference = (over: Partial<Preference> = {}): Preference => ({
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

const profileOf = (prefs: Preference[], version = 4): PreferenceProfile => ({ version, preferences: prefs });
const resolve = (prefs: Preference[], version = 4) =>
  resolveGroundedObjective(effectivePlannerPreferences(profileOf(prefs, version)));

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

// ── the RED handler-level proof ──────────────────────────────────────────────

describe('K9A — a real confirmed native preference reaches the grounded objective', () => {
  beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
  afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

  test('the handler discloses the resolved grounded objective for a confirmed preference', async () => {
    const res = await run(body({
      preference_profile: { version: 4, preferences: [labPreference()] },
    }));
    expect(res.statusCode).toBe(200);
    const g = res._body.academicDecision.groundedObjective;
    expect(g).toBeDefined();
    expect(g.objective).toBe('prefer_laboratory_courses');
    expect(g.provenance.preferenceId).toBe('course_feature_practical');
    expect(g.provenance.profileVersion).toBe(4);
  });

  test('no such preference → the handler discloses no grounded objective', async () => {
    const res = await run(body({ preference_profile: { version: 4, preferences: [] } }));
    expect(res._body.academicDecision.groundedObjective.objective).toBeNull();
  });
});

// ── the mapping boundary ─────────────────────────────────────────────────────

describe('resolveGroundedObjective — the single eligibility mapping', () => {
  test('a CONFIRMED active laboratory preference maps to the grounded objective', () => {
    const r = resolve([labPreference()]);
    expect(r.objective).toBe('prefer_laboratory_courses');
    expect(r.provenance).toMatchObject({
      preferenceId: 'course_feature_practical', source: 'explicit_answer', profileVersion: 4,
    });
  });

  test('the contract is generic — the request speaks of a FEATURE, not the objective id', () => {
    expect(SUPPORTED_GROUNDED_FEATURES).toContain('practical_laboratory');
    // The internal objective name is never required as an input value.
    expect(SUPPORTED_GROUNDED_FEATURES).not.toContain('prefer_laboratory_courses');
    expect(resolve([labPreference({ normalized: 'prefer_laboratory_courses' })]).objective).toBeUndefined();
  });

  test.each([
    ['indifferent', { classification: 'indifferent' as const }],
    ['uncertain', { classification: 'uncertain' as const, mayAffectPlanningBeforeConfirmation: false }],
    ['unconfirmed', { confirmationStatus: 'unconfirmed' as const, mayAffectPlanningBeforeConfirmation: false }],
    ['rejected', { confirmationStatus: 'rejected' as const, mayAffectPlanningBeforeConfirmation: false }],
  ])('%s never activates the objective', (_label, over) => {
    expect(resolve([labPreference(over)]).objective).toBeUndefined();
  });

  test('an ABSENT preference adds no bias', () => {
    expect(resolve([]).objective).toBeUndefined();
    expect(resolve([]).provenance).toBeUndefined();
  });

  test('an indifferent answer is recorded (so the topic is not re-asked) yet adds no bias', () => {
    const eff = effectivePlannerPreferences(profileOf([labPreference({ classification: 'indifferent' })]));
    expect(resolveGroundedObjective(eff).objective).toBeUndefined();
    // It is present-and-excluded, not missing — that is what suppresses re-asking.
    expect(eff.excluded.map((e) => e.id)).toContain('course_feature_practical');
  });

  test('an UNSUPPORTED feature value is excluded with a deterministic typed reason', () => {
    const r = resolve([labPreference({ normalized: 'prefer_short_lectures' })]);
    expect(r.objective).toBeUndefined();
    expect(r.excluded).toEqual([
      { id: 'course_feature_practical', value: 'prefer_short_lectures', reason: 'unsupported_grounded_feature' },
    ]);
    // deterministic across runs
    expect(JSON.stringify(resolve([labPreference({ normalized: 'prefer_short_lectures' })]))).toBe(JSON.stringify(r));
  });

  test('source and confirmation status stay distinguishable — a safe default is not an explicit answer', () => {
    const explicit = resolve([labPreference({ source: 'explicit_answer' })]);
    const dflt = resolve([labPreference({ source: 'safe_default' })]);
    expect(explicit.provenance!.source).toBe('explicit_answer');
    expect(dflt.provenance!.source).toBe('safe_default');
    expect(explicit.provenance!.source).not.toBe(dflt.provenance!.source);
  });

  test('the preference stays SOFT — it is never promoted to a hard constraint', () => {
    const eff = effectivePlannerPreferences(profileOf([labPreference()]));
    expect(eff.soft.map((p) => p.id)).toContain('course_feature_practical');
    expect(eff.hard).toEqual([]);
  });

  test('even a hard_constraint classification cannot make this feature affect legality', () => {
    // The mapping only ever yields a SOFT ranking objective; there is no path
    // from a course-feature preference to a legality rule.
    const r = resolve([labPreference({ classification: 'hard_constraint' })]);
    expect(r.objective).toBe('prefer_laboratory_courses');
    // The result shape itself forbids a legality output: the ONLY keys are the
    // soft objective, its provenance, and unsupported-value exclusions. (A
    // `hardConstraint` field does not type-check, which is the real guarantee.)
    expect(Object.keys(r).sort()).toEqual(['objective', 'provenance']);
  });

  test('the profile version travels with the resolution, so mutations stale a proposal', () => {
    expect(resolve([labPreference()], 4).provenance!.profileVersion).toBe(4);
    expect(resolve([labPreference()], 5).provenance!.profileVersion).toBe(5);
  });
});

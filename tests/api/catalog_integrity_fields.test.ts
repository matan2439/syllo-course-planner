/**
 * Catalog-integrity FIELD-LEVEL enforcement + the screenshot/reproduction
 * reckoning.
 *
 * Field matrix (each field either enforced by an existing gate — proved here —
 * or gated in course_profile.ts):
 *   - canonical course ID   → wire boardResponseSchema (course_id: min(1)) +
 *                             buildCourseProfiles skips non-string ids.
 *   - catalog record        → planContextToState drops any placed id absent from
 *                             the universe; the planner only ADDs from profiles.
 *   - Hebrew display name    → course_profile.ts excluded gate (66ea1c2).
 *   - credit/workload value  → course_profile.ts excluded gate (this slice).
 *   - offering data          → getLegalSemesters fallback (confident:false); a
 *                             placement-policy choice, NOT a catalog gate (see report).
 *   - prerequisites          → [] is the authoritative "no prerequisites" value,
 *                             never a reason to exclude (course_profile test 3).
 *
 * Screenshot reckoning: the reproduced ME-2027 request never places a name-less
 * or hours-less course, so it cannot itself render the screenshot's
 * "פרטי הקורס אינם זמינים" card (see report §2). This proves the stronger
 * invariant instead: EVERY placed id the API returns resolves — with a name AND
 * authoritative hours — through the real wire → adapter → model → UI path.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { boardResponseToModel, generatePlanResponseToModel } from '../../shared/planner/adapters';
import { buildDraftVM } from '../../web/lib/planner/draft-vm';
import { buildConstraintModel, planContextToState } from '../../api/ai/planner_model';

const BOARD_JSON = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);

const makeRes = () => {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
};
async function run(body: any) {
  const res = makeRes();
  await handler({ method: 'POST', body } as any, res);
  return res;
}

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

describe('catalog integrity — canonical course ID (wire boundary)', () => {
  it('the wire adapter rejects an empty course_id', () => {
    const bad = {
      semesters: [{ semester_id: 'year_3_semester_a', courses: [{ course_id: '', name_he: 'x', weekly_hours: 3 }] }],
      warnings: [], metadata: { board_data_version: 'v1' },
    };
    expect(() => boardResponseToModel(bad)).toThrow();
  });
});

describe('catalog integrity — a catalog record is required to be planned over', () => {
  it('planContextToState drops a placed id absent from the universe, keeps a real one', () => {
    const model = buildConstraintModel(BOARD_JSON, {});
    const state = planContextToState(
      { semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'NOT-IN-CATALOG' }, { course_id: '0542-2400' }] }] },
      model,
    );
    const placed = Object.values(state.semesters).flat();
    expect(placed).not.toContain('NOT-IN-CATALOG'); // no catalog record → never carried into the plan
    expect(placed).toContain('0542-2400');          // a real catalog course is kept
  });
});

describe('screenshot/reproduction — every API-placed id resolves through wire→adapter→model→UI', () => {
  it('the reproduced ME-2027 proposal renders no missing-info card and no partial semester', async () => {
    const planContext = {
      semesters: BOARD_JSON.semesters.map((s: any) => ({
        id: s.semester_id, courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })),
      })),
      personal_status: { completed: [], currently_taking: [], planned: [] },
      total_hours_progress: { known_completed_hours: 90 },
    };
    const res = await run({
      program_id: 'mechanical_engineering_2027',
      plan_context: planContext,
      preferences: { max_weekly_hours: 24, extra_request_he: 'אני רוצה מבוא לאלמנטים סופיים ותורת התנודות. בלי תרמודינמיקה 2.' },
      interpret_free_text: true,
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.blocked).toBe(false);

    // The exact wire → adapter → model → UI path the browser uses.
    const board = boardResponseToModel(BOARD_JSON);
    const gen = generatePlanResponseToModel(res._body);
    const draft = buildDraftVM(gen, board);

    let placedCount = 0;
    for (const s of draft.semesters) {
      for (const c of s.courses) {
        placedCount++;
        expect(c.resolved).toBe(true);                          // present in courseCatalog
        expect(typeof c.nameHe).toBe('string');                 // never null → never "פרטי הקורס אינם זמינים"
        expect((c.nameHe ?? '').length).toBeGreaterThan(0);
        expect(c.weeklyHours).not.toBeNull();                   // authoritative hours
      }
      expect(s.totalComplete).toBe(true);                       // no "סכום חלקי" partial total
    }
    expect(placedCount).toBeGreaterThan(20); // a full ~26-course degree plan really was inspected
  }, 60000);
});

/**
 * B2 — local acceptance over the frozen official 2025 cache and the real 2027
 * Mechanical board. The cache is intentionally git-ignored, so CI without the
 * frozen corpus skips the data-dependent assertion; the committed fixture/unit
 * suites still cover the mechanism everywhere.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PROGRAM = 'mechanical_engineering_2027';
const CACHE = join(process.cwd(), 'data', 'evidence_cache');
const BOARD = JSON.parse(readFileSync(join(process.cwd(), 'data', 'boards', `${PROGRAM}.json`), 'utf8'));
const SELECTED_MATERIALS_COURSE = '0542-4425';
const ALTERNATIVE_MATERIALS_COURSE = '0581-4131';

const planContext = () => ({
  semesters: BOARD.semesters.map((s: any) => ({
    id: s.semester_id,
    courses: (s.courses ?? []).map((c: any) => ({ course_id: c.course_id })),
  })),
  personal_status: { completed: [], currently_taking: [], planned: [] },
  total_hours_progress: { known_completed_hours: 92 },
});

const makeRes = () => ({
  statusCode: 0, setHeader: jest.fn().mockReturnThis(),
  status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
  json: jest.fn(function (this: any, body: any) { this._body = body; return this; }),
  write: jest.fn(), end: jest.fn(),
} as any);

test('an explicit free-text materials focus uses recent official evidence and changes the real recommendation', async () => {
  if (!existsSync(CACHE)) return;
  process.env.AI_DEV_MODE = 'true';
  process.env.AI_DEV_BYPASS_QUOTA = 'true';
  try {
    const generate = async (focus = false) => {
      const res = makeRes();
      await handler({ method: 'POST', body: {
      program_id: PROGRAM,
      plan_context: planContext(),
      preferences: {
        disallowed_course_ids: [],
        ...(focus ? { extra_request_he: 'אני רוצה להתמקד בחומרים' } : {}),
      },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
      interpret_free_text: true,
      } } as any, res);
      expect(res.statusCode).toBe(200);
      expect(res._body.blocked).toBe(false);
      return res._body.academicDecision.candidates;
    };

    const control = await generate(false);
    const candidates = await generate(true);
    const courseSets = candidates.summaries.map((s: any) => [...s.courseIds].sort().join('|'));
    expect(new Set(courseSets).size).toBeGreaterThan(1);
    expect(candidates.selectedCandidateId).not.toBe(control.selectedCandidateId);
    expect(candidates.summaries.some((s: any) => s.courseIds.includes(ALTERNATIVE_MATERIALS_COURSE))).toBe(true);
    expect(candidates.summaries.find((s: any) => s.selected).courseIds).toContain(SELECTED_MATERIALS_COURSE);
    expect(candidates.selectedGroundedScore.score).toBeGreaterThan(0);
    expect(candidates.selectedGroundedScore.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ courseId: SELECTED_MATERIALS_COURSE, topicId: 'materials', academicYear: 2025 })]),
    );
    expect(candidates.evidence.historicalCourseIds).toContain(SELECTED_MATERIALS_COURSE);
    expect(candidates.evidence.historicalEvidenceNoticeHe).toContain('2025');
  } finally {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  }
}, 180000);

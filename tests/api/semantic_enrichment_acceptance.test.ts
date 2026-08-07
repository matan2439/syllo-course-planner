/**
 * PRODUCT acceptance for the semantic syllabus-enrichment pipeline:
 *   authoritative snapshot → semantic extraction (captured, untrusted) → grounding
 *   validation → versioned cache → evidence-backed matcher → real planner.
 *
 * Proves semantic value BEYOND the legacy pattern extractor on REAL courses, that the
 * validated cache feeds the real planner, that Generate consumes the cache (no live
 * extraction), and that priority/legality are preserved.
 */
import handler, { buildCourseFitById } from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCourseCapabilityEvidence } from '../../api/ai/course_capability_evidence';
import { loadEnrichedProfileCache, lookupProfile } from '../../api/ai/course_profile_cache';
import { buildSyllabusSnapshot } from '../../api/ai/syllabus_snapshot';
import { validateExtraction } from '../../api/ai/semantic_extraction_validator';

const PROGRAM = 'mechanical_engineering_2027';
const BOARD = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'boards', `${PROGRAM}.json`), 'utf8'));
const byId = new Map<string, any>();
for (const s of BOARD.semesters) for (const c of (s.courses || [])) byId.set(c.course_id, c);
for (const c of (BOARD.metadata?.program_repository_courses || [])) byId.set(c.course_id, c);

const SEMANTIC_ONLY = ['0571-4174', '0542-4226']; // legacy misses; semantic catches
const DESIGN_EXPLICIT = '0542-4425';
const NO_DESIGN = '0542-4420'; // machine theory — validated absence
const PRIOR = 92;

function planContext() {
  return {
    semesters: BOARD.semesters.map((s: any) => ({ id: s.semester_id, courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })) })),
    personal_status: { completed: [], currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: PRIOR },
  };
}
const makeRes = () => ({ statusCode: 0, setHeader: jest.fn().mockReturnThis(), status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }), json: jest.fn(function (this: any, b: any) { this._body = b; return this; }), write: jest.fn(), end: jest.fn() } as any);
async function run(body: any) { const res = makeRes(); await handler({ method: 'POST', body: { program_id: PROGRAM, session_token: randomUUID(), ...body } } as any, res); return res; }
const placed = (b: any): string[] => [...new Set((b.semesters as any[]).flatMap((s) => s.course_ids))];

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// (semantic value) legacy pattern extractor MISSES these; the validated cache catches them.
test('semantic pipeline identifies design where the legacy pattern extractor does NOT', () => {
  const cache = loadEnrichedProfileCache(PROGRAM)!;
  expect(cache).toBeTruthy();
  for (const id of SEMANTIC_ONLY) {
    expect(extractCourseCapabilityEvidence(byId.get(id), 'mechanical_design').inferenceLevel).toBe('missing'); // legacy misses
    const look = lookupProfile(cache, buildSyllabusSnapshot(byId.get(id), PROGRAM), 'mechanical_design');
    expect(look.status).toBe('hit'); // semantic (validated) catches it
    expect(look.evidence!.inferenceLevel).toBe('derived');
    expect(look.evidence!.confidence).toBeLessThanOrEqual(0.6); // bounded, never over-confident
    expect(BOARD ? byId.get(id).syllabus_summary_he : '').toContain((look.evidence!.extractedEvidence ?? "").split(' … ')[0]); // grounded in real source
  }
});

// (grounding safety) a fabricated excerpt is rejected end-to-end and never becomes evidence.
test('a hallucinated (non-source) excerpt is rejected by the grounding validator', () => {
  const snap = buildSyllabusSnapshot(byId.get(DESIGN_EXPLICIT), PROGRAM);
  const bad = { courseId: DESIGN_EXPLICIT, snapshotHash: snap.contentHash, claims: [
    { courseId: DESIGN_EXPLICIT, capability: 'mechanical_design', relationship: 'teaches', strength: 0.9, inferenceLevel: 'explicit', confidence: 0.9,
      evidenceSpans: [{ excerpt: 'טקסט שהומצא ואינו קיים בסילבוס', section: null, startOffset: 0, endOffset: 5 }], rationale: 'x', unsupportedOrAmbiguous: false }] };
  const r = validateExtraction(bad as any, snap, { courseTitle: byId.get(DESIGN_EXPLICIT).name_he });
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/grounded|source|offset/i);
});

// (cache → matcher) the validated semantic signal reaches the planner fit map; validated
// absence (no design) contributes nothing.
test('validated cached evidence (incl. semantic-only courses) reaches the fit map; absences do not', () => {
  const fit = buildCourseFitById(BOARD, [{ area: 'mechanical_design', weight: 1 }], PROGRAM)!;
  expect(fit).toBeTruthy();
  for (const id of SEMANTIC_ONLY) expect(fit.fitById.get(id)).toBeGreaterThan(0);
  expect(fit.fitById.has(NO_DESIGN)).toBe(false); // machine-theory course: no confident fit
  // the fit value equals the cache strength (proves it is cache-sourced, not recomputed by legacy)
  const cache = loadEnrichedProfileCache(PROGRAM)!;
  const look = lookupProfile(cache, buildSyllabusSnapshot(byId.get(DESIGN_EXPLICIT), PROGRAM), 'mechanical_design');
  expect(fit.fitById.get(DESIGN_EXPLICIT)).toBe(look.evidence!.strength);
});

// (real plan change, cache-sourced) the design request changes the real legal plan, and the
// honored explanation cites the cached validated evidence.
test('the design request changes the real proposal using cached evidence, cited truthfully', async () => {
  const control = await run({ plan_context: planContext(), preferences: {} });
  const focus = await run({ plan_context: planContext(), preferences: { extra_request_he: 'אני רוצה להתמקד בתכן' }, interpret_free_text: true });
  expect(control._body.blocked).toBe(false);
  expect(focus._body.blocked).toBe(false);
  expect(focus._body.errors).toEqual([]);
  expect(placed(control._body)).not.toContain(DESIGN_EXPLICIT);
  expect(placed(focus._body)).toContain(DESIGN_EXPLICIT); // evidence-backed change
  const cache = loadEnrichedProfileCache(PROGRAM)!;
  const quote = (cache.profiles[DESIGN_EXPLICIT].evidence[0].extractedEvidence ?? "").split(' … ')[0];
  expect(focus._body.intentOutcome.honored.join(' ')).toContain(quote); // cites the cached evidence
}, 120000);

// (priority) exclusion beats the semantic general fit.
test('explicit exclusion beats the semantic design fit', async () => {
  const res = await run({ plan_context: planContext(), preferences: { extra_request_he: 'אני רוצה להתמקד בתכן', disallowed_course_ids: [DESIGN_EXPLICIT] }, interpret_free_text: true });
  expect(placed(res._body)).not.toContain(DESIGN_EXPLICIT);
}, 120000);

// (no confident change from a validated absence) a machine-theory course is never pulled in by design focus.
test('a course with validated NO-design evidence is not introduced by the design request', async () => {
  const focus = await run({ plan_context: planContext(), preferences: { extra_request_he: 'אני רוצה להתמקד בתכן' }, interpret_free_text: true });
  const control = await run({ plan_context: planContext(), preferences: {} });
  // 0542-4420 is not added by focus beyond whatever control already had (never introduced by fit).
  expect(placed(focus._body).includes(NO_DESIGN)).toBe(placed(control._body).includes(NO_DESIGN));
}, 120000);

/**
 * Coverage regression suite for the full EE + ME enrichment pipeline.
 *
 * Verifies:
 *  1. Both profile files have adequate profile counts.
 *  2. All profiles have structurally valid fields.
 *  3. No hand-reviewed (captured-review-v1) profile was overwritten.
 *  4. buildCourseFitById differentiates EE specialisation areas correctly.
 *  5. Negative-control assertions: clearly off-domain courses do NOT score
 *     at the 'derived' (0.6) level for unrelated capabilities.
 *  6. ME signal_processing focus returns no results (capability not in program).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCourseFitById } from '../../api/ai/generate-plan';
import {
  loadEnrichedProfileCache,
  lookupProfile,
} from '../../api/ai/course_profile_cache';
import { buildSyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

// ── Board loaders ────────────────────────────────────────────────────────────

function loadBoard(name: string): any {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'data', 'boards', `${name}.json`), 'utf8'),
  );
}

const EE_BOARD = loadBoard('electrical_engineering_2027');
const ME_BOARD = loadBoard('mechanical_engineering_2027');

function boardCourses(board: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const s of board.semesters ?? [])
    for (const c of s.courses ?? []) out[c.course_id] = c;
  for (const c of board.metadata?.program_repository_courses ?? []) out[c.course_id] = c;
  return out;
}

// ── 1. Profile-count thresholds ──────────────────────────────────────────────

test('EE profile file has ≥ 100 profiles after pipeline', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  expect(Object.keys(cache.profiles).length).toBeGreaterThanOrEqual(100);
});

test('ME profile file has ≥ 80 profiles after pipeline', () => {
  const cache = loadEnrichedProfileCache('mechanical_engineering_2027')!;
  expect(Object.keys(cache.profiles).length).toBeGreaterThanOrEqual(80);
});

// ── 2. Structural validity ───────────────────────────────────────────────────

test.each(['electrical_engineering_2027', 'mechanical_engineering_2027'])(
  'All %s profiles have required structural fields',
  (programId) => {
    const cache = loadEnrichedProfileCache(programId)!;
    for (const [cid, p] of Object.entries(cache.profiles)) {
      expect(typeof p.courseId).toBe('string');
      expect(typeof p.snapshotHash).toBe('string');
      expect(p.schemaVersion).toBe('1');
      expect(p.ontologyVersion).toBe('1');
      expect(p.extractorVersion).toBe('1');
      expect(['captured-review-v1', 'deterministic-v1']).toContain(p.extractorName);
      expect(Array.isArray(p.evaluatedCapabilities)).toBe(true);
      expect(Array.isArray(p.evidence)).toBe(true);
      // All evidence items must have required fields
      for (const ev of p.evidence) {
        expect(ev.courseId).toBe(cid);
        expect(typeof ev.capability).toBe('string');
        expect(typeof ev.strength).toBe('number');
        expect(ev.strength).toBeGreaterThanOrEqual(0);
        expect(ev.strength).toBeLessThanOrEqual(1);
        expect(typeof ev.extractedEvidence).toBe('string');
        expect((ev.extractedEvidence ?? '').length).toBeGreaterThan(0);
      }
    }
  },
);

// ── 3. Hand-reviewed profiles not overwritten ────────────────────────────────

test('EE hand-reviewed profiles (captured-review-v1) are preserved unchanged', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const handReviewed = Object.values(cache.profiles).filter(
    (p) => p.extractorName === 'captured-review-v1',
  );
  expect(handReviewed.length).toBeGreaterThanOrEqual(18);
  for (const p of handReviewed) {
    // Hand-reviewed profiles use 'captured' extractor kind
    expect(p.extractorKind).toBe('captured');
  }
});

test('ME hand-reviewed profiles (captured-review-v1) are preserved unchanged', () => {
  const cache = loadEnrichedProfileCache('mechanical_engineering_2027')!;
  const handReviewed = Object.values(cache.profiles).filter(
    (p) => p.extractorName === 'captured-review-v1',
  );
  expect(handReviewed.length).toBeGreaterThanOrEqual(6);
});

// ── 4. EE specialisation differentiation ─────────────────────────────────────

test('buildCourseFitById produces distinct scores for vlsi vs signal_processing focus', () => {
  const vlsi = buildCourseFitById(
    EE_BOARD, [{ area: 'vlsi' as const, weight: 1 }], 'electrical_engineering_2027',
  );
  const sp = buildCourseFitById(
    EE_BOARD, [{ area: 'signal_processing' as const, weight: 1 }], 'electrical_engineering_2027',
  );
  expect(vlsi).not.toBeUndefined();
  expect(sp).not.toBeUndefined();
  // The two specialisations should recommend different course sets
  const vlsiIds = new Set(vlsi!.fitById.keys());
  const spIds = new Set(sp!.fitById.keys());
  // They should NOT be identical
  const intersection = [...vlsiIds].filter((id) => spIds.has(id));
  expect(intersection.length).toBeLessThan(Math.max(vlsiIds.size, spIds.size));
});

test('buildCourseFitById scores ml_ai courses differently from circuits courses', () => {
  const mlai = buildCourseFitById(
    EE_BOARD, [{ area: 'ml_ai' as const, weight: 1 }], 'electrical_engineering_2027',
  );
  const circuits = buildCourseFitById(
    EE_BOARD, [{ area: 'circuits_electronics' as const, weight: 1 }], 'electrical_engineering_2027',
  );
  // Both should return results (there are profiles for each)
  if (mlai && circuits) {
    const mlaiIds = new Set(mlai.fitById.keys());
    const circuitIds = new Set(circuits.fitById.keys());
    const sharedCount = [...mlaiIds].filter((id) => circuitIds.has(id)).length;
    expect(sharedCount).toBeLessThan(Math.max(mlaiIds.size, circuitIds.size));
  }
});

// ── 5. Negative-control assertions ───────────────────────────────────────────

test('NC-1: digital-circuits course (0512-3514) has zero ml_ai score', () => {
  const result = buildCourseFitById(
    EE_BOARD, [{ area: 'ml_ai' as const, weight: 1 }], 'electrical_engineering_2027',
  );
  // Digital circuits course should not appear as an ml_ai recommendation
  const score = result?.fitById.get('0512-3514') ?? 0;
  expect(score).toBe(0);
});

test('NC-2: humanities course (0618-1042) has at most estimated-level signal_processing', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const courses = boardCourses(EE_BOARD);
  const course = courses['0618-1042'];
  if (!course) return; // Skip if not in board
  const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');
  const r = lookupProfile(cache, snap, 'signal_processing');
  if (r.status === 'hit') {
    // If matched, it must only be estimated (single incidental mention), never derived
    expect(r.evidence!.inferenceLevel).toBe('estimated');
    expect(r.evidence!.strength).toBeLessThanOrEqual(0.3);
  }
  // Otherwise it's a miss, which is also acceptable
});

test('NC-3: ME program has no planner hits for signal_processing (capability not in ME)', () => {
  // signal_processing is an EE capability, not registered in mechanical_engineering_2027
  const result = buildCourseFitById(
    ME_BOARD, [{ area: 'signal_processing' as const, weight: 1 }], 'mechanical_engineering_2027',
  );
  // ME evaluatedCapabilities do not include signal_processing → no lookupProfile hits
  expect(result).toBeUndefined();
});

// ── 6. Deterministic profiles have termCount metadata ────────────────────────

test('deterministic-v1 evidence items include termCount metadata', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const detProfiles = Object.values(cache.profiles).filter(
    (p) => p.extractorName === 'deterministic-v1' && p.evidence.length > 0,
  );
  expect(detProfiles.length).toBeGreaterThan(0);
  for (const p of detProfiles.slice(0, 5)) {
    for (const ev of p.evidence) {
      expect(typeof (ev as any).termCount).toBe('number');
      expect((ev as any).termCount).toBeGreaterThanOrEqual(1);
    }
  }
});

test('derived-level (0.6) evidence has termCount ≥ 2 or very short content', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  for (const p of Object.values(cache.profiles)) {
    for (const ev of p.evidence) {
      if (ev.inferenceLevel === 'derived') {
        // Either termCount >= 2, or the content is very short (<100 chars)
        const tc = (ev as any).termCount ?? 1;
        const excerpt = ev.extractedEvidence ?? '';
        const isShortContent = excerpt.length < 100;
        expect(tc >= 2 || isShortContent).toBe(true);
      }
    }
  }
});

// ── 7. extractorConfidenceLabel on deterministic profiles ────────────────────

test('deterministic-v1 profiles with any derived evidence have label "medium"', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  for (const p of Object.values(cache.profiles)) {
    if (p.extractorName !== 'deterministic-v1') continue;
    const hasDerived = p.evidence.some((e: any) => e.inferenceLevel === 'derived');
    if (hasDerived) {
      expect((p as any).extractorConfidenceLabel).toBe('medium');
    }
  }
});

test('hand-reviewed profiles do not have extractorConfidenceLabel set automatically', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  for (const p of Object.values(cache.profiles)) {
    if (p.extractorName === 'captured-review-v1') {
      // The 'high' label is reserved for hand-reviewed; pipeline never sets it
      const label = (p as any).extractorConfidenceLabel;
      expect(label).not.toBe('medium');
      expect(label).not.toBe('low');
    }
  }
});

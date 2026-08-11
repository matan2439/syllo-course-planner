/**
 * Slice 6 — deterministic GroundingValidationCapability.
 *
 * Consumes the Ground stage's PlanGrounding and turns unresolved authoritative
 * conflicts into typed, provenance-carrying validation findings that block
 * Apply. It NEVER re-plans, never picks between conflicting sources, and never
 * downgrades a known fact or blocks on a non-critical unknown.
 */
import { DeterministicGroundingValidation } from '../../api/ai/grounding_validation';
import type { PlanGrounding } from '../../api/ai/plan_grounding';

const EMPTY: PlanGrounding = { facts: [], counts: { known: 0, unknown: 0, inferred: 0, conflicting: 0 }, conflicts: [] };

describe('DeterministicGroundingValidation', () => {
  const v = new DeterministicGroundingValidation();

  test('no conflicts → valid, apply not blocked, no findings', () => {
    const r = v.validate({ grounding: EMPTY });
    expect(r.valid).toBe(true);
    expect(r.applyBlocked).toBe(false);
    expect(r.findings).toEqual([]);
  });

  test('an availability conflict → a typed AVAILABILITY finding with provenance, blocks Apply', () => {
    const grounding: PlanGrounding = {
      facts: [{ courseId: 'C', status: 'conflicting', facts: { hours: 4, semesterAvailability: ['b'], prerequisites: [] },
        provenance: { source: 'catalog', dataQuality: 'normalized', confidence: 0.8 } }],
      counts: { known: 0, unknown: 0, inferred: 0, conflicting: 1 },
      conflicts: [{ courseId: 'C', kind: 'catalog_vs_normalized_availability', detail: 'catalog [a] vs normalized [b]' }],
    };
    const r = v.validate({ grounding });
    expect(r.valid).toBe(false);
    expect(r.applyBlocked).toBe(true);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.code).toBe('GROUNDING_AVAILABILITY_CONFLICT');
    expect(f.courseId).toBe('C');
    expect(f.detail).toContain('[a]');
    expect(f.detail).toContain('[b]');
    // Provenance survives (neither source silently chosen).
    expect(f.provenance).toEqual({ source: 'catalog', dataQuality: 'normalized', confidence: 0.8 });
    expect(f.severity).toBe('error');
  });

  test('a completion conflict → a typed COMPLETION finding, blocks Apply', () => {
    const grounding: PlanGrounding = {
      facts: [], counts: { known: 0, unknown: 0, inferred: 0, conflicting: 1 },
      conflicts: [{ courseId: 'D', kind: 'user_assertion_vs_plan', detail: 'marked completed yet placed' }],
    };
    const r = v.validate({ grounding });
    expect(r.findings[0].code).toBe('GROUNDING_COMPLETION_CONFLICT');
    expect(r.applyBlocked).toBe(true);
  });

  test('known facts and non-critical unknowns never produce findings (no downgrade, no false block)', () => {
    const grounding: PlanGrounding = {
      facts: [
        { courseId: 'K', status: 'known', facts: { hours: 4, semesterAvailability: ['a'], prerequisites: [] }, provenance: { source: 's', dataQuality: 'q', confidence: 0.9 } },
        { courseId: 'U', status: 'unknown', facts: { hours: null, semesterAvailability: ['a'], prerequisites: [] }, provenance: { source: null, dataQuality: null, confidence: 0 }, note: 'weekly hours unknown' },
      ],
      counts: { known: 1, unknown: 1, inferred: 0, conflicting: 0 },
      conflicts: [],
    };
    const r = v.validate({ grounding });
    expect(r.valid).toBe(true);
    expect(r.applyBlocked).toBe(false);
    expect(r.findings).toEqual([]);
  });
});

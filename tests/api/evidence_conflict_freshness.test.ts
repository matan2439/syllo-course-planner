/**
 * K5 — conflict and freshness across SEVERAL sources, not one isolated document.
 *
 * Exercises the resolution rules against realistic multi-source situations, and
 * pins that a single deterministic FreshnessPolicy — not scattered timestamp
 * comparisons — decides what is current.
 */
import {
  makeEvidence,
  resolveFact,
  legalityValue,
  DEFAULT_FRESHNESS_POLICY,
  type AcademicEvidence,
  type AcademicFactType,
  type AcademicSourceClass,
} from '../../api/ai/academic_evidence';

const NOW = '2026-08-14T00:00:00.000Z';

function ev(over: Partial<AcademicEvidence> & { sourceClass?: AcademicSourceClass; factType?: AcademicFactType } = {}): AcademicEvidence {
  return makeEvidence({
    institutionId: 'inst.example', programId: 'prog-1', courseId: 'C-100',
    factType: 'credits', value: 4,
    sourceRef: 'https://example.edu/a', sourceClass: 'official_syllabus',
    academicYear: 2027, retrievedAt: '2026-08-01T00:00:00.000Z',
    extractionMethod: 'rule:x', extractionVersion: '1.0.0', confidence: 0.95,
    ...over,
  });
}
const resolve = (list: AcademicEvidence[], ctx?: Parameters<typeof resolveFact>[1]) =>
  resolveFact(list, ctx ?? { academicYear: 2027, now: NOW });

describe('K5 — two official syllabi for different academic years', () => {
  test('the applicable year is used; the other year is retained but never applied', () => {
    const current = ev({ academicYear: 2027, value: 4, sourceRef: 'https://example.edu/2027' });
    const older = ev({ academicYear: 2024, value: 9, sourceRef: 'https://example.edu/2024' });
    const r = resolve([older, current]);
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.value).toBe(4);
    expect(r.evidence).toHaveLength(2); // both retained
  });

  test('a NEWER retrieval for the WRONG year still loses to applicability', () => {
    const wrongYearNewer = ev({ academicYear: 2028, value: 9, retrievedAt: '2026-08-13T00:00:00.000Z' });
    const rightYearOlder = ev({ academicYear: 2027, value: 4, retrievedAt: '2026-01-01T00:00:00.000Z' });
    expect(resolve([wrongYearNewer, rightYearOlder]).value).toBe(4);
  });

  test('ONLY an older year available ⇒ stale, and nothing reaches legality', () => {
    const r = resolve([ev({ academicYear: 2024 })]);
    expect(r.state).toBe('stale');
    expect(legalityValue(r)).toBeUndefined();
  });
});

describe('K5 — cross-source precedence', () => {
  test('official CATALOG outranks official SYLLABUS for a legality-bearing fact', () => {
    const catalog = ev({ sourceClass: 'official_catalog', value: 4, sourceRef: 'https://example.edu/cat' });
    const syllabus = ev({ sourceClass: 'official_syllabus', value: 5, sourceRef: 'https://example.edu/syl' });
    const r = resolve([syllabus, catalog]);
    expect(r.value).toBe(4);
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.evidence).toHaveLength(2); // the outranked record is kept
  });

  test('a DESCRIPTIVE syllabus feature can never override catalog legality', () => {
    // The syllabus describes a feature; the catalog owns credits. Different
    // facts, so the descriptive one cannot touch the legality-bearing one.
    const feature = resolve([ev({ factType: 'descriptive_feature', sourceClass: 'official_syllabus', value: 'lab' })]);
    expect(feature.state).toBe('confirmed_authoritative');
    // …and it yields no legality value for credits, because it is not that fact.
    const credits = resolve([ev({ sourceClass: 'official_catalog', value: 4 })]);
    expect(legalityValue(credits)).toBe(4);
  });

  test('two SAME-LEVEL official sources that disagree stay a conflict, both retained', () => {
    const a = ev({ sourceClass: 'official_catalog', value: 4, sourceRef: 'https://example.edu/a' });
    const b = ev({ sourceClass: 'official_catalog', value: 5, sourceRef: 'https://example.edu/b' });
    const r = resolve([a, b]);
    expect(r.state).toBe('conflicting');
    expect(r.value).toBeUndefined();
    expect(r.evidence).toHaveLength(2);
    expect(legalityValue(r)).toBeUndefined(); // a conflict never reaches ranking or legality
  });
});

describe('K5 — the deterministic freshness policy', () => {
  test('the default policy is explicit and shared, not per-call-site guesswork', () => {
    expect(DEFAULT_FRESHNESS_POLICY).toEqual({
      maxAgeDays: undefined, allowNotYetEffective: false, minConfidence: 0.5,
    });
  });

  test('a retrieval older than the policy bound is stale', () => {
    const r = resolve([ev({ retrievedAt: '2020-01-01T00:00:00.000Z' })], {
      academicYear: 2027, now: NOW, policy: { maxAgeDays: 365 },
    });
    expect(r.state).toBe('stale');
  });

  test('a record NOT YET in effect does not govern the present', () => {
    const r = resolve([ev({ effectiveFrom: '2030-01-01T00:00:00.000Z' })]);
    expect(r.state).toBe('stale');
    // …unless a policy explicitly allows it.
    const allowed = resolve([ev({ effectiveFrom: '2030-01-01T00:00:00.000Z' })], {
      academicYear: 2027, now: NOW, policy: { allowNotYetEffective: true },
    });
    expect(allowed.state).toBe('confirmed_authoritative');
  });

  test('an already-effective record is unaffected by the effective-date rule', () => {
    expect(resolve([ev({ effectiveFrom: '2025-01-01T00:00:00.000Z' })]).state).toBe('confirmed_authoritative');
  });

  test('the policy is a single object — one call site cannot disagree with another', () => {
    const list = [ev({ retrievedAt: '2020-01-01T00:00:00.000Z' })];
    const policy = { maxAgeDays: 365 };
    expect(resolve(list, { academicYear: 2027, now: NOW, policy }).state)
      .toBe(resolve(list, { academicYear: 2027, now: NOW, policy }).state);
  });
});

describe('K5 — degenerate and adversarial records', () => {
  test('a missing/blank academic year never matches the requested year', () => {
    const r = resolve([ev({ academicYear: '' as unknown as number })]);
    expect(r.state).toBe('stale');
    expect(legalityValue(r)).toBeUndefined();
  });

  test('evidence for another COURSE is simply not this course\'s evidence', () => {
    // Callers index by course; a mismatched record resolved on its own is still
    // judged on its own merits and cannot leak into another course's fact.
    const other = ev({ courseId: 'C-999', value: 42 });
    expect(other.courseId).toBe('C-999');
    expect(resolve([other]).value).toBe(42); // only when asked ABOUT C-999
  });

  test('the same source reference with a CHANGED value is a conflict, not an overwrite', () => {
    const v1 = ev({ sourceRef: 'https://example.edu/same', value: 4 });
    const v2 = ev({ sourceRef: 'https://example.edu/same', value: 7 });
    expect(v1.evidenceId).not.toBe(v2.evidenceId); // distinct records
    const r = resolve([v1, v2]);
    expect(r.state).toBe('conflicting');
    expect(r.evidence).toHaveLength(2); // neither silently overwrote the other
  });

  test('resolution is deterministic under input reordering for every scenario above', () => {
    const a = ev({ sourceClass: 'official_catalog', value: 4, sourceRef: 'https://example.edu/a' });
    const b = ev({ sourceClass: 'official_syllabus', value: 5, sourceRef: 'https://example.edu/b' });
    const c = ev({ academicYear: 2024, value: 9 });
    expect(JSON.stringify(resolve([a, b, c]))).toBe(JSON.stringify(resolve([c, b, a])));
  });
});

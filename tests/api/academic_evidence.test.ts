/**
 * K1 — authoritative academic source + evidence contract.
 *
 * The generic boundary for representing academic knowledge WITH PROVENANCE.
 * Nothing here is TAU- or Mechanical-Engineering-specific: institution, program,
 * course and academic year are all parameters.
 *
 * Pins the invariants that matter:
 *   - only AUTHORITATIVE source classes may determine legality-bearing facts;
 *   - secondary/descriptive sources supply context and can never override them;
 *   - no fact is ever stored or resolved without its evidence;
 *   - version applicability beats recency (a newer syllabus for another year
 *     does not silently become current);
 *   - two conflicting authoritative sources produce a deterministic conflict
 *     that RETAINS both records rather than silently picking a winner;
 *   - uncertain / conflicting / stale / missing / unsupported facts never reach
 *     hard legality.
 */
import {
  ACADEMIC_SOURCE_CLASSES,
  LEGALITY_FACT_TYPES,
  isAuthoritativeSourceClass,
  mayDetermineLegality,
  makeEvidence,
  resolveFact,
  legalityValue,
  type AcademicEvidence,
  type AcademicSourceClass,
} from '../../api/ai/academic_evidence';

const NOW = '2026-08-14T00:00:00.000Z';

function ev(over: Partial<AcademicEvidence> = {}): AcademicEvidence {
  return makeEvidence({
    institutionId: 'inst.example',
    programId: 'prog-1',
    courseId: 'C-100',
    factType: 'credits',
    value: 4,
    sourceRef: 'https://example.edu/catalog/C-100',
    sourceClass: 'official_catalog',
    academicYear: 2027,
    retrievedAt: '2026-08-01T00:00:00.000Z',
    extractionMethod: 'rule:catalog_credits',
    extractionVersion: '1.0.0',
    confidence: 0.95,
    ...over,
  });
}

// ── source hierarchy ─────────────────────────────────────────────────────────

describe('source hierarchy', () => {
  test('declares the six source classes in precedence order', () => {
    expect(ACADEMIC_SOURCE_CLASSES).toEqual([
      'official_catalog',
      'official_syllabus',
      'official_timetable',
      'authoritative_student_record',
      'secondary_descriptive',
      'unverified',
    ]);
  });

  test('exactly the four official/record classes are authoritative', () => {
    const authoritative = ACADEMIC_SOURCE_CLASSES.filter(isAuthoritativeSourceClass);
    expect(authoritative).toEqual([
      'official_catalog', 'official_syllabus', 'official_timetable', 'authoritative_student_record',
    ]);
    expect(isAuthoritativeSourceClass('secondary_descriptive')).toBe(false);
    expect(isAuthoritativeSourceClass('unverified')).toBe(false);
  });

  test('a secondary/unverified source may never determine a legality-bearing fact', () => {
    for (const factType of LEGALITY_FACT_TYPES) {
      for (const sourceClass of ['secondary_descriptive', 'unverified'] as AcademicSourceClass[]) {
        expect(mayDetermineLegality(ev({ factType, sourceClass }))).toBe(false);
      }
      expect(mayDetermineLegality(ev({ factType, sourceClass: 'official_catalog' }))).toBe(true);
    }
  });

  test('legality-bearing fact types cover existence, credits, prerequisites, periods, classification, exams and degree legality', () => {
    expect([...LEGALITY_FACT_TYPES].sort()).toEqual([
      'classification', 'course_exists', 'credits', 'degree_legality',
      'exam_rules', 'offering_periods', 'prerequisites',
    ]);
    // A purely descriptive feature is NOT legality-bearing.
    expect(LEGALITY_FACT_TYPES.includes('descriptive_feature' as never)).toBe(false);
  });
});

// ── evidence record ──────────────────────────────────────────────────────────

describe('evidence record', () => {
  test('carries the full provenance schema and a stable derived id', () => {
    const e = ev();
    expect(e).toMatchObject({
      institutionId: 'inst.example', programId: 'prog-1', courseId: 'C-100',
      factType: 'credits', value: 4,
      sourceRef: 'https://example.edu/catalog/C-100', sourceClass: 'official_catalog',
      academicYear: 2027, retrievedAt: '2026-08-01T00:00:00.000Z',
      extractionMethod: 'rule:catalog_credits', extractionVersion: '1.0.0',
      confidence: 0.95, authoritative: true,
    });
    expect(typeof e.evidenceId).toBe('string');
    expect(e.evidenceId.length).toBeGreaterThan(0);
  });

  test('the evidence id is deterministic and distinguishes different facts', () => {
    expect(ev().evidenceId).toBe(ev().evidenceId);
    expect(ev().evidenceId).not.toBe(ev({ value: 5 }).evidenceId);
    expect(ev().evidenceId).not.toBe(ev({ academicYear: 2026 }).evidenceId);
    expect(ev().evidenceId).not.toBe(ev({ sourceClass: 'official_syllabus' }).evidenceId);
  });

  test('authoritative status is DERIVED from the source class, never caller-supplied', () => {
    expect(ev({ sourceClass: 'official_syllabus' }).authoritative).toBe(true);
    expect(ev({ sourceClass: 'secondary_descriptive' }).authoritative).toBe(false);
    // even if a caller tries to claim otherwise
    expect(ev({ sourceClass: 'unverified', authoritative: true } as Partial<AcademicEvidence>).authoritative).toBe(false);
  });

  test('an excerpt or a locator preserves where the claim came from', () => {
    const e = ev({ excerpt: 'נקודות זכות: 4', locator: 'section:credits' });
    expect(e.excerpt).toBe('נקודות זכות: 4');
    expect(e.locator).toBe('section:credits');
  });
});

// ── resolution: no bare facts ────────────────────────────────────────────────

describe('resolveFact always returns evidence with the fact', () => {
  test('a confirmed authoritative fact carries the evidence that established it', () => {
    const e = ev();
    const r = resolveFact([e], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.value).toBe(4);
    expect(r.evidence.map((x) => x.evidenceId)).toContain(e.evidenceId);
  });

  test('no evidence at all resolves to missing, with no value', () => {
    const r = resolveFact([], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('missing');
    expect(r.value).toBeUndefined();
    expect(r.evidence).toEqual([]);
  });
});

// ── version applicability ────────────────────────────────────────────────────

describe('version selection — applicability beats recency', () => {
  test('a NEWER source for a DIFFERENT year does not become the current fact', () => {
    const current = ev({ academicYear: 2027, value: 4, retrievedAt: '2026-01-01T00:00:00.000Z' });
    const otherYear = ev({ academicYear: 2028, value: 9, retrievedAt: '2026-08-01T00:00:00.000Z' });
    const r = resolveFact([otherYear, current], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.value).toBe(4); // the applicable year wins, not the newer retrieval
    // the inapplicable record is retained, never discarded
    expect(r.evidence.map((x) => x.evidenceId)).toContain(otherYear.evidenceId);
  });

  test('ONLY inapplicable-year evidence resolves to stale, never to a confirmed fact', () => {
    const r = resolveFact([ev({ academicYear: 2025, value: 3 })], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('stale');
    expect(r.value).toBeUndefined();
    expect(r.evidence).toHaveLength(1); // retained for review
  });

  test('program applicability is respected — another program does not supply this one', () => {
    const other = ev({ programId: 'prog-2', value: 8 });
    const r = resolveFact([other], { academicYear: 2027, now: NOW, programId: 'prog-1' });
    expect(r.state).not.toBe('confirmed_authoritative');
    expect(r.value).toBeUndefined();
  });
});

// ── conflict detection ───────────────────────────────────────────────────────

describe('conflict rules', () => {
  test('two conflicting AUTHORITATIVE sources of the same class produce a deterministic conflict', () => {
    const a = ev({ value: 4, sourceRef: 'https://example.edu/a' });
    const b = ev({ value: 5, sourceRef: 'https://example.edu/b' });
    const r = resolveFact([a, b], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('conflicting');
    expect(r.value).toBeUndefined(); // never silently picks one
    expect(r.conflict!.evidenceIds.sort()).toEqual([a.evidenceId, b.evidenceId].sort());
    // BOTH records retained
    expect(r.evidence).toHaveLength(2);
  });

  test('conflict detection is order-independent and deterministic', () => {
    const a = ev({ value: 4, sourceRef: 'https://example.edu/a' });
    const b = ev({ value: 5, sourceRef: 'https://example.edu/b' });
    expect(JSON.stringify(resolveFact([a, b], { academicYear: 2027, now: NOW })))
      .toBe(JSON.stringify(resolveFact([b, a], { academicYear: 2027, now: NOW })));
  });

  test('official regulation OUTRANKS a lower official class rather than conflicting', () => {
    const catalog = ev({ sourceClass: 'official_catalog', value: 4 });
    const syllabus = ev({ sourceClass: 'official_syllabus', value: 5 });
    const r = resolveFact([syllabus, catalog], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.value).toBe(4); // catalog wins for a legality-bearing fact
    expect(r.evidence).toHaveLength(2); // the outranked record is still retained
  });

  test('a secondary source disagreeing with an authoritative one NEVER overrides it', () => {
    const official = ev({ sourceClass: 'official_catalog', value: 4 });
    const blog = ev({ sourceClass: 'secondary_descriptive', value: 99 });
    const r = resolveFact([blog, official], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('confirmed_authoritative');
    expect(r.value).toBe(4);
  });

  test('agreeing sources are not a conflict', () => {
    const a = ev({ value: 4, sourceRef: 'https://example.edu/a' });
    const b = ev({ value: 4, sourceRef: 'https://example.edu/b' });
    expect(resolveFact([a, b], { academicYear: 2027, now: NOW }).state).toBe('confirmed_authoritative');
  });
});

// ── unsupported / uncertain / stale ──────────────────────────────────────────

describe('non-authoritative and low-confidence claims', () => {
  test('a legality-bearing fact backed ONLY by a secondary source is unsupported', () => {
    const r = resolveFact([ev({ sourceClass: 'secondary_descriptive', value: 4 })], { academicYear: 2027, now: NOW });
    expect(r.state).toBe('unsupported');
    expect(r.value).toBeUndefined();
  });

  test('a DESCRIPTIVE fact backed by a secondary source is confirmed as descriptive, not authoritative', () => {
    const r = resolveFact(
      [ev({ factType: 'descriptive_feature', sourceClass: 'secondary_descriptive', value: 'project' })],
      { academicYear: 2027, now: NOW },
    );
    expect(r.state).toBe('confirmed_descriptive');
    expect(r.value).toBe('project');
  });

  test('low confidence resolves to uncertain, never to a confirmed fact', () => {
    const r = resolveFact([ev({ confidence: 0.2 })], { academicYear: 2027, now: NOW, minConfidence: 0.5 });
    expect(r.state).toBe('uncertain');
    expect(r.value).toBeUndefined();
  });

  test('evidence older than the freshness bound resolves to stale', () => {
    const r = resolveFact([ev({ retrievedAt: '2020-01-01T00:00:00.000Z' })], {
      academicYear: 2027, now: NOW, maxAgeDays: 365,
    });
    expect(r.state).toBe('stale');
    expect(r.value).toBeUndefined();
  });
});

// ── the legality gate ────────────────────────────────────────────────────────

describe('legalityValue — the one door onto hard legality', () => {
  test('only a confirmed AUTHORITATIVE fact yields a legality value', () => {
    expect(legalityValue(resolveFact([ev()], { academicYear: 2027, now: NOW }))).toBe(4);
  });

  test('uncertain, conflicting, stale, missing, unsupported and descriptive never reach legality', () => {
    const cases = [
      resolveFact([], { academicYear: 2027, now: NOW }),                                              // missing
      resolveFact([ev({ academicYear: 2025 })], { academicYear: 2027, now: NOW }),                    // stale
      resolveFact([ev({ confidence: 0.1 })], { academicYear: 2027, now: NOW, minConfidence: 0.5 }),   // uncertain
      resolveFact([ev({ value: 4, sourceRef: 'a' }), ev({ value: 5, sourceRef: 'b' })], { academicYear: 2027, now: NOW }), // conflicting
      resolveFact([ev({ sourceClass: 'secondary_descriptive' })], { academicYear: 2027, now: NOW }),  // unsupported
      resolveFact([ev({ factType: 'descriptive_feature', sourceClass: 'secondary_descriptive', value: 'x' })], { academicYear: 2027, now: NOW }), // confirmed_descriptive
    ];
    for (const r of cases) expect(legalityValue(r)).toBeUndefined();
    expect(cases.map((r) => r.state)).toEqual([
      'missing', 'stale', 'uncertain', 'conflicting', 'unsupported', 'confirmed_descriptive',
    ]);
  });
});

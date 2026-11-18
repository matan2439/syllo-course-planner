/**
 * Step 6.1 regression suite — EE capability ontology extension and enriched profiles.
 *
 * Verifies:
 *  1. CAPABILITY_ONTOLOGY now includes all EE ACADEMIC_FOCUS_AREAS values.
 *  2. capabilitiesFor('electrical_engineering_2027') returns a non-empty list.
 *  3. validateExtraction accepts EE capability claims and rejects unknown ones.
 *  4. Existing ME behavior is unchanged.
 *  5. The EE enriched profile file loads from disk and lookupProfile returns hits.
 *  6. Quality fix: musical DSP (derived 0.6) scores lower than statistical SP (explicit 0.9).
 *  7. buildCourseFitById correctly differentiates the two courses via enriched profiles.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CAPABILITY_ONTOLOGY,
  capabilitiesFor,
  type CandidateExtraction,
} from '../../api/ai/semantic_course_extraction';
import { validateExtraction } from '../../api/ai/semantic_extraction_validator';
import {
  loadEnrichedProfileCache,
  lookupProfile,
  SCHEMA_VERSION,
  ONTOLOGY_VERSION,
  EXTRACTOR_VERSION,
} from '../../api/ai/course_profile_cache';
import { buildSyllabusSnapshot, sha256 } from '../../api/ai/syllabus_snapshot';
import { buildCourseFitById } from '../../api/ai/generate-plan';
import type { SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

const EE_BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'electrical_engineering_2027.json'), 'utf8'),
);

// ── 1. Ontology extension ────────────────────────────────────────────────────

test('CAPABILITY_ONTOLOGY retains mechanical_design (ME regression)', () => {
  expect(CAPABILITY_ONTOLOGY).toContain('mechanical_design');
});

test.each([
  'signal_processing', 'vlsi', 'electromagnetics', 'communications',
  'ml_ai', 'circuits_electronics', 'optics_photonics', 'bioelectronics',
  'quantum_engineering', 'energy_power', 'computer_systems',
])('CAPABILITY_ONTOLOGY includes EE capability %s', (cap) => {
  expect(CAPABILITY_ONTOLOGY).toContain(cap);
});

test('CAPABILITY_ONTOLOGY covers both ME and EE ACADEMIC_FOCUS_AREAS', () => {
  const ontology = CAPABILITY_ONTOLOGY as readonly string[];
  for (const c of ['strength_analysis', 'finite_elements', 'mechanical_design', 'control_systems', 'robotics']) {
    expect(ontology).toContain(c);
  }
  for (const c of ['signal_processing', 'vlsi', 'communications', 'ml_ai', 'circuits_electronics']) {
    expect(ontology).toContain(c);
  }
});

// ── 2. programs.json registration ────────────────────────────────────────────

test('capabilitiesFor electrical_engineering_2027 returns all 11 EE capabilities', () => {
  const caps = capabilitiesFor('electrical_engineering_2027');
  expect(caps.length).toBe(11);
  expect(caps).toContain('signal_processing');
  expect(caps).toContain('vlsi');
  expect(caps).toContain('communications');
  expect(caps).toContain('ml_ai');
});

test('capabilitiesFor mechanical_engineering_2027 is unchanged (ME regression)', () => {
  const caps = capabilitiesFor('mechanical_engineering_2027');
  expect(caps).toContain('mechanical_design');
});

// ── 3. Validator accepts EE capabilities, rejects unknown ────────────────────

function makeSnap(courseId: string, content: string): SyllabusSnapshot {
  const hash = sha256(content);
  return {
    courseId,
    institution: 'TAU',
    programOrCatalog: 'electrical_engineering_2027',
    sourceType: 'official_syllabus',
    sourceUrl: 'https://ims.tau.ac.il/x',
    sourceAuthority: 'tau_official_syllabus',
    sourceYear: 2026,
    language: 'he',
    retrievedAt: '2026-11-18T00:00:00Z',
    contentHash: hash,
    normalizedContent: content,
  };
}

function makeExtraction(snapshot: SyllabusSnapshot, capability: string, excerpt: string, inferenceLevel: 'explicit' | 'derived' | 'estimated' = 'explicit'): CandidateExtraction {
  const i = snapshot.normalizedContent.indexOf(excerpt);
  return {
    courseId: snapshot.courseId,
    snapshotHash: snapshot.contentHash,
    claims: [{
      courseId: snapshot.courseId,
      capability,
      relationship: 'teaches',
      strength: 0.9,
      inferenceLevel,
      confidence: 0.9,
      evidenceSpans: i >= 0
        ? [{ excerpt, section: null, startOffset: i, endOffset: i + excerpt.length }]
        : [],
      rationale: 'teaches this capability',
      unsupportedOrAmbiguous: false,
    }],
  };
}

test('validateExtraction accepts an EE signal_processing claim with grounded excerpt', () => {
  const content = 'עיבוד אותות — שערוך בייסיאני ואופטימליות';
  const snap = makeSnap('0512-4261', content);
  const extraction = makeExtraction(snap, 'signal_processing', 'שערוך בייסיאני ואופטימליות');
  const result = validateExtraction(extraction, snap);
  expect(result.accepted).toHaveLength(1);
  expect(result.rejected).toHaveLength(0);
  expect(result.accepted[0].capability).toBe('signal_processing');
});

test('validateExtraction accepts EE vlsi claim', () => {
  const content = 'תכנון VLSI דיגיטלי: Verilog, סינתזה לוגית, מיקום וחיווט';
  const snap = makeSnap('0512-4707', content);
  const extraction = makeExtraction(snap, 'vlsi', 'תכנון VLSI דיגיטלי: Verilog, סינתזה לוגית, מיקום וחיווט');
  const result = validateExtraction(extraction, snap);
  expect(result.accepted).toHaveLength(1);
  expect(result.rejected).toHaveLength(0);
});

test('validateExtraction rejects a claim with unknown capability', () => {
  const content = 'some course content about interesting things';
  const snap = makeSnap('9999-0000', content);
  const extraction = makeExtraction(snap, 'underwater_basketweaving', 'some course content');
  const result = validateExtraction(extraction, snap);
  expect(result.accepted).toHaveLength(0);
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0].reason).toMatch(/ontology/i);
});

test('validateExtraction rejects an extraction with mismatched snapshot hash', () => {
  const content = 'some course content';
  const snap = makeSnap('0512-4261', content);
  const extraction: CandidateExtraction = { ...makeExtraction(snap, 'signal_processing', 'some course'), snapshotHash: 'wronghash' };
  const result = validateExtraction(extraction, snap);
  expect(result.accepted).toHaveLength(0);
  expect(result.rejected.length).toBeGreaterThan(0);
});

// ── 4. EE profile file loads and returns correct hits ───────────────────────

test('loadEnrichedProfileCache returns the EE profile cache from disk', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027');
  expect(cache).not.toBeNull();
  expect(cache!.programOrCatalog).toBe('electrical_engineering_2027');
  expect(cache!.schemaVersion).toBe(SCHEMA_VERSION);
  expect(cache!.ontologyVersion).toBe(ONTOLOGY_VERSION);
  expect(cache!.extractorVersion).toBe(EXTRACTOR_VERSION);
  expect(Object.keys(cache!.profiles).length).toBeGreaterThanOrEqual(18);
});

function courseSnap(courseId: string): SyllabusSnapshot {
  const courses: any[] = EE_BOARD.metadata?.program_repository_courses ?? [];
  const c = courses.find((x: any) => x.course_id === courseId);
  if (!c) throw new Error(`Course ${courseId} not found in EE board`);
  return buildSyllabusSnapshot(c, 'electrical_engineering_2027');
}

test('lookupProfile returns hit for 0512-4261 signal_processing with explicit strength 0.9', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4261'), 'signal_processing');
  expect(r.status).toBe('hit');
  expect(r.evidence!.inferenceLevel).toBe('explicit');
  expect(r.evidence!.strength).toBe(0.9);
});

test('lookupProfile returns hit for 0512-4295 signal_processing with derived strength 0.6', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4295'), 'signal_processing');
  expect(r.status).toBe('hit');
  expect(r.evidence!.inferenceLevel).toBe('derived');
  expect(r.evidence!.strength).toBe(0.6);
});

test('lookupProfile returns hit for 0512-4707 vlsi with explicit strength 0.9', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4707'), 'vlsi');
  expect(r.status).toBe('hit');
  expect(r.evidence!.strength).toBe(0.9);
});

test('lookupProfile returns hit for 0512-4800 electromagnetics with explicit 0.9', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4800'), 'electromagnetics');
  expect(r.status).toBe('hit');
  expect(r.evidence!.strength).toBe(0.9);
});

test('lookupProfile returns hit for 0512-4264 ml_ai with explicit 0.9', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4264'), 'ml_ai');
  expect(r.status).toBe('hit');
  expect(r.evidence!.strength).toBe(0.9);
});

test('lookupProfile returns hit for 0512-4706 circuits_electronics with explicit 0.9', () => {
  const cache = loadEnrichedProfileCache('electrical_engineering_2027')!;
  const r = lookupProfile(cache, courseSnap('0512-4706'), 'circuits_electronics');
  expect(r.status).toBe('hit');
  expect(r.evidence!.strength).toBe(0.9);
});

// ── 5. Quality fix: musical DSP scores lower than statistical SP ─────────────

test('statistical SP (0512-4261) scores higher than musical DSP (0512-4295) for signal_processing focus', () => {
  const focusAreas = [{ area: 'signal_processing' as const, weight: 1 }];
  const result = buildCourseFitById(EE_BOARD, focusAreas, 'electrical_engineering_2027');
  expect(result).not.toBeUndefined();
  const statSP = result!.fitById.get('0512-4261') ?? 0;
  const musicalDSP = result!.fitById.get('0512-4295') ?? 0;
  expect(statSP).toBeGreaterThan(0.8);   // explicit 0.9 × weight 1
  expect(musicalDSP).toBeGreaterThan(0); // derived 0.6 × weight 1
  expect(statSP).toBeGreaterThan(musicalDSP); // KEY quality fix assertion
});

test('buildCourseFitById produces distinct evidence-backed scores: stat SP 0.9 vs musical DSP 0.6', () => {
  const focusAreas = [{ area: 'signal_processing' as const, weight: 1 }];
  const result = buildCourseFitById(EE_BOARD, focusAreas, 'electrical_engineering_2027')!;
  expect(result.fitById.get('0512-4261')).toBeCloseTo(0.9, 2);
  expect(result.fitById.get('0512-4295')).toBeCloseTo(0.6, 2);
});

test('buildCourseFitById scores VLSI courses for vlsi focus', () => {
  const focusAreas = [{ area: 'vlsi' as const, weight: 1 }];
  const result = buildCourseFitById(EE_BOARD, focusAreas, 'electrical_engineering_2027')!;
  expect(result.fitById.get('0512-4707') ?? 0).toBeGreaterThan(0.8);
  expect(result.fitById.get('0512-4711') ?? 0).toBeGreaterThan(0.8);
});

test('buildCourseFitById scores comms courses for communications focus', () => {
  const focusAreas = [{ area: 'communications' as const, weight: 1 }];
  const result = buildCourseFitById(EE_BOARD, focusAreas, 'electrical_engineering_2027')!;
  expect(result.fitById.get('0512-4161') ?? 0).toBeGreaterThan(0.8);
  expect(result.fitById.get('0512-4100') ?? 0).toBeGreaterThan(0.8);
});

test('buildCourseFitById returns undefined when no focusAreas given', () => {
  const result = buildCourseFitById(EE_BOARD, [], 'electrical_engineering_2027');
  expect(result).toBeUndefined();
});

test('buildCourseFitById returns undefined for unknown program', () => {
  const result = buildCourseFitById(EE_BOARD, [{ area: 'signal_processing' as const, weight: 1 }], 'nonexistent_2027');
  expect(result).toBeUndefined();
});

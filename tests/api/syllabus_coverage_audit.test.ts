/**
 * B0 — the syllabus/evidence coverage audit, pinned as a regression.
 *
 * The audit (`data/import_reports/syllabus_coverage_audit_2027.json`) measured
 * the frozen local corpus against the real TAU Mechanical program and found one
 * fact that dominates every other: the acquired documents are for academic year
 * **2025**, the program board is **2027**, and `prepareEvidence` applies an
 * exact year match. So on the real program, evidence coverage is **0 of 56**
 * and every grounded objective is inert.
 *
 * That is not a parsing problem, and no parser, vocabulary entry or new
 * objective could change a real recommendation while it holds. This suite
 * therefore pins the MECHANISM rather than the corpus:
 *
 *   - the corpus itself is git-ignored and regenerable, so nothing here depends
 *     on it being present;
 *   - the year rule is proven with a document built in-test from a REAL course
 *     id taken from the REAL board, so the only variable is the year;
 *   - the committed audit report is checked against the committed board, so a
 *     catalog change that invalidates the audit surfaces here.
 *
 * If someone later acquires 2027 documents, the live-corpus assertion at the
 * bottom is what tells them the picture changed.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseProgramVersionId } from '../../api/board';
import { prepareEvidence, RECENT_OFFICIAL_SYLLABUS_POLICY } from '../../api/ai/evidence_provider';
import { RuleBasedFeatureExtractor } from '../../api/ai/course_features';
import { loadDocuments } from '../../api/ai/evidence_cache';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const ROOT = process.cwd();
const PROGRAM_ID = 'mechanical_engineering_2027';

const board = JSON.parse(
  readFileSync(join(ROOT, 'data', 'boards', `${PROGRAM_ID}.json`), 'utf8'),
);
const universe: string[] = (board.metadata.program_repository_courses ?? []).map(
  (c: any) => c.course_id,
);
const handlerUniverse: string[] = [
  ...new Set<string>([
    ...universe,
    ...(board.semesters ?? []).flatMap((s: any) => (s.courses ?? []).map((c: any) => c.course_id)),
  ]),
];
const requiringPool = [
  ...new Set<string>(
    (board.metadata.program_requirements_categories?.categories ?? [])
      .filter((c: any) => Number(c.min_courses) > 0)
      .flatMap((c: any) => c.course_ids ?? []),
  ),
];

const auditPath = join(ROOT, 'data', 'import_reports', 'syllabus_coverage_audit_2027.json');
const audit = JSON.parse(readFileSync(auditPath, 'utf8'));

/** A document for a REAL course from the REAL board, at a chosen year. */
function docFor(courseId: string, academicYear: number): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId,
    academicYear,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId}&year=${academicYear}`,
    contentHash: `sha_audit_${courseId}_${academicYear}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': ['מעבדה'] },
    text: 'אופן ההוראה מעבדה תוכן הקורס ומטרתו מעבר חום וזרימה במחליפי החום. מטלות הקורס',
  };
}

const coverageAt = (year: number, documents: SyllabusDocument[]) =>
  prepareEvidence({
    courseIds: universe,
    academicYear: year,
    documents,
    extractor: new RuleBasedFeatureExtractor(),
  });

describe('B0 — the audit is anchored to the real program', () => {
  test('the program id resolves to catalog year 2027', () => {
    expect(parseProgramVersionId(PROGRAM_ID)).toEqual({
      base: 'mechanical_engineering',
      year: 2027,
    });
    expect(audit.catalogYear).toBe(2027);
    expect(audit.programId).toBe(PROGRAM_ID);
  });

  test('the audited universe still matches the committed board', () => {
    // If the catalog grows or shrinks, the audit's percentages stop meaning
    // what they said, and this is where that surfaces.
    expect(audit.universe.programCourses).toBe(universe.length);
    expect(audit.universe.requiringCategoryCourses).toBe(requiringPool.length);
  });
});

describe('B0 — the YEAR is the binding constraint, not parsing', () => {
  const realCourseId = requiringPool[0];

  test('a real course document at the CATALOG year is covered', () => {
    expect(realCourseId).toBeTruthy();
    const prepared = coverageAt(2027, [docFor(realCourseId, 2027)]);
    expect(prepared.coverage.coveredCourseCount).toBe(1);
    expect(prepared.features.size).toBe(1);
    // The delivery-mode fact is genuinely readable — parsing is not the gap.
    expect(prepared.features.get(realCourseId)!.laboratory.value).toBe(true);
  });

  test('the SAME document one year off is inert — no features, no topics', () => {
    const prepared = coverageAt(2027, [docFor(realCourseId, 2025)]);
    expect(prepared.coverage.coveredCourseCount).toBe(0);
    expect(prepared.features.size).toBe(0);
    expect(prepared.topics.size).toBe(0);
    // …and it is reported as STALE rather than silently missing, so the
    // difference between "never acquired" and "acquired for another year"
    // is visible to anyone reading the coverage.
    expect((prepared.coverage as unknown as { staleCourseIds: string[] }).staleCourseIds)
      .toEqual([realCourseId]);
    expect(prepared.coverage.missingCourseIds).toContain(realCourseId);
  });

  test('a year-stale corpus asks no grounded question, rather than guessing', () => {
    // `coverageSufficient` is what gates the delivery/topic questions. With a
    // year-stale corpus it must be false — the system stays silent instead of
    // offering a choice it cannot ground.
    const prepared = coverageAt(2027, [docFor(realCourseId, 2025)]);
    expect(prepared.coverage.coveredCourseCount > 0).toBe(false);
  });
});

describe('B0 — the measured verdicts the audit recorded', () => {
  test('assessment and learning-outcome fields are absent from the source', () => {
    // Re-confirmed at 23 documents, up from the 8 the K8A audit rejected them
    // on. Nothing to parse: the label does not exist in the official page.
    expect(audit.fieldCoverage.assessmentProject).toMatch(/^0\//);
    expect(audit.fieldCoverage.finalExam).toMatch(/^0\//);
    expect(audit.fieldCoverage.coursework).toMatch(/^0\//);
    expect(audit.fieldCoverage.learningOutcomes).toMatch(/^0\//);
    expect(audit.fieldCoverage.skills).toMatch(/^0\//);
    expect(audit.sourceLabelsObserved.join(' ')).not.toMatch(/תוצאות למידה|מיומנוי/);
  });

  test('delivery mode is the one fully-covered field', () => {
    const [known, total] = audit.fieldCoverage.deliveryMode.split('/').map(Number);
    expect(known).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  test('the audit records ZERO applicable coverage at the catalog year', () => {
    expect(audit.applicability.atCatalogYear2027.covered).toBe(0);
    expect(audit.applicability.atCatalogYear2027.stale).toBeGreaterThan(0);
  });
});

/**
 * The live corpus is git-ignored and regenerable, so its absence is normal and
 * must never fail a build. When it IS present, these assertions are what tell a
 * future reader that the audit's central finding still holds — or that someone
 * has acquired documents for the catalog year and the picture has changed.
 */
describe('B0 — the live corpus, when present', () => {
  const cacheRoot = join(ROOT, 'data', 'evidence_cache');
  const present = existsSync(cacheRoot);

  test('it is still year-stale against the catalog year (or the audit is out of date)', () => {
    if (!present) {
      expect(audit.corpus.documents).toBeGreaterThan(0); // the audit still stands on its own
      return;
    }
    const { documents } = loadDocuments(cacheRoot);
    if (documents.length === 0) return;

    const covered = coverageAt(2027, documents).coverage.coveredCourseCount;
    const years = [...new Set(documents.map((d) => d.academicYear))];
    expect({ covered, years }).toEqual({
      covered: audit.applicability.atCatalogYear2027.covered,
      years: audit.corpus.documentYears,
    });
  });

  test('B1 policy activates the audited recent corpus descriptively, without changing the frozen source', () => {
    if (!present) return;
    const { documents } = loadDocuments(cacheRoot);
    if (documents.length === 0) return;

    const prepared = prepareEvidence({
      courseIds: handlerUniverse,
      academicYear: 2027,
      documents,
      descriptiveFreshnessPolicy: RECENT_OFFICIAL_SYLLABUS_POLICY,
    });
    const auditedDistinctCourses = new Set(documents.map((d) => d.courseId).filter((id) => handlerUniverse.includes(id))).size;
    const relevantDocuments = documents.filter((d) => handlerUniverse.includes(d.courseId));

    expect(prepared.coverage.coveredCourseCount).toBe(auditedDistinctCourses);
    expect(prepared.coverage.historicalCourseIds).toHaveLength(auditedDistinctCourses);
    expect(prepared.coverage.academicYears).toEqual([2025]);
    expect(prepared.coverage.conflictingCourseIds).toEqual([]);
    expect(prepared.snapshot.documents).toHaveLength(relevantDocuments.length);
  });
});

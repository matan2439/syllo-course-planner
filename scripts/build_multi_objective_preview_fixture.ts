/**
 * M-browser — the COMMITTED deterministic fixture for the MULTI-OBJECTIVE
 * Preview acceptance (topic + project composed).
 *
 * Performs no network access: it writes four offering-scoped official documents
 * into a cache-shaped directory, using wording taken verbatim from documents
 * already acquired in T2. Offering-scoped (no group suffix) means the fact
 * applies to exactly the object a candidate selects, so coverage is complete by
 * construction — the incomplete live corpus is deliberately NOT used to make a
 * browser flow pass.
 *
 * The corpus is designed so the topic question is the ONLY thing under test:
 *   - every course states `תכן הנדסי`, so `engineering_design` is present in
 *     official evidence yet can never separate two 2-course candidates;
 *   - E1 states manufacturing, but E1 is in BOTH retained candidates;
 *   - E4 states thermofluids, but E4 is in NEITHER retained candidate;
 *   - only E3's own topics (robotics, control) can change the outcome.
 *
 * Usage: npx tsx scripts/build_topic_preview_fixture.ts
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { CACHE_MANIFEST_VERSION, type CacheEntry } from '../api/ai/evidence_cache';
import { FEATURE_EXTRACTION_VERSION } from '../api/ai/course_features';
import type { SyllabusDocument } from '../api/ai/syllabus_source';

/** Matches `test_program_grounded_preview_2027`, whose catalog year is 2027. */
const YEAR = 2027;

/**
 * Designed so BOTH grounded questions are impactful and both answers compose:
 *   E1 — lecture, no distinguishing topic; present in every retained candidate
 *   E2 — lecture, no distinguishing topic
 *   E3 — PROJECT delivery AND robotics content: satisfies both preferences
 *   E4 — laboratory + thermofluids, never retained (breadth only)
 * So {E1,E3} Pareto-dominates {E1,E2}: strictly better on project AND on topic.
 */
const CONTENT: Record<string, string> = {
  E1: 'תכן הנדסי בלבד.',
  E2: 'תכן הנדסי בלבד.',
  // Verbatim from the acquired 0542-4624 (robotics and control laboratory).
  E3: 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת, משוב כוח.',
  // Verbatim wording from the acquired 0542-4094 (flow and energy systems).
  E4: 'תכן הנדסי, מעבר חום וזרימה במחליפי החום.',
};

/** Delivery mode per course — E3 is the only retained PROJECT course. */
const DELIVERY: Record<string, string> = { E1: 'שיעור', E2: 'שיעור', E3: 'פרוייקט', E4: 'מעבדה' };

function doc(courseId: string): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId,
    academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=multiobj${courseId}&year=${YEAR}`,
    contentHash: `sha_multiobj_${courseId}`,
    retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [DELIVERY[courseId]] },
    text: `אופן ההוראה ${DELIVERY[courseId]} תוכן הקורס ומטרתו ${CONTENT[courseId]} מטלות הקורס`,
  };
}

function main() {
  const root = join(process.cwd(), 'data', 'evidence_fixtures', 'multi_objective_preview');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'objects'), { recursive: true });

  const documents = Object.keys(CONTENT).sort().map(doc);
  const entries: CacheEntry[] = [];
  for (const d of documents) {
    writeFileSync(join(root, 'objects', `${d.contentHash}.json`), JSON.stringify(d, null, 2), 'utf-8');
    entries.push({
      contentHash: d.contentHash,
      courseId: d.courseId,
      academicYear: d.academicYear,
      sourceUrl: d.sourceUrl,
      retrievedAt: d.retrievedAt,
      institutionId: d.institutionId,
      extractionVersion: FEATURE_EXTRACTION_VERSION,
    });
  }
  entries.sort((a, b) =>
    a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 :
    a.academicYear - b.academicYear || (a.contentHash < b.contentHash ? -1 : 1),
  );
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ version: CACHE_MANIFEST_VERSION, entries }, null, 2),
    'utf-8',
  );
  console.log(`wrote ${documents.length} documents to ${root}`);
}

main();

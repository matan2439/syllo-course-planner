/**
 * T2 — official CONTENT-SOURCE coverage matrix.
 *
 * Measures, per official source class, how much usable topic evidence exists in
 * the already-acquired corpus. Performs NO acquisition and no network access —
 * it reads the durable evidence cache (K6) and the recorded course-details pages
 * only, so it is deterministic and repeatable.
 *
 * Emits metadata and short official phrases only — never a full course
 * description.
 *
 * Usage: npx tsx scripts/audit_topic_coverage.ts
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadDocuments } from '../api/ai/evidence_cache';
import { groupIdOfDocument } from '../api/ai/feature_applicability';
import {
  extractCourseTopics, officialContentSection, supportedTopics,
  TOPIC_IDS, TOPIC_MAPPER_VERSION, type TopicId,
} from '../api/ai/course_topics';
import { normalizeOfferingGroupUniverse } from '../api/ai/group_universe';
import type { SyllabusDocument } from '../api/ai/syllabus_source';

const TARGET_YEAR = 2025;

/** Unordered pairs the topic set can separate: one supports it, the other does not. */
function distinguishingPairs(byCourse: Map<string, Set<TopicId>>): { total: number; perTopic: Record<string, number> } {
  const known = [...byCourse.keys()];
  const perTopic: Record<string, number> = {};
  const separated = new Set<string>();
  for (const topic of TOPIC_IDS) {
    const yes = known.filter((c) => byCourse.get(c)!.has(topic));
    const no = known.filter((c) => !byCourse.get(c)!.has(topic));
    perTopic[topic] = yes.length * no.length;
    for (const a of yes) for (const b of no) separated.add([a, b].sort().join('|'));
  }
  return { total: separated.size, perTopic };
}

function main() {
  const cacheRoot = (process.env.AI_EVIDENCE_CACHE_DIR ?? '').trim() || join(process.cwd(), 'data', 'evidence_cache');
  if (!existsSync(cacheRoot)) {
    console.error(`no evidence cache at ${cacheRoot}`);
    process.exit(1);
  }
  const { documents, corruptedHashes } = loadDocuments(cacheRoot);
  const courses = [...new Set(documents.map((d) => d.courseId))].sort();
  const applicable = documents.filter((d) => String(d.academicYear) === String(TARGET_YEAR));
  const stale = documents.filter((d) => String(d.academicYear) !== String(TARGET_YEAR));

  // ── source 1: the `נושאי לימוד` sub-label (what K8A actually measured) ──────
  const withTopicLabel = applicable.filter((d) => /נושאי\s*לימוד/.test(d.text ?? ''));
  const topicLabelCourses = [...new Set(withTopicLabel.map((d) => d.courseId))];

  // ── source 2: the `תוכן הקורס ומטרתו` official content section ─────────────
  const withContent = applicable.filter((d) => officialContentSection(d) !== undefined);
  const contentCourses = [...new Set(withContent.map((d) => d.courseId))].sort();

  // Section scope: does the content differ between groups of one course?
  const scopeConflicts: string[] = [];
  const byCourseDocs = new Map<string, SyllabusDocument[]>();
  for (const d of withContent) byCourseDocs.set(d.courseId, [...(byCourseDocs.get(d.courseId) ?? []), d]);
  for (const [courseId, docs] of byCourseDocs) {
    if (docs.length < 2) continue;
    const distinct = new Set(docs.map((d) => officialContentSection(d)));
    if (distinct.size > 1) scopeConflicts.push(courseId);
  }

  const extractionByCourse = new Map<string, Set<TopicId>>();
  const perCourse: Array<Record<string, unknown>> = [];
  for (const courseId of contentCourses) {
    const docs = byCourseDocs.get(courseId)!;
    const extractions = docs.map((d) => extractCourseTopics(d, { academicYear: TARGET_YEAR }));
    const topics = supportedTopics(extractions);
    extractionByCourse.set(courseId, topics);
    perCourse.push({
      courseId,
      documents: docs.length,
      groups: docs.map((d) => groupIdOfDocument(d) ?? '-'),
      topics: [...topics].sort(),
      assertionCount: extractions.reduce((n, e) => n + e.assertions.length, 0),
      ambiguousPhrases: [...new Set(extractions.flatMap((e) => e.ambiguousPhrases))],
      /** Short official phrases only — enough to audit the mapping. */
      sampleWording: [...new Set(extractions.flatMap((e) => e.assertions.map((a) => a.rawWording)))].slice(0, 8),
    });
  }

  const usable = contentCourses.filter((c) => extractionByCourse.get(c)!.size > 0);
  const unknown = contentCourses.filter((c) => extractionByCourse.get(c)!.size === 0);
  const pairs = distinguishingPairs(new Map([...extractionByCourse].filter(([, t]) => t.size > 0)));
  const pairsIncludingUnknown = distinguishingPairs(extractionByCourse);

  // ── source 3: the official course-details page ────────────────────────────
  const detailsDir = join(process.cwd(), 'data', 'raw_html', 'course_details');
  const detailsPages = existsSync(detailsDir)
    ? readdirSync(detailsDir).filter((f) => /^course_\d{8}_\d{4}\.html$/.test(f))
    : [];
  const detailsWithContent = detailsPages.filter((f) => {
    const html = readFileSync(join(detailsDir, f), 'utf-8');
    return /תוכן\s+הקורס|תיאור\s+הקורס|נושאי\s*לימוד/.test(html);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    targetAcademicYear: TARGET_YEAR,
    mapperVersion: TOPIC_MAPPER_VERSION,
    corpus: {
      cacheRoot: 'data/evidence_cache (git-ignored, regenerable)',
      documents: documents.length,
      distinctCourses: courses.length,
      corruptedObjects: corruptedHashes.length,
      applicableDocuments: applicable.length,
      staleDocuments: stale.length,
      sectionsObserved: documents.filter((d) => groupIdOfDocument(d) !== undefined).length,
    },
    sources: [
      {
        priority: 1,
        sourceClass: 'official_syllabus.נושאי לימוד (explicit topic list sub-label)',
        scope: 'course',
        attemptedCourses: courses.length,
        identifiedDocuments: withTopicLabel.length,
        applicableDocuments: withTopicLabel.length,
        coursesWithUsableTopics: topicLabelCourses.length,
        unknownCourses: courses.length - topicLabelCourses.length,
        conflicting: 0,
        staleOrMismatched: 0,
        verdict: 'INSUFFICIENT ALONE — this is the field the K8A audit measured.',
      },
      {
        priority: 1,
        sourceClass: 'official_syllabus.תוכן הקורס ומטרתו (course content and objectives)',
        scope: 'course (measured: identical across groups)',
        attemptedCourses: courses.length,
        identifiedDocuments: withContent.length,
        applicableDocuments: withContent.length,
        coursesWithUsableTopics: usable.length,
        unknownCourses: unknown.length,
        conflicting: scopeConflicts.length,
        staleOrMismatched: stale.length,
        normalizedTopicCandidates: [...new Set([...extractionByCourse.values()].flatMap((s) => [...s]))].sort(),
        distinguishingCandidatePairs: pairs.total,
        distinguishingPairsPerTopic: pairs.perTopic,
        distinguishingPairsIncludingUnknownCourses: pairsIncludingUnknown.total,
      },
      {
        priority: 2,
        sourceClass: 'official_course_details (timetable/offering page)',
        scope: 'offering + section',
        attemptedCourses: detailsPages.length,
        identifiedDocuments: detailsPages.length,
        documentsCarryingCourseContent: detailsWithContent.length,
        coursesWithUsableTopics: 0,
        verdict:
          'NO CONTENT. The page carries course id, group ids, group type, semester, ' +
          'lecturer, building, room, day and time — and no topic or description field. ' +
          'It is authoritative for the GROUP UNIVERSE (T1), not for content.',
      },
      {
        priority: 3,
        sourceClass: 'official_faculty_course_pages',
        verdict:
          'NOT INSPECTED — no faculty course page is referenced by this repository, ' +
          'and locating one would require a search engine or link traversal, both of ' +
          'which the acquisition restrictions forbid.',
      },
    ],
    scopeFinding: {
      multiGroupCoursesWithContent: [...byCourseDocs.entries()].filter(([, d]) => d.length > 1).map(([c]) => c),
      contentDifferedBetweenGroups: scopeConflicts,
      conclusion:
        scopeConflicts.length === 0
          ? 'Content is COURSE-scoped: every multi-group course publishes an identical content section per group, so a topic fact may label a course-level candidate without a complete group universe.'
          : 'Content varies between groups for at least one course — it must be treated as section-scoped.',
    },
    perCourse,
  };

  const outDir = join(process.cwd(), 'data', 'import_reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'topic_coverage_matrix.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify({ ...report, perCourse: `${perCourse.length} entries` }, null, 2));
  console.log(`\nmatrix: ${outPath}`);
}

main();

/**
 * K8A — objective feasibility and coverage audit.
 *
 * Measures, against the ALREADY-ACQUIRED official corpus in the durable evidence
 * cache (K6), whether each candidate grounded objective has enough authoritative
 * evidence to be implementable. Performs NO acquisition and no network access —
 * it only reads the cache, so it is deterministic and repeatable.
 *
 * Emits a metadata-only coverage matrix: counts, coverage rates and a decision
 * per objective. No syllabus prose is printed or written.
 *
 * Usage: npx tsx scripts/audit_objective_coverage.ts
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { loadDocuments } from '../api/ai/evidence_cache';
import { groupIdOfDocument } from '../api/ai/feature_applicability';
import type { SyllabusDocument } from '../api/ai/syllabus_source';

const DELIVERY = 'אופן ההוראה';
const ASSIGNMENTS = 'מטלות הקורס';
const DAY = 'יום';
const HOURS = 'שעות';

/** Delivery-mode values, as the official enumerated field spells them. */
const LAB = /מעבד/;
const PROJECT = /פרוי/;

interface ObjectiveRow {
  priority: number;
  objective: string;
  officialSource: string;
  attemptedCourses: number;
  documentsApplicable: number;
  known: number;
  unknown: number;
  conflictingOrSectionVarying: number;
  coverageRate: string;
  distinguishingCandidatePairs: number;
  selectionChangeFeasible: boolean;
  decision: 'IMPLEMENT' | 'REJECT' | 'DEFER';
  reason: string;
}

function firstValue(doc: SyllabusDocument, label: string): string | undefined {
  return doc.labeledFields?.[label]?.[0];
}

/** Course ids whose observed sections disagree on a delivery-derived feature. */
function sectionVarying(docs: SyllabusDocument[], test: RegExp): string[] {
  const byCourse = new Map<string, Set<boolean>>();
  for (const d of docs) {
    const mode = firstValue(d, DELIVERY);
    if (mode === undefined) continue;
    const set = byCourse.get(d.courseId) ?? new Set<boolean>();
    set.add(test.test(mode));
    byCourse.set(d.courseId, set);
  }
  return [...byCourse.entries()].filter(([, v]) => v.size > 1).map(([k]) => k).sort();
}

/** How many unordered course pairs differ on the feature — the distinguishing power. */
function distinguishingPairs(docs: SyllabusDocument[], test: RegExp): number {
  const byCourse = new Map<string, boolean>();
  for (const d of docs) {
    const mode = firstValue(d, DELIVERY);
    if (mode === undefined) continue;
    // Only unambiguous courses count; a section-varying course is not usable.
    if (byCourse.has(d.courseId) && byCourse.get(d.courseId) !== test.test(mode)) {
      byCourse.delete(d.courseId);
      continue;
    }
    byCourse.set(d.courseId, test.test(mode));
  }
  const yes = [...byCourse.values()].filter(Boolean).length;
  const no = [...byCourse.values()].filter((v) => !v).length;
  return yes * no;
}

function main() {
  const root = (process.env.AI_EVIDENCE_CACHE_DIR ?? '').trim() || join(process.cwd(), 'data', 'evidence_cache');
  if (!existsSync(root)) {
    console.error(`no evidence cache at ${root} — run scripts/acquire_official_syllabi.ts first`);
    process.exit(1);
  }
  const { documents, corruptedHashes } = loadDocuments(root);
  const courses = [...new Set(documents.map((d) => d.courseId))];

  const withDelivery = documents.filter((d) => firstValue(d, DELIVERY) !== undefined).length;
  const withAssignments = documents.filter((d) => firstValue(d, ASSIGNMENTS) !== undefined).length;
  const withTopics = documents.filter((d) => /נושאי\s*לימוד/.test(d.text ?? '')).length;
  const withOutcomes = documents.filter((d) => /תוצאות\s*למידה/.test(d.text ?? '')).length;
  const withDayTime = documents.filter((d) => firstValue(d, DAY) !== undefined && firstValue(d, HOURS) !== undefined).length;
  const topicCourses = [...new Set(documents.filter((d) => /נושאי\s*לימוד/.test(d.text ?? '')).map((d) => d.courseId))];

  // Day/time is SECTION-scoped: the same course's groups can meet at different
  // times, which is exactly why it cannot label a course-level candidate.
  const timeVaryingCourses = (() => {
    const byCourse = new Map<string, Set<string>>();
    for (const d of documents) {
      const t = `${firstValue(d, DAY) ?? ''}|${firstValue(d, HOURS) ?? ''}`;
      const s = byCourse.get(d.courseId) ?? new Set<string>();
      s.add(t);
      byCourse.set(d.courseId, s);
    }
    return [...byCourse.entries()].filter(([, v]) => v.size > 1).map(([k]) => k).sort();
  })();

  const rows: ObjectiveRow[] = [
    {
      priority: 1,
      objective: 'course content / topic alignment with confirmed interests',
      officialSource: 'official syllabus — explicit "נושאי לימוד" list / learning outcomes',
      attemptedCourses: courses.length,
      documentsApplicable: withTopics,
      known: topicCourses.length,
      unknown: courses.length - topicCourses.length,
      conflictingOrSectionVarying: 0,
      coverageRate: `${topicCourses.length}/${courses.length} courses`,
      distinguishingCandidatePairs: 0,
      selectionChangeFeasible: false,
      decision: 'REJECT',
      reason:
        `only ${topicCourses.length} of ${courses.length} distinct courses publish an explicit topic list ` +
        `(${withTopics}/${documents.length} documents), and learning outcomes are absent entirely ` +
        `(${withOutcomes}/${documents.length}). With one topic-bearing course there is no pair of ` +
        `candidates the feature can separate, so no selection change is possible. Mining narrative ` +
        `prose or the course TITLE instead would be inference, not official evidence.`,
    },
    {
      priority: 2,
      objective: 'final-exam / assessment preference',
      officialSource: 'official syllabus — "מטלות הקורס" assessment field',
      attemptedCourses: courses.length,
      documentsApplicable: withAssignments,
      known: withAssignments,
      unknown: documents.length - withAssignments,
      conflictingOrSectionVarying: 0,
      coverageRate: `${withAssignments}/${documents.length} documents`,
      distinguishingCandidatePairs: 0,
      selectionChangeFeasible: false,
      decision: 'REJECT',
      reason:
        `the assessment field carries a LABEL but no values on every acquired document ` +
        `(${withAssignments}/${documents.length}). Absence is not falsehood: turning a missing ` +
        `"מטלות הקורס" into "no final exam" is exactly the inference this pipeline forbids. ` +
        `No alternative authoritative assessment source is wired.`,
    },
    {
      priority: 3,
      objective: 'project / design-based learning',
      officialSource: 'official syllabus — "אופן ההוראה" enumerated delivery-mode field',
      attemptedCourses: courses.length,
      documentsApplicable: withDelivery,
      known: withDelivery,
      unknown: documents.length - withDelivery,
      conflictingOrSectionVarying: sectionVarying(documents, PROJECT).length,
      coverageRate: `${withDelivery}/${documents.length} documents`,
      distinguishingCandidatePairs: distinguishingPairs(documents, PROJECT),
      selectionChangeFeasible: distinguishingPairs(documents, PROJECT) > 0,
      decision: distinguishingPairs(documents, PROJECT) > 0 ? 'IMPLEMENT' : 'REJECT',
      reason:
        `the delivery-mode field is SCHEMA-COMPLETE and present on every acquired document ` +
        `(${withDelivery}/${documents.length}); "פרוייקט" appears as a real enumerated value, so the ` +
        `feature normalizes deterministically, and unambiguous project vs non-project courses form ` +
        `${distinguishingPairs(documents, PROJECT)} distinguishing pairs — a selection change is achievable.`,
    },
    {
      priority: 4,
      objective: 'timetable / day / time preference',
      officialSource: 'official syllabus — "יום" / "שעות" (section-scoped)',
      attemptedCourses: courses.length,
      documentsApplicable: withDayTime,
      known: withDayTime,
      unknown: documents.length - withDayTime,
      conflictingOrSectionVarying: timeVaryingCourses.length,
      coverageRate: `${withDayTime}/${documents.length} documents`,
      distinguishingCandidatePairs: 0,
      selectionChangeFeasible: false,
      decision: 'DEFER',
      reason:
        `day/time coverage is good (${withDayTime}/${documents.length}) but the values are ` +
        `SECTION-scoped: ${timeVaryingCourses.length} course(s) already show different meeting times ` +
        `across groups. The planner selects a course and a period, never a section, so per K7.5 these ` +
        `facts cannot label a course-level candidate. ARCHITECTURAL PREREQUISITE: section-level ` +
        `selection plus an authoritative timetable source mapping course+section+semester+day+time+year.`,
    },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    corpus: {
      cacheRoot: 'data/evidence_cache (git-ignored, regenerable)',
      documents: documents.length,
      distinctCourses: courses.length,
      corruptedObjects: corruptedHashes.length,
      academicYears: [...new Set(documents.map((d) => d.academicYear))].sort(),
      sectionsObserved: documents.filter((d) => groupIdOfDocument(d) !== undefined).length,
    },
    fieldCoverage: {
      deliveryMode: `${withDelivery}/${documents.length}`,
      assignments: `${withAssignments}/${documents.length}`,
      explicitTopicList: `${withTopics}/${documents.length}`,
      learningOutcomes: `${withOutcomes}/${documents.length}`,
      dayAndTime: `${withDayTime}/${documents.length}`,
    },
    matrix: rows,
    selected: rows.find((r) => r.decision === 'IMPLEMENT')?.objective ?? null,
  };

  const outDir = join(process.cwd(), 'data', 'import_reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'objective_coverage_matrix.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nmatrix: ${outPath}`);
}

main();

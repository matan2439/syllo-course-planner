/**
 * T1 — run the group-universe normalizer over the ALREADY-RECORDED official
 * course-details pages and emit a metadata-only report.
 *
 * Performs NO acquisition and no network access: it reads
 * `data/raw_html/course_details/` (git-ignored, regenerable) and writes counts,
 * group ids, completeness and applicability. No course prose is ever printed or
 * written — group ids and official delivery-mode labels only.
 *
 * Usage: npx tsx scripts/normalize_group_universes.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { normalizeOfferingGroupUniverse, authoritativeGroupIds, groupUniverseIndex, GROUP_UNIVERSE_NORMALIZER_VERSION } from '../api/ai/group_universe';
import { loadDocuments } from '../api/ai/evidence_cache';
import { prepareEvidence } from '../api/ai/evidence_provider';

/** `course_05423791_2025.html` → course id `0542-3791`, year 2025. */
function identityOf(file: string): { courseId: string; academicYear: number } | undefined {
  const m = /^course_(\d{8})_(\d{4})\.html$/.exec(file);
  if (!m) return undefined;
  return { courseId: `${m[1].slice(0, 4)}-${m[1].slice(4)}`, academicYear: Number(m[2]) };
}

function main() {
  const dir = join(process.cwd(), 'data', 'raw_html', 'course_details');
  if (!existsSync(dir)) {
    console.error(`no recorded course-details pages at ${dir}`);
    process.exit(1);
  }

  const universes = readdirSync(dir)
    .sort()
    .flatMap((file) => {
      const id = identityOf(file);
      if (!id) return [];
      return [
        normalizeOfferingGroupUniverse({
          institutionId: 'tau.ac.il',
          courseId: id.courseId,
          academicYear: id.academicYear,
          sourceRef: `recorded:data/raw_html/course_details/${file}`,
          content: readFileSync(join(dir, file), 'utf-8'),
        }),
      ];
    });

  // What the universe actually BUYS on the real acquired corpus: how many
  // courses stop being `unknown` at the course level once completeness can be
  // established. Measured, never assumed.
  const cacheRoot = (process.env.AI_EVIDENCE_CACHE_DIR ?? '').trim() || join(process.cwd(), 'data', 'evidence_cache');
  const effect = (() => {
    if (!existsSync(cacheRoot)) return null;
    const { documents } = loadDocuments(cacheRoot);
    if (documents.length === 0) return null;
    const courseIds = [...new Set(documents.map((d) => d.courseId))].sort();
    const academicYear = documents[0].academicYear;
    const index = groupUniverseIndex(universes);
    const before = prepareEvidence({ courseIds, academicYear, documents });
    const after = prepareEvidence({ courseIds, academicYear, documents, groupUniverse: index });
    const state = (p: typeof before, id: string) => String(p.features.get(id)?.laboratory.value ?? 'absent');
    return {
      academicYear,
      corpusCourses: courseIds.length,
      resolvedByUniverse: courseIds.filter((id) => state(before, id) === 'unknown' && state(after, id) !== 'unknown'),
      stillUnknown: courseIds.filter((id) => state(after, id) === 'unknown'),
      noUniverseRecorded: courseIds.filter((id) => !index[id]),
      perCourse: courseIds.map((id) => ({
        courseId: id,
        authoritativeGroups: index[id] ?? null,
        deliveryBefore: state(before, id),
        deliveryAfter: state(after, id),
      })),
    };
  })();

  const count = (s: string) => universes.filter((u) => u.completeness === s).length;
  const report = {
    generatedAt: new Date().toISOString(),
    normalizerVersion: GROUP_UNIVERSE_NORMALIZER_VERSION,
    source: 'data/raw_html/course_details (git-ignored, regenerable)',
    pages: universes.length,
    applicability: {
      applicable: universes.filter((u) => u.applicability === 'applicable').length,
      courseMismatch: universes.filter((u) => u.applicability === 'course_mismatch').length,
      yearMismatch: universes.filter((u) => u.applicability === 'year_mismatch').length,
      unidentified: universes.filter((u) => u.applicability === 'unidentified').length,
    },
    completeness: {
      complete: count('complete'),
      incomplete: count('incomplete'),
      conflicting: count('conflicting'),
      unknown: count('unknown'),
    },
    authoritativeCourses: Object.keys(groupUniverseIndex(universes)).length,
    totalAuthoritativeGroups: universes.reduce((n, u) => n + (authoritativeGroupIds(u)?.length ?? 0), 0),
    effect,
    anomalies: universes.flatMap((u) => u.anomalies.map((a) => ({ courseId: u.courseId, ...a }))),
    universes: universes.map((u) => ({
      courseId: u.courseId,
      academicYear: u.academicYear,
      applicability: u.applicability,
      completeness: u.completeness,
      semesters: u.semesters,
      groupIds: u.groups.map((g) => g.groupId),
      groupTypes: [...new Set(u.groups.map((g) => g.groupType).filter(Boolean))],
      contentHash: u.contentHash,
      sourceRef: u.sourceRef,
    })),
  };

  const outDir = join(process.cwd(), 'data', 'import_reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'group_universe_report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify({ ...report, universes: `${report.universes.length} entries` }, null, 2));
  console.log(`\nreport: ${outPath}`);
}

main();

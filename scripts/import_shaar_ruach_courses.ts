/**
 * Imports the full קורסי שער רוח course list from the 8
 * SHAAR_RUACH_SOURCE_URLS pages and writes/updates
 * data/general_courses_shaar_ruach.json.
 *
 * Uses app/analysis/shaar_ruach_import.ts (parseShaarRuachCoursesFromHtml /
 * mergeShaarRuachCourses / buildShaarRuachRepository) — a separate parser
 * from the engineering scrapers. Must NOT be merged into engineering
 * elective data.
 *
 * Usage: npm run import:shaar-ruach
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  parseShaarRuachCoursesFromHtml,
  mergeShaarRuachCourses,
  buildShaarRuachRepository,
  SHAAR_RUACH_SOURCE_URLS,
  ShaarRuachImportedCourse,
} from '../app/analysis/shaar_ruach_import';

async function main() {
  const coursesByPage: ShaarRuachImportedCourse[][] = [];
  let fetchErrors = 0;

  for (const url of SHAAR_RUACH_SOURCE_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const html = await res.text();
      const courses = parseShaarRuachCoursesFromHtml(html, url);
      console.log(`[import:shaar-ruach] ${url} -> ${courses.length} courses`);
      coursesByPage.push(courses);
    } catch (err: any) {
      fetchErrors++;
      console.error(`[import:shaar-ruach] FAILED to fetch ${url}`);
      console.error(`[import:shaar-ruach] Reason: ${err?.message || err}`);
    }
  }

  if (fetchErrors === SHAAR_RUACH_SOURCE_URLS.length) {
    console.error('[import:shaar-ruach] All 8 source URLs failed — likely a network restriction in this environment.');
    console.error('[import:shaar-ruach] No changes made to data/general_courses_shaar_ruach.json.');
    process.exitCode = 1;
    return;
  }

  const merged = mergeShaarRuachCourses(coursesByPage);

  const withSyllabus = merged.filter(c => c.source_confidence === 'high').length;
  const fallback = merged.filter(c => c.source_confidence !== 'high').length;
  const standardCount = merged.filter(c => c.format === 'standard').length;
  const frontalCount = merged.filter(c => c.format === 'frontal').length;
  const multiSemester = merged.filter(c => c.offered_semesters.length > 1).length;

  console.log(`[import:shaar-ruach] Total merged courses (by base id): ${merged.length}`);
  console.log(`[import:shaar-ruach]   standard format: ${standardCount}, frontal format: ${frontalCount}`);
  console.log(`[import:shaar-ruach]   with ims/tau syllabus links: ${withSyllabus}, fallback: ${fallback}`);
  console.log(`[import:shaar-ruach]   offered in both semesters: ${multiSemester}`);
  if (fetchErrors > 0) {
    console.log(`[import:shaar-ruach]   NOTE: ${fetchErrors}/${SHAAR_RUACH_SOURCE_URLS.length} source URLs failed to fetch — result may be incomplete.`);
  }

  if (merged.length === 0) {
    console.error('[import:shaar-ruach] No courses parsed — leaving existing data file untouched.');
    process.exitCode = 1;
    return;
  }

  const repo = buildShaarRuachRepository(merged, SHAAR_RUACH_SOURCE_URLS);
  const outPath = join(__dirname, '..', 'data', 'general_courses_shaar_ruach.json');
  writeFileSync(outPath, JSON.stringify(repo, null, 2) + '\n', 'utf-8');
  console.log(`[import:shaar-ruach] Wrote ${repo.courses.length} courses to ${outPath}`);
}

main();

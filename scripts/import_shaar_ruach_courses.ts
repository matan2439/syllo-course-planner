/**
 * Imports the קורסי שער רוח course list from
 * https://humanities.tau.ac.il/shar_ruach/courses and writes/updates
 * data/general_courses_shaar_ruach.json.
 *
 * Uses app/analysis/shaar_ruach_import.ts (parseShaarRuachCoursesFromHtml /
 * buildShaarRuachRepository) — a separate parser from the engineering
 * scrapers. Must NOT be merged into engineering elective data.
 *
 * Usage: npm run import:shaar-ruach
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  parseShaarRuachCoursesFromHtml,
  buildShaarRuachRepository,
  SHAAR_RUACH_SOURCE_URL,
} from '../app/analysis/shaar_ruach_import';

async function main() {
  let html: string;
  try {
    const res = await fetch(SHAAR_RUACH_SOURCE_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    html = await res.text();
  } catch (err: any) {
    console.error(`[import:shaar-ruach] FAILED to fetch ${SHAAR_RUACH_SOURCE_URL}`);
    console.error(`[import:shaar-ruach] Reason: ${err?.message || err}`);
    console.error('[import:shaar-ruach] This is likely a network restriction in this environment.');
    console.error('[import:shaar-ruach] No changes made to data/general_courses_shaar_ruach.json.');
    process.exitCode = 1;
    return;
  }

  const courses = parseShaarRuachCoursesFromHtml(html, SHAAR_RUACH_SOURCE_URL);

  const withSyllabus = courses.filter(c => c.source_confidence === 'high').length;
  const fallback = courses.filter(c => c.source_confidence !== 'high').length;
  const skipped = 0; // parser never throws; everything with a recognizable course link is kept

  console.log(`[import:shaar-ruach] Parsed courses: ${courses.length}`);
  console.log(`[import:shaar-ruach] With ims/tau syllabus links: ${withSyllabus}`);
  console.log(`[import:shaar-ruach] Fallback page links (no syllabus code): ${fallback}`);
  console.log(`[import:shaar-ruach] Skipped (not course links): ${skipped}`);

  if (courses.length === 0) {
    console.error('[import:shaar-ruach] No courses parsed — leaving existing data file untouched.');
    process.exitCode = 1;
    return;
  }

  const repo = buildShaarRuachRepository(courses, SHAAR_RUACH_SOURCE_URL);
  const outPath = join(__dirname, '..', 'data', 'general_courses_shaar_ruach.json');
  writeFileSync(outPath, JSON.stringify(repo, null, 2) + '\n', 'utf-8');
  console.log(`[import:shaar-ruach] Wrote ${repo.courses.length} courses to ${outPath}`);
}

main();

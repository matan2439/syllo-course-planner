/**
 * Audits data/general_courses_shaar_ruach.json against the live שער רוח
 * catalog (fetched from the 8 SHAAR_RUACH_SOURCE_URLS pages).
 *
 * Read-only: never writes to data/general_courses_shaar_ruach.json. Use
 * `npm run import:shaar-ruach` to actually update the local repository.
 *
 * Usage: npm run audit:shaar-ruach
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseShaarRuachCoursesFromHtml,
  mergeShaarRuachCourses,
  SHAAR_RUACH_SOURCE_URLS,
  ShaarRuachImportedCourse,
  ShaarRuachRepository,
} from '../app/analysis/shaar_ruach_import';

export interface ShaarRuachAuditResult {
  officialCount: number;
  localCount: number;
  missing: ShaarRuachImportedCourse[];
  extra: ShaarRuachRepository['courses'];
  duplicatedBases: string[];
}

/**
 * Pure comparison logic, usable both by the CLI (with live-fetched data)
 * and by tests (with fixture data) — no network or filesystem access.
 */
export function compareShaarRuachCatalogs(
  coursesByPage: ShaarRuachImportedCourse[][],
  local: ShaarRuachRepository,
): ShaarRuachAuditResult {
  const official = mergeShaarRuachCourses(coursesByPage);

  const officialByBase = new Map(official.map(c => [c.course_id_base, c]));
  const localByBase = new Map(local.courses.map(c => [c.course_id_base ?? c.course_id, c]));

  const missing = official.filter(c => !localByBase.has(c.course_id_base));
  const extra = local.courses.filter(c => !officialByBase.has(c.course_id_base ?? c.course_id));

  // Duplicated normalized base ids within the official scrape (shouldn't
  // happen after mergeShaarRuachCourses, but check the raw per-page data).
  const baseCounts = new Map<string, number>();
  for (const page of coursesByPage) {
    for (const c of page) {
      baseCounts.set(c.course_id_base, (baseCounts.get(c.course_id_base) || 0) + 1);
    }
  }
  const duplicatedBases = Array.from(baseCounts.entries()).filter(([, n]) => n > 1).map(([id]) => id);

  return {
    officialCount: official.length,
    localCount: local.courses.length,
    missing,
    extra,
    duplicatedBases,
  };
}

async function main() {
  const coursesByPage: ShaarRuachImportedCourse[][] = [];
  let fetchErrors = 0;

  for (const url of SHAAR_RUACH_SOURCE_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const html = await res.text();
      coursesByPage.push(parseShaarRuachCoursesFromHtml(html, url));
    } catch (err: any) {
      fetchErrors++;
      console.error(`[audit:shaar-ruach] FAILED to fetch ${url}: ${err?.message || err}`);
    }
  }

  if (fetchErrors === SHAAR_RUACH_SOURCE_URLS.length) {
    console.error('[audit:shaar-ruach] All 8 source URLs failed — cannot audit (likely a network restriction).');
    process.exitCode = 1;
    return;
  }

  const localPath = join(__dirname, '..', 'data', 'general_courses_shaar_ruach.json');
  const local: ShaarRuachRepository = JSON.parse(readFileSync(localPath, 'utf-8'));

  const result = compareShaarRuachCatalogs(coursesByPage, local);

  console.log('=== שער רוח audit ===');
  if (fetchErrors > 0) {
    console.log(`NOTE: ${fetchErrors}/${SHAAR_RUACH_SOURCE_URLS.length} source URLs failed to fetch — official totals may be incomplete.`);
  }
  console.log(`Total official courses found (live, deduped by base id): ${result.officialCount}`);
  console.log(`Total local courses (data/general_courses_shaar_ruach.json): ${result.localCount}`);
  console.log(`Missing from local (on official site, not in local JSON): ${result.missing.length}`);
  for (const c of result.missing) {
    console.log(`  - ${c.course_id_base} (${c.section_id ?? 'no section'}) — ${c.name_he}`);
  }
  console.log(`Extra in local (in local JSON, not found on official site): ${result.extra.length}`);
  for (const c of result.extra) {
    console.log(`  - ${c.course_id_base ?? c.course_id} — ${c.name_he}`);
  }
  console.log(`Duplicated normalized base ids across pages (pre-merge): ${result.duplicatedBases.length}`);
  for (const id of result.duplicatedBases) {
    console.log(`  - ${id}`);
  }
}

if (require.main === module) {
  main();
}

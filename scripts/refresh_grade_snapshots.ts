/**
 * Refresh the committed grade snapshots: for every configured grade source with
 * a snapshot_path, fetch the source's own payload for every course of every
 * program board in data/boards and write it there. Run it from a normal machine
 * (some sources refuse server traffic), then commit the files.
 *
 *   npm run refresh:grades
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { buildCourseProfiles } from '../api/ai/course_profile';
import { loadCourseInsightConfig, REPO_ROOT } from '../api/ai/course_insights/config';
import { createHttpFetcher } from '../api/ai/course_insights/http';
import { GradeStore, gradeCourseKey, type GradeSnapshot } from '../api/ai/course_insights/grades';

const CONCURRENCY = 4;

async function main() {
  const config = loadCourseInsightConfig();
  const boardsDir = join(REPO_ROOT, 'data', 'boards');
  const keys = new Set<string>();
  for (const file of readdirSync(boardsDir).filter((name) => name.endsWith('.json'))) {
    for (const id of buildCourseProfiles(JSON.parse(readFileSync(join(boardsDir, file), 'utf8'))).keys()) {
      const key = gradeCourseKey(id);
      if (key.length === 8) keys.add(key);
    }
  }
  const store = new GradeStore(createHttpFetcher(config.user_agent));

  for (const source of config.grade_sources.filter((s) => s.enabled && s.snapshot_path)) {
    const courses: Record<string, unknown> = {};
    const queue = [...keys].sort();
    let failed = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let key = queue.shift(); key; key = queue.shift()) {
        try {
          // A course the source has nothing for is recorded as null: "no data", not "unknown".
          courses[key] = (await store.fetchRaw(source, key)) ?? null;
        } catch (error) {
          failed++;
          console.warn(`  ${source.id} ${key}: ${(error as Error).message}`);
        }
      }
    }));
    const snapshot: GradeSnapshot = {
      source: source.id,
      generated_at: new Date().toISOString(),
      courses: Object.fromEntries(Object.entries(courses).sort(([a], [b]) => a.localeCompare(b))),
    };
    const path = join(REPO_ROOT, source.snapshot_path as string);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(snapshot) + '\n');
    const withData = Object.values(courses).filter((payload) => payload && (!Array.isArray(payload) || payload.length)).length;
    console.log(`${source.id}: ${Object.keys(courses).length}/${keys.size} courses (${withData} with grades, ${failed} failed) → ${source.snapshot_path}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

/**
 * Enriches the local שער רוח repository with the currently published BIDIT
 * timetable. BIDIT is consulted only for concrete current-year facts: meeting
 * slots, teaching format and assessment dates.
 *
 * The programme requirement defines every שער רוח course as two weekly hours.
 * BIDIT's current-year details are preserved as supplemental schedule evidence.
 *
 * Usage: npx tsx scripts/enrich_shaar_ruach_bidit.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BIDIT_BASE = 'http://www.bid-it.appspot.com/ajax/chosen-courses-info/';
const OUTPUT = join(process.cwd(), 'data', 'general_courses_shaar_ruach.json');
const BOARD_OUTPUT = join(process.cwd(), 'data', 'boards', 'mechanical_engineering_2027.json');

type BiditGroup = {
  amountHours?: number;
  days?: string[];
  beginHours?: string[];
  endHours?: string[];
  ofenHoraa?: string;
  moedType?: string[];
  dates?: string[];
};

type BiditCourse = { cNum?: string; hoursNum?: number; kvutzaData?: BiditGroup[] };
type RepositoryCourse = Record<string, unknown> & { course_id: string };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compactGroups(groups: BiditGroup[] = []) {
  return groups.map((group) => ({
    days: group.days ?? [],
    begin_hours: group.beginHours ?? [],
    end_hours: group.endHours ?? [],
    teaching_format: group.ofenHoraa ?? null,
    assessment: group.moedType ?? [],
    assessment_dates: group.dates ?? [],
  }));
}

async function loadCourse(courseId: string, semester: 1 | 2): Promise<BiditCourse | null> {
  const courseNum = courseId.replace(/-/g, '');
  const url = `${BIDIT_BASE}?university=TAU&semester=${semester}&courses_list=${courseNum}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${courseId}, semester ${semester}: HTTP ${response.status}`);
  const body = await response.json() as { coursesInfo?: BiditCourse[] };
  return body.coursesInfo?.[0] ?? null;
}

async function main() {
  const repository = JSON.parse(readFileSync(OUTPUT, 'utf-8')) as { courses: RepositoryCourse[]; [key: string]: unknown };
  let next = 0;
  let verifiedHours = 0;
  let observed = 0;
  let failures = 0;
  const courses = repository.courses;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= courses.length) return;
      const course = courses[index];
      const schedule: Record<string, unknown> = {};
      try {
        for (const [semesterKey, semester] of [['A', 1], ['B', 2]] as const) {
          const source = await loadCourse(course.course_id, semester);
          if (!source) continue;
          observed += 1;
          schedule[semesterKey] = {
            weekly_hours: Number(source.hoursNum) || 0,
            groups: compactGroups(source.kvutzaData),
          };
        }
      } catch (error) {
        failures += 1;
        console.error(`[enrich:shaar-ruach-bidit] ${course.course_id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      if (Object.keys(schedule).length) {
        course.bidit_schedule_2027 = schedule;
        course.bidit_checked_at = new Date().toISOString();
      }
      const verified = Object.values(schedule).find((entry: any) => entry.weekly_hours > 0);
      if (verified) verifiedHours += 1;
      course.weekly_hours = 2;
      course.weekly_hours_source = 'program_requirement';
    }
  };

  await Promise.all(Array.from({ length: 6 }, worker));
  repository.bidit_schedule_source = BIDIT_BASE;
  repository.bidit_schedule_year = '2026-2027';
  writeFileSync(OUTPUT, `${JSON.stringify(repository, null, 2)}\n`, 'utf-8');
  const board = JSON.parse(readFileSync(BOARD_OUTPUT, 'utf-8')) as {
    metadata?: { program_repository_courses?: Array<Record<string, unknown>>; board_data_version?: string };
    semesters?: unknown[];
  };
  const enrichedById = new Map(courses.map((course) => [course.course_id, course]));
  let copiedToBoard = 0;
  for (const course of board.metadata?.program_repository_courses ?? []) {
    const enriched = enrichedById.get(String(course.course_id));
    if (!enriched) continue;
    for (const field of ['weekly_hours', 'weekly_hours_source', 'weekly_hours_verified_from_bidit', 'bidit_schedule_2027']) {
      if (enriched[field] !== undefined) course[field] = enriched[field];
    }
    copiedToBoard += 1;
  }
  const versionPayload = stableJson({
    semesters: board.semesters ?? [],
    program_repository_courses: board.metadata?.program_repository_courses ?? [],
  });
  // Keep the local fallback's revision tied to its actual catalog contents.
  if (board.metadata) board.metadata.board_data_version = createHash('sha256').update(versionPayload).digest('hex').slice(0, 16);
  writeFileSync(BOARD_OUTPUT, `${JSON.stringify(board, null, 2)}\n`, 'utf-8');
  console.log(`[enrich:shaar-ruach-bidit] observed ${observed} semester records; verified weekly hours for ${verifiedHours}/${courses.length} courses; copied ${copiedToBoard} records into the local board; fetch failures: ${failures}.`);
}

main();

/**
 * Deterministic planner-quality evaluation (offline; NO model calls, NO database, NO network).
 *
 * Runs the real generate-plan handler on the committed Mechanical Engineering 2027 board for a set of
 * controlled student profiles, once with the specialization objective OFF (previous baseline) and once
 * ON, and reports independently meaningful metrics:
 *   correctness : request blocked, errors, missing mandatory courses, verified prerequisite violations
 *                 (official data, shadow audit), committed-course changes
 *   specialization: focus-aligned courses (name evidence), syllabus-corroborated focus courses, longest
 *                 official prerequisite chain among focus courses, difference between interests
 *   personalization: wanted courses present, unwanted courses absent
 *   efficiency  : total hours, peak semester load
 * The internal optimiser score is never used as evidence of improvement.
 *
 * Usage: npx tsx scripts/evaluate_planner_quality.ts [--json out.json] [--md out.md]
 * Electrical Engineering: no topic profiles exist, so interest scenarios would be inert there; it is
 * evaluated for academic correctness only (see docs/data-audit/planner-evaluation.md).
 */
import handler from '../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { shadowPrerequisiteAudit, loadPrerequisiteCatalog, referencedCourseIds } from '../api/ai/prerequisites';
import { inferFocusAreasFromText, topicKeywordsForAreas } from '../api/ai/course_topic_profile_inference';
import { createMechanicalEngineering2027Resolver } from '../api/ai/course_topic_profiles_static';

process.env.AI_DEV_MODE = 'true';
process.env.AI_DEV_BYPASS_QUOTA = 'true';
const ROOT = join(__dirname, '..');
const BOARD_ID = 'mechanical_engineering_2027';
const BOARD = JSON.parse(readFileSync(join(ROOT, 'data/boards', `${BOARD_ID}.json`), 'utf8'));
const SPEC = JSON.parse(readFileSync(join(ROOT, 'data/degrees/tau/mechanical_engineering/2027/spec.json'), 'utf8'));
const byId = new Map<string, any>();
for (const c of BOARD.metadata?.program_repository_courses ?? []) byId.set(c.course_id, c);
for (const s of BOARD.semesters) for (const c of s.courses ?? []) byId.set(c.course_id, { ...byId.get(c.course_id), ...c });
const hoursOf = (id: string) => byId.get(id)?.weekly_hours ?? 0;
const SHAAR_DONE = ['0609-1005', '0609-1003', '0609-1008'];
const MANDATORY_Y3_4: string[] = SPEC.mandatory_courses.filter((m: any) => m.year >= 3).map((m: any) => m.course_id);
const COMPLETED_Y1_2: string[] = SPEC.mandatory_courses.filter((m: any) => m.year <= 2).map((m: any) => m.course_id);

interface Scenario { id: string; label: string; request?: string; wanted?: string[]; unwanted?: string[]; maxWeeklyHours?: number }
const SCENARIOS: Scenario[] = [
  { id: 'none', label: 'No stated interest (control)' },
  { id: 'control', label: 'Control systems', request: 'אני רוצה להתמקד בבקרה' },
  { id: 'energy', label: 'Energy / thermal', request: 'אני רוצה להתמקד באנרגיה' },
  { id: 'robotics', label: 'Robotics / mechatronics', request: 'אני רוצה להתמקד ברובוטיקה' },
  { id: 'manufacturing', label: 'Manufacturing', request: 'אני רוצה להתמקד בייצור' },
  { id: 'materials', label: 'Materials', request: 'אני רוצה להתמקד בחומרים' },
  { id: 'biomech', label: 'Biomechanics / medical', request: 'אני רוצה להתמקד בביו' },
  { id: 'design', label: 'Mechanical design', request: 'אני רוצה להתמקד בתכן' },
  { id: 'fem', label: 'Finite elements', request: 'אני רוצה להתמקד באלמנטים סופיים' },
  { id: 'control_light', label: 'Control + lighter workload (16h cap)', request: 'אני רוצה להתמקד בבקרה', maxWeeklyHours: 16 },
  { id: 'control_wanted', label: 'Control + must-have design course', request: 'אני רוצה להתמקד בבקרה', wanted: ['0542-4425'] },
  { id: 'control_avoid', label: 'Control + avoid the top control elective', request: 'אני רוצה להתמקד בבקרה', unwanted: ['0542-4621'] },
];

function planContext() {
  return {
    semesters: BOARD.semesters.map((s: any) => ({ id: s.semester_id, courses: (s.courses ?? []).map((c: any) => ({ course_id: c.course_id })) })),
    personal_status: { completed: [...SHAAR_DONE, ...COMPLETED_Y1_2].map((course_id) => ({ course_id })), currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: 90 },
  };
}
const makeRes = () => { const r: any = { statusCode: 0, setHeader() { return r; }, status(c: number) { r.statusCode = c; return r; }, json(b: any) { r._body = b; return r; }, write() {}, end() {} }; return r; };

type Arm = 'baseline' | 'specialization' | 'specialization_readiness';
async function plan(s: Scenario, arm: Arm) {
  if (arm === 'baseline') process.env.AI_SPECIALIZATION_OBJECTIVE = 'off'; else delete process.env.AI_SPECIALIZATION_OBJECTIVE;
  if (arm === 'specialization_readiness') process.env.AI_PREREQ_READINESS_OBJECTIVE = 'on'; else delete process.env.AI_PREREQ_READINESS_OBJECTIVE;
  const preferences: any = {};
  if (s.request) preferences.extra_request_he = s.request;
  if (s.wanted) preferences.wanted_course_ids = s.wanted;
  if (s.unwanted) preferences.unwanted_course_ids = s.unwanted;
  if (s.maxWeeklyHours) preferences.max_weekly_hours = s.maxWeeklyHours;
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id: BOARD_ID, session_token: randomUUID(), plan_context: planContext(), preferences, interpret_free_text: Boolean(s.request) } } as any, res);
  return res;
}

const catalog = loadPrerequisiteCatalog();
const resolver = createMechanicalEngineering2027Resolver();

/** Longest chain of placed focus courses linked by OFFICIAL prerequisites (counted in courses). */
function focusChainDepth(focus: Set<string>): number {
  const memo = new Map<string, number>();
  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, 1);
    const preds = [...new Set(referencedCourseIds(catalog?.[id]?.expression ?? null))];
    // Chain through any prerequisite course (focus or not) so a foundation on the way counts; count only focus courses.
    const walk = (p: string, seen: Set<string>): number => {
      if (seen.has(p)) return 0;
      seen.add(p);
      if (focus.has(p)) return depth(p);
      return Math.max(0, ...[...new Set(referencedCourseIds(catalog?.[p]?.expression ?? null))].map((q) => walk(q, seen)));
    };
    const best = 1 + Math.max(0, ...preds.map((p) => walk(p, new Set([id]))));
    memo.set(id, best);
    return best;
  };
  return Math.max(0, ...[...focus].map(depth));
}

function evaluate(s: Scenario, res: any) {
  const body = res._body ?? {};
  const semesters: Array<{ semester_id: string; course_ids: string[] }> = body.semesters ?? [];
  const placed = [...new Set(semesters.flatMap((x) => x.course_ids))];
  const placedSet = new Set(placed);
  const areas = s.request ? inferFocusAreasFromText(s.request) : [];
  const keywords = topicKeywordsForAreas(areas);
  const focus = new Set(placed.filter((id) => resolver.resolveCourseTopicProfile(id)?.topics.some((t) => areas.includes(t.area))));
  const corroborated = [...focus].filter((id) => keywords.some((k) => String(byId.get(id)?.syllabus_summary_he ?? '').toLowerCase().includes(k)));
  const audit = shadowPrerequisiteAudit({
    semesters: semesters.map((x) => ({ semesterId: x.semester_id, courseIds: x.course_ids })),
    completedCourseIds: [...SHAAR_DONE, ...COMPLETED_Y1_2], programId: BOARD_ID,
  });
  const loads = semesters.map((x) => x.course_ids.reduce((sum, id) => sum + hoursOf(id), 0));
  const electives = placed.filter((id) => !MANDATORY_Y3_4.includes(id));
  return {
    blocked: Boolean(body.blocked), errors: (body.errors ?? []).length, status: res.statusCode,
    missingMandatory: MANDATORY_Y3_4.filter((id) => !placedSet.has(id)),
    verifiedPrereqViolations: audit.wouldBlock.filter((b) => b.enforcementGrade === 'verified').map((b) => `${b.courseId}@${b.semesterId}`),
    violationDetail: audit.wouldBlock.filter((b) => b.enforcementGrade === 'verified').map((b) => ({ course: b.courseId, semester: b.semesterId, unmet: b.unmetPrerequisites, locked: MANDATORY_Y3_4.includes(b.courseId) })),
    warnings: (body.warnings_he ?? []).length, warningText: (body.warnings_he ?? []).slice(0, 4),
    advisoryPrereqFindings: audit.wouldBlock.filter((b) => b.enforcementGrade === 'advisory').length,
    totalHours: placed.reduce((sum, id) => sum + hoursOf(id), 0), peakHours: Math.max(0, ...loads),
    electives, focusCourses: [...focus].sort(), focusCorroboratedBySyllabus: corroborated.sort(),
    focusChainDepth: focusChainDepth(focus),
    wantedPresent: (s.wanted ?? []).filter((id) => placedSet.has(id)), wantedMissing: (s.wanted ?? []).filter((id) => !placedSet.has(id)),
    unwantedPresent: (s.unwanted ?? []).filter((id) => placedSet.has(id)),
    focusCourseHours: [...focus].reduce((sum, id) => sum + hoursOf(id), 0),
  };
}

const jaccardDistance = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]).size; return u ? 1 - [...A].filter((x) => B.has(x)).length / u : 0; };

const ARMS: Arm[] = ['baseline', 'specialization', 'specialization_readiness'];
const short = (a: Arm) => (a === 'baseline' ? 'base' : a === 'specialization' ? 'spec' : 'spec+ready');

function renderMarkdown(summary: any, rows: any[]): string {
  const L = ['# Planner quality evaluation (deterministic, offline)', '',
    `Board \`${BOARD_ID}\`; generated by \`npx tsx scripts/evaluate_planner_quality.ts --json docs/data-audit/planner-evaluation.json --md docs/data-audit/planner-evaluation.md\`. The real generate-plan handler runs with no model calls, no database and no network. **This is not evidence of real-model conversational quality.**`, '',
    'Arms: **baseline** = specialization objective off (previous behaviour); **spec** = banded workload balance + pathway coherence (new default when interests are stated); **spec+ready** = spec plus official-prerequisite readiness ranking (flag `AI_PREREQ_READINESS_OBJECTIVE`, default OFF, needs owner approval).', '',
    'Student: finished years 1–2 of the official plan and the three שער רוח courses, planning years 3–4. Prerequisite violations are measured with the production shadow audit on official registrar data (grade *verified*); "locked" ones come from the official mandatory placement itself (register entries D1–D3).', '',
    '## Totals over all scenarios', '', '| Metric | baseline | spec | spec+ready |', '|---|---|---|---|'];
  const t = summary.totals;
  const line = (label: string, key: string, fmt = (x: number) => String(x)) => L.push(`| ${label} | ${fmt(t.baseline[key])} | ${fmt(t.specialization[key])} | ${fmt(t.specialization_readiness[key])} |`);
  line('Focus-aligned courses placed (name evidence)', 'focusCourses');
  line('…of which corroborated by official syllabus text', 'focusCorroboratedBySyllabus');
  line('Focus-course weekly hours', 'focusCourseHours');
  line('Verified prerequisite violations (all)', 'verifiedPrereqViolations');
  line('…of which NOT forced by locked official placements', 'nonLockedViolations');
  line('Missing mandatory courses', 'missingMandatory');
  line('Blocked / failed requests', 'blocked');
  line('Mean peak weekly hours', 'meanPeak', (x) => x.toFixed(1));
  L.push('', `Mean elective-set distance between different interests (0 = identical plans, 1 = disjoint): baseline ${summary.meanElectiveDistanceBetweenInterests.baseline.toFixed(2)}, spec ${summary.meanElectiveDistanceBetweenInterests.specialization.toFixed(2)}, spec+ready ${summary.meanElectiveDistanceBetweenInterests.specialization_readiness.toFixed(2)}.`, '',
    '## Per scenario', '', '| Scenario | Focus courses (b/s/r) | Corroborated (b/s/r) | Focus chain depth (b/s/r) | Verified violations (b/s/r) | Wanted missing | Unwanted present |', '|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const f = (k: string) => ['baseline', 'specialization', 'specialization_readiness'].map((a) => (r[a][k] instanceof Array ? r[a][k].length : r[a][k])).join(' / ');
    L.push(`| ${r.scenario.label} | ${f('focusCourses')} | ${f('focusCorroboratedBySyllabus')} | ${f('focusChainDepth')} | ${f('verifiedPrereqViolations')} | ${f('wantedMissing')} | ${f('unwantedPresent')} |`);
  }
  return L.join('\n') + '\n';
}

async function main() {
  const rows: any[] = [];
  for (const s of SCENARIOS) {
    const row: any = { scenario: s };
    for (const arm of ARMS) {
      const t0 = Date.now();
      const res = await plan(s, arm);
      row[arm] = { ...evaluate(s, res), ms: Date.now() - t0 };
    }
    rows.push(row);
    const f = (k: string) => ARMS.map((a) => `${short(a)}=${row[a][k] instanceof Array ? row[a][k].length : row[a][k]}`).join(' ');
    console.log(`${s.id.padEnd(15)} focus[${f('focusCourses')}] corrob[${f('focusCorroboratedBySyllabus')}] chain[${f('focusChainDepth')}] peak[${f('peakHours')}] verifiedViol[${f('verifiedPrereqViolations')}] missingMand[${f('missingMandatory')}] ms[${f('ms')}]`);
  }
  const interests = rows.filter((r) => ['control', 'energy', 'robotics', 'manufacturing', 'materials', 'biomech', 'design', 'fem'].includes(r.scenario.id));
  const meanDistance = (key: Arm) => {
    let sum = 0, n = 0;
    for (let i = 0; i < interests.length; i++) for (let j = i + 1; j < interests.length; j++) { sum += jaccardDistance(interests[i][key].electives, interests[j][key].electives); n++; }
    return n ? sum / n : 0;
  };
  const sumOf = (arm: Arm, key: string) => rows.reduce((t, r) => t + (r[arm][key] instanceof Array ? r[arm][key].length : r[arm][key]), 0);
  const summary: any = { meanElectiveDistanceBetweenInterests: Object.fromEntries(ARMS.map((a) => [a, meanDistance(a)])), totals: {} };
  for (const a of ARMS) summary.totals[a] = { focusCourses: sumOf(a, 'focusCourses'), focusCorroboratedBySyllabus: sumOf(a, 'focusCorroboratedBySyllabus'), focusCourseHours: sumOf(a, 'focusCourseHours'), verifiedPrereqViolations: sumOf(a, 'verifiedPrereqViolations'), nonLockedViolations: rows.reduce((t, r) => t + r[a].violationDetail.filter((v: any) => !v.locked).length, 0), missingMandatory: sumOf(a, 'missingMandatory'), blocked: rows.filter((r) => r[a].blocked).length, meanPeak: sumOf(a, 'peakHours') / rows.length, meanMs: sumOf(a, 'ms') / rows.length };
  console.log('\nmean elective-set distance between different interests:', summary.meanElectiveDistanceBetweenInterests);
  console.log('totals', JSON.stringify(summary.totals, null, 1));
  // Timings vary run to run: kept on the console only so the written report stays reproducible.
  const strip = (v: any): any => JSON.parse(JSON.stringify(v, (k, x) => (k === 'ms' || k === 'meanMs' ? undefined : x)));
  const out = process.argv.indexOf('--json');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(strip({ board: BOARD_ID, summary, rows }), null, 1) + '\n');
  const md = process.argv.indexOf('--md');
  if (md > 0) writeFileSync(process.argv[md + 1], renderMarkdown(strip(summary), strip(rows)));
}
main().catch((e) => { console.error(e); process.exit(1); });

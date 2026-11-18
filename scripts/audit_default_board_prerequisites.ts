/**
 * Shadow-evaluates the OFFICIAL default degree path of each supported program (the spec's
 * mandatory_courses at their official year/semester) with the production evaluator, to measure
 * what strict prerequisite enforcement would do to a student who follows the official plan.
 * Every blocked placement of an official plan is a FALSE POSITIVE candidate for enforcement.
 *
 * Read-only and offline. Usage: npx tsx scripts/audit_default_board_prerequisites.ts [--json out.json]
 * "either" semesters are evaluated in BOTH A and B (earliest / latest) so a flexible window is not
 * mistaken for a violation.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { shadowPrerequisiteAudit, loadPrerequisiteCatalog, loadEquivalences } from '../api/ai/prerequisites';

const ROOT = join(__dirname, '..');
const PROGRAMS: Array<{ program: string; family: string; file: string }> = [
  { program: 'mechanical_engineering_2027', family: 'mechanical_engineering', file: 'data/degrees/tau/mechanical_engineering/2027/spec.json' },
  { program: 'electrical_engineering_2027', family: 'electrical_engineering', file: 'data/degrees/tau/electrical_engineering/2027/spec.json' },
];

interface Mandatory { course_id: string; year: number; semester: 'A' | 'B' | 'either' }

function evaluate(program: string, mandatory: Mandatory[], eitherAs: 'A' | 'B') {
  const slots: Record<string, string[]> = {};
  for (const m of mandatory) {
    const sem = m.semester === 'either' ? eitherAs : m.semester;
    (slots[`${m.year}${sem}`] ??= []).push(m.course_id);
  }
  const order: string[] = [];
  for (let y = 1; y <= 4; y++) for (const s of ['A', 'B']) order.push(`${y}${s}`);
  const semesters = order.map((id) => ({ semesterId: id, courseIds: slots[id] ?? [] }));
  return shadowPrerequisiteAudit({ semesters, completedCourseIds: [], programId: program });
}

const results: Record<string, unknown> = {};
const catalog = loadPrerequisiteCatalog();
for (const { program, file } of PROGRAMS) {
  const spec = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  const mandatory: Mandatory[] = spec.mandatory_courses;
  const variants = (['A', 'B'] as const).map((eitherAs) => ({ eitherAs, audit: evaluate(program, mandatory, eitherAs) }));
  const summary = variants.map(({ eitherAs, audit }) => ({
    eitherPlacedIn: eitherAs,
    wouldBlock: audit.wouldBlock.map((b) => ({ grade: b.enforcementGrade, advisoryReasons: b.advisoryReasons, course: b.courseId, semester: b.semesterId, unmetPrerequisites: b.unmetPrerequisites, unmetCorequisites: b.unmetCorequisites })),
    inferredEquivalenceUses: audit.equivalenceUses.filter((u) => u.status === 'inferred'),
    registrarEquivalenceUses: audit.equivalenceUses.filter((u) => u.status !== 'inferred').length,
    assumedNone: audit.assumedNone, unknown: audit.unknown, needsReview: audit.needsReview,
  }));
  const noRecord = mandatory.filter((m) => !catalog?.[m.course_id]).map((m) => m.course_id);
  results[program] = { mandatoryCourses: mandatory.length, mandatoryWithoutPrerequisiteRecord: noRecord, variants: summary };
  console.log(`\n${program}: ${mandatory.length} mandatory courses; no prerequisite record for: ${noRecord.join(', ') || '—'}`);
  for (const v of summary) {
    console.log(`  'either' placed in ${v.eitherPlacedIn}: ${v.wouldBlock.length} official placement(s) would be blocked`);
    for (const b of v.wouldBlock) console.log(`    [${b.grade}] ${b.course} @ ${b.semester}: prereq unmet ${JSON.stringify(b.unmetPrerequisites)} coreq unmet ${JSON.stringify(b.unmetCorequisites)}`);
    if (v.inferredEquivalenceUses.length) console.log(`    inferred-equivalence uses: ${JSON.stringify(v.inferredEquivalenceUses)}`);
  }
}
void loadEquivalences;
const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(results, null, 1) + '\n');

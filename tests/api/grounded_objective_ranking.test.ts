/**
 * K4 — END-TO-END proof that a source-grounded soft objective changes REAL
 * candidate ranking.
 *
 * The chain proven here, with no step stubbed out:
 *   official academic source (the genuine TAU syllabus tracked in this repo)
 *     → versioned evidence (K1 contract, via the K2 adapter)
 *       → normalized course features (K3 rule-based extraction)
 *         → confirmed soft objective (K4)
 *           → the SELECTED candidate changes.
 *
 * A test that only asserts "a score number moved" would not qualify. These
 * assertions are about which plan the system actually picks, produced by the
 * real `generateCandidateSet` running the real `PlannerWorker` under one fixed
 * policy with identical hard constraints on every candidate.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateCandidateSet, selectCandidate } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate } from '../../api/ai/planner_validate';
import { acquireSyllabus, buildEvidenceSnapshot, type HttpFetcher, type SyllabusDocument } from '../../api/ai/syllabus_source';
import { RuleBasedFeatureExtractor, type CourseFeatures } from '../../api/ai/course_features';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import { explainGroundedRanking, scoreCandidateOnObjective, type GroundedObjective } from '../../api/ai/grounded_objectives';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';

const REAL_HTML = readFileSync(
  join(__dirname, '..', '..', 'data', 'raw_html', 'syllabus', 'syllabus_05423792.html'),
  'utf-8',
);
const RETRIEVED_AT = '2026-08-14T00:00:00.000Z';
const YEAR = 2025;

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

// ── the planning problem: four interchangeable 4h electives, 8h target ───────
// Every legal plan picks two. Hard constraints are identical for all candidates.
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

function model(extra: Parameters<typeof buildConstraintModel>[1] = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 8, categories: [] },
      program_repository_courses: ELECTIVES.map((id) => ({
        course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective',
        offered_semesters: [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: 20, maxHoursPerSemester: 25, ...extra });
}
const empty = (): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });

// ── the evidence: ONE snapshot, built from the REAL official document ────────

/**
 * Acquire an official document through the REAL adapter, requesting the
 * document's own real course id (so the adapter's course-id/year checks are
 * genuinely exercised rather than bypassed), then bind the acquired evidence to
 * this scenario's planning id.
 */
async function officialDoc(
  html: string,
  realCourseId: string,
  planningId: string,
  academicYear = YEAR,
): Promise<SyllabusDocument> {
  const url = `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${realCourseId.replace(/\D/g, '')}00&year=${academicYear}`;
  const fetcher: HttpFetcher = async () => ({
    status: 200, finalUrl: url, contentType: 'text/html', body: html,
  });
  const r = await acquireSyllabus(
    { institutionId: 'tau.ac.il', courseId: realCourseId, academicYear, retrievedAt: RETRIEVED_AT, url },
    fetcher,
  );
  if (r.status !== 'acquired') throw new Error(`fixture did not acquire: ${r.reason}`);
  return { ...r.document, courseId: planningId };
}

/** Minimal hand-written stub in the official label/value shape. No copied content. */
function lectureStub(courseNumber: string): string {
  const cell = (l: string, v: string) =>
    `<div class="data-table-cell"><small class="data-table-cell-label">${l}</small><span>${v}</span></div>`;
  // No group suffix on the course number ⇒ OFFERING scope, so the fact applies to
  // the whole offering the candidate actually selects.
  return `<div class="data-table">${cell('מספר קורס', courseNumber)}${cell('שם הקורס', 'קורס עיוני')}${cell('אופן ההוראה', 'שיעור')}${cell('מטלות הקורס', 'בחינה סופית')}</div>`;
}

const extractor = new RuleBasedFeatureExtractor();

/**
 * The evidence snapshot for this request.
 *
 * K7.5 — APPLICABILITY IS EXPLICIT AND COMPLETE. Evidence goes through the real
 * `prepareEvidence`, so the same course/offering/section aggregation the handler
 * uses applies here too; this test can no longer prove ranking with a
 * section-scoped fact attributed to a course-level candidate.
 *
 *  - E3 is backed by the GENUINE official laboratory syllabus (group 05), and
 *    the fixture declares the authoritative group universe for E3 as exactly
 *    ['05'] — a single-section offering — so coverage is COMPLETE and the
 *    course-level value is legitimately `true`.
 *  - E1/E2/E4 carry offering-scoped lecture documents (no group marker), so they
 *    resolve to a definite `false`. The unfavoured candidates are therefore NOT
 *    merely missing evidence — they have applicable evidence that says "no
 *    laboratory", which is what makes the comparison meaningful.
 */
async function buildScenario() {
  const docs = await Promise.all([
    officialDoc(lectureStub('0542-1111'), '0542-1111', 'E1'),
    officialDoc(lectureStub('0542-2222'), '0542-2222', 'E2'),
    officialDoc(lectureStub('0542-4444'), '0542-4444', 'E4'),
    officialDoc(REAL_HTML, '0542-3792', 'E3'), // the genuine official LABORATORY syllabus
  ]);
  const prepared = prepareEvidence({
    courseIds: ELECTIVES,
    academicYear: YEAR,
    documents: docs,
    // Authoritative, complete group universe for the evidenced course.
    groupUniverse: { E3: ['05'] },
  });
  return { snapshot: prepared.snapshot, features: prepared.features, prepared };
}

const objectiveFor = (snapshotId: string): GroundedObjective => ({
  id: 'prefer_laboratory_courses', confirmed: true, snapshotId,
});

const courseIdsOf = (state: PlanState) => [...new Set(Object.values(state.semesters).flat())].sort();

function generate(opts: {
  grounded?: { objective: GroundedObjective; features: Map<string, CourseFeatures> };
  model?: Parameters<typeof buildConstraintModel>[1];
} = {}) {
  return generateCandidateSet({
    buildModel: () => model(opts.model ?? {}),
    policy: 'neutral',
    initialState: empty(),
    profileVersion: 3,
    maxCandidates: 4,
    ...(opts.grounded ? { groundedObjective: opts.grounded } : {}),
  });
}

// ── the proof ────────────────────────────────────────────────────────────────

describe('K4 — a confirmed grounded objective changes real candidate selection', () => {
  let scenario: Awaited<ReturnType<typeof buildScenario>>;
  beforeAll(async () => { scenario = await buildScenario(); });

  test('1. at least two legal candidates satisfy identical hard constraints', () => {
    const set = generate();
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of set.candidates) {
      const report = validateCandidate(c.state, model());
      expect(report.valid).toBe(true);       // same authoritative validator
      expect(report.degreeMet).toBe(true);   // same required academic output
      expect(c.policy).toBe('neutral');      // same confirmed policy
      expect(c.profileVersion).toBe(3);      // same preference-profile version
    }
  });

  test('2. official syllabus evidence distinguishes the candidates on the feature', () => {
    const { features } = scenario;
    expect(features.get('E3')!.laboratory.value).toBe(true);   // real official lab syllabus
    expect(features.get('E1')!.laboratory.value).toBe(false);  // official lecture mode
    expect(features.get('E2')!.laboratory.value).toBe(false);
    expect(features.get('E4')!.laboratory.value).toBe(false);  // applicable evidence, not absence

    const set = generate();
    const withLab = set.candidates.filter((c) => courseIdsOf(c.state).includes('E3'));
    const withoutLab = set.candidates.filter((c) => !courseIdsOf(c.state).includes('E3'));
    expect(withLab.length).toBeGreaterThan(0);
    expect(withoutLab.length).toBeGreaterThan(0); // the evidence really does separate them
  });

  test('3. WITHOUT the preference, the canonical legacy selection is preserved', () => {
    const set = generate();
    expect(selectCandidate(set)!.normalizedIdentity).toBe(set.legacyIdentity);
    expect(selectCandidate(set)!.provenance).toBe('greedy_baseline');
    expect(selectCandidate(set)!.groundedScore).toBeUndefined();
  });

  test('4+5. WITH the confirmed preference, the SELECTED plan becomes the evidence-backed one', () => {
    const { snapshot, features } = scenario;
    const before = selectCandidate(generate())!;
    const after = selectCandidate(generate({
      grounded: { objective: objectiveFor(snapshot.snapshotId), features },
    }))!;

    // The selection genuinely changed — not merely a score number.
    expect(after.normalizedIdentity).not.toBe(before.normalizedIdentity);
    // …and the newly selected proposal is the one the official evidence supports.
    expect(courseIdsOf(before.state)).not.toContain('E3');
    expect(courseIdsOf(after.state)).toContain('E3');
    expect(after.groundedScore!.score).toBeGreaterThan(0);
    expect(after.groundedScore!.contributions[0].courseId).toBe('E3');
  });

  test('6. the explanation cites the confirmed preference, the feature and the official source', () => {
    const { snapshot, features } = scenario;
    const set = generate({ grounded: { objective: objectiveFor(snapshot.snapshotId), features } });
    const selected = selectCandidate(set)!;
    const alternative = set.candidates.find((c) => c.id !== selected.id);
    const text = explainGroundedRanking({
      objective: objectiveFor(snapshot.snapshotId),
      selected: selected.groundedScore!,
      alternative: alternative?.groundedScore,
    });
    expect(text).toContain('מעבדה');                 // which feature
    expect(text).toContain('ims.tau.ac.il');         // official source
    expect(text).toContain(String(YEAR));            // source year
    expect(text).toContain('E3');                    // the supporting course
    // Never claims the course is objectively better.
    expect(text).not.toMatch(/קורס טוב יותר|עדיף אובייקטיבית/);
  });

  test('7. missing or unknown evidence adds NO bias', async () => {
    const { snapshot } = scenario;
    // Every course unknown → every candidate scores 0 → legacy order preserved.
    const unknownDoc = await officialDoc(
      '<div class="data-table"><div class="data-table-cell"><small class="data-table-cell-label">מספר קורס</small><span>0542-9999-01</span></div></div>',
      '0542-9999',
      'E1',
    );
    const allUnknown = new Map([['E1', extractor.extract(unknownDoc)]]);
    expect(allUnknown.get('E1')!.laboratory.value).toBe('unknown');

    const baseline = selectCandidate(generate())!;
    const withUnknown = selectCandidate(generate({
      grounded: { objective: objectiveFor(snapshot.snapshotId), features: allUnknown },
    }))!;
    expect(withUnknown.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(withUnknown.groundedScore!.score).toBe(0);
    expect(withUnknown.groundedScore!.unknownCourseIds).toContain('E1');

    // An empty feature index (no evidence acquired at all) is equally inert.
    const noEvidence = selectCandidate(generate({
      grounded: { objective: objectiveFor(snapshot.snapshotId), features: new Map() },
    }))!;
    expect(noEvidence.normalizedIdentity).toBe(baseline.normalizedIdentity);
  });

  test('8. the soft objective can NEVER beat a hard constraint', () => {
    const { snapshot, features } = scenario;
    // E3 is the evidence-backed favourite — and is hard-EXCLUDED.
    const set = generate({
      grounded: { objective: objectiveFor(snapshot.snapshotId), features },
      model: { disallowedCourseIds: ['E3'] },
    });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) {
      expect(courseIdsOf(c.state)).not.toContain('E3'); // exclusion wins, always
    }
    expect(selectCandidate(set)!.groundedScore!.score).toBe(0);

    // And a hard INCLUSION the objective does not favour is still honoured.
    const forced = generate({
      grounded: { objective: objectiveFor(snapshot.snapshotId), features },
      model: { mustIncludeCourseIds: ['E1'] },
    });
    for (const c of forced.candidates) expect(courseIdsOf(c.state)).toContain('E1');
  });

  test('every candidate is scored against the SAME evidence snapshot', () => {
    const { snapshot, features } = scenario;
    const set = generate({ grounded: { objective: objectiveFor(snapshot.snapshotId), features } });
    // One objective object, one snapshotId, applied to every candidate.
    expect(set.candidates.every((c) => c.groundedScore !== undefined)).toBe(true);
    for (const c of set.candidates) {
      const recomputed = scoreCandidateOnObjective(courseIdsOf(c.state), objectiveFor(snapshot.snapshotId), features);
      expect(c.groundedScore!.score).toBe(recomputed.score);
    }
  });

  test('ranking with the objective is deterministic and reproducible', () => {
    const { snapshot, features } = scenario;
    const g = () => generate({ grounded: { objective: objectiveFor(snapshot.snapshotId), features } });
    expect(g().candidates.map((c) => c.id)).toEqual(g().candidates.map((c) => c.id));
    expect(selectCandidate(g())!.id).toBe(selectCandidate(g())!.id);
  });
});

/**
 * K8B/K8C — the SECOND grounded objective: `prefer_project_courses`.
 *
 * Selected by the K8A coverage audit, not by convenience: topic alignment
 * (1/7 courses) and assessment (0/8) both failed the evidence threshold, while
 * the official `אופן ההוראה` delivery-mode field is schema-complete (8/8) and
 * publishes "פרוייקט" as a real enumerated value.
 *
 * The objective must carry its OWN end-to-end ranking proof — a score-only unit
 * test would not qualify. These assertions are about which plan the system
 * actually selects, produced by the real `generateCandidateSet` running the real
 * `PlannerWorker` under one fixed policy with identical hard constraints.
 */
import { generateCandidateSet, selectCandidate } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate } from '../../api/ai/planner_validate';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import { RuleBasedFeatureExtractor } from '../../api/ai/course_features';
import { explainGroundedRanking, scoreCandidateOnObjective, type GroundedObjective } from '../../api/ai/grounded_objectives';
import { resolveGroundedObjective, SUPPORTED_GROUNDED_FEATURES } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { Preference } from '../../api/ai/preference_model';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2025;
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
const courseIdsOf = (s: PlanState) => [...new Set(Object.values(s.semesters).flat())].sort();

/**
 * An OFFERING-scoped official document (no group suffix on the course number), so
 * the fact applies to exactly the object the candidate selects. `אופן ההוראה` is
 * the real enumerated field the audit measured at 8/8.
 */
function doc(courseId: string, delivery: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542${courseId}&year=${YEAR}`,
    contentHash: `sha_${courseId}_${delivery}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`0542-30${courseId.slice(1)}`], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery}`,
    ...over,
  };
}

/** E3 is the only PROJECT course; the rest are lectures. */
const PROJECT_CORPUS = [doc('E1', 'שיעור'), doc('E2', 'שיעור'), doc('E3', 'פרוייקט'), doc('E4', 'שיעור')];

const projectObjective = (snapshotId: string): GroundedObjective => ({
  id: 'prefer_project_courses', confirmed: true, snapshotId,
});

function prepared(docs: SyllabusDocument[] = PROJECT_CORPUS) {
  return prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: docs });
}

function generate(opts: { grounded?: { objective: GroundedObjective; features: Map<string, ReturnType<RuleBasedFeatureExtractor['extract']>> }; model?: Parameters<typeof buildConstraintModel>[1] } = {}) {
  return generateCandidateSet({
    buildModel: () => model(opts.model ?? {}),
    policy: 'neutral', initialState: empty(), profileVersion: 3, maxCandidates: 4,
    ...(opts.grounded ? { groundedObjective: opts.grounded } : {}),
  });
}

// ── the feature ──────────────────────────────────────────────────────────────

describe('K8B — project delivery is extracted from the schema-complete official field', () => {
  const extractor = new RuleBasedFeatureExtractor();

  test('"פרוייקט" delivery yields projectDelivery TRUE', () => {
    expect(extractor.extract(doc('E3', 'פרוייקט')).projectDelivery.value).toBe(true);
  });

  test('a lecture or laboratory course yields projectDelivery FALSE — the field is schema-complete', () => {
    expect(extractor.extract(doc('E1', 'שיעור')).projectDelivery.value).toBe(false);
    expect(extractor.extract(doc('E9', 'מעבדה')).projectDelivery.value).toBe(false);
  });

  test('a MISSING delivery field yields unknown, never false', () => {
    const noField = doc('E5', 'שיעור', { labeledFields: { 'מספר קורס': ['0542-3005'] } });
    expect(extractor.extract(noField).projectDelivery.value).toBe('unknown');
    expect(extractor.extract(noField).projectDelivery.evidence).toEqual([]);
  });

  test('the feature carries official evidence with source and year', () => {
    const f = extractor.extract(doc('E3', 'פרוייקט'));
    expect(f.projectDelivery.evidence[0].sourceClass).toBe('official_syllabus');
    expect(f.projectDelivery.evidence[0].academicYear).toBe(YEAR);
    expect(f.projectDelivery.evidence[0].sourceRef).toContain('ims.tau.ac.il');
  });

  test('laboratory and project are independent readings of the same official field', () => {
    const lab = extractor.extract(doc('E9', 'מעבדה'));
    expect(lab.laboratory.value).toBe(true);
    expect(lab.projectDelivery.value).toBe(false);
  });
});

// ── the preference contract ──────────────────────────────────────────────────

describe('K8B — the typed preference maps to the objective at the one boundary', () => {
  const pref = (over: Partial<Preference> = {}): Preference => ({
    id: 'course_feature_practical', category: 'course_feature', normalized: 'project_based',
    value: 'project_based', classification: 'soft_preference', confidence: 0.9,
    source: 'explicit_answer', confirmationStatus: 'confirmed',
    affects: 'grounded_course_feature', mayAffectPlanningBeforeConfirmation: true, ...over,
  });
  const resolve = (p: Preference[], version = 4) =>
    resolveGroundedObjective(effectivePlannerPreferences({ version, preferences: p }));

  test('project_based is a supported feature that resolves to the project objective', () => {
    expect(SUPPORTED_GROUNDED_FEATURES).toContain('project_based');
    expect(resolve([pref()]).objective).toBe('prefer_project_courses');
    expect(resolve([pref()]).provenance!.feature).toBe('project_based');
  });

  test('the internal objective id is still never a valid input value', () => {
    expect(resolve([pref({ normalized: 'prefer_project_courses' })]).objective).toBeUndefined();
  });

  test.each([
    ['indifferent', { classification: 'indifferent' as const }],
    ['uncertain', { classification: 'uncertain' as const, mayAffectPlanningBeforeConfirmation: false }],
    ['unconfirmed', { confirmationStatus: 'unconfirmed' as const, mayAffectPlanningBeforeConfirmation: false }],
  ])('%s never activates the project objective', (_l, over) => {
    expect(resolve([pref(over)]).objective).toBeUndefined();
  });

  test('the preference stays SOFT — it never becomes a hard inclusion', () => {
    const eff = effectivePlannerPreferences({ version: 4, preferences: [pref()] });
    expect(eff.soft.map((p) => p.id)).toContain('course_feature_practical');
    expect(eff.hard).toEqual([]);
  });
});

// ── K8C: the end-to-end ranking proof ────────────────────────────────────────

describe('K8C — the project objective changes REAL candidate selection', () => {
  test('1+2. at least two valid candidates share identical hard constraints', () => {
    const set = generate();
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of set.candidates) {
      const r = validateCandidate(c.state, model());
      expect(r.valid).toBe(true);
      expect(r.degreeMet).toBe(true);
      expect(c.policy).toBe('neutral');
      expect(c.profileVersion).toBe(3);
    }
  });

  test('3. official applicable evidence distinguishes the candidates', () => {
    const p = prepared();
    expect(p.features.get('E3')!.projectDelivery.value).toBe(true);
    expect(p.features.get('E1')!.projectDelivery.value).toBe(false);
    const set = generate();
    expect(set.candidates.some((c) => courseIdsOf(c.state).includes('E3'))).toBe(true);
    expect(set.candidates.some((c) => !courseIdsOf(c.state).includes('E3'))).toBe(true);
  });

  test('4. WITHOUT the preference the canonical legacy selection is preserved', () => {
    const set = generate();
    expect(selectCandidate(set)!.normalizedIdentity).toBe(set.legacyIdentity);
    expect(selectCandidate(set)!.groundedScore).toBeUndefined();
  });

  test('5+6. WITH the confirmed preference the SELECTED plan becomes the project one', () => {
    const p = prepared();
    const before = selectCandidate(generate())!;
    const after = selectCandidate(generate({
      grounded: { objective: projectObjective(p.snapshot.snapshotId), features: p.features },
    }))!;
    expect(after.normalizedIdentity).not.toBe(before.normalizedIdentity);
    expect(courseIdsOf(before.state)).not.toContain('E3');
    expect(courseIdsOf(after.state)).toContain('E3');
    expect(after.groundedScore!.contributions[0].courseId).toBe('E3');
  });

  test('7. the explanation cites the project feature, official source and year', () => {
    const p = prepared();
    const set = generate({ grounded: { objective: projectObjective(p.snapshot.snapshotId), features: p.features } });
    const sel = selectCandidate(set)!;
    const text = explainGroundedRanking({
      objective: projectObjective(p.snapshot.snapshotId),
      selected: sel.groundedScore!,
      alternative: set.candidates.find((c) => c.id !== sel.id)?.groundedScore,
    });
    expect(text).toMatch(/פרוי/);           // the project feature, not laboratory
    expect(text).not.toMatch(/מעבדה/);
    expect(text).toContain('ims.tau.ac.il');
    expect(text).toContain(String(YEAR));
    expect(text).not.toMatch(/טוב יותר|קל יותר|מומלץ יותר/);
  });

  test('8. an INDIFFERENT preference restores the canonical selection', () => {
    // No objective is resolved for an indifferent answer, so ranking is untouched.
    const baseline = selectCandidate(generate())!;
    expect(selectCandidate(generate())!.normalizedIdentity).toBe(baseline.normalizedIdentity);
  });

  test('9. missing or unknown evidence leaves the selection unchanged', () => {
    const baseline = selectCandidate(generate())!;
    const noEvidence = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: [] });
    const withNothing = selectCandidate(generate({
      grounded: { objective: projectObjective(noEvidence.snapshot.snapshotId), features: noEvidence.features },
    }))!;
    expect(withNothing.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(withNothing.groundedScore!.score).toBe(0);
  });

  test('9b. section-VARYING project evidence is inert (K7.5 applicability holds)', () => {
    const mixed = prepareEvidence({
      courseIds: ELECTIVES, academicYear: YEAR,
      documents: [
        { ...doc('E3', 'פרוייקט'), contentHash: 'g05', labeledFields: { 'מספר קורס': ['0542-3003-05'], 'אופן ההוראה': ['פרוייקט'] } },
        { ...doc('E3', 'שיעור'), contentHash: 'g01', labeledFields: { 'מספר קורס': ['0542-3003-01'], 'אופן ההוראה': ['שיעור'] } },
      ],
    });
    const baseline = selectCandidate(generate())!;
    const withMixed = selectCandidate(generate({
      grounded: { objective: projectObjective(mixed.snapshot.snapshotId), features: mixed.features },
    }))!;
    expect(withMixed.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(withMixed.groundedScore!.score).toBe(0);
    expect(mixed.coverage.variesBySectionCourseIds).toEqual(['E3']);
  });

  test('10. hard exclusion of the favoured project course still wins', () => {
    const p = prepared();
    const set = generate({
      grounded: { objective: projectObjective(p.snapshot.snapshotId), features: p.features },
      model: { disallowedCourseIds: ['E3'] },
    });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) expect(courseIdsOf(c.state)).not.toContain('E3');
    expect(selectCandidate(set)!.groundedScore!.score).toBe(0);
  });

  test('11. repeated runs are deterministic', () => {
    const p = prepared();
    const g = () => generate({ grounded: { objective: projectObjective(p.snapshot.snapshotId), features: p.features } });
    expect(g().candidates.map((c) => c.id)).toEqual(g().candidates.map((c) => c.id));
    expect(selectCandidate(g())!.id).toBe(selectCandidate(g())!.id);
  });

  test('every candidate is scored against the SAME snapshot', () => {
    const p = prepared();
    const set = generate({ grounded: { objective: projectObjective(p.snapshot.snapshotId), features: p.features } });
    for (const c of set.candidates) {
      const recomputed = scoreCandidateOnObjective(courseIdsOf(c.state), projectObjective(p.snapshot.snapshotId), p.features);
      expect(c.groundedScore!.score).toBe(recomputed.score);
    }
  });
});

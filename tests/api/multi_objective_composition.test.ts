/**
 * M2–M5 — the composition rules, proven generically.
 *
 * Nothing here is pair-specific. Every case drives the SAME code path from an
 * objective collection, which is why all seven single/pair/triple combinations
 * are exercised: if a hidden `if topic && project` branch existed, the triple
 * and the laboratory pairs would not behave like the others.
 *
 * The properties under test are the ones that make composition safe:
 *   - each objective scores independently and is normalized to [0,1];
 *   - the denominator cannot be gamed by schedule size, coverage or duplicates;
 *   - Pareto dominance is decided on the full vector, before aggregation;
 *   - a dominated candidate can never outrank its dominator;
 *   - order — of objectives, preferences or candidates — changes nothing.
 */
import {
  resolveGroundedObjectiveSet,
  scoreObjective,
  dominates,
  composedUtility,
  type ResolvedObjective,
} from '../../api/ai/grounded_objective_set';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { RuleBasedFeatureExtractor } from '../../api/ai/course_features';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import { generateCandidateSet, selectCandidate } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import type { Preference } from '../../api/ai/preference_model';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2027;
const ELECTIVES = ['E1', 'E2', 'E3', 'E4'];

function doc(courseId: string, delivery: string, content: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=comp${courseId}&year=${YEAR}`,
    contentHash: `sha_comp_${courseId}`, retrievedAt: '2026-08-15T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery} תוכן הקורס ומטרתו ${content} מטלות הקורס`,
    ...over,
  };
}

const CORPUS = [
  doc('E1', 'שיעור', 'תכן הנדסי בלבד.'),
  doc('E2', 'פרוייקט', 'תכן הנדסי בלבד.'),
  doc('E3', 'פרוייקט', 'תכן הנדסי, הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'),
  doc('E4', 'מעבדה', 'תכן הנדסי, מעבר חום וזרימה.'),
];

const prepared = (docs: SyllabusDocument[] = CORPUS) =>
  prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: docs, extractor: new RuleBasedFeatureExtractor() });

const pref = (over: Partial<Preference>): Preference => ({
  id: 'x', category: 'course_feature', normalized: 'project_based', value: 'project_based',
  classification: 'soft_preference', confidence: 0.9, source: 'explicit_answer',
  confirmationStatus: 'confirmed', affects: 'grounded_course_feature',
  mayAffectPlanningBeforeConfirmation: true, ...over,
});
const PROJECT = pref({ id: 'course_feature_project', normalized: 'project_based', value: 'project_based' });
const LAB = pref({ id: 'course_feature_lab', normalized: 'practical_laboratory', value: 'practical_laboratory' });
const TOPIC = pref({
  id: 'course_topic_interest', category: 'course_topic_interest', normalized: 'robotics', value: 'robotics',
  affects: 'grounded_topic_interest',
});

const setOf = (prefs: Preference[], version = 5) =>
  resolveGroundedObjectiveSet(effectivePlannerPreferences({ version, preferences: prefs }));

// ── M5: the generic objective collection ─────────────────────────────────────

describe('M5 — every single/pair/triple combination resolves generically', () => {
  const CASES: Array<[string, Preference[], string[]]> = [
    ['topic only', [TOPIC], ['prefer_topic_alignment']],
    ['project only', [PROJECT], ['prefer_project_courses']],
    ['laboratory only', [LAB], ['prefer_laboratory_courses']],
    ['topic + project', [TOPIC, PROJECT], ['prefer_project_courses', 'prefer_topic_alignment']],
    ['topic + laboratory', [TOPIC, LAB], ['prefer_laboratory_courses', 'prefer_topic_alignment']],
    ['project + laboratory', [PROJECT, LAB], ['prefer_laboratory_courses', 'prefer_project_courses']],
    ['topic + project + laboratory', [TOPIC, PROJECT, LAB],
      ['prefer_laboratory_courses', 'prefer_project_courses', 'prefer_topic_alignment']],
  ];

  test.each(CASES)('%s', (_label, prefs, expected) => {
    expect(setOf(prefs).objectives.map((o) => o.id)).toEqual(expected);
  });

  test.each(CASES)('%s is invariant to preference order', (_label, prefs, expected) => {
    expect(setOf([...prefs].reverse()).objectives.map((o) => o.id)).toEqual(expected);
  });

  test('every objective carries its own provenance, never a shared one', () => {
    const objectives = setOf([TOPIC, PROJECT, LAB]).objectives;
    expect(objectives.map((o) => o.preferenceId).sort())
      .toEqual(['course_feature_lab', 'course_feature_project', 'course_topic_interest']);
    for (const o of objectives) expect(o.profileVersion).toBe(5);
  });
});

// ── M2: normalization ────────────────────────────────────────────────────────

describe('M2 — normalized scores are bounded, comparable and ungameable', () => {
  const p = prepared();
  const objective = (id: ResolvedObjective['id'], kind: ResolvedObjective['kind'], topicIds?: string[]): ResolvedObjective => ({
    id, preferenceId: 'p', kind, target: 't', source: 'explicit_answer', profileVersion: 5,
    ...(topicIds ? { topicIds: topicIds as never } : {}),
  });
  const score = (ids: string[], o: ResolvedObjective) =>
    scoreObjective(ids, o, p.snapshot.snapshotId, p.features, p.topics);

  test('a normalized score is always within [0,1]', () => {
    for (const ids of [['E1'], ['E2', 'E3'], ELECTIVES]) {
      const s = score(ids, objective('prefer_project_courses', 'delivery'));
      expect(s.normalized).toBeGreaterThanOrEqual(0);
      expect(s.normalized).toBeLessThanOrEqual(1);
    }
  });

  test('a LARGER schedule is not rewarded merely for holding more courses', () => {
    // Both plans are half project courses; the bigger one must not score higher.
    const small = score(['E2', 'E1'], objective('prefer_project_courses', 'delivery'));
    const big = score(['E2', 'E3', 'E1', 'E4'], objective('prefer_project_courses', 'delivery'));
    expect(big.raw).toBeGreaterThan(small.raw);           // raw counts DO grow
    expect(big.normalized).toBeCloseTo(small.normalized); // normalized does not
  });

  test('greater evidence COVERAGE cannot raise a score', () => {
    // Same one project course; the second plan simply has more covered courses.
    const sparse = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: [CORPUS[1]] });
    const lean = scoreObjective(['E2', 'E1'], objective('prefer_project_courses', 'delivery'), sparse.snapshot.snapshotId, sparse.features, sparse.topics);
    const full = score(['E2', 'E1'], objective('prefer_project_courses', 'delivery'));
    expect(lean.normalized).toBeCloseTo(full.normalized);
  });

  test('an UNKNOWN course neither rewards nor penalises relative to a known negative', () => {
    const noEvidence = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: [CORPUS[1]] });
    // {E2 project, E1 unknown} vs {E2 project, E1 known-not-project}
    const withUnknown = scoreObjective(['E2', 'E1'], objective('prefer_project_courses', 'delivery'), noEvidence.snapshot.snapshotId, noEvidence.features, noEvidence.topics);
    const withFalse = score(['E2', 'E1'], objective('prefer_project_courses', 'delivery'));
    expect(withUnknown.normalized).toBeCloseTo(withFalse.normalized);
  });

  test('duplicate evidence for the same fact does not increase a score', () => {
    const duplicated = prepareEvidence({
      courseIds: ELECTIVES, academicYear: YEAR,
      documents: [...CORPUS, { ...CORPUS[2], contentHash: 'sha_dup_E3' }],
    });
    const once = score(['E3', 'E1'], objective('prefer_topic_alignment', 'topic', ['robotics']));
    const twice = scoreObjective(['E3', 'E1'], objective('prefer_topic_alignment', 'topic', ['robotics']), duplicated.snapshot.snapshotId, duplicated.features, duplicated.topics);
    expect(twice.normalized).toBeCloseTo(once.normalized);
  });

  test('topic and delivery denominators make their scores comparable', () => {
    // One of two courses matches, on either objective ⇒ both read 0.5.
    const topic = score(['E3', 'E1'], objective('prefer_topic_alignment', 'topic', ['robotics']));
    const delivery = score(['E2', 'E1'], objective('prefer_project_courses', 'delivery'));
    expect(topic.normalized).toBeCloseTo(0.5);
    expect(delivery.normalized).toBeCloseTo(0.5);
  });
});

// ── M3: Pareto dominance ─────────────────────────────────────────────────────

describe('M3 — dominance is decided on the full vector', () => {
  test('better on one, equal on the rest ⇒ dominates', () => {
    expect(dominates([1, 0.5], [0.5, 0.5])).toBe(true);
    expect(dominates([0.5, 1], [0.5, 0.5])).toBe(true);
  });
  test('better on one but worse on another ⇒ neither dominates', () => {
    expect(dominates([1, 0], [0, 1])).toBe(false);
    expect(dominates([0, 1], [1, 0])).toBe(false);
  });
  test('identical vectors ⇒ no domination in either direction', () => {
    expect(dominates([0.5, 0.5], [0.5, 0.5])).toBe(false);
  });
  test('dominance is order-invariant across the objective axis', () => {
    expect(dominates([1, 0.5], [0.5, 0.5])).toBe(dominates([0.5, 1], [0.5, 0.5]));
  });
  test('a dominator always has strictly greater composed utility', () => {
    expect(composedUtility([1, 0.5])).toBeGreaterThan(composedUtility([0.5, 0.5]));
    expect(composedUtility([0.5, 0.5, 1])).toBeGreaterThan(composedUtility([0.5, 0.5, 0.5]));
  });
});

// ── M4: composition policy ───────────────────────────────────────────────────

describe('M4 — the equal-importance default is symmetric and deterministic', () => {
  test('composed utility does not depend on objective order', () => {
    expect(composedUtility([0.25, 0.75])).toBeCloseTo(composedUtility([0.75, 0.25]));
    expect(composedUtility([0, 0.5, 1])).toBeCloseTo(composedUtility([1, 0.5, 0]));
  });
  test('an exact trade-off produces an exact tie — precedence would not', () => {
    expect(composedUtility([1, 0])).toBeCloseTo(composedUtility([0, 1]));
  });
  test('explicit priority changes the outcome, and only when supplied', () => {
    expect(composedUtility([1, 0], [3, 1])).toBeGreaterThan(composedUtility([0, 1], [3, 1]));
    expect(composedUtility([1, 0])).toBeCloseTo(composedUtility([0, 1]));
  });
  test('a zero priority is honoured as "this genuinely does not matter"', () => {
    expect(composedUtility([0, 1], [0, 1])).toBeCloseTo(1);
  });
});

// ── M3/M4 through the REAL candidate machinery ───────────────────────────────

describe('M3/M4 — composition through the real candidate set', () => {
  function model(extra: Parameters<typeof buildConstraintModel>[1] = {}): ConstraintModel {
    return buildConstraintModel({
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
    }, { hardCap: 20, maxHoursPerSemester: 25, ...extra });
  }
  const empty = (): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });
  const p = prepared();

  const generate = (objectives: ResolvedObjective[], extra: Parameters<typeof buildConstraintModel>[1] = {}) =>
    generateCandidateSet({
      buildModel: () => model(extra),
      policy: 'neutral', initialState: empty(), profileVersion: 5, maxCandidates: 4,
      ...(objectives.length
        ? { groundedObjectives: { objectives, snapshotId: p.snapshot.snapshotId, features: p.features, topics: p.topics } }
        : {}),
    });

  const OBJ = {
    project: setOf([PROJECT]).objectives[0],
    lab: setOf([LAB]).objectives[0],
    topic: setOf([TOPIC]).objectives[0],
  };
  const ids = (s: PlanState) => [...new Set(Object.values(s.semesters).flat())].sort();

  test('a candidate winning BOTH outranks one winning only one', () => {
    // Both retained candidates hold a project course, so project ties; only
    // {E1,E3} also covers robotics, so it dominates.
    const sel = selectCandidate(generate([OBJ.project, OBJ.topic]))!;
    expect(ids(sel.state)).toContain('E3');
    expect(sel.objectiveScores).toHaveLength(2);
  });

  test('OBJECTIVE order does not change the selected candidate or the vectors', () => {
    const forward = selectCandidate(generate([OBJ.project, OBJ.topic]))!;
    const reverse = selectCandidate(generate([OBJ.topic, OBJ.project]))!;
    expect(reverse.normalizedIdentity).toBe(forward.normalizedIdentity);
    expect([...(reverse.objectiveScores ?? [])].map((c) => c.normalized).sort())
      .toEqual([...(forward.objectiveScores ?? [])].map((c) => c.normalized).sort());
  });

  test('repeated runs produce identical ids, ranking and vectors', () => {
    const a = generate([OBJ.project, OBJ.topic, OBJ.lab]);
    const b = generate([OBJ.project, OBJ.topic, OBJ.lab]);
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id));
    expect(JSON.stringify(a.candidates.map((c) => c.objectiveScores)))
      .toBe(JSON.stringify(b.candidates.map((c) => c.objectiveScores)));
  });

  test('no candidate outranks a candidate that dominates it', () => {
    const set = generate([OBJ.project, OBJ.topic]);
    const vec = (i: number) => set.candidates[i].objectiveScores!.map((c) => c.normalized);
    for (let i = 0; i < set.candidates.length; i++) {
      for (let j = i + 1; j < set.candidates.length; j++) {
        // j is ranked below i, so j must not dominate i.
        expect(dominates(vec(j), vec(i))).toBe(false);
      }
    }
  });

  test('the composition metadata is truthful about the objective set', () => {
    const set = generate([OBJ.project, OBJ.topic]);
    expect(set.composition!.objectiveIds).toEqual(['prefer_project_courses', 'prefer_topic_alignment']);
    expect(set.composition!.nonDominatedCount).toBeGreaterThanOrEqual(1);
    expect(set.composition!.dominatedCount + set.composition!.nonDominatedCount)
      .toBe(set.candidates.length);
  });

  test('ONE objective still reports the single-objective reason', () => {
    expect(generate([OBJ.topic]).composition!.reason).toBe('single_objective');
  });

  test('a hard exclusion of the both-satisfying course beats every soft objective', () => {
    const set = generate([OBJ.project, OBJ.topic], { disallowedCourseIds: ['E3'] });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) expect(ids(c.state)).not.toContain('E3');
  });

  test('with NO objectives the ranking is untouched — default-off is preserved', () => {
    const plain = selectCandidate(generate([]))!;
    expect(plain.objectiveScores).toBeUndefined();
    expect(plain.normalizedIdentity).toBe(generate([]).legacyIdentity);
  });
});

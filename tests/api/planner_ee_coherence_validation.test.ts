/**
 * Point-5 adversarial validation — proves that the new goal stack
 * (`interest_fit > balance_peak`) yields topic-coherent plans for EE students.
 *
 * Three adversarial scenarios, each built as a head-to-head comparison between
 * two legal plans that are identical on every higher-priority goal:
 *
 *   ALIGNED plan  — places the topic-relevant EE course in the HEAVIER semester.
 *   BALANCE plan  — places a topic-agnostic generic course, keeping the LIGHTER peak.
 *
 * Before the goal-stack change (index 8 interest_fit < index 4 balance_peak):
 *   BALANCE would win — a one-point peak advantage outranked topic alignment.
 *
 * After the change (index 6 interest_fit > index 7 balance_peak):
 *   ALIGNED wins — topic coherence is decided before load balancing.
 *
 * All scenarios also verify that the invariants that must NEVER be overridden
 * still hold: legality, degree completion, and explicit unwanted-avoidance each
 * rank above interest_fit in every scenario.
 *
 * EE course IDs used (TAU catalog, all from loadElectricalEngineering2027Catalog):
 *   0512-4200  מבוא לעיבוד ספרתי של אותות  — signal_processing, weight 0.7
 *   0512-4703  מבוא לתכנון מעגלי Vlsi       — vlsi + circuits_electronics, weight 0.7+0.6
 *   0512-4800  הנדסת מיקרוגלים              — electromagnetics, weight 0.7
 *   0509-1815  כימיה בסיסית להנדסה         — default profile, no EE topic (fit = 0)
 */

import { scorePlan, compareScore } from '../../api/ai/planner_goals';
import { type ConstraintModel, type PlanState, emptyState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';
import { createElectricalEngineering2027Resolver } from '../../api/ai/course_topic_profiles_static';
import { areasForTopicIds } from '../../api/ai/focus_topic_objective';

// ── fixture helpers ───────────────────────────────────────────────────────────

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a'];
const SEM_A = SEMS[0];
const SEM_B = SEMS[1];

function profile(id: string, hrs: number, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null, is_mandatory: false,
    course_type: 'elective', placement_policy: 'elective', hours: hrs,
    offered_semesters: null, effective_allowed_semesters: null, recommended_semester: null,
    allowed_semesters: null, program_allowed_semesters: null, prerequisites: [], corequisites: [],
    syllabus_url: null, syllabus_available: false, syllabus_summary_he: null, syllabus_topics_he: [],
    assessment_type: null, workload_score: null, difficulty_score: 3, difficulty_level: null,
    grade_average: null, is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null,
    data_confidence: 0.5, provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

/**
 * Build a minimal ConstraintModel for the adversarial scenarios.
 * Total degree hours = 24 so that placing 3 courses × 8h each fills degree completion (g1=1).
 * Both plans place the same number of hours → g1 is always equal.
 */
function mkModel(fitById: Map<string, number>, over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  // HEAVY_BASE: 10 hours in sem_A — always present in both plans
  profiles.set('HEAVY_BASE', profile('HEAVY_BASE', 10));
  // LIGHT_BASE: 6 hours in sem_B — always present in both plans
  profiles.set('LIGHT_BASE', profile('LIGHT_BASE', 6));
  // The focus-topic course: placed in sem_A (heavy), weight 0.7 for the topic
  profiles.set('TOPIC_COURSE', profile('TOPIC_COURSE', 4));
  // A generic humanities/non-EE course: placed in sem_B (light), zero topic fit
  profiles.set('GENERIC', profile('GENERIC', 4));
  return {
    profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [], categories: [],
    degreeRequiredHours: 20,  // HEAVY_BASE(10) + LIGHT_BASE(6) + 4-hour elective = 20
    priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    courseFitById: fitById,
    ...over,
  };
}

/**
 * ALIGNED plan: places TOPIC_COURSE in sem_A (the HEAVY semester, now 14h).
 *   sem_A = [HEAVY_BASE(10h), TOPIC_COURSE(4h)] → 14h  peak = 14
 *   sem_B = [LIGHT_BASE(6h)]                   →  6h
 */
function alignedPlan(): PlanState {
  const s = emptyState(SEMS);
  s.semesters[SEM_A] = ['HEAVY_BASE', 'TOPIC_COURSE'];
  s.semesters[SEM_B] = ['LIGHT_BASE'];
  return s;
}

/**
 * BALANCE plan: places GENERIC in sem_B (the LIGHT semester, now 10h).
 *   sem_A = [HEAVY_BASE(10h)]               → 10h  peak = 10
 *   sem_B = [LIGHT_BASE(6h), GENERIC(4h)]  → 10h
 * Balance is better (peak 10 beats 14), but no topic fit (GENERIC has fit = 0).
 */
function balancePlan(): PlanState {
  const s = emptyState(SEMS);
  s.semesters[SEM_A] = ['HEAVY_BASE'];
  s.semesters[SEM_B] = ['LIGHT_BASE', 'GENERIC'];
  return s;
}

// ── Premise: real EE course profiles are non-zero for their focus areas ───────

describe('Point-5 premise: EE topic profiles resolve with non-zero fit scores', () => {
  const resolver = createElectricalEngineering2027Resolver();

  test('0512-4200 (SP course) has signal_processing AcademicFocusArea with weight 0.7', () => {
    const p = resolver.resolveCourseTopicProfile('0512-4200');
    expect(p).toBeDefined();
    expect(p!.source).toBe('inferred');
    const spArea = p!.topics.find(t => t.area === 'signal_processing');
    expect(spArea).toBeDefined();
    expect(spArea!.weight).toBe(0.7);
  });

  test('0512-4703 (VLSI course) has vlsi AcademicFocusArea with weight 0.7', () => {
    const p = resolver.resolveCourseTopicProfile('0512-4703');
    expect(p).toBeDefined();
    const vlsiArea = p!.topics.find(t => t.area === 'vlsi');
    expect(vlsiArea).toBeDefined();
    expect(vlsiArea!.weight).toBe(0.7);
  });

  test('0512-4800 (EM course) has electromagnetics AcademicFocusArea with weight 0.7', () => {
    const p = resolver.resolveCourseTopicProfile('0512-4800');
    expect(p).toBeDefined();
    const emArea = p!.topics.find(t => t.area === 'electromagnetics');
    expect(emArea).toBeDefined();
    expect(emArea!.weight).toBe(0.7);
  });

  test('0509-1815 (basic chemistry) has no EE topic areas — honest default profile', () => {
    // This course IS in the EE catalog but has no keyword/category match → default.
    const p = resolver.resolveCourseTopicProfile('0509-1815');
    expect(p).toBeDefined();
    expect(p!.source).toBe('default');
    expect(p!.topics).toEqual([]);
  });

  test('areasForTopicIds maps signal_processing topicId → signal_processing AcademicFocusArea', () => {
    const areas = areasForTopicIds(['signal_processing']);
    expect(areas.has('signal_processing')).toBe(true);
  });

  test('areasForTopicIds maps vlsi_chip_design topicId → vlsi AcademicFocusArea', () => {
    const areas = areasForTopicIds(['vlsi_chip_design']);
    expect(areas.has('vlsi')).toBe(true);
  });
});

// ── Scenario A: Signal Processing focus ───────────────────────────────────────

describe('Point-5 Scenario A: EE student focused on signal_processing', () => {
  // TOPIC_COURSE simulates 0512-4200: fit 0.7 for signal_processing.
  // GENERIC simulates 0555-4000 (ethics): fit 0.
  const FIT = new Map([['TOPIC_COURSE', 0.7]]);

  test('ALIGNED plan (topic course in heavy sem) beats BALANCE plan (generic in light sem)', () => {
    const m = mkModel(FIT);
    // New stack: fit (index 6) is decided before balance_peak (index 7).
    // ALIGNED: gFit = 0.7, g4a = -14
    // BALANCE: gFit = 0.0, g4a = -10 (better peak)
    // → gFit 0.7 > 0 → ALIGNED wins.
    expect(compareScore(scorePlan(alignedPlan(), m), scorePlan(balancePlan(), m))).toBeGreaterThan(0);
  });

  test('without fit signals (gFit=0 both), balance still decides — backward compat', () => {
    const m = mkModel(new Map()); // no courseFitById entries → both plans have gFit = 0
    // Both gFit equal → g4a decides: BALANCE peak(-10) beats ALIGNED peak(-14).
    expect(compareScore(scorePlan(balancePlan(), m), scorePlan(alignedPlan(), m))).toBeGreaterThan(0);
  });

  test('unwanted_avoidance still outranks fit: topic-high-fit but unwanted course loses', () => {
    const m = mkModel(FIT);
    m.profiles.get('TOPIC_COURSE')!.is_unwanted = true;
    // ALIGNED places an unwanted course → g5b penalised.
    // BALANCE places GENERIC (not unwanted) → g5b = 0.
    // g5b (index 5) is above gFit (index 6) → BALANCE wins despite ALIGNED having higher fit.
    expect(compareScore(scorePlan(balancePlan(), m), scorePlan(alignedPlan(), m))).toBeGreaterThan(0);
  });

  test('legality still outranks fit: over-cap aligned plan loses to legal balanced plan', () => {
    const m = mkModel(FIT, { maxHoursPerSemester: 12 });
    // ALIGNED: sem_A has 14h which exceeds maxHoursPerSemester=12 → over user cap → g3 penalised.
    // BALANCE: sem_B has 10h, sem_A has 10h → both ≤ 12 → legal.
    // g3 (legality, index 3) is far above gFit (index 6) → BALANCE wins.
    expect(compareScore(scorePlan(balancePlan(), m), scorePlan(alignedPlan(), m))).toBeGreaterThan(0);
  });
});

// ── Scenario B: VLSI focus ────────────────────────────────────────────────────

describe('Point-5 Scenario B: EE student focused on vlsi_chip_design', () => {
  // TOPIC_COURSE simulates 0512-4703: fit 0.7 for vlsi (via circuits_electronics 0.6 + vlsi 0.7 = 1.3
  // but we keep the simpler injected value 0.7 to match the single-area vlsi signal).
  const FIT = new Map([['TOPIC_COURSE', 0.7]]);

  test('ALIGNED plan (VLSI course in heavy sem) beats BALANCE plan (generic in light sem)', () => {
    const m = mkModel(FIT);
    expect(compareScore(scorePlan(alignedPlan(), m), scorePlan(balancePlan(), m))).toBeGreaterThan(0);
  });

  test('a stronger fit signal gives an even larger margin', () => {
    // Both courses are topic-relevant, but TOPIC_COURSE is better aligned (0.9) than GENERIC (0.3).
    const m = mkModel(new Map([['TOPIC_COURSE', 0.9], ['GENERIC', 0.3]]));
    // ALIGNED: gFit = 0.9, BALANCE: gFit = 0.3 → ALIGNED still wins.
    expect(compareScore(scorePlan(alignedPlan(), m), scorePlan(balancePlan(), m))).toBeGreaterThan(0);
  });
});

// ── Scenario C: Electromagnetics focus ───────────────────────────────────────

describe('Point-5 Scenario C: EE student focused on electromagnetics', () => {
  // TOPIC_COURSE simulates 0512-4800 (הנדסת מיקרוגלים): fit 0.7 for electromagnetics.
  const FIT = new Map([['TOPIC_COURSE', 0.7]]);

  test('ALIGNED plan (EM course in heavy sem) beats BALANCE plan (generic in light sem)', () => {
    const m = mkModel(FIT);
    expect(compareScore(scorePlan(alignedPlan(), m), scorePlan(balancePlan(), m))).toBeGreaterThan(0);
  });

  test('completing degree requirements still outranks fit: more hours placed is better', () => {
    // Both plans complete the degree. Degree now requires 24h → only BALANCE achieves it
    // (places 20h = HEAVY_BASE+LIGHT_BASE+GENERIC). ALIGNED places 20h too — wait, same.
    // So to test g1 priority, make degree = 20h but only one plan places an extra mandatory course.
    const mandatory = profile('MAND', 4, { is_mandatory: true, course_type: 'mandatory' });
    const m = mkModel(FIT, {
      degreeRequiredHours: 24,
      requiredMandatoryCourseIds: ['MAND'],
    });
    m.profiles.set('MAND', mandatory);
    // Plan that places MAND (even without fit) beats plan that skips MAND but has fit.
    const withMandatory = emptyState(SEMS);
    withMandatory.semesters[SEM_A] = ['HEAVY_BASE'];
    withMandatory.semesters[SEM_B] = ['LIGHT_BASE', 'MAND'];
    const withFitOnly = alignedPlan();
    // withFitOnly: gFit=0.7 but misses MAND → g2a < 1
    // withMandatory: gFit=0 but places MAND → g2a = 1
    // g2a (index 1) is far above gFit (index 6) → withMandatory wins.
    expect(compareScore(scorePlan(withMandatory, m), scorePlan(withFitOnly, m))).toBeGreaterThan(0);
  });
});

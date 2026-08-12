/**
 * Slice 17B — internal candidate set. Generates balanced + compact alternatives
 * through the SAME stable PlannerWorker (only model.distributionPolicy differs),
 * validates each with the existing validator before retention, deduplicates by
 * NORMALIZED academic identity (course→period, order-invariant), summarizes real
 * differences, selects by a confirmed preference, and gates one elicitation
 * question to only when the answer could change the selected plan.
 */
import { generateCandidateSet, selectCandidate, shouldAskBalanceQuestion } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import type { ConstraintModel } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

function mk(courses: Array<{ id: string; hours: number; semesters?: string[] }>, opts: { totalHours?: number; hardCap?: number; maxHours?: number } = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: opts.totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective', offered_semesters: c.semesters ?? [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours });
}
const empty = () => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });

// A dual-semester fixture where balanced ([8,8]) and compact ([16,0]) diverge.
const distinctModel = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16, hardCap: 20, maxHours: 25 });
// A fixture where both policies converge (single-semester-only courses).
const convergedModel = () => mk([{ id: 'S1', hours: 4, semesters: [SEM_A] }], { totalHours: 4, hardCap: 20, maxHours: 25 });

function gen(model: () => ConstraintModel, profileVersion = 3) {
  return generateCandidateSet({ buildModel: (p) => ({ ...model(), distributionPolicy: p }), initialState: empty(), profileVersion });
}

describe('generateCandidateSet', () => {
  test('retains two distinct legal candidates when the problem permits', () => {
    const set = gen(distinctModel);
    expect(set.converged).toBe(false);
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates.every((c) => c.valid)).toBe(true); // both pass the authoritative validator
    expect(set.candidates.map((c) => c.policy).sort()).toEqual(['balanced', 'compact']);
  });

  test('candidate ids derive from normalized identity — stable + order-invariant, deterministic runs', () => {
    const a = gen(distinctModel);
    const b = gen(distinctModel);
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id)); // deterministic
    // id is a function of normalized identity, not policy/order:
    const byPolicy = Object.fromEntries(a.candidates.map((c) => [c.policy, c]));
    expect(byPolicy.balanced.id).not.toBe(byPolicy.compact.id); // different plans → different ids
    expect(byPolicy.compact.id).toBe(gen(distinctModel).candidates.find((c) => c.policy === 'compact')!.id);
  });

  test('difference summary reflects real load/assignment differences', () => {
    const set = gen(distinctModel);
    const s = set.differenceSummary;
    // balanced [8,8] vs compact [16,0]: peak 8 vs 16, active periods 2 vs 1.
    expect(s.find((f) => f.kind === 'peak_load')).toMatchObject({ balanced: 8, compact: 16 });
    expect(s.find((f) => f.kind === 'active_periods')).toMatchObject({ balanced: 2, compact: 1 });
  });

  test('preserves policy + profile-version provenance on each candidate', () => {
    const set = gen(distinctModel, 9);
    expect(set.candidates.every((c) => c.profileVersion === 9)).toBe(true);
    expect(new Set(set.candidates.map((c) => c.policy))).toEqual(new Set(['balanced', 'compact']));
  });

  test('convergent policies collapse to ONE candidate (no duplicate choice)', () => {
    const set = gen(convergedModel);
    expect(set.converged).toBe(true);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].convergedPolicies?.sort()).toEqual(['balanced', 'compact']);
    expect(set.differenceSummary).toEqual([]); // no meaningful alternative
  });
});

describe('selectCandidate', () => {
  test('a confirmed balanced preference selects the balanced candidate', () => {
    const set = gen(distinctModel);
    expect(selectCandidate(set, 'balanced')?.policy).toBe('balanced');
  });
  test('a confirmed compact preference selects the compact candidate', () => {
    const set = gen(distinctModel);
    expect(selectCandidate(set, 'compact')?.policy).toBe('compact');
  });
  test('neutral/indifferent imposes neither — deterministic legacy default (first candidate)', () => {
    const set = gen(distinctModel);
    expect(selectCandidate(set, 'neutral')).toBe(set.candidates[0]);
  });
  test('convergence → the single candidate regardless of preference', () => {
    const set = gen(convergedModel);
    expect(selectCandidate(set, 'compact')).toBe(set.candidates[0]);
  });
});

describe('shouldAskBalanceQuestion', () => {
  test('asks when two distinct legal candidates differ and the topic is unanswered', () => {
    expect(shouldAskBalanceQuestion(gen(distinctModel), { alreadyAnswered: false })).toBe(true);
  });
  test('does NOT ask when the policies converge (no meaningful alternative)', () => {
    expect(shouldAskBalanceQuestion(gen(convergedModel), { alreadyAnswered: false })).toBe(false);
  });
  test('does NOT ask when the topic is already answered/indifferent', () => {
    expect(shouldAskBalanceQuestion(gen(distinctModel), { alreadyAnswered: true })).toBe(false);
  });
});

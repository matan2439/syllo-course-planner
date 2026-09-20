/**
 * Gate 2 (updated for Slice 18B) — a NEUTRAL request must still resolve to the
 * canonical LEGACY stable-planner result, never to a silent balanced/compact
 * bias and never to array/generation order.
 *
 * Under Slice 18B the whole set is planned under ONE resolved policy, so
 * "neutral" now means the model carries no distribution policy at all — exactly
 * the flag-off stable planner. The primary candidate must therefore be
 * identical to what the plain greedy run produces, and the selection reason must
 * stay truthfully labelled as the legacy default rather than a preference.
 */
import { generateCandidateSet, selectCandidate, selectionReason } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import type { ConstraintModel } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

function mk(courses: Array<{ id: string; hours: number }>, opts: { totalHours?: number; hardCap?: number; maxHours?: number } = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: opts.totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours });
}
const empty = () => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });
const distinctModel = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16, hardCap: 20, maxHours: 25 });

function legacyPlanIdentity(): string {
  // flag-off stable planner: no distribution policy at all.
  const w = new PlannerWorker(distinctModel(), empty(), { topN: 6, rolloutSteps: 80 });
  w.run(500, 'greedy');
  const plan = w.getPlan();
  const pairs: Array<[string, string]> = [];
  for (const [period, ids] of Object.entries(plan.semesters)) for (const id of ids) pairs.push([id, period]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return JSON.stringify(pairs);
}

const neutralSet = () =>
  generateCandidateSet({ buildModel: () => distinctModel(), policy: 'neutral', initialState: empty(), profileVersion: 1 });

describe('Gate 2 — neutral resolves to the canonical legacy result', () => {
  test('the neutral baseline is canonically identical to the flag-off stable result', () => {
    expect(neutralSet().legacyIdentity).toBe(legacyPlanIdentity());
  });

  test('the neutral primary candidate is that same canonical plan', () => {
    const set = neutralSet();
    expect(selectCandidate(set)!.normalizedIdentity).toBe(legacyPlanIdentity());
    expect(selectCandidate(set)!.provenance).toBe('greedy_baseline');
  });

  test('neutral imposes no balanced/compact bias — the policy is carried through untouched', () => {
    const set = neutralSet();
    expect(set.policy).toBe('neutral');
    expect(set.candidates.every((c) => c.policy === 'neutral')).toBe(true);
  });

  test('repeated generation selects the same primary (never generation order)', () => {
    expect(selectCandidate(neutralSet())!.id).toBe(selectCandidate(neutralSet())!.id);
  });

  test('a confirmed preference is labelled by that policy, neutral by the legacy default', () => {
    const withPolicy = (policy: 'balanced' | 'compact') =>
      generateCandidateSet({ buildModel: () => distinctModel(), policy, initialState: empty(), profileVersion: 1 });
    expect(selectionReason(withPolicy('balanced'))).toBe('confirmed_balanced');
    expect(selectionReason(withPolicy('compact'))).toBe('confirmed_compact');
    expect(selectionReason(neutralSet())).toBe('legacy_default'); // never a preference-derived reason
  });
});

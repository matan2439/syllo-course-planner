import {
  DeterministicWhatIfSimulationCapability,
  type SimulationRequest,
} from '../../api/ai/what_if_simulation';
import type { PlanState } from '../../api/ai/planner_types';

function plan(): PlanState {
  return {
    semesters: {
      year_3_semester_a: ['course-a'],
      year_3_semester_b: [],
    },
  };
}

describe('DeterministicWhatIfSimulationCapability', () => {
  it('applies ordered move/remove edits without committing them', async () => {
    const baseline = plan();
    const capability = new DeterministicWhatIfSimulationCapability({ validateState: () => ({ valid: true }) });
    const result = await capability.simulate({ baseline, changes: [
      { kind: 'move_course', courseId: 'course-a', toSemester: 'year_3_semester_b' },
      { kind: 'remove_course', courseId: 'course-a' },
    ] });
    expect(result.status === 'simulated' && result.candidate.semesters).toEqual({ year_3_semester_a: [], year_3_semester_b: [] });
    expect(baseline).toEqual(plan());
  });

  it('rejects an impossible later edit without returning a partial candidate', async () => {
    const capability = new DeterministicWhatIfSimulationCapability({ validateState: () => { throw new Error('must not validate a partial result'); } });
    const baseline = plan();
    const result = await capability.simulate({ baseline, changes: [
      { kind: 'remove_course', courseId: 'course-a' },
      { kind: 'move_course', courseId: 'course-a', toSemester: 'year_3_semester_b' },
    ] });
    expect(result).toMatchObject({ status: 'rejected', failedChangeIndex: 1, code: 'CHANGE_NOT_APPLICABLE' });
    expect(result).not.toHaveProperty('candidate');
    expect(baseline).toEqual(plan());
  });

  it('retains the validator rejection and isolates returned snapshots', async () => {
    const baseline = plan();
    const capability = new DeterministicWhatIfSimulationCapability({ validateState: () => ({ valid: false, reason: 'prerequisite missing' }) });
    const result = await capability.simulate({ baseline, changes: [] });
    expect(result.status).toBe('simulated');
    if (result.status !== 'simulated') throw new Error('expected simulation');
    expect(result.validation).toEqual({ valid: false, violations: [{ code: 'VALIDATION_REJECTED', message: 'prerequisite missing' }] });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    result.baseline.semesters.year_3_semester_a.push('external-edit');
    result.candidate.semesters.year_3_semester_a.push('candidate-edit');
    expect(baseline).toEqual(plan());
  });

  it('retains structured validation findings and evidence for an invalid hypothetical plan', async () => {
    const capability = new DeterministicWhatIfSimulationCapability({
      validateState: () => ({
        valid: false,
        reason: 'prerequisite missing',
        violations: [{
          code: 'PREREQUISITE_NOT_MET',
          severity: 'error',
          message: 'course-a requires course-prerequisite first',
          courseIds: ['course-a', 'course-prerequisite'],
        }],
        evidence: {
          legal: false,
          complete: true,
          constraintsChecked: ['prerequisites', 'offering'],
          degreeHours: 12,
          degreeHoursRequired: 185,
        },
      }),
    });

    const result = await capability.simulate({ baseline: plan(), changes: [] });

    expect(result.status).toBe('simulated');
    if (result.status !== 'simulated') throw new Error('expected simulation');
    expect(result.validation).toEqual({
      valid: false,
      violations: [{
        code: 'PREREQUISITE_NOT_MET',
        severity: 'error',
        message: 'course-a requires course-prerequisite first',
        courseIds: ['course-a', 'course-prerequisite'],
      }],
      evidence: {
        legal: false,
        complete: true,
        constraintsChecked: ['prerequisites', 'offering'],
        degreeHours: 12,
        degreeHoursRequired: 185,
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('preserves atomic annual additions and copies change arrays', async () => {
    const changes: SimulationRequest['changes'] = [{ kind: 'add_course', courseId: 'annual', semesterId: 'year_3_semester_a', alsoSemesterIds: ['year_3_semester_b'] }];
    const capability = new DeterministicWhatIfSimulationCapability({ validateState: () => ({ valid: true }) });
    const result = await capability.simulate({ baseline: plan(), changes });
    if (result.status !== 'simulated') throw new Error('expected simulation');
    expect(result.candidate.semesters).toEqual({ year_3_semester_a: ['course-a', 'annual'], year_3_semester_b: ['annual'] });
    if (result.changes[0].kind === 'add_course') result.changes[0].alsoSemesterIds!.push('other');
    expect(changes[0]).toEqual({ kind: 'add_course', courseId: 'annual', semesterId: 'year_3_semester_a', alsoSemesterIds: ['year_3_semester_b'] });
  });

  it('simulates an addition against a copy and returns validation evidence', async () => {
    const baseline = plan();
    const request: SimulationRequest = {
      baseline,
      changes: [
        { kind: 'add_course', courseId: 'course-b', semesterId: 'year_3_semester_b' },
      ],
    };
    const capability = new DeterministicWhatIfSimulationCapability({
      validateState: () => ({ valid: true }),
    });

    const result = await capability.simulate(request);

    expect(result).toEqual({
      status: 'simulated',
      baseline,
      candidate: {
        semesters: {
          year_3_semester_a: ['course-a'],
          year_3_semester_b: ['course-b'],
        },
      },
      changes: request.changes,
      validation: { valid: true, violations: [] },
    });
    expect(baseline).toEqual(plan());
    expect(result.status === 'simulated' && result.candidate).not.toBe(baseline);
  });
});

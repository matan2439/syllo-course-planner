/**
 * Unit contract for academic_status_knowledge.ts — the semantic rules that keep
 * "unknown" from ever masquerading as "none", and completed HOURS from ever
 * becoming completed COURSE IDS.
 */
import {
  canonicalizeCourseIds,
  isCompletedCoursesKnown,
  recognizedCompletedHours,
  resolveCompletedCourseKnowledge,
} from '../../api/ai/academic_status_knowledge';

describe('resolveCompletedCourseKnowledge', () => {
  test('no marker → unknown (backward compatible: every legacy caller is unaffected)', () => {
    expect(resolveCompletedCourseKnowledge({ completed: [] })).toEqual({ kind: 'unknown' });
    expect(resolveCompletedCourseKnowledge({ completed: [{ course_id: 'A' }] })).toEqual({ kind: 'unknown' });
    expect(resolveCompletedCourseKnowledge(undefined)).toEqual({ kind: 'unknown' });
  });

  test('explicit known + empty list → known_empty (a real "I completed none" answer)', () => {
    const k = resolveCompletedCourseKnowledge({
      completed: [],
      completed_knowledge: { status: 'known', provenance: 'explicit_user' },
    });
    expect(k).toEqual({ kind: 'known_empty', provenance: 'explicit_user' });
    expect(isCompletedCoursesKnown(k)).toBe(true);
  });

  test('explicit known + ids → known, ids preserved exactly and de-duplicated', () => {
    const k = resolveCompletedCourseKnowledge({
      completed: [{ course_id: 'A' }, { course_id: 'B' }, { course_id: 'A' }],
      completed_knowledge: { status: 'known', provenance: 'authoritative_board' },
    });
    expect(k).toEqual({ kind: 'known', courseIds: ['A', 'B'], provenance: 'authoritative_board' });
  });

  test('a "known" claim with an unrecognized/absent provenance is NOT knowledge (fail-safe)', () => {
    expect(resolveCompletedCourseKnowledge({
      completed: [], completed_knowledge: { status: 'known', provenance: 'vibes' },
    })).toEqual({ kind: 'unknown' });
    expect(resolveCompletedCourseKnowledge({
      completed: [], completed_knowledge: { status: 'known' },
    })).toEqual({ kind: 'unknown' });
  });

  test('an explicit unknown marker stays unknown even with ids present', () => {
    expect(resolveCompletedCourseKnowledge({
      completed: [{ course_id: 'A' }], completed_knowledge: { status: 'unknown' },
    })).toEqual({ kind: 'unknown' });
  });

  test('hours are never a source of ids — an hours total alone yields no completed courses', () => {
    // known_completed_hours lives elsewhere in plan_context and is deliberately
    // not an input here: there is no path from a number to a course identity.
    const k = resolveCompletedCourseKnowledge({ total_hours_progress: { known_completed_hours: 92 } } as never);
    expect(k).toEqual({ kind: 'unknown' });
  });
});

describe('canonicalizeCourseIds', () => {
  test('trims, drops blanks/non-strings, de-duplicates, preserves first-occurrence order', () => {
    expect(canonicalizeCourseIds([' A ', 'B', 'A', '', null, 7, { course_id: 'C' }])).toEqual(['A', 'B', 'C']);
  });
  test('a non-array is empty, never a fabricated id', () => {
    expect(canonicalizeCourseIds(undefined)).toEqual([]);
    expect(canonicalizeCourseIds('A')).toEqual([]);
  });
});

describe('recognizedCompletedHours (accounting rule)', () => {
  const hours = { A: 4, B: 5.5, C: 3 };

  test('sums AUTHORITATIVE hours of uniquely identified courses — duplicates counted once', () => {
    const r = recognizedCompletedHours(['A', 'B', 'A'], hours);
    expect(r.hours).toBe(9.5);
    expect(r.countedCourseIds).toEqual(['A', 'B']);
  });

  test('a course with unknown hours contributes 0 and is reported, never guessed', () => {
    const r = recognizedCompletedHours(['A', 'ZZ'], hours);
    expect(r.hours).toBe(4);
    expect(r.unknownHourCourseIds).toEqual(['ZZ']);
  });

  test('derived-not-additive: the total is a function of the ids only, so no aggregate is double counted', () => {
    // Calling it twice with the same ids yields the same total — the rule never
    // accumulates onto a pre-existing known_completed_hours aggregate.
    expect(recognizedCompletedHours(['A', 'C'], hours).hours).toBe(7);
    expect(recognizedCompletedHours(['A', 'C'], hours).hours).toBe(7);
  });
});

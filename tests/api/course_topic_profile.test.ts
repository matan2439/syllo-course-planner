/**
 * Course Topic Tagging Contract — tests for api/ai/course_topic_profile.ts.
 *
 * Proves the "supply side" contract (what a COURSE contributes) is deterministic
 * and reuses the exact same AcademicFocusArea/CourseStyle vocabulary as the
 * "demand side" contract (academic_interest_profile.ts's AcademicInterestProfile —
 * what a USER wants), without duplicating either enum.
 *
 * Foundation epic only: no planner-scoring/plan/UI/LLM/Supabase imports. This is
 * a type contract, not wired into any production path.
 */

import { ACADEMIC_FOCUS_AREAS, COURSE_STYLES } from '../../api/ai/academic_interest_profile';
import {
  emptyCourseTopicProfile,
  normalizeCourseTopicProfile,
  getTopicWeight,
  getStyleWeight,
  mergeCourseTopicProfiles,
  hasMeaningfulCourseTopicProfile,
} from '../../api/ai/course_topic_profile';
import type { RawCourseTopicProfile } from '../../api/ai/course_topic_profile';

describe('emptyCourseTopicProfile', () => {
  test('creates an empty topic profile for a course', () => {
    expect(emptyCourseTopicProfile('ME101')).toEqual({ courseId: 'ME101', topics: [], styles: [] });
  });

  test('trims the courseId', () => {
    expect(emptyCourseTopicProfile('  ME101  ').courseId).toBe('ME101');
  });
});

describe('normalizeCourseTopicProfile', () => {
  test('accepts multiple topic weights', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'fluids', weight: 0.8 },
        { area: 'heat_transfer', weight: 0.3 },
      ],
    });
    expect(result.topics).toEqual([
      { area: 'heat_transfer', weight: 0.3 },
      { area: 'fluids', weight: 0.8 },
    ]);
  });

  test('clamps topic weights to 0..1', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'fluids', weight: 2 },
        { area: 'materials', weight: -0.5 },
        { area: 'robotics', weight: 0.42 },
      ],
    });
    const byArea = Object.fromEntries(result.topics.map((t) => [t.area, t.weight]));
    expect(byArea.fluids).toBe(1);
    expect(byArea.materials).toBe(0);
    expect(byArea.robotics).toBe(0.42);
  });

  test('merges duplicate topic weights deterministically (max weight wins)', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'fluids', weight: 0.3 },
        { area: 'fluids', weight: 0.9 },
      ],
    });
    expect(result.topics).toEqual([{ area: 'fluids', weight: 0.9 }]);
  });

  test('supports course style weights', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      styles: [
        { style: 'project_based', weight: 0.7 },
        { style: 'industry_relevant', weight: 0.4 },
      ],
    });
    expect(result.styles).toEqual([
      { style: 'project_based', weight: 0.7 },
      { style: 'industry_relevant', weight: 0.4 },
    ]);
  });

  test('merges duplicate style weights deterministically (max weight wins)', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      styles: [
        { style: 'exam_light', weight: 0.2 },
        { style: 'exam_light', weight: 0.6 },
      ],
    });
    expect(result.styles).toEqual([{ style: 'exam_light', weight: 0.6 }]);
  });

  test('preserves notes and source', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      notes: ['  syllabus mentions CFD  ', 'syllabus mentions CFD'],
      source: 'syllabus',
    });
    expect(result.notes).toEqual(['syllabus mentions CFD']);
    expect(result.source).toBe('syllabus');
  });

  test('drops an invalid source rather than preserving garbage', () => {
    const result = normalizeCourseTopicProfile({ courseId: 'ME101', source: 'bogus' });
    expect(result).not.toHaveProperty('source');
  });

  test('drops entries whose area/style is not a canonical member', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'fluids', weight: 0.5 },
        { area: 'made_up_area', weight: 0.9 },
      ],
      styles: [
        { style: 'project_based', weight: 0.5 },
        { style: 'bogus_style', weight: 0.9 },
      ],
    });
    expect(result.topics.map((t) => t.area)).toEqual(['fluids']);
    expect(result.styles.map((s) => s.style)).toEqual(['project_based']);
  });

  test('stable ordering is deterministic regardless of input order', () => {
    const a = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
        { area: 'heat_transfer', weight: 0.5 },
      ],
    });
    const b = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'heat_transfer', weight: 0.5 },
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
      ],
    });
    expect(a).toEqual(b);
    expect(a.topics.map((t) => t.area)).toEqual(['strength_analysis', 'heat_transfer', 'materials']);
  });

  test('does not mutate its input', () => {
    const input: RawCourseTopicProfile = {
      courseId: 'ME101',
      topics: [{ area: 'materials', weight: 5 }],
      notes: ['  x  ', 'x'],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeCourseTopicProfile(input);
    expect(input).toEqual(snapshot);
  });

  test('tolerates untrusted garbage input without throwing', () => {
    const garbage = {
      courseId: 'ME101',
      topics: 'not-an-array',
      styles: [null, 42, { area: 5 }, {}],
      notes: 'not-an-array',
      source: 123,
    } as unknown as RawCourseTopicProfile;
    const result = normalizeCourseTopicProfile(garbage);
    expect(result.topics).toEqual([]);
    expect(result.styles).toEqual([]);
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('source');
  });

  test('reuses AcademicFocusArea and CourseStyle from academic_interest_profile.ts (no duplicate enum)', () => {
    const result = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: ACADEMIC_FOCUS_AREAS.map((area) => ({ area, weight: 1 })),
      styles: COURSE_STYLES.map((style) => ({ style, weight: 1 })),
    });
    expect(result.topics.map((t) => t.area)).toEqual([...ACADEMIC_FOCUS_AREAS]);
    expect(result.styles.map((s) => s.style)).toEqual([...COURSE_STYLES]);
  });
});

describe('getTopicWeight / getStyleWeight', () => {
  test('getTopicWeight returns 0 for a missing topic', () => {
    const profile = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [{ area: 'fluids', weight: 0.5 }],
    });
    expect(getTopicWeight(profile, 'robotics')).toBe(0);
    expect(getTopicWeight(profile, 'fluids')).toBe(0.5);
  });

  test('getStyleWeight returns 0 for a missing style', () => {
    const profile = normalizeCourseTopicProfile({
      courseId: 'ME101',
      styles: [{ style: 'project_based', weight: 0.6 }],
    });
    expect(getStyleWeight(profile, 'exam_light')).toBe(0);
    expect(getStyleWeight(profile, 'project_based')).toBe(0.6);
  });
});

describe('mergeCourseTopicProfiles', () => {
  test('merging two empty profiles yields an empty profile', () => {
    const base = emptyCourseTopicProfile('ME101');
    const override = emptyCourseTopicProfile('ME101');
    expect(mergeCourseTopicProfiles(base, override)).toEqual(emptyCourseTopicProfile('ME101'));
  });

  test('supports override precedence for a duplicate topic weight', () => {
    const base = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.9 }] });
    const override = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.2 }] });
    expect(mergeCourseTopicProfiles(base, override).topics).toEqual([{ area: 'fluids', weight: 0.2 }]);
  });

  test('supports override precedence for a duplicate style weight', () => {
    const base = normalizeCourseTopicProfile({ courseId: 'ME101', styles: [{ style: 'project_based', weight: 0.9 }] });
    const override = normalizeCourseTopicProfile({ courseId: 'ME101', styles: [{ style: 'project_based', weight: 0.2 }] });
    expect(mergeCourseTopicProfiles(base, override).styles).toEqual([{ style: 'project_based', weight: 0.2 }]);
  });

  test('keeps base entries the override does not touch, unions distinct entries canonically', () => {
    const base = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'materials', weight: 0.5 }] });
    const override = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'strength_analysis', weight: 0.5 }] });
    const merged = mergeCourseTopicProfiles(base, override);
    expect(merged.topics.map((t) => t.area)).toEqual(['strength_analysis', 'materials']);
  });

  test('source: override wins when present, else falls back to base', () => {
    const base = normalizeCourseTopicProfile({ courseId: 'ME101', source: 'manual' });
    const overrideWithSource = normalizeCourseTopicProfile({ courseId: 'ME101', source: 'inferred' });
    const overrideWithoutSource = normalizeCourseTopicProfile({ courseId: 'ME101' });
    expect(mergeCourseTopicProfiles(base, overrideWithSource).source).toBe('inferred');
    expect(mergeCourseTopicProfiles(base, overrideWithoutSource).source).toBe('manual');
  });

  test('unions notes (base first, deduped)', () => {
    const base = normalizeCourseTopicProfile({ courseId: 'ME101', notes: ['keep'] });
    const override = normalizeCourseTopicProfile({ courseId: 'ME101', notes: ['keep', 'new'] });
    expect(mergeCourseTopicProfiles(base, override).notes).toEqual(['keep', 'new']);
  });

  test('does not mutate either input', () => {
    const base = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [{ area: 'fluids', weight: 0.5 }],
      notes: ['keep'],
    });
    const override = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'robotics', weight: 0.5 }] });
    const baseSnapshot = JSON.parse(JSON.stringify(base));
    const overrideSnapshot = JSON.parse(JSON.stringify(override));
    mergeCourseTopicProfiles(base, override);
    expect(base).toEqual(baseSnapshot);
    expect(override).toEqual(overrideSnapshot);
  });
});

describe('hasMeaningfulCourseTopicProfile', () => {
  test('returns false for an empty profile', () => {
    expect(hasMeaningfulCourseTopicProfile(emptyCourseTopicProfile('ME101'))).toBe(false);
  });

  test('returns false for a notes-only profile (notes are passthrough, not signal)', () => {
    const profile = normalizeCourseTopicProfile({ courseId: 'ME101', notes: ['interesting'] });
    expect(hasMeaningfulCourseTopicProfile(profile)).toBe(false);
  });

  test('returns true when topics are present', () => {
    const profile = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.5 }] });
    expect(hasMeaningfulCourseTopicProfile(profile)).toBe(true);
  });

  test('returns true when styles are present', () => {
    const profile = normalizeCourseTopicProfile({ courseId: 'ME101', styles: [{ style: 'project_based', weight: 0.5 }] });
    expect(hasMeaningfulCourseTopicProfile(profile)).toBe(true);
  });
});

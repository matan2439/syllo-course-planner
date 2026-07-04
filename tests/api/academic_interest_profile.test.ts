/**
 * Academic Interest Profile Contract — tests for
 * api/ai/academic_interest_profile.ts.
 *
 * Proves the profile is a stable, deterministic contract: canonical enum lists
 * are the single source of truth for the union types + type guards, and
 * normalizeAcademicInterestProfile is a pure, total sanitizer that clamps
 * weights to [0,1], drops invalid entries, dedupes, and produces a canonically
 * ordered result regardless of input order — never throws, never mutates.
 *
 * Foundation epic only: no planner-scoring/plan/UI/LLM/Supabase imports. This
 * is a type contract, not wired into any production path.
 */

import {
  ACADEMIC_FOCUS_AREAS,
  COURSE_STYLES,
  OPTIMIZATION_PRIORITIES,
  DEFAULT_INTEREST_WEIGHT,
  isAcademicFocusArea,
  isCourseStyle,
  isOptimizationPriority,
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import type {
  AcademicInterestProfile,
  RawAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';

describe('canonical enum lists', () => {
  test('focus areas contain the mechanical-engineering domains and general', () => {
    expect(ACADEMIC_FOCUS_AREAS).toContain('strength_analysis');
    expect(ACADEMIC_FOCUS_AREAS).toContain('finite_elements');
    expect(ACADEMIC_FOCUS_AREAS).toContain('heat_transfer');
    expect(ACADEMIC_FOCUS_AREAS).toContain('fluids');
    expect(ACADEMIC_FOCUS_AREAS).toContain('general');
  });

  test('course styles include project_based and industry_relevant', () => {
    expect(COURSE_STYLES).toContain('project_based');
    expect(COURSE_STYLES).toContain('industry_relevant');
  });

  test('optimization priorities include low_peak_load and interest_alignment', () => {
    expect(OPTIMIZATION_PRIORITIES).toContain('low_peak_load');
    expect(OPTIMIZATION_PRIORITIES).toContain('interest_alignment');
    expect(OPTIMIZATION_PRIORITIES).toContain('degree_completion');
  });

  test('lists have no duplicate members', () => {
    expect(new Set(ACADEMIC_FOCUS_AREAS).size).toBe(ACADEMIC_FOCUS_AREAS.length);
    expect(new Set(COURSE_STYLES).size).toBe(COURSE_STYLES.length);
    expect(new Set(OPTIMIZATION_PRIORITIES).size).toBe(OPTIMIZATION_PRIORITIES.length);
  });
});

describe('type guards', () => {
  test('isAcademicFocusArea accepts canonical members, rejects everything else', () => {
    expect(isAcademicFocusArea('heat_transfer')).toBe(true);
    expect(isAcademicFocusArea('general')).toBe(true);
    expect(isAcademicFocusArea('nonsense')).toBe(false);
    expect(isAcademicFocusArea(123)).toBe(false);
    expect(isAcademicFocusArea(undefined)).toBe(false);
    expect(isAcademicFocusArea(null)).toBe(false);
  });

  test('isCourseStyle accepts canonical members, rejects everything else', () => {
    expect(isCourseStyle('project_based')).toBe(true);
    expect(isCourseStyle('not_a_style')).toBe(false);
    expect(isCourseStyle(0)).toBe(false);
  });

  test('isOptimizationPriority accepts canonical members, rejects everything else', () => {
    expect(isOptimizationPriority('low_peak_load')).toBe(true);
    expect(isOptimizationPriority('made_up')).toBe(false);
    expect(isOptimizationPriority({})).toBe(false);
  });
});

describe('emptyAcademicInterestProfile', () => {
  test('returns all four required lists empty with no optional keys', () => {
    const profile = emptyAcademicInterestProfile();
    expect(profile).toEqual({
      focusAreas: [],
      avoidAreas: [],
      courseStylePreferences: [],
      optimizationPriorities: [],
    });
    expect(profile).not.toHaveProperty('careerGoals');
    expect(profile).not.toHaveProperty('notes');
  });

  test('returns a fresh object each call (no shared references)', () => {
    const a = emptyAcademicInterestProfile();
    const b = emptyAcademicInterestProfile();
    expect(a).not.toBe(b);
    expect(a.focusAreas).not.toBe(b.focusAreas);
  });
});

describe('normalizeAcademicInterestProfile', () => {
  test('an empty input normalizes to the empty profile', () => {
    expect(normalizeAcademicInterestProfile({})).toEqual(emptyAcademicInterestProfile());
  });

  test('clamps out-of-range weights into [0,1]', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'heat_transfer', weight: 2 },
        { area: 'fluids', weight: -0.5 },
        { area: 'materials', weight: 0.42 },
      ],
    });
    const byArea = Object.fromEntries(result.focusAreas.map((f) => [f.area, f.weight]));
    expect(byArea.heat_transfer).toBe(1);
    expect(byArea.fluids).toBe(0);
    expect(byArea.materials).toBe(0.42);
  });

  test('defaults a missing or NaN weight to DEFAULT_INTEREST_WEIGHT', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'heat_transfer' },
        { area: 'fluids', weight: Number.NaN },
      ],
    });
    for (const f of result.focusAreas) {
      expect(f.weight).toBe(DEFAULT_INTEREST_WEIGHT);
    }
  });

  test('drops entries whose area/style/priority is not a canonical member', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'heat_transfer', weight: 0.5 },
        { area: 'made_up_area', weight: 0.9 },
      ],
      courseStylePreferences: [
        { style: 'project_based', weight: 0.5 },
        { style: 'bogus_style', weight: 0.9 },
      ],
      optimizationPriorities: [
        { priority: 'low_peak_load', weight: 0.5 },
        { priority: 'bogus_priority', weight: 0.9 },
      ],
    });
    expect(result.focusAreas.map((f) => f.area)).toEqual(['heat_transfer']);
    expect(result.courseStylePreferences.map((s) => s.style)).toEqual(['project_based']);
    expect(result.optimizationPriorities.map((p) => p.priority)).toEqual(['low_peak_load']);
  });

  test('dedupes a repeated area keeping the max-weight entry', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'fluids', weight: 0.3, source: 'user' },
        { area: 'fluids', weight: 0.9, source: 'inferred' },
      ],
    });
    expect(result.focusAreas).toEqual([{ area: 'fluids', weight: 0.9, source: 'inferred' }]);
  });

  test('on a weight tie keeps the first-seen entry', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'fluids', weight: 0.5, source: 'user' },
        { area: 'fluids', weight: 0.5, source: 'inferred' },
      ],
    });
    expect(result.focusAreas).toEqual([{ area: 'fluids', weight: 0.5, source: 'user' }]);
  });

  test('sorts focus areas by canonical order regardless of input order', () => {
    const shuffledA: RawAcademicInterestProfile = {
      focusAreas: [
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
        { area: 'heat_transfer', weight: 0.5 },
      ],
    };
    const shuffledB: RawAcademicInterestProfile = {
      focusAreas: [
        { area: 'heat_transfer', weight: 0.5 },
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
      ],
    };
    const a = normalizeAcademicInterestProfile(shuffledA);
    const b = normalizeAcademicInterestProfile(shuffledB);
    expect(a).toEqual(b);
    expect(a.focusAreas.map((f) => f.area)).toEqual([
      'strength_analysis',
      'heat_transfer',
      'materials',
    ]);
  });

  test('preserves a valid source and omits an invalid or missing source key', () => {
    const result = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'heat_transfer', weight: 0.5, source: 'user' },
        { area: 'fluids', weight: 0.5, source: 'bogus' },
        { area: 'materials', weight: 0.5 },
      ],
    });
    const byArea = Object.fromEntries(result.focusAreas.map((f) => [f.area, f]));
    expect(byArea.heat_transfer.source).toBe('user');
    expect(byArea.fluids).not.toHaveProperty('source');
    expect(byArea.materials).not.toHaveProperty('source');
  });

  test('normalizes avoidAreas independently of focusAreas', () => {
    const result = normalizeAcademicInterestProfile({
      avoidAreas: [{ area: 'thermal_systems', weight: 5 }],
    });
    expect(result.focusAreas).toEqual([]);
    expect(result.avoidAreas).toEqual([{ area: 'thermal_systems', weight: 1 }]);
  });

  test('normalizes course styles and optimization priorities (clamp + dedupe + sort)', () => {
    const result = normalizeAcademicInterestProfile({
      courseStylePreferences: [
        { style: 'industry_relevant', weight: 3 },
        { style: 'project_based', weight: 0.2 },
        { style: 'project_based', weight: 0.8 },
      ],
      optimizationPriorities: [
        { priority: 'low_peak_load', weight: 0.7 },
        { priority: 'degree_completion', weight: 0.9 },
      ],
    });
    expect(result.courseStylePreferences).toEqual([
      { style: 'project_based', weight: 0.8 },
      { style: 'industry_relevant', weight: 1 },
    ]);
    expect(result.optimizationPriorities).toEqual([
      { priority: 'degree_completion', weight: 0.9 },
      { priority: 'low_peak_load', weight: 0.7 },
    ]);
  });

  test('trims, dedupes and drops empty career goals / notes, omitting empty lists', () => {
    const result = normalizeAcademicInterestProfile({
      careerGoals: ['  automotive  ', 'automotive', '', '   '],
      notes: [],
    });
    expect(result.careerGoals).toEqual(['automotive']);
    expect(result).not.toHaveProperty('notes');
  });

  test('tolerates untrusted garbage input without throwing', () => {
    const garbage = {
      focusAreas: 'not-an-array',
      avoidAreas: [null, 42, { area: 5 }, {}],
      courseStylePreferences: null,
      optimizationPriorities: undefined,
      careerGoals: 'not-an-array',
      notes: [7, {}, 'keep'],
    } as unknown as RawAcademicInterestProfile;
    const result = normalizeAcademicInterestProfile(garbage);
    expect(result.focusAreas).toEqual([]);
    expect(result.avoidAreas).toEqual([]);
    expect(result.courseStylePreferences).toEqual([]);
    expect(result.optimizationPriorities).toEqual([]);
    expect(result.notes).toEqual(['keep']);
    expect(result).not.toHaveProperty('careerGoals');
  });

  test('does not mutate its input', () => {
    const input: RawAcademicInterestProfile = {
      focusAreas: [
        { area: 'materials', weight: 5 },
        { area: 'heat_transfer', weight: 0.5 },
      ],
      careerGoals: ['  x  ', 'x'],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeAcademicInterestProfile(input);
    expect(input).toEqual(snapshot);
  });

  test('is idempotent — normalizing a normalized profile is a no-op', () => {
    const once = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'materials', weight: 5 },
        { area: 'heat_transfer', weight: -1 },
        { area: 'made_up', weight: 0.5 },
      ],
      courseStylePreferences: [{ style: 'project_based', weight: 0.3 }],
      careerGoals: ['  robotics  ', 'robotics'],
    });
    const twice = normalizeAcademicInterestProfile(once as AcademicInterestProfile);
    expect(twice).toEqual(once);
  });
});

/**
 * Course Topic Tagging Contract — a stable, deterministic representation of
 * what academic topics (AcademicFocusArea) and course styles (CourseStyle) a
 * SPECIFIC COURSE contributes to.
 *
 * This is the "supply side" counterpart to academic_interest_profile.ts's
 * "demand side" (AcademicInterestProfile — what a USER wants). Both reuse the
 * exact same AcademicFocusArea/CourseStyle enums from academic_interest_profile.ts
 * (imported, never duplicated) so a future consumer can compare a user's
 * interest profile against a course's topic profile using identical
 * vocabulary. That comparison — and any planner-scoring change — is
 * explicitly NOT built in this epic: this file only defines the course-side
 * data shape and deterministic normalization/merge helpers.
 *
 * FOUNDATION EPIC ONLY. Nothing here is wired into planner scoring
 * (planner_goals.ts), generated plans, generate-plan.ts, any UI, LLM, or
 * Supabase. No syllabus parsing, no LLM inference — pure types + deterministic
 * helpers, mirroring academic_interest_profile.ts's conventions.
 */

import {
  ACADEMIC_FOCUS_AREAS,
  COURSE_STYLES,
  isAcademicFocusArea,
  isCourseStyle,
} from './academic_interest_profile';
import type { AcademicFocusArea, CourseStyle } from './academic_interest_profile';

export const COURSE_TOPIC_PROFILE_SOURCES = ['manual', 'syllabus', 'inferred', 'default'] as const;
export type CourseTopicProfileSource = (typeof COURSE_TOPIC_PROFILE_SOURCES)[number];

/** Default weight for a topic/style listed without an explicit strength — expressed = fully weighted. Mirrors DEFAULT_INTEREST_WEIGHT. */
export const DEFAULT_TOPIC_WEIGHT = 1;

export interface CourseTopicWeight {
  area: AcademicFocusArea;
  /** Normalized 0..1 — how strongly this course contributes to `area`. */
  weight: number;
}

export interface CourseStyleWeight {
  style: CourseStyle;
  /** Normalized 0..1 — how strongly this course exhibits `style`. */
  weight: number;
}

export interface CourseTopicProfile {
  courseId: string;
  topics: CourseTopicWeight[];
  styles: CourseStyleWeight[];
  notes?: string[];
  source?: CourseTopicProfileSource;
}

/** Untrusted/partial input to normalizeCourseTopicProfile — everything but courseId tolerated as unknown. */
export interface RawCourseTopicProfile {
  courseId: string;
  topics?: unknown;
  styles?: unknown;
  notes?: unknown;
  source?: unknown;
}

function normalizeCourseId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function emptyCourseTopicProfile(courseId: string): CourseTopicProfile {
  return { courseId: normalizeCourseId(courseId), topics: [], styles: [] };
}

function normalizeWeight(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TOPIC_WEIGHT;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeSource(value: unknown): CourseTopicProfileSource | undefined {
  return typeof value === 'string' && (COURSE_TOPIC_PROFILE_SOURCES as readonly string[]).includes(value)
    ? (value as CourseTopicProfileSource)
    : undefined;
}

/** Trim, drop empty/whitespace, dedupe (preserving order); undefined when nothing remains. */
function normalizeStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalize a list of weighted entries keyed by `key`: drop invalid keys, clamp
 * weights, dedupe keeping the max-weight entry (ties keep first-seen), sort by
 * canonical enum order. Mirrors normalizePreferenceList in
 * academic_interest_profile.ts (no per-entry `source` here — CourseTopicWeight/
 * CourseStyleWeight carry only `weight`, source lives at the profile level).
 */
function normalizeWeightedList<K extends string, T extends string>(
  raw: unknown,
  key: K,
  isValid: (value: unknown) => value is T,
  canonical: readonly T[],
): Array<{ weight: number } & Record<K, T>> {
  const byKey = new Map<T, number>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const value = (item as Record<string, unknown>)[key];
      if (!isValid(value)) continue;
      const weight = normalizeWeight((item as Record<string, unknown>).weight);
      const existing = byKey.get(value);
      if (existing === undefined || weight > existing) {
        byKey.set(value, weight);
      }
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => canonical.indexOf(a[0]) - canonical.indexOf(b[0]))
    .map(([value, weight]) => ({ [key]: value, weight })) as Array<{ weight: number } & Record<K, T>>;
}

export function normalizeCourseTopicProfile(input: RawCourseTopicProfile): CourseTopicProfile {
  const profile: CourseTopicProfile = {
    courseId: normalizeCourseId(input.courseId),
    topics: normalizeWeightedList<'area', AcademicFocusArea>(
      input.topics,
      'area',
      isAcademicFocusArea,
      ACADEMIC_FOCUS_AREAS,
    ),
    styles: normalizeWeightedList<'style', CourseStyle>(input.styles, 'style', isCourseStyle, COURSE_STYLES),
  };

  const notes = normalizeStringList(input.notes);
  if (notes) profile.notes = notes;
  const source = normalizeSource(input.source);
  if (source) profile.source = source;

  return profile;
}

export function getTopicWeight(profile: CourseTopicProfile, area: AcademicFocusArea): number {
  return profile.topics.find((t) => t.area === area)?.weight ?? 0;
}

export function getStyleWeight(profile: CourseTopicProfile, style: CourseStyle): number {
  return profile.styles.find((s) => s.style === style)?.weight ?? 0;
}

/**
 * Merge a base weighted list with an override list keyed by `key`. Entries only
 * in base are kept; on a duplicate key the OVERRIDE entry's weight wins outright
 * (real base/override precedence, distinct from normalize's within-list
 * max-weight dedupe). Weights are clamped defensively; result is canonically
 * ordered — deterministic and total.
 */
function mergeWeightedList<K extends string, T extends string>(
  base: ReadonlyArray<{ weight: number } & Record<K, T>>,
  override: ReadonlyArray<{ weight: number } & Record<K, T>>,
  key: K,
  canonical: readonly T[],
): Array<{ weight: number } & Record<K, T>> {
  const byKey = new Map<T, number>();
  for (const item of [...base, ...override]) {
    byKey.set(item[key], normalizeWeight(item.weight));
  }
  return [...byKey.entries()]
    .sort((a, b) => canonical.indexOf(a[0]) - canonical.indexOf(b[0]))
    .map(([value, weight]) => ({ [key]: value, weight })) as Array<{ weight: number } & Record<K, T>>;
}

/** Union two string lists preserving order (base first, then override's new entries); undefined when empty. */
function mergeStringList(base: string[] | undefined, override: string[] | undefined): string[] | undefined {
  return normalizeStringList([...(base ?? []), ...(override ?? [])]);
}

/**
 * Deterministically combine two topic profiles for (presumptively) the same
 * course, with `override` taking precedence: duplicate topic/style entries
 * take the override's weight, notes union (base first), and `source` is
 * override's if present, else base's. `courseId` prefers override's value,
 * falling back to base's when override's is empty (e.g. built via
 * emptyCourseTopicProfile('')) — mirrors mergeAcademicInterestProfiles'
 * override-wins precedence; this function does not validate that base and
 * override describe the same course, matching that same sibling's contract.
 */
export function mergeCourseTopicProfiles(
  base: CourseTopicProfile,
  override: CourseTopicProfile,
): CourseTopicProfile {
  const merged: CourseTopicProfile = {
    courseId: override.courseId || base.courseId,
    topics: mergeWeightedList<'area', AcademicFocusArea>(base.topics, override.topics, 'area', ACADEMIC_FOCUS_AREAS),
    styles: mergeWeightedList<'style', CourseStyle>(base.styles, override.styles, 'style', COURSE_STYLES),
  };

  const notes = mergeStringList(base.notes, override.notes);
  if (notes) merged.notes = notes;
  const source = override.source ?? base.source;
  if (source) merged.source = source;

  return merged;
}

/** True when the profile carries any actual topic/style signal. Free-text `notes` are passthrough annotation, not signal. */
export function hasMeaningfulCourseTopicProfile(profile: CourseTopicProfile): boolean {
  return profile.topics.length > 0 || profile.styles.length > 0;
}

/**
 * Academic Interest Profile Contract — a stable, deterministic representation
 * of user academic intent and optimization priorities.
 *
 * The long-term product goal is "maximum academic output with minimum user
 * load". Much of user intent is about academic direction — strength analysis,
 * finite elements, heat transfer, project-based courses, avoiding a topic,
 * caring about industry relevance — not just feasibility. This file gives that
 * intent a structured type contract so a future planning/clarification/LLM
 * layer can treat it as data, not loose text.
 *
 * FOUNDATION EPIC ONLY. Nothing here is wired into planner scoring
 * (planner_goals.ts), generated plans, generate-plan.ts, the clarification
 * runtime, any UI, LLM, or Supabase. It is pure types + deterministic helpers.
 * The canonical enum lists below are the single source of truth: the union
 * types AND the runtime type guards derive from them (mirrors GOAL_STACK in
 * planner_goals.ts), so they can never drift apart.
 *
 * `normalizeAcademicInterestProfile` is a total, pure sanitizer: it accepts
 * untrusted/partial input (e.g. from a future LLM extraction step), clamps
 * weights to [0,1], drops entries with unknown areas/styles/priorities, dedupes
 * keeping the strongest-weighted entry, and emits a canonically ordered result
 * — so the same intent always produces the same profile, regardless of input
 * order. It never throws and never mutates its input.
 */

// ── Canonical enum lists (single source of truth) ─────────────────────────────

export const ACADEMIC_FOCUS_AREAS = [
  'strength_analysis',
  'finite_elements',
  'mechanical_design',
  'heat_transfer',
  'thermal_systems',
  'fluids',
  'control_systems',
  'manufacturing',
  'materials',
  'biomechanics',
  'energy',
  'robotics',
  'general',
] as const;
export type AcademicFocusArea = (typeof ACADEMIC_FOCUS_AREAS)[number];

export const COURSE_STYLES = [
  'project_based',
  'exam_light',
  'math_heavy',
  'practical',
  'theoretical',
  'lab_based',
  'industry_relevant',
] as const;
export type CourseStyle = (typeof COURSE_STYLES)[number];

export const OPTIMIZATION_PRIORITIES = [
  'degree_completion',
  'requirement_coverage',
  'interest_alignment',
  'load_balance',
  'low_peak_load',
  'grade_safety',
  'schedule_flexibility',
  'career_relevance',
] as const;
export type OptimizationPriority = (typeof OPTIMIZATION_PRIORITIES)[number];

export const PREFERENCE_SOURCES = ['user', 'inferred', 'default'] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

/** Default weight for a preference present without an explicit strength — expressed = fully weighted. */
export const DEFAULT_INTEREST_WEIGHT = 1;

// ── Profile shape ─────────────────────────────────────────────────────────────

export interface AcademicFocusPreference {
  area: AcademicFocusArea;
  /** Normalized 0..1. */
  weight: number;
  source?: PreferenceSource;
}

export interface CourseStylePreference {
  style: CourseStyle;
  /** Normalized 0..1. */
  weight: number;
  source?: PreferenceSource;
}

export interface OptimizationPriorityPreference {
  priority: OptimizationPriority;
  /** Normalized 0..1. */
  weight: number;
  source?: PreferenceSource;
}

export interface AcademicInterestProfile {
  focusAreas: AcademicFocusPreference[];
  avoidAreas: AcademicFocusPreference[];
  courseStylePreferences: CourseStylePreference[];
  optimizationPriorities: OptimizationPriorityPreference[];
  careerGoals?: string[];
  notes?: string[];
}

/** Untrusted/partial input to normalizeAcademicInterestProfile — every field tolerated as unknown. */
export interface RawAcademicInterestProfile {
  focusAreas?: unknown;
  avoidAreas?: unknown;
  courseStylePreferences?: unknown;
  optimizationPriorities?: unknown;
  careerGoals?: unknown;
  notes?: unknown;
}

// ── Type guards (derive from the canonical lists) ─────────────────────────────

export function isAcademicFocusArea(value: unknown): value is AcademicFocusArea {
  return typeof value === 'string' && (ACADEMIC_FOCUS_AREAS as readonly string[]).includes(value);
}

export function isCourseStyle(value: unknown): value is CourseStyle {
  return typeof value === 'string' && (COURSE_STYLES as readonly string[]).includes(value);
}

export function isOptimizationPriority(value: unknown): value is OptimizationPriority {
  return typeof value === 'string' && (OPTIMIZATION_PRIORITIES as readonly string[]).includes(value);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function emptyAcademicInterestProfile(): AcademicInterestProfile {
  return {
    focusAreas: [],
    avoidAreas: [],
    courseStylePreferences: [],
    optimizationPriorities: [],
  };
}

function normalizeWeight(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_INTEREST_WEIGHT;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeSource(value: unknown): PreferenceSource | undefined {
  return typeof value === 'string' && (PREFERENCE_SOURCES as readonly string[]).includes(value)
    ? (value as PreferenceSource)
    : undefined;
}

/**
 * Normalize a list of weighted preferences keyed by `key` ('area'|'style'|'priority'):
 * drop invalid keys, clamp weights, dedupe keeping the max-weight entry (ties keep
 * first-seen), then sort by the key's canonical enum order. Fully deterministic.
 */
function normalizePreferenceList<K extends string, T extends string>(
  raw: unknown,
  key: K,
  isValid: (value: unknown) => value is T,
  canonical: readonly T[],
): Array<{ weight: number; source?: PreferenceSource } & Record<K, T>> {
  const byKey = new Map<T, { weight: number; source?: PreferenceSource }>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const value = (item as Record<string, unknown>)[key];
      if (!isValid(value)) continue;
      const weight = normalizeWeight((item as Record<string, unknown>).weight);
      const source = normalizeSource((item as Record<string, unknown>).source);
      const existing = byKey.get(value);
      if (!existing || weight > existing.weight) {
        byKey.set(value, { weight, source });
      }
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => canonical.indexOf(a[0]) - canonical.indexOf(b[0]))
    .map(([value, { weight, source }]) => ({
      [key]: value,
      weight,
      ...(source ? { source } : {}),
    })) as Array<{ weight: number; source?: PreferenceSource } & Record<K, T>>;
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

export function normalizeAcademicInterestProfile(
  input: RawAcademicInterestProfile,
): AcademicInterestProfile {
  const profile: AcademicInterestProfile = {
    focusAreas: normalizePreferenceList(input.focusAreas, 'area', isAcademicFocusArea, ACADEMIC_FOCUS_AREAS),
    avoidAreas: normalizePreferenceList(input.avoidAreas, 'area', isAcademicFocusArea, ACADEMIC_FOCUS_AREAS),
    courseStylePreferences: normalizePreferenceList(input.courseStylePreferences, 'style', isCourseStyle, COURSE_STYLES),
    optimizationPriorities: normalizePreferenceList(input.optimizationPriorities, 'priority', isOptimizationPriority, OPTIMIZATION_PRIORITIES),
  };

  const careerGoals = normalizeStringList(input.careerGoals);
  if (careerGoals) profile.careerGoals = careerGoals;
  const notes = normalizeStringList(input.notes);
  if (notes) profile.notes = notes;

  return profile;
}

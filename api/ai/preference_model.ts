/**
 * preference_model.ts — a generic, program/institution-agnostic typed model for
 * ELICITED planning preferences (Slice 10). It is the structured meaning the
 * conversation produces; it is NOT a planner rule and NOT a fixed TAU/ME schema.
 * `category`, `affects`, and `value` are open on purpose so other programs and
 * institutions can carry their own semantics without touching this file.
 *
 * Core product invariant enforced here: a VAGUE user statement never becomes a
 * hard constraint. It is captured as `uncertain` + inert (may not affect
 * planning) until the student explicitly confirms it.
 */

export type PreferenceClassification =
  | 'hard_constraint'
  | 'soft_preference'
  | 'goal'
  | 'indifferent'
  | 'uncertain';

export type PreferenceSource =
  | 'explicit_answer'
  | 'confirmed_interpretation'
  | 'existing_profile'
  | 'safe_default';

export type PreferenceConfirmationStatus = 'unconfirmed' | 'pending' | 'confirmed' | 'rejected';

export interface Preference {
  /** Stable id — also the elicitation topic id, so a topic is asked at most once. */
  id: string;
  /** Semantic category (open string): e.g. 'workload', 'semester_balance', 'free_days'. */
  category: string;
  /** Verbatim user wording, when this came from something the user said. */
  originalWording?: string;
  /** Normalized machine meaning (open string) — what the value means. */
  normalized: string;
  value: unknown;
  classification: PreferenceClassification;
  /** 0..1 — how sure we are of the interpretation. */
  confidence: number;
  source: PreferenceSource;
  confirmationStatus: PreferenceConfirmationStatus;
  /** The planner objective/constraint this would influence (open string). */
  affects: string;
  /** Optional scope (e.g. 'this_semester') and expiry (ISO), where relevant. */
  scope?: string;
  expiry?: string;
  /** True only when it is safe to let this influence planning before confirmation. */
  mayAffectPlanningBeforeConfirmation: boolean;
}

const VAGUE_CONFIDENCE = 0.35;

export function makePreference(
  p: Omit<Preference, 'confirmationStatus' | 'mayAffectPlanningBeforeConfirmation'> &
    Partial<Pick<Preference, 'confirmationStatus' | 'mayAffectPlanningBeforeConfirmation'>>,
): Preference {
  const confirmationStatus = p.confirmationStatus ?? 'unconfirmed';
  // A hard constraint or an uncertain interpretation must never silently drive
  // planning: hard constraints require confirmation, uncertain ones are inert.
  const safeDefault =
    p.classification !== 'uncertain' && p.classification !== 'hard_constraint';
  return {
    ...p,
    confirmationStatus,
    mayAffectPlanningBeforeConfirmation:
      p.mayAffectPlanningBeforeConfirmation ??
      (confirmationStatus === 'confirmed' ? p.classification !== 'indifferent' : safeDefault),
  };
}

/** A concrete, offered choice the user explicitly picked — a soft preference by default. */
export function fromExplicitChoice(input: {
  id: string;
  category: string;
  normalized: string;
  value: unknown;
  affects: string;
  classification?: PreferenceClassification;
  confidence?: number;
}): Preference {
  return makePreference({
    id: input.id,
    category: input.category,
    normalized: input.normalized,
    value: input.value,
    classification: input.classification ?? 'soft_preference',
    confidence: input.confidence ?? 0.9,
    source: 'explicit_answer',
    affects: input.affects,
  });
}

/** A vague/free-text statement — captured as UNCERTAIN and inert (never a hard constraint). */
export function fromVagueStatement(input: {
  id: string;
  category: string;
  originalWording: string;
  normalized: string;
  affects: string;
  value?: unknown;
}): Preference {
  return makePreference({
    id: input.id,
    category: input.category,
    originalWording: input.originalWording,
    normalized: input.normalized,
    value: input.value ?? input.normalized,
    classification: 'uncertain',
    confidence: VAGUE_CONFIDENCE,
    source: 'explicit_answer',
    affects: input.affects,
    mayAffectPlanningBeforeConfirmation: false,
  });
}

/** Confirm an interpretation — promotes an uncertain preference to an active one. */
export function confirmPreference(
  p: Preference,
  opts: { as?: PreferenceClassification } = {},
): Preference {
  const classification =
    opts.as ?? (p.classification === 'uncertain' ? 'soft_preference' : p.classification);
  return {
    ...p,
    classification,
    confirmationStatus: 'confirmed',
    source: 'confirmed_interpretation',
    confidence: Math.max(p.confidence, 0.9),
    mayAffectPlanningBeforeConfirmation: classification !== 'indifferent',
  };
}

// ── Profile (versioned) ──────────────────────────────────────────────────────

export interface PreferenceProfile {
  /** Monotonic version — bumped on every mutation so stale proposals are detectable. */
  version: number;
  preferences: Preference[];
}

export function emptyProfile(): PreferenceProfile {
  return { version: 1, preferences: [] };
}

/** Replace-by-id (no duplicates) and bump the version. */
export function upsertPreference(profile: PreferenceProfile, pref: Preference): PreferenceProfile {
  const preferences = [...profile.preferences.filter((p) => p.id !== pref.id), pref];
  return { version: profile.version + 1, preferences };
}

export function removePreference(profile: PreferenceProfile, id: string): PreferenceProfile {
  if (!profile.preferences.some((p) => p.id === id)) return profile;
  return { version: profile.version + 1, preferences: profile.preferences.filter((p) => p.id !== id) };
}

/** The preferences that may currently influence planning (confirmed/safe, non-indifferent). */
export function activePreferences(profile: PreferenceProfile): Preference[] {
  return profile.preferences.filter(
    (p) => p.mayAffectPlanningBeforeConfirmation && p.classification !== 'indifferent',
  );
}

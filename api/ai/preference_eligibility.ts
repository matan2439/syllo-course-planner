/**
 * preference_eligibility.ts — the server-side boundary that decides which typed
 * preferences may reach the planner, and how (Slice 14). Deterministic and pure.
 *
 * The typed PreferenceProfile is the source of truth (never the chat transcript).
 * Classification filtering happens BEFORE planning:
 *   - confirmed hard_constraint     → may affect legality        (hard bucket)
 *   - confirmed soft_preference/goal → may affect ranking only    (soft bucket)
 *   - indifferent                    → excluded (no bias)
 *   - uncertain / unconfirmed        → excluded (must not influence planning)
 * An ineligible preference is never silently dropped — it is returned in
 * `excluded` with a deterministic reason. Source (explicit vs safe_default vs
 * confirmed_interpretation) is preserved so defaults stay distinguishable.
 */
import { activePreferences, type Preference, type PreferenceProfile } from './preference_model';

export interface PreferenceExclusion {
  id: string;
  reason: string;
}

export interface EffectivePlannerPreferences {
  profileVersion: number;
  /** Confirmed hard constraints — may affect legality. */
  hard: Preference[];
  /** Confirmed soft preferences + goals — ranking/scoring only. */
  soft: Preference[];
  /** Ineligible preferences with a deterministic reason (never silently dropped). */
  excluded: PreferenceExclusion[];
}

export function effectivePlannerPreferences(profile: PreferenceProfile): EffectivePlannerPreferences {
  const active = new Set(activePreferences(profile).map((p) => p.id));
  const hard: Preference[] = [];
  const soft: Preference[] = [];
  const excluded: PreferenceExclusion[] = [];

  for (const p of profile.preferences) {
    if (p.classification === 'indifferent') {
      excluded.push({ id: p.id, reason: 'indifferent — no planner bias' });
      continue;
    }
    if (!active.has(p.id)) {
      // uncertain or an unconfirmed interpretation that may not yet affect planning
      excluded.push({ id: p.id, reason: 'uncertain/unconfirmed — excluded until confirmed' });
      continue;
    }
    if (p.classification === 'hard_constraint') {
      hard.push(p); // confirmation already guaranteed by activePreferences for hard constraints
    } else {
      // soft_preference | goal — ranking only (a goal must never become a hard rule)
      soft.push(p);
    }
  }

  return { profileVersion: profile.version, hard, soft, excluded };
}

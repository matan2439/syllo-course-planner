/**
 * Phase 2C — single source of truth for per-semester weekly-hour load
 * thresholds, used by validation, scoring, the defensive server gate, and
 * the client preview/badges. Mirror these in
 * app/web/semester_board_viewer.html (the drift test in
 * tests/test_viewer_structure.py asserts the mirror stays in sync).
 *
 * Semantics:
 *  - ≤ SOFT_LOAD_MAX (22) — preferred range.
 *  - 23..HARD_LOAD_CAP (26) — warning + scoring penalty, still allowed.
 *  - > HARD_LOAD_CAP — BLOCKING unless the user explicitly accepted the
 *    overload (overload_accepted === true AND overload_confirmed_at set).
 *  - > ABSOLUTE_MAX_REASONABLE (30) — always blocking, cannot be overridden.
 */

/** Lower bound of the "healthy" weekly-hours range. */
export const SOFT_LOAD_MIN = 18;

/** Upper bound of the "healthy" weekly-hours range — exceeding this is a soft warning. */
export const SOFT_LOAD_MAX = 22;

/** Default per-semester cap when the user hasn't set one (board semester-card display cap). */
export const DEFAULT_MAX_HOURS_PER_SEMESTER = 20;

/** Hard cap — exceeding this blocks Apply unless the user explicitly confirmed the overload. */
export const HARD_LOAD_CAP = 26;

/** Absolute maximum — exceeding this is always blocking, never overridable. */
export const ABSOLUTE_MAX_REASONABLE = 30;

/** Legacy margin used by some pre-Phase-2C call sites; kept for backcompat. */
export const SEVERE_OVERLOAD_MARGIN = 3;

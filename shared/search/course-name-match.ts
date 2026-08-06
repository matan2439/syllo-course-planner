/**
 * Approximate (fuzzy) Hebrew course-name matching — one runtime-neutral matcher
 * reused by every course search bar (repository page, native planner fields,
 * legacy picker). Ranks candidates by how closely a typed query matches a course
 * name or id, tolerating the ways users actually type Hebrew course names:
 * missing/……different nikkud, parentheses ("(2)" vs "2"), punctuation, spacing,
 * and small typos.
 *
 * Pure + dependency-free so the legacy vanilla-JS picker can mirror the same
 * normalize/score rules (see semester_board_viewer.html normalizeCourseSearch).
 */

/** Strip nikkud/cantillation + punctuation, collapse whitespace, lowercase. "פיזיקה (2)'" → "פיזיקה 2". */
export function normalizeCourseName(s: string): string {
  return (s ?? '')
    .replace(/[֑-ׇ]/g, '') // Hebrew nikkud / cantillation
    .replace(/["'׳״`()\[\]{}.,;:!?׀|/\\־–—_-]/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Bounded Levenshtein distance; returns `max + 1` once it provably exceeds `max` (cheap early-out). */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // whole row already over budget
    prev = cur;
  }
  return prev[b.length];
}

/** Typo budget scaled to token length: short tokens tolerate less. */
function typoBudget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * Score how well `query` matches a course (`name` + optional `id`). 0 = no match
 * (filter it out); higher = better. Deterministic and monotonic so callers can
 * sort by it. An empty query matches everything with a neutral score.
 */
export function scoreCourseMatch(query: string, name: string, id = ''): number {
  const nq = normalizeCourseName(query);
  if (!nq) return 1; // empty query → show all (unranked)
  const nn = normalizeCourseName(name);
  const nid = normalizeCourseName(id);

  if (nn === nq) return 100;              // exact (normalized) name
  if (nid && nid === nq) return 95;       // exact id
  if (nn.startsWith(nq)) return 85;       // name prefix
  if (nid && nid.includes(nq)) return 80; // id substring (course numbers)
  if (nn.includes(nq)) return 70;         // name substring

  // Every query token appears somewhere in the name (order-independent).
  const nameTokens = nn.split(' ').filter(Boolean);
  const queryTokens = nq.split(' ').filter(Boolean);
  if (queryTokens.length && queryTokens.every((qt) => nameTokens.some((t) => t.includes(qt)))) return 55;

  // Typo tolerance: each query token is within a length-scaled edit distance of
  // some name token. Requires ALL query tokens to fuzzy-hit (avoids noise).
  const everyTokenFuzzy = queryTokens.length > 0 && queryTokens.every((qt) =>
    nameTokens.some((t) => boundedLevenshtein(qt, t, typoBudget(qt.length)) <= typoBudget(qt.length)),
  );
  if (everyTokenFuzzy) return 40;

  // Whole-string typo tolerance for a single-token query against the full name.
  if (queryTokens.length === 1 && boundedLevenshtein(nq, nn, typoBudget(nq.length)) <= typoBudget(nq.length)) return 35;

  return 0;
}

export interface RankedMatch<T> { item: T; score: number }

/**
 * Rank `items` by fuzzy match against `query`, dropping non-matches (score 0).
 * Stable tie-break by shorter (more specific) name then name text, so results are
 * deterministic. Empty query returns items unchanged (all, original order).
 */
export function rankCourseMatches<T>(
  query: string,
  items: readonly T[],
  getName: (t: T) => string,
  getId: (t: T) => string = () => '',
): RankedMatch<T>[] {
  const nq = normalizeCourseName(query);
  const scored = items.map((item) => ({ item, score: scoreCourseMatch(query, getName(item), getId(item)) }));
  if (!nq) return scored; // neutral, original order
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score
      || normalizeCourseName(getName(a.item)).length - normalizeCourseName(getName(b.item)).length
      || getName(a.item).localeCompare(getName(b.item)));
}

/**
 * Server-side replacement for the retired legacy overshoot-minimization test:
 * soft-match candidates must not all be added past the remaining hours gap.
 */
import { pickBestCandidateForGap, type CompletionCandidate } from '../../api/ai/completion_analysis';

const HOURS = [4, 3, 4, 4, 4, 3, 1]; // 23 ש"ש of soft matches, as in the legacy scenario

function fill(gap: number): number {
  let pool: CompletionCandidate[] = HOURS.map((hours, i) => ({ course_id: `c${i}`, hours }));
  let added = 0;
  while (gap > 0) {
    const pick = pickBestCandidateForGap(pool, {}, gap);
    if (!pick) break;
    added += pick.hours ?? 0;
    gap -= pick.hours ?? 0;
    pool = pool.filter(c => c.course_id !== pick.course_id);
  }
  return added;
}

describe('gap fill minimizes overshoot', () => {
  it('a 9 ש"ש gap is closed exactly, not by adding all 23 ש"ש of soft matches', () => {
    expect(fill(9)).toBe(9);
  });

  it('overshoots by at most 1 ש"ש for any gap this pool can close', () => {
    for (let gap = 1; gap <= 22; gap++) {
      expect(fill(gap) - gap).toBeLessThanOrEqual(1);
    }
  });
});

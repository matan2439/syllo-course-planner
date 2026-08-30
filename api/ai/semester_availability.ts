/**
 * Map recurring catalog term labels onto the planner's canonical semester ids.
 * Exact ids pass through; unknown vocabularies remain unchanged so callers can
 * fail closed instead of guessing.
 */
export function mapOfferedToKnownSemesters(
  offered: readonly string[],
  knownSemesterIds: readonly string[],
): string[] {
  if (!knownSemesterIds.length) return [...offered];
  const out: string[] = [];
  for (const offeredSemester of offered) {
    if (knownSemesterIds.includes(offeredSemester)) {
      out.push(offeredSemester);
      continue;
    }
    const term = offeredSemester.trim().toLowerCase().replace(/^א$/, 'a').replace(/^ב$/, 'b');
    const matches = knownSemesterIds.filter(
      (semesterId) => semesterId.toLowerCase().split('_').pop() === term,
    );
    out.push(...(matches.length ? matches : [offeredSemester]));
  }
  return [...new Set(out)];
}

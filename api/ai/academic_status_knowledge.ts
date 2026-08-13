/**
 * academic_status_knowledge.ts — the typed known/unknown contract for the
 * student's own academic status (completed courses).
 *
 * WHY THIS EXISTS. `plan_context.personal_status.completed` is a bare array, so
 * an empty array meant two different things: "the student completed nothing"
 * and "the application never asked". The clarification capability treats an
 * empty list as a critical gap, so a student who genuinely completed no courses
 * could never resolve it — a valid flagged Apply was unreachable.
 *
 * SEMANTIC RULES (deliberate, do not relax):
 *   - Completed CREDIT HOURS are not completed COURSE IDS. Nothing here derives
 *     an id from an hours total; `known_completed_hours` stays a separate fact.
 *   - Absence of a knowledge marker is UNKNOWN, never "none". Every pre-existing
 *     caller (legacy + unflagged) therefore keeps today's behaviour exactly.
 *   - A `known` claim is only honoured with a RECOGNIZED provenance. An
 *     unrecognized/absent source falls back to `unknown` (fail-safe) so a claim
 *     can never masquerade as a confirmed fact.
 *   - The student is authoritative about their OWN history (explicit_user), but
 *     never about catalog facts (credits, prerequisites, category, existence).
 */

/** Who established the completed-course facts. Only these are honoured. */
export const COMPLETED_COURSES_PROVENANCES = [
  'explicit_user', // the student explicitly reported their own history
  'authoritative_board', // the program board's own completed_course_ids metadata
  'imported_record', // an imported academic record (transcript)
] as const;
export type CompletedCoursesProvenance = (typeof COMPLETED_COURSES_PROVENANCES)[number];

/**
 * Tri-state knowledge about a set of course ids. `known_empty` is a real
 * answer ("none"), structurally distinct from `unknown` ("not asked").
 */
export type CourseIdKnowledge =
  | { kind: 'known'; courseIds: string[]; provenance: CompletedCoursesProvenance }
  | { kind: 'known_empty'; provenance: CompletedCoursesProvenance }
  | { kind: 'unknown' };

/** The wire marker carried on `plan_context.personal_status`. */
export interface CompletedKnowledgeMarker {
  status?: 'known' | 'unknown';
  provenance?: string;
}

function isRecognizedProvenance(v: unknown): v is CompletedCoursesProvenance {
  return typeof v === 'string' && (COMPLETED_COURSES_PROVENANCES as readonly string[]).includes(v);
}

/**
 * Canonicalize reported ids: trim, drop empties, de-duplicate deterministically
 * (first occurrence wins, input order preserved). Never invents or drops an id
 * for any other reason — an id the catalog does not know still survives here so
 * downstream validation can surface it rather than silently losing it.
 */
export function canonicalizeCourseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = typeof item === 'string' ? item : (item as { course_id?: unknown })?.course_id;
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Resolve the completed-course knowledge state from a raw `personal_status`.
 *
 * Backward compatible by construction: without a `completed_knowledge` marker
 * the result is `unknown`, which is exactly how every existing caller behaves
 * today (the critical clarification is retained).
 */
export function resolveCompletedCourseKnowledge(personalStatus: unknown): CourseIdKnowledge {
  const ps = (personalStatus ?? {}) as { completed?: unknown; completed_knowledge?: CompletedKnowledgeMarker };
  const marker = ps.completed_knowledge;
  if (!marker || marker.status !== 'known') return { kind: 'unknown' };
  // A 'known' claim without a recognized source is NOT knowledge.
  if (!isRecognizedProvenance(marker.provenance)) return { kind: 'unknown' };

  const courseIds = canonicalizeCourseIds(ps.completed);
  return courseIds.length === 0
    ? { kind: 'known_empty', provenance: marker.provenance }
    : { kind: 'known', courseIds, provenance: marker.provenance };
}

/** True when the completed-course set is established (including an explicit "none"). */
export function isCompletedCoursesKnown(knowledge: CourseIdKnowledge): boolean {
  return knowledge.kind !== 'unknown';
}

/**
 * Recognized completed hours — the sum of the AUTHORITATIVE credit hours of the
 * uniquely identified completed courses.
 *
 * ACCOUNTING RULE (mirrors the legacy planner's `known_completed_hours =
 * completed_status_hours`): the hours total is DERIVED from the identified
 * courses, never added on top of an independent aggregate, so a course can not
 * be counted twice. Hours come only from `hoursById` (authoritative catalog /
 * program data) — a course whose hours are unknown contributes 0 and is
 * reported in `unknownHourCourseIds` rather than guessed.
 */
export function recognizedCompletedHours(
  courseIds: string[],
  hoursById: Record<string, number | null | undefined>,
): { hours: number; countedCourseIds: string[]; unknownHourCourseIds: string[] } {
  const counted: string[] = [];
  const unknownHours: string[] = [];
  let hours = 0;
  for (const id of canonicalizeCourseIds(courseIds)) {
    const h = hoursById[id];
    if (typeof h === 'number' && Number.isFinite(h)) {
      hours += h;
      counted.push(id);
    } else {
      unknownHours.push(id);
    }
  }
  return { hours, countedCourseIds: counted, unknownHourCourseIds: unknownHours };
}

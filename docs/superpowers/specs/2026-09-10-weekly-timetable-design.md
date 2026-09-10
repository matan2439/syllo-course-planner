# Weekly Timetable (Bidit-style Schedule) Design

**Status:** Draft for user review
**Date:** 2026-09-10
**Canonical branch:** `ui/frontend-modernization`

## Objective

Add a weekly, day/hour schedule view to the planner so the student can pick
actual teaching groups (lecture/tutorial/lab) for their courses and see them
laid out on a Sunday–Friday, 08:00–21:00 grid, the way bid-it does today. The
hard product rule driving this feature: **two selected groups may never
overlap in time.** This supersedes the "timetable screenshot is a layout
reference only" non-goal recorded in
`2026-09-02-semester-table-conversational-agent-production-design.md` — actual
weekday/hour scheduling is now in scope, per explicit user request and the
already-recorded "urgent Bidit timetable priority" (`AUTONOMOUS_PROGRESS.md`,
2026-09-06).

TAU's own program data (`tochniot.tau.ac.il` GraphQL, see
`reference-tau-graphql-api` memory) has no day/hour/group fields — only total
weekly hours per teaching mode. No official TAU source for this was found.
bid-it's public, unauthenticated `/ajax/chosen-courses-info/` endpoint returns
exactly what's needed (verified live during design): per-course teaching
groups with day, start/end time, teaching kind (ראשית/משנית), havura, lecturer
and room. This is **not an official academic authority** and is treated with
the same provenance discipline the rest of the app already applies to
non-authoritative sources: labeled as such, with a fetch timestamp, and never
silently treated as "no conflict" when data is missing.

## Data layer

New serverless endpoint `api/ai/schedule-groups.ts` (same pattern/build entry
as the existing `api/ai/*.ts` functions, registered in `vercel.json`
`builds`/`rewrites`):

- `GET /api/ai/schedule-groups?year=<YYYY>&semester=<1|2>&courses=<comma-separated 8-digit ids>`
  — server-side proxies bid-it's `/ajax/chosen-courses-info/` (batches all
  requested course ids in one upstream call; verified batching works via
  repeated `courses_list` params) and normalizes the response into:

  ```ts
  {
    year: number;
    semester: 1 | 2;
    courses: Array<{
      course_id: string;
      name_he: string | null;
      found: boolean;              // false = bid-it has no record for this course/term
      groups: Array<{
        group_id: string;          // gNum
        havura: string;
        kind: string;              // ראשית / משנית
        teaching_mode: string;     // ofenHoraa
        day: string;               // א..ו
        start: string;             // "HH:MM"
        end: string;               // "HH:MM"
        lecturer: string | null;
        room: string | null;
      }>;
      incomplete_data: boolean;    // found but a group is missing day/time
    }>;
    source: 'bidit';
    fetched_at: string;            // ISO timestamp
  }
  ```

  A course with `found: false` or any group missing day/time must render as
  "אין נתוני שעות" in the UI and must **not** be treated as conflict-free —
  it is excluded from the overlap check and flagged, not silently placed.

- `GET /api/ai/schedule-groups?search=<text>` — proxies bid-it's public
  `/ajax/get-autoComplete-courses/` (already confirmed to be the full TAU
  catalog, not just Mechanical Engineering) for the free-course-search box.

- Upstream failures/timeouts return a typed error per course id (never throw
  for the whole batch because one course failed), following the existing
  fail-closed convention used elsewhere in `api/ai/`.

## Semester ↔ weekly-panel sync

The board has 4 semester columns (`year_3_semester_a` … `year_4_semester_b`,
see `project-tau-course-planner` memory). Each column gets a one-time mapping
to a real academic term (`{ year: number, semester: 1 | 2 }`), stored
alongside existing board state in `localStorage`, with a sensible default —
the 4 columns default to 4 consecutive terms starting from the current
calendar term (e.g. today's date maps to 2026 סמסטר א', so the columns
default to 2026-א, 2026-ב, 2027-א, 2027-ב in order) — and an inline edit
control per column header for correction.

The weekly-schedule drawer's tabs are the board's own 4 semester labels, not
generic bid-it tabs. Selecting a tab:

1. Resolves that column's mapped `{year, semester}`.
2. Reads the courses currently placed in that board column.
3. Fetches their groups via `schedule-groups` and renders them on the grid.

This is **one-directional, board → weekly**: adding/removing/moving a course
on that board column changes what the weekly view shows next time it
re-renders (or live, if the drawer is open — re-run the fetch/render when the
board's course set for the active mapped column changes). The weekly view
never mutates the board.

A free-text course search inside the drawer (same visual slot as bid-it's own
search) lets the student explore a course **not yet on the board** for
schedule-fit purposes only; adding it to the weekly grid does not add it to
the board. Placing it for real stays a separate, existing board action
(repository drag/add).

## UI

A new drawer, "מערכת שעות", in the planner toolbar, using the exact existing
drawer infrastructure (open/close toggle, Escape handling before it reaches
the workspace, focus trap, focus restoration on close, portal above scrolling
ancestors) already covered by `tests/ui/planner_shell_actions.test.js` and the
recent course-details/drawer accessibility fixes.

Inside the drawer:

- Semester tab row (the board's 4 semester labels) + small "term" edit control.
- Grid: Sunday–Friday columns × 08:00–21:00 hour rows, matching bid-it's
  layout. Each selected group renders as a block positioned by day/start/end.
- A course's available groups list (from the active tab's board courses, plus
  any free-search additions) with a checkbox/toggle per group.
- Selecting a group that overlaps an already-selected group is **blocked**:
  the checkbox does not activate, and an inline message names the conflicting
  course and time (e.g. "חופף ל'אותות ומערכות' בימי א' 08:00–10:00").
- Courses with `found: false` or `incomplete_data: true` show a distinct
  "אין נתוני שעות" badge instead of a normal group list.
- A small provenance line: "מקור: bid-it (לא רשמי) · עודכן HH:MM".

## State

New `localStorage` key (separate from existing board/theme keys), e.g.
`tau_weekly_schedule`, holding: per-program semester→term mapping, and the
set of manually-selected group ids per (course_id, term). Board placement
state is untouched.

## Conflict rule (hard)

A pure function, unit-testable in isolation:

```
hasOverlap(a: {day, start, end}, b: {day, start, end}): boolean
```

Same day, and time ranges intersect (half-open, `start < otherEnd && end >
otherStart`). Used both to gate adding a new group (block on conflict) and to
render any conflicts that could arise from re-fetched/changed data (e.g. a
course moved off the board's mapped term) — a stale selection that now
conflicts is surfaced, not silently kept.

## Explicit non-goals (this slice)

- No automatic havura linking between lecture/tutorial groups (soft guidance
  only, not enforced) — the only hard rule is time overlap.
- No write-back from the weekly grid into the board or the AI agent's context.
- No support for universities other than TAU (bid-it's `university=TAU`
  param is hardcoded).

## Testing

- API test for `schedule-groups.ts`: normalization shape, `found:false`
  handling, batching, upstream-timeout/error-per-course isolation — mocked
  fetch, matching `tests/api/*.test.ts` conventions.
- Unit tests for `hasOverlap` and the term-mapping default logic.
- JSDOM UI test for the new drawer: open/close/focus/Escape parity with
  existing drawers, tab switching re-fetching/re-rendering, blocked-conflict
  message content, "אין נתוני שעות" rendering for missing data — matching
  `tests/ui/*.test.js` conventions (real component, controlled fetch).

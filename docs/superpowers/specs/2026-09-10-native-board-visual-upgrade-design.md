# Native planner board — visual upgrade design

Date: 2026-09-10
Surface: `/planner/native` (React), NOT the legacy `app/web/semester_board_viewer.html` (confirmed explicitly out of scope — that surface is being retired).

## Problem

The user asked for three visual improvements on the deployed planner:
1. Distinct colors per course group (elective category, and mandatory).
2. A small, always-visible widget showing degree-completion progress (hours placed + per-category course counts).
3. Drag-and-drop for mandatory course slots between semesters, with drag/hover animations.

Investigation found the legacy static-HTML planner already has mature implementations of all three. But the user redirected: new work belongs on `/planner/native`, the React board that's meant to replace the legacy iframe. That surface is much younger and is missing real infrastructure, not just polish:

- **Root-cause bug**: board course data encodes legal semesters as bare codes (`"A"`/`"B"`) in `offered_semesters`. `CourseCard.tsx` compares these directly against full semester ids (`"year_4_semester_a"`), which never match. Result: **no course is currently draggable on `/planner/native`**, despite the drag machinery (ghost states, drop-target feedback, CSS animations) being fully built and tested.
- **No annual-course concept**: courses with `placement_policy: "annual"` (year-long, e.g. `0542-3792`) appear as two independent entries in the board data (once per semester half), each carrying `offered_semesters: ["A","B"]`. Nothing today distinguishes "annual" from "flexible mandatory offered twice" — once the bug above is fixed, an annual course's two halves would become independently draggable, which is wrong (they're one atomic placement).
- **No category concept**: `program_category_id` (fluids/solids/systems/advanced_labs/other) exists in the raw board JSON per course but is dropped by `shared/planner/adapters.ts` before reaching any React component.
- **No degree-progress data**: `metadata.program_requirements_validation` (hours + per-category counts, already computed server/data-side) is also dropped before reaching `/planner/native` — `RequirementsProgressPanel` exists and consumes this shape, but only on the separate `/plan` route, via a different (raw, non-canonical) data path.

## Non-goals

- No changes to `app/web/semester_board_viewer.html` (legacy, being retired).
- No changes to planner/AI generation logic (`api/ai/generate-plan.ts`, greedy planner, LLM interpreter). This is a read-only display upgrade to data that already exists; nothing here changes what the planner is allowed to place.
- No re-categorization of course data — `program_category_id` and `placement_policy` are consumed as shipped, never inferred or recomputed in the UI.
- No visual work on `/plan`'s existing `RequirementsProgressPanel` beyond reusing its view-model logic.

## Architecture

### 1. Root-cause fix: semester-code normalization

`shared/planner/adapters.ts::courseToModel` currently copies `offered_semesters` verbatim. Add a normalization step — ported from the legacy `normalizeLegalSemesterIdsLocal` (`app/web/semester_board_viewer.html:9864`) — that expands bare `"A"`/`"B"` (and Hebrew `"א"`/`"ב"`) into every real semester id ending in `_semester_a`/`_semester_b` present in the board, while passing full ids (`"year_3_semester_a"`) through unchanged. This needs the board's known semester-id list, so `courseToModel` gains a second parameter (`knownSemesterIds: string[]`), threaded from `boardResponseToModel`'s own `parsed.semesters` list.

This alone fixes dragging for every course type (elective and flexible-mandatory) that already has correct `offered_semesters` data. It is the prerequisite for everything else in this spec that involves movement.

### 2. Extend the canonical model: category + placement-policy passthrough

Add to `shared/planner/wire.ts::boardCourseSchema` (all optional, `.passthrough()` already covers forward-compat):
- `program_category_id: z.string().nullable().optional()`
- `placement_policy: z.string().optional()` (values as shipped: `"fixed" | "flexible" | "annual" | "elective"` — treated as an opaque string, not a closed enum, matching how the codebase already treats `course_type`)

Add to `shared/planner/model.ts::BoardCourseModel`:
- `programCategoryId?: string`
- `placementPolicy?: string`

Add to `shared/planner/adapters.ts::courseToModel`: pass both through unchanged (pure passthrough, same pattern as `offeredSemesters`).

Add a derived helper (co-located with the model, pure function, mirrors legacy `isAnnualCourse`):
```ts
export function isAnnualCourse(c: BoardCourseModel): boolean {
  return c.placementPolicy === 'annual';
}
```

### 3. Extend the canonical model: requirements-validation passthrough

Add to `shared/planner/wire.ts`: a `boardRequirementsValidationSchema` mirroring the shape `web/lib/requirements.ts::RawRequirementsValidation` already expects (`valid`, `total_required_hours`, `planned_hours`, `remaining_hours`, `core_courses_total_min`, `core_courses_selected`, `core_courses_satisfied`, `category_results[]`, `warnings[]`, `explanation`). Add it as an optional field on `boardResponseSchema.metadata`.

Add to `shared/planner/model.ts::BoardModel`: `requirementsValidation?: BoardRequirementsValidation` (typed passthrough, no recomputation — same "pass through shipped numbers" discipline `lib/requirements.ts` already documents).

Add to `shared/planner/adapters.ts::boardResponseToModel`: copy `parsed.metadata.program_requirements_validation` through unchanged if present.

`web/lib/requirements.ts::adaptRequirements` gets a second entry point (or is generalized) to accept this canonical shape directly, so `/planner/native` and `/plan` share one adapter function instead of diverging.

### 4. View-model + rendering: category colors

`web/lib/board.ts::CourseVM` gains `categoryId?: string`. `web/lib/planner/board-vm.ts::boardModelToVM` copies `catalogCourse?.programCategoryId` through, defaulting elective-type courses with no category to `'other_specialization'` (mirrors legacy `GENERAL_ELECTIVE_CAT_ID` fallback) and leaving mandatory courses uncategorized (`undefined`) since categories are an elective-only concept in this program's data model.

New color tokens in `web/app/globals.css` (light + dark, following the existing `:root` / `:root[data-theme='dark']` / `@media (prefers-color-scheme: dark)` triple-block pattern already used for `--purple` etc.), ported from the legacy's already-validated palette (`app/web/semester_board_viewer.html:66-72` light, `:116-122` dark):
```
--cat-fluids-accent, --cat-fluids-bg
--cat-solids-accent, --cat-solids-bg
--cat-systems-accent, --cat-systems-bg
--cat-labs-accent, --cat-labs-bg
--cat-other-accent, --cat-other-bg
```
`CourseCard.tsx` applies the matching accent as a left border color + background tint when `course.categoryId` is set (electives only; mandatory keeps its current purple badge treatment, itself already a distinct "group color").

New small component `CategoryLegend.tsx`: a row of colored dot+label chips (חובה + the 4 elective categories), collapsible, rendered once above the board grid in `NativePlannerBoard.tsx`.

### 5. View-model + rendering: annual courses span both columns

`CourseVM` gains `isAnnual?: boolean` (from `board-vm.ts`, via the new `isAnnualCourse()` helper on the matching catalog entry).

`NativePlannerBoard.tsx` currently renders `SemesterColumn` per semester independently, each mapping its own `courses` array. Annual courses need de-duplication (they appear once per half today) and a unified rendering: `NativePlannerBoard` groups semesters into year-pairs (a/b), pulls out any course flagged `isAnnual` present in either half (rendered once, not twice), and renders it as a single block spanning both of that year's columns — analogous to the legacy `.annual-band` (`grid-column: 1 / -1` equivalent, expressed as a `col-span-2` block positioned above/between the two `SemesterColumn`s of that year). Annual blocks are never draggable (`movable` forced `false` in `CourseCard`, mirroring legacy's `isLocked` treatment) and carry a "שנתי (א׳+ב׳)" badge.

`SemesterColumn.tsx` stops rendering any course where `isAnnual` is true (it's rendered once at the board level instead), so counts/hours in the column header exclude annual courses' double-count.

Note: `NativePlannerBoard`'s grid is currently `grid-auto-flow: column` (one column per semester, flat list). A true spanning block needs either (a) switching the board container to an explicit 2-row grid (an "annual row" above the 4 semester columns, with each annual block placed via `grid-column` under its year's pair) or (b) a simpler non-spanning fallback — render the annual block once, inline, at the top of its year's first-semester column, visually connected to a matching placeholder/marker in the second-semester column. Option (a) matches the user's literal ask ("spread across both columns") and is preferred; the plan should confirm the grid restructuring is scoped correctly before implementation, since it changes the board's top-level layout, not just one component.

### 6. Flexible-mandatory dragging

No new mechanism needed — `CourseCard.tsx`'s existing `movable` logic (derived from `offeredSemesters.length > 1`, now correctly populated after the fix in §1) already makes a flexible-mandatory course draggable, with the same drop-target validation, ghost feedback, and animations electives already get. The only change needed here is excluding annual courses from this generic path (§5), since they'd otherwise wrongly qualify.

### 7. Compact progress widget

New component `web/app/components/ProgressBadge.tsx`: a small pill in the `/planner/native` header (next to whatever board-summary chips already exist there) showing `{plannedHours}/{totalRequiredHours} ש״ש` with a green (satisfied) or amber (remaining) dot. Click expands a popover reusing `RequirementCategoryCard`/the category-row rendering already in `RequirementsProgressPanel.tsx` (extract that inner list into a small reusable piece rather than duplicating markup) — same `RequirementsVM` data, just a compact trigger instead of the full-page panel layout.

Wired into `NativePlannerJourney.tsx`: `board.requirementsValidation` (now present on the canonical `BoardModel` per §3) feeds `adaptRequirements`-equivalent logic to build the `RequirementsVM` passed to `ProgressBadge`.

### 8. Animation polish

Extend the existing (already-implemented) CSS in `web/app/globals.css`:
- `.planner-drop-target-active` gets a stronger pulse/glow while a valid drag is over it (it currently sets colors; add a `box-shadow` pulse keyframe).
- A brief "landing" animation class (`.planner-just-placed`, ~250ms scale/opacity pulse) applied to a card immediately after a successful move/add, removed after the animation ends (mirrors the legacy's `cardDraftIn` keyframe pattern at `app/web/semester_board_viewer.html:1653`).
- Respect `prefers-reduced-motion` (the existing `rise` animation already has a guard — follow the same pattern for new keyframes).

## Data flow summary

```
data/parsed_json/*.json (program_category_id, placement_policy, program_requirements_validation — already shipped)
  -> api/board.ts (unchanged, passthrough)
  -> shared/planner/wire.ts (zod: +3 optional fields)
  -> shared/planner/adapters.ts (+semester-code normalization, +passthrough of new fields)
  -> shared/planner/model.ts (BoardModel: +programCategoryId, +placementPolicy, +requirementsValidation)
  -> web/lib/planner/board-vm.ts (BoardVM: +categoryId, +isAnnual per course)
  -> web/app/components/{CourseCard,SemesterColumn,NativePlannerBoard,ProgressBadge,CategoryLegend}.tsx
```

## Testing

Follow existing repo conventions (jest, colocated `*.test.ts(x)`):
- `shared/planner/adapters.test.ts` (existing file, extend): semester-code normalization (bare `"A"`/`"B"` → full ids; already-full ids pass through; unknown tokens dropped), category/placement-policy passthrough, requirements-validation passthrough.
- `web/lib/planner/board-vm.test.ts` (existing, extend): `categoryId`/`isAnnual` mapping, elective-with-no-category fallback.
- `web/app/components/CourseCard.test.tsx` / `SemesterColumn.test.tsx` (existing, extend or new): annual course is never draggable; flexible-mandatory with normalized `offeredSemesters` is draggable; category accent class applied.
- `web/app/components/NativePlannerBoard.test.tsx` (existing, extend): annual course renders once, spanning both columns of its year.
- New: `ProgressBadge.test.tsx`, `CategoryLegend.test.tsx`.
- Manual verification: run locally via the documented dev flow (`AI_DEV_MODE=true npx tsx scripts/dev_api_server.ts` + `npm run dev:web`, per project memory), screenshot `/planner/native` with the real ME-2027 board data (which has real fixed/flexible/annual/categorized courses to exercise every path).

## Open questions resolved during brainstorming (recorded for the plan)

- Target surface: `/planner/native` only, not legacy HTML. Confirmed explicitly by user.
- Mandatory-course dragging: only courses with 2+ real legal semesters (`placement_policy: 'flexible'`) become draggable; annual courses stay locked but gain the spanning visual; single-semester `'fixed'` mandatory stays locked (dragging them would produce an illegal schedule).
- Color grouping: by elective category (fluids/solids/systems/advanced_labs/other) plus a single distinct mandatory color — not a finer subdivision of mandatory.
- Progress widget: a genuinely new small always-visible header badge (not just surfacing something already on the page), showing hours-placed/required and per-category ✓/⚠, expandable for detail.

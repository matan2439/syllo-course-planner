# Semester Table + Conversational Academic Agent Production Design

**Status:** Draft for user review
**Date:** 2026-09-02
**Canonical branch:** `ui/frontend-modernization`

## Objective

Release the substantial verified planner work in time for the upcoming course
bidding period, while reshaping `/planner` into a practical Hebrew/RTL workspace:
a semester-column table in the center, a categorized course repository at the
right, and the full Academic Decision Agent available as a real conversational
LLM interface over the same authoritative durable board.

The timetable screenshot is a layout reference, not a request to invent meeting
times. The product remains a degree/semester planner. Columns represent academic
semesters, and course cards represent semester placement rather than weekday and
hour slots.

## Product contract

There is exactly one committed board. Manual actions and the Agent operate on
that board through the existing server authority:

- Repository drag/add, board remove and board move are manual commands.
- A successful manual command returns the new board and version from the server.
- Agent planning reads the current committed board, academic status and typed
  preference profile.
- Agent alternatives are drafts and never mutate the board.
- Any accepted manual mutation stales all existing Agent alternatives.
- Apply sends proposal/candidate/version/idempotency identity; the browser never
  supplies an authoritative replacement plan.
- Missing course, prerequisite, program or storage facts fail closed and are
  explained in Hebrew.

## Desktop workspace

The desktop screen uses a board-first split layout:

1. A sticky repository rail on the right, approximately 21–24rem wide.
2. A horizontally scrollable semester table using the remaining width.
3. A collapsible Agent drawer below the workspace or as a wide overlay that does
   not reduce semester columns to unreadable cards.

The repository contains a search field, selected-course state, and expandable
academic categories. Each compact course row shows name, code, hours, offering
and warnings. It is draggable and also exposes a keyboard-accessible “add to
semester” action. Categories and membership come only from authoritative board
metadata.

The board renders one visually continuous table with one column per semester.
Each header shows semester name, course count, total weekly hours and warning
count. Empty columns are generous drop targets. Course cards are compact,
color-coded by factual category/type, and expose details, remove and move
controls. Dragging from the repository adds; dragging between columns moves.
Both operations call the same typed manual-edit server endpoint.

## Mobile workspace

Mobile uses three explicit views: “הלוח”, “מאגר הקורסים”, and “העוזר”. The board
keeps horizontally swipeable semester columns with a visible position cue;
repository and Agent controls are never hidden behind hover. Every drag action
has an equivalent button flow. Focus, live status and errors remain available
without relying on color or animation.

## Real conversational LLM Agent

The Agent surface is a transcript-style conversation, not a decorative text box
and not a parallel UI-only preference form. A student can write naturally in
Hebrew, receive a grounded response, answer one clarification at a time, inspect
what the system understood, and explicitly request alternatives.

The LLM is an orchestrator and explainer, never the academic authority. It may
choose among the existing tools, but each tool is deterministic and validates
its own inputs. The initial production tool set is:

- `get_state`: read the committed board/version and current academic context;
- `rank_candidates`: inspect grounded legal candidates;
- `add_course`, `remove_course`, `move_course`, `replace_course`: manipulate an
  isolated planning draft only;
- `finalize_plan`: run deterministic completion/repair and validation;
- clarification and preference tools backed by the existing typed conversation
  and Academic Decision contracts;
- knowledge/explanation capabilities only when supported by authoritative
  syllabus evidence.

The existing `PlannerWorker`, planner tools, validation, candidate alternatives,
proposal persistence and authoritative Apply remain the execution core. The new
chat transport must stream or return assistant turns with structured tool/event
metadata. The UI renders human-readable explanations, not raw tool payloads.

Every assistant claim about legality, prerequisites, degree progress, hours or
course membership must be grounded in tool output. Free-form LLM text cannot
commit a board, create a course fact, weaken a rule or mark a requirement as
complete. If no runtime model is configured, the Agent panel reports that the
conversational assistant is unavailable; it must not silently masquerade a
deterministic form as an LLM conversation.

## Conversation state and durability

The durable board, proposal and academic-context repositories remain canonical.
For the beta, conversation messages may be session-scoped, but every plan-bearing
assistant turn stores or references the proposal id, base board version,
academic-status digest and preference digest. Refresh must preserve committed
board state and active proposal authority. A future account system may add
cross-device transcript history without changing the planning contracts.

## Error and concurrency behavior

- Manual mutation pending state disables duplicate drag/button actions.
- A rejected drop restores the last committed board and names the reason.
- Stale proposal Apply is blocked after any manual edit or relevant status change.
- Provider failure leaves the board and draft proposal authority unchanged.
- Tool-call failure is surfaced as a bounded Hebrew explanation; internal stack,
  prompt, secret and session identifiers are not displayed.
- Unknown offering or prerequisite facts block the affected action rather than
  being guessed by the model.

## Visual direction

Retain the established purple product identity, RTL typography and restrained
animated background. Shift the planning surface from large floating cards to a
dense, precise academic workbench: thin structural borders, quiet purple column
headers, compact course blocks, strong selected/drop states and clear typography.
Color communicates category only alongside text. Motion is limited to direct
interaction feedback and respects reduced motion.

## Implementation boundaries

Reuse and reshape the current React components instead of reviving the legacy
HTML runtime:

- `UnifiedPlannerWorkspace` owns the responsive board/repository/Agent layout.
- `NativePlannerBoard` and `SemesterColumn` own table columns and drop targets.
- `UnifiedCourseRepository` owns category filtering and repository drag sources.
- `NativePlannerJourney` continues to own committed board/version, manual edit,
  proposal staleness, alternatives and Apply.
- A focused conversational Agent component/transport replaces the impression
  that the current deterministic preference questionnaire is itself an LLM.
- Existing typed API/domain modules remain authoritative; no catalog JSON or
  Production database is hand-edited.

Electrical Engineering remains hidden until its official-source facts,
cross-track validator and complete board materialization pass their separate
gate. Mechanical Engineering 2027 is the release program.

## TDD and verification

Each slice follows strict RED → GREEN and is committed independently:

1. repository course drag contract and keyboard equivalent;
2. semester-table drop/add and move behavior through server authority;
3. responsive table/repository/Agent composition;
4. conversational message and tool-event contract;
5. LLM availability/failure and no-fake-chat behavior;
6. Agent reads manual changes, returns multiple drafts, stales after edits and
   applies only the selected server candidate;
7. accessibility, RTL, keyboard, mobile and reduced-motion regressions.

The release gate requires focused component/API suites, full root and web tests,
root/web typecheck, production build, desktop/mobile browser acceptance, no
unexpected console or network errors, and a successful immutable Preview journey.

## Production release

The current in-progress Electrical validator slice is finished and committed
separately. All coherent local commits are pushed to
`origin/ui/frontend-modernization`. A new immutable Preview is built from the
exact candidate commit and tested with Mechanical Engineering 2027.

After Preview acceptance, promote that exact deployment artifact to Production;
do not rebuild a different artifact and do not merge or modify `main` as part of
the promotion. Record the prior production deployment for rollback, then run
live `/planner` smoke tests. One bounded real LLM acceptance conversation is
allowed only against the configured runtime provider; automated tests and
fixtures never call paid providers. Provider configuration, secrets, aliases and
Production data are not changed implicitly.

## Completion definition

The release is complete when the live `/planner` shows the semester table and
categorized repository; a student can add, remove and move courses with drag or
keyboard controls; committed changes survive refresh; the Agent conducts a real
Hebrew LLM conversation through the developed planner tools, grounds alternatives
in the current board, and can apply only a selected authoritative candidate;
desktop/mobile/RTL/accessibility checks pass; and rollback metadata is recorded.

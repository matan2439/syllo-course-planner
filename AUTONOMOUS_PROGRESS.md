# Autonomous Progress

## Latest session — reconcile the conversational-agent implementation plan

The conversational-agent plan now records the typed conversation wire,
bounded deterministic-tool orchestration, server-authoritative endpoint,
Hebrew transcript UI, one-board proposal/apply behavior and provider-free
verification as completed. Evidence is current: root conversational/planner
tests pass in 5 suites with 43 tests; manual-authority tests pass in 4 suites
with 27 tests; all 29 web suites pass with 259 tests; root typecheck and the
web production build pass. Release and Production promotion remain open gates.

## Latest session — allow native drops when drag data is hidden during dragover

The semester drop target now opts into the browser drop protocol from the
known planner MIME type even when the browser withholds `getData()` until the
drop event. Full course identity, offering restrictions and manual mutation
authority remain fail-closed at drop time. Focused drag/repository/board tests
pass (23 tests), all 29 web suites pass with 259 tests, root typecheck passes,
and the web production build passes. No catalog, provider, Supabase,
Production, or remote database configuration changed.

## Latest session — keep the semester board visible beside the course drawer

The desktop workbench now keeps a concrete board shell in the grid instead of
flattening it with `display: contents`. Opening the course repository therefore
keeps the semester table visible as the central, labelled drop surface while
the repository remains a separate side column. The focused workspace suite
passes 13 tests, the repository/board/server-authority regression set passes
50 tests, all 29 web suites pass with 258 tests, root typecheck passes, and the
web production build passes. No catalog, provider, Supabase, Production, or
remote database configuration changed.

## Latest session — reconcile the semester-table implementation plan

The semester-table plan is now marked complete through its responsive
workbench, typed repository drag payloads, server-authoritative add/move/remove
paths and accessibility regressions. Evidence is current: 4 root manual-
authority suites with 27 tests, 29 web suites with 257 tests, root typecheck and
web production build all pass. The conversational-agent and release plans
remain intentionally open for their separate gates.

## Latest session — document the keyboard fallback beside drag guidance

The open-repository board hint now explains both supported paths: drag a course
to a semester or use the keyboard/touch-friendly “הוסף לסמסטר” action. This
keeps the planner usable when a device does not provide reliable HTML5 drag
events. The focused workspace suite passes 12 tests. No catalog, provider,
Supabase, Production, or remote database configuration changed.

## Latest session — make the open drawer’s board affordance explicit

When the course repository is open, the board canvas now announces that it is
still active and accepts a course drop. The hint is visible, RTL-friendly and
polite to assistive technology, so the drawer no longer visually suggests that
it replaced the semester board. The focused workspace suite passes 12 tests.

## Latest session — activate semester drops on drag entry

Semester columns now validate and activate an allowed repository or board drag
as soon as the pointer enters the column, then reuse the same fail-closed
handler during `dragover`. This makes the drop affordance reliable in browsers
that do not emit a useful first `dragover`, while manual edits still go through
the existing authoritative server mutation. The NativePlannerBoard suite now
passes 15 tests. No catalog, provider, Supabase, Production, or remote
database configuration changed.

## Latest session — keep the board concrete while the course drawer is open

The open course drawer now leaves an explicit, persistent semester-board drop
surface in the workspace contract. On tablet and mobile layouts the board
canvas uses a real layout box instead of `display: contents`, so it remains
visible and participates in drag hit-testing while the repository is open.
The focused workspace regression, repository/board drag suites (36 tests),
root typecheck, and web production build pass. No catalog, provider, Supabase,
Production, or remote database configuration changed.

## Latest session — retain board frame on load failure

The planner now preserves the labelled semester-board frame when the
authoritative board request fails, while the error remains explicit and no
course or drop target is fabricated. This prevents the course drawer from
appearing to replace the planner during a failed load. Full web tests (29
suites, 255 tests), root typecheck, and the web production build pass. No
catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — preserve the board while it loads

The unified planner now keeps a labelled semester-board shell visible while
the authoritative board request is pending, instead of collapsing to a lone
loading line when the course drawer is opened early. The shell is explicitly
non-interactive until authoritative data arrives, so it never presents fake
drop targets. Full web tests (29 suites, 255 tests), root typecheck, and the
web production build pass. No catalog, provider, Supabase, Production, or
remote database configuration changed.

## Latest session — focus both opened drawers

Opening either the course repository or Academic Decision Agent drawer now
places keyboard focus on that drawer's close control. The board remains the
single mounted planning surface while both drawers keep consistent keyboard
behavior. Full web tests (29 suites, 254 tests), root typecheck, and the web
production build pass. No catalog, provider, Supabase, Production, or remote
database configuration changed.

## Latest session — focus the opened course drawer

Opening the course repository now moves keyboard focus directly to its close
button. This keeps the drawer immediately dismissible without hiding or
unmounting the semester board, and the focused workspace suite now covers the
behavior. Full web tests, root typecheck, and the web production build pass.
No catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — return focus when closing a drawer

Closing the active course or AI drawer with `Escape` now returns keyboard focus
to its trigger, while the semester board remains mounted and visible. The
focused workspace suite passed with 9 tests; the full web suite passed with 29
suites and 252 tests, followed by root typecheck and the web production build.
No catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — keyboard-close drawer behavior

The active course or AI drawer now closes with `Escape`, returning focus state to
the board without unmounting or replacing the authoritative planner surface.
The focused workspace suite passed with 9 tests; the full web suite and typecheck
are the release checks for this slice. No catalog, provider, Supabase,
Production, or remote database configuration changed.

## Latest release gate — Preview remains ready

Re-verified the latest visible Preview at
`https://tau-course-planner-84rboslpa-matanyaron-1633s-projects.vercel.app/planner?program=mechanical_engineering_2027`.
The full web suite passed with 29 suites and 251 tests, and the repository
typecheck passed. The board/repository split layout, accessible valid-drop
announcement, and typed drag/drop fallback are included in this Preview. No
catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — announce a valid drop target

Semester columns now expose an accessible live status, `אפשר לשחרר כאן`, while
an allowed repository/board drag is over them. The status and purple drop-target
highlight clear on drop or when leaving the target; invalid payloads remain
fail-closed and do not announce acceptance. The focused drag/workspace/
repository/board suite passed with 34 tests, plus web typecheck and diff check.
No catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — show the live semester drop target

Added a fail-closed drag-over guard to semester columns and a visible
`planner-drop-target-active` state. Only a payload accepted for that semester
highlights it; invalid, missing, or server-pending payloads do not. The state
clears on drop/leave and the existing add-vs-move dispatch remains unchanged.
The focused drag/workspace/repository/board suite passed with 34 tests, plus
web typecheck and diff check. No catalog, provider, Supabase, Production, or
remote database configuration changed.

## Latest session — label draggable repository sources

Added an accessible group label to every unselected repository course that can
be dragged (`גרור את … ללוח הסמסטרים`). Selected/non-draggable courses remain
unchanged, while the existing visible drag hint and server-validated add path
remain intact. The focused workspace, repository, board, and drag-payload
regressions passed with 33 tests; web typecheck and diff check passed. No
catalog, provider, Supabase, Production, or remote database configuration
changed.

## Latest session — make draggable course sources discoverable

Added a shared `planner-drag-source` affordance to draggable repository and
board cards (`grab`/`grabbing` cursor), while keeping already-selected or
non-movable cards unchanged. The focused repository, board, workspace, and
drag-payload suite passed with 33 tests; web typecheck and diff check passed.
No authoritative mutation path, catalog source, provider, Supabase,
Production, or remote database configuration changed.

## Latest session — harden repository drag compatibility

Hardened repository-to-board dragging by writing the same strict JSON payload
to `text/plain` in addition to the typed planner MIME and accepting that
fallback only when it still validates as a repository or board payload. This
covers browsers/mobile WebViews that strip custom drag MIME types without
loosening server authority or allowing arbitrary text to become a course edit.
The focused drag, repository, board, and workspace regression suite passed
with 33 tests, and web typecheck/diff check passed. No catalog, provider,
Supabase, Production, or remote database configuration changed.

## Latest session — preserve the board beside the course drawer

Fixed the responsive workspace regression where opening the course repository
used a nearly full-screen fixed layer and covered the semester board. Open
drawers now switch the workbench to a split layout on narrow screens: at
tablet/mobile widths the board remains visible beside the repository, while on
very narrow phones both surfaces retain a usable width in a horizontal
workbench. The board remains mounted and a live drop target while the
repository stays draggable beside it. The focused workspace, repository,
board, and drag-payload regressions passed (32 tests), and the web TypeScript
check passed. This slice changes only the planner UI; no provider, catalog,
Supabase, Production, or remote database configuration was changed. The
unrelated curriculum test modification and private untracked files remain
untouched and unstaged. The isolated Preview for this slice is
https://tau-course-planner-hqxzdt4nq-matanyaron-1633s-projects.vercel.app/planner?program=mechanical_engineering_2027;
browser verification at the affected 639px width confirmed the board and
repository were side by side (224px and 352px), non-overlapping, and the board
drop point was not covered. The Preview still exposed 56 draggable sources and
no iframe.

## Latest session — release gate evidence for the unified planner

The exact pushed head `a0e5df0` passed the local release gate: the full root API
suite passed with 202 suites and 2,569 tests (one pre-existing skipped test),
the full web suite passed with 29 suites and 249 tests, both TypeScript checks
passed, and the Next production build completed. The isolated Preview for this
head is
https://tau-course-planner-5hvqqy528-matanyaron-1633s-projects.vercel.app/planner?program=mechanical_engineering_2027
and browser acceptance confirmed no legacy iframe, a visible board, closed
repository and agent triggers, and the repository interaction path exposing 56
draggable course sources while the board remains mounted. Browser logs showed
only the known non-blocking Three.js `Clock` deprecation warning and no errors.
Production promotion remains intentionally deferred; the one approved bounded
real-LLM smoke request completed in Hebrew, returned a
grounded assistant response, kept the committed board at 6 courses, did not
show raw tool JSON, and did not apply a plan. No provider configuration,
Supabase, Production configuration, catalog source, or remote database was
changed. Electrical remains hidden. The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

## Latest session — remove the duplicate assistant surface

When the conversational Academic Agent is enabled, the journey now shows only
the real Hebrew chat surface and the structured preference elicitation. The old
local-only composer is kept for the legacy path, while server-confirmed manual
edit notices remain visible as accessible live status text beside the new chat.
This prevents two competing message inputs from appearing in the same planner.

Strict RED added a flag-on regression assertion and reproduced the duplicate
`שיחה` surface. GREEN passes the Agent/Apply/alternatives component suites
(46/46), root and web TypeScript gates, and the Next build. The isolated Preview
is ready at
https://tau-course-planner-55zgxndc6-matanyaron-1633s-projects.vercel.app/planner?program=mechanical_engineering_2027
and browser verification confirms the board and repository remain visible with
one close control and 56 draggable courses. No provider, Supabase, Production
configuration, catalog source, or remote database was changed. The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

## Latest session — materialize conversation proposals in the board journey

The Hebrew Academic Agent now returns a typed, read-only server materialization
of its validated proposal. `NativePlannerJourney` converts that materialization
into the existing draft view, so a conversational result is visible beside the
authoritative board and can be applied only by naming the server-held proposal
and candidate through the existing Apply endpoint. Manual edits still advance
the journey revision and make the visible draft stale. The endpoint also uses
the same deterministic candidate machinery to expose up to the validated
non-dominated alternatives when the current model supports them; a partial
model remains a truthful single draft rather than a fabricated comparison.

Strict RED added a journey test and reproduced the missing draft after a
conversation proposal. GREEN passes the Agent/Apply/alternatives component
suites (46/46), the conversation API/wire suites (13/13), and root and web
TypeScript gates. The isolated Preview
https://tau-course-planner-qo4ix408r-matanyaron-1633s-projects.vercel.app/planner?program=mechanical_engineering_2027
was then browser-verified with the board visible beside the repository, one
repository close control, and 56 draggable course sources. No provider,
Supabase, Production configuration, catalog source, or remote database was
changed. The unrelated `tests/test_tau_curriculum_document.py` modification
and untracked private files remain untouched and unstaged.

## Latest session — connect the Hebrew conversation to the single journey

The real Hebrew Academic Agent panel is now mounted inside the same
`NativePlannerJourney` that owns the committed semester board. It sends the
current board version, server-owned academic-status digest and server-owned
preference digest through the typed conversation endpoint. A fresh workspace
explicitly establishes an unknown academic context before exposing the chat,
so the client never guesses a digest or pretends a conversation can mutate the
board. Existing deterministic preference elicitation and server-authoritative
Apply remain intact.

Strict RED added a journey integration test and reproduced the missing
conversation textbox. GREEN passes the Agent journey suite (9/9), the
conversation/API/context regression suites (20/20), root and web TypeScript
gates, and the Next production build. The isolated Preview is pending for this
commit. No provider, Supabase, Production configuration, catalog source, or
remote database was changed. The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

## Latest session — expose the server-owned preference digest

The refreshable planning-context response now returns the server-computed
`preference_digest` alongside the academic-status digest. The conversational
Agent can therefore send the exact owner-scoped preference revision that the
server will validate; it never has to guess a digest from UI state. The
response remains program-scoped and contains no board replacement or client
authority.

Strict RED added the refresh/client assertions and reproduced both failures:
the endpoint omitted the digest and the runtime-neutral client rejected the
response. GREEN passes the planning-context endpoint/client suites (7/7),
root and web TypeScript gates, and the existing conversation contract suite.
No provider, Supabase, Production configuration, catalog source, or remote
database was changed. The unrelated `tests/test_tau_curriculum_document.py`
modification and untracked private files remain untouched and unstaged.

The isolated Preview for this verified contract is
https://tau-course-planner-kh4476pvm-matanyaron-1633s-projects.vercel.app/planner
(deployment `dpl_EDMuAUjXf3HUxdb5iABfESCdMGrk`, status `Ready`). The browser
verified that the semester board remains visible beside the course repository,
with the repository close control and draggable course sources present.

## Latest session — add the typed Hebrew conversation surface

The planner now has a dedicated Hebrew transcript/composer surface for the
Academic Agent. It submits the bounded typed transcript to
`/api/ai/conversation`, keeps Shift+Enter available for multi-line messages,
shows a truthful pending/error/unavailable state, renders friendly tool-status
labels, and never displays raw tool payloads. The explicit `בנה חלופות` action
remains non-mutating; only the existing server-authoritative Apply path may
change the board.

Strict RED reproduced the missing conversation client export and the absent
panel module. GREEN passes the focused API contract and panel suites (40/40),
the conversation endpoint/wire regression set (50/50), the unified workspace,
board, repository, alternatives and server-Apply UI regression set (52/52),
root and web TypeScript gates. The panel is ready for the next integration
slice into the single board journey. No provider, Supabase, Production
configuration, catalog source, or remote database was changed. The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

## Latest session — keep the semester board as the repository drop target

Opening the course-repository drawer no longer applies a mobile-only `hidden`
class to the shared board canvas. The semester table and its drop targets stay
mounted and visible while the repository is open, so a course can be dragged
from the repository into an offered semester; the existing server-authoritative
manual-add path still performs the actual validation and commit.

Strict RED reproduced the board canvas receiving `hidden` after opening the
repository. GREEN passes the focused workspace suite (8/8) and the repository,
board, and server-apply drag regression set (43/43), plus web typecheck and
production build. No provider, Supabase, Production configuration, catalog
source, or remote database was changed. The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

The verified Preview for the board/drop-target fix is
https://tau-course-planner-ndpsrqa67-matanyaron-1633s-projects.vercel.app/planner
(deployment `dpl_DQh6QZLjjFwUp7S3FcczxLLCv6Wa`, status `Ready`). The browser
verified that the board and repository remain present together after opening
the course drawer.

## Latest session — connect the conversational agent to server-owned proposals

The conversational endpoint now composes the configured model with the existing
isolated `PlannerWorker`, seeding it from the current committed board when one
exists. A successful, valid draft is persisted through the existing
`ProposalStore`, and the response exposes only a proposal receipt plus a
redacted `alternatives_ready` event; the client cannot submit a plan or tool
payload as authoritative state. Invalid drafts remain non-applyable and model
absence still returns the typed 503 unavailable response.

Strict RED reproduced the missing `runAgent` seam. GREEN passes the focused
conversation suite (9/9), the proposal/Apply/storage regression set (57/57),
the root TypeScript gate, and the web production build. This slice is ready for
an isolated Preview deployment; no provider, Supabase, Production
configuration, catalog source, or remote database was changed. The isolated
Preview for this commit is
https://tau-course-planner-r1ut6mvhy-matanyaron-1633s-projects.vercel.app/planner
(deployment `dpl_3WR4SxBmWrnfUZmSvTp5jzkNZmgb`, status `Ready`). The unrelated
`tests/test_tau_curriculum_document.py` modification and untracked private
files remain untouched and unstaged.

## Latest session — close drawers and keep mobile surface singular

The unified workspace now provides an explicit, keyboard-accessible close
button inside both the course repository rail and the Academic Decision Agent
rail. Closing either rail returns focus/state to the semester board, which is
important on mobile where the floating trigger can be covered by the open
surface. The agent close action is passed through the single journey instance;
no duplicate board or agent state was introduced. The active workspace surface
is also recorded on the workbench: narrow layouts show only the selected rail,
so repository and agent surfaces cannot overlap the semester board or each
other. Desktop continues to support both rails at once.

Strict RED reproduced the missing in-surface repository close control and the
missing mobile-surface state. GREEN passes 7/7 workspace tests and the web
TypeScript gate. The prior verified board/repository/server-apply regression
set passes 42/42 and the production build passes. This verified slice is
deployed as an immutable Preview at
https://tau-course-planner-8vza3sgy1-matanyaron-1633s-projects.vercel.app/planner
(deployment `dpl_6aRgV46A3Z8XsXiDcjkUZe24pZnC`, status `Ready`). The
automation browser reached Vercel's authentication gate for this protected
Preview, so visual interaction still requires the signed-in private-beta
browser session.

No provider, Supabase, Production configuration, catalog source, or remote
database was changed. The unrelated `tests/test_tau_curriculum_document.py`
modification and untracked private files remain untouched and unstaged.

## Latest session — unblock drawer controls and desktop drop geometry

The planner workbench now keeps the repository and AI controls above the
drawer surfaces, and the desktop layout uses real grid columns instead of
fixed overlays. When a drawer is closed it is removed from the desktop layout
and exposed as `aria-hidden`; when open, the board retains a readable central
column and the repository no longer covers semester drop targets. This keeps
the existing keyboard add path and authoritative server mutation path intact.

Strict RED reproduced the missing closed-panel accessibility state and the
browser repro showed the repository rail covering the board and its toggle.
Focused GREEN passes 5/5 workspace tests; the relevant board/repository/
server-apply regression set passes 40/40. The full root suite passes 202/203
API suites (one skipped), 2,566 passed API tests (one skipped), and 78/78 UI
suites with 835 passed UI tests. Root and web typecheck and the Next.js
production build pass. Python verification is blocked outside this change by
the checked-out `data/database.sqlite` lacking the `courses` table after 266
passed and 28 skipped tests; the first failure is
`tests/test_difficulty_estimator.py::test_real_course_has_score`.

No provider, Supabase, Production configuration, catalog source, or remote
database was changed. Preview browser verification is still pending for the
new commit.

## Latest session — conversation program-universe gate

The configured conversation path now resolves the complete server-side program
board after owner, board-version, academic-status and preference checks. A
missing authoritative universe returns a typed Hebrew `503` and the model is
not invoked over a partial or client-authored catalog.

Strict RED proved the endpoint had no program-universe dependency. GREEN passes
8/8 endpoint tests, 18/18 endpoint/wire/board-loader regressions, and the root
TypeScript gate. No model, provider, remote storage, or Production state was
contacted.

## Latest session — conversation preference authority gate

Planning preferences now have a deterministic, key-order-independent server
digest. The configured conversation path compares the client's expected digest
with the owner-scoped preferences retained in academic context and rejects stale
preferences before any model invocation.

Strict RED proved no preference digest boundary existed. GREEN passes 7/7
conversation endpoint tests, 26/26 conversation/proposal/context regressions,
and the root TypeScript gate. No model, provider, remote storage, or Production
state was contacted.

## Latest session — conversation storage-failure redaction

The conversation endpoint now contains its owner, board and academic-context
reads inside a fail-closed storage boundary. Known planner storage failures
return a stable Hebrew `503` response and unexpected failures return a generic
redacted `500`; neither leaks adapter errors or stack details.

Strict RED reproduced an escaping `PlannerStorageError`. GREEN passes 6/6
conversation endpoint tests, 9/9 endpoint/context regressions, and the root
TypeScript gate. No model, provider, remote storage, or Production state was
contacted.

## Latest session — conversation academic-context authority gate

The configured-model conversation path now loads the owner-scoped academic
context after the board-version check and rejects missing or stale academic
status digests before any model invocation. Client digest strings remain
expected-value checks; the underlying facts stay server-owned.

Strict RED proved the endpoint had no academic-context dependency. GREEN passes
5/5 endpoint tests, 11/11 conversation/context-store/context-endpoint
regressions, and the root TypeScript gate. No model, provider, remote storage,
or Production state was contacted.

## Latest session — conversation board-version authority gate

The configured-model conversation path now resolves the server-issued owner,
loads that owner's authoritative committed board, and rejects a stale client
board version with `409 BOARD_VERSION_CONFLICT` before any model invocation.
The missing-model path remains storage-free and fail closed.

Strict RED proved the endpoint had no authoritative board loader. GREEN passes
4/4 endpoint tests, 43/43 endpoint/wire/board-repository regressions, and the
root TypeScript gate. No model, provider, remote storage, or Production state
was contacted.

## Latest session — central board with independent side drawers

The planner workbench now keeps the semester table as the permanent central
canvas. The categorized course repository opens from the right and the
Academic AI surface opens independently from the left; both are closed by
default, keyboard-accessible, overlay the board on narrow screens, and gently
reserve space for it on desktop without duplicating the shared journey state.

Strict RED required the central canvas and two independently expanded drawers.
GREEN passes 5/5 focused workspace tests, 21/21 workspace/journey/repository
regressions, the web TypeScript gate, and the Next.js production build. No
planner authority, model provider, Production configuration, or remote data was
changed.

## Latest session — fail-closed conversation endpoint boundary

`POST /api/ai/conversation` now has an explicit Vercel route and validates the
shared bounded conversation contract before any model resolution. Unsupported
methods and client-authored board/tool payloads are rejected; a missing model
returns the typed `ASSISTANT_UNAVAILABLE` outcome with `Cache-Control: no-store`
instead of a deterministic answer disguised as AI.

Strict RED proved the endpoint was absent. GREEN passes 7/7 endpoint/wire tests
and the root TypeScript gate. The configured-model path intentionally remains
fail closed until the next slice composes server-owned board/context loading and
proposal persistence. No provider or remote storage was contacted.

## Latest session — conversational tool orchestration

The Agent can now run a bounded Hebrew LLM turn over an isolated
`PlannerWorker` using the existing deterministic get/rank/add/remove/move/
replace/finalize tools. Tool progress is reduced to safe typed events, every
mutation remains worker-validated, and a deterministic repair/validation pass
produces only a draft plan—not a committed board.

Strict RED proved the conversational orchestrator was absent. GREEN passes
30/30 conversational, tool and worker tests plus the root TypeScript gate.
Invalid semester actions are rejected without state corruption; provider
failure discards the isolated draft and returns a redacted unavailable result.
All tests used an injected fake generator and invoked no real model.

## Latest session — bounded conversational Agent contract

The conversational Academic Agent now has a strict shared wire contract for
Hebrew transcript turns, ownership/session identity, authoritative board and
academic/preference digests, redacted tool-status events, clarifications,
proposal availability and a truthful `assistant_unavailable` outcome.

Strict RED proved the contract module was absent. GREEN passes 4/4 focused
schema tests and the root TypeScript gate. The request rejects system/tool role
spoofing, oversized transcripts, invalid UUID ownership and client-authored
board or replacement-plan payloads. No model or provider was invoked.

## Latest session — semester-table UI verification gate

The approved semester-table UI plan has passed its complete local gate. The
web suite passes 240/240 tests across 28 suites, `tsc --noEmit` passes, and the
Next.js 15 production build completes with `/planner` as a dynamic route. The
full API regression run passes 2551/2552 tests across 199 suites with one
pre-existing skipped test; the focused manual-edit/server-authority gate passes
27/27 tests across all four required suites.

The root `npm test -- <paths>` wrapper appended an incompatible UI-config run
that found no matching tests, so the required four suites were rerun directly
with the repository's local Jest binary and exited 0. No real provider, remote
database, Preview or Production environment was contacted. Next work begins the
approved conversational Academic Agent plan.

## Latest session — responsive three-surface workbench

The unified planner now exposes separate mobile tabs for the semester board,
course repository and Academic Agent while keeping one mounted Journey and one
authoritative state. RTL roving focus supports Arrow, Home and End navigation.
On desktop the categorized repository is a sticky scrollable rail beside the
semester table, while the Agent remains a dedicated region of the same Journey.

Strict RED proved the workspace had only two combined views and lacked the
workbench structure. GREEN passes 34/34 workspace, route and Journey tests plus
the full TypeScript gate. Production has not yet changed; immutable Preview and
the conversational Agent gates still precede promotion.

## Latest session — repository drops use server authority

Dropping a repository course onto a semester now enters the same authoritative
`add_course` mutation used by manual controls. The committed board remains
unchanged while the request is pending, adopts only the returned server board
and version, refreshes the workspace course ids, and stales any visible Agent
proposal through the existing manual-revision path.

Strict RED proved the table accepted the gesture visually but the Journey sent
no edit. GREEN passes 33/33 Journey, board and workspace tests plus the full
TypeScript gate. No local optimistic board mutation was introduced.
Production, aliases, databases and catalog data were unchanged.

## Latest session — typed semester-table drop targets

The native board now renders as one continuous horizontally scrollable
semester table with stable 17rem columns and full-height drop zones. Typed
repository payloads dispatch only to add intents, typed board payloads dispatch
only to move intents, and both fail closed outside authoritative semester
restrictions. Existing board cards now emit the shared typed drag contract.

Strict RED proved repository drops were ignored and the board still used the
old responsive card grid. GREEN passes 19/19 board and drag-contract tests plus
the full TypeScript gate. The next slice will route repository drops through
the existing server-authoritative manual-edit journey. Production, aliases,
databases and catalog data were unchanged.

## Latest session — draggable semester-aware course repository

Repository courses can now be dragged with the typed repository payload and
carry only the semesters supported by their authoritative offering facts.
Every drag action has a keyboard-accessible semester-specific add control, and
courses already committed to the board disable both interaction paths.

Strict RED proved that repository cards were not drag sources and add controls
could not name a destination. GREEN passes 8/8 repository/workspace tests and
the full TypeScript gate. The workspace now forwards an explicitly selected
semester into the existing authoritative manual-add journey. Production,
aliases, databases and catalog data were unchanged.

## Latest session — typed planner drag boundary

The unified planner now has a strict typed drag contract that distinguishes a
repository add from a move of an existing board course. Repository payloads
can carry authoritative semester restrictions, while empty identifiers,
unknown drag kinds, malformed JSON and invalid semester lists fail closed.

Strict RED proved the boundary was absent. GREEN passes all 6 focused payload
tests; the TypeScript gate also passes. This is the first implementation slice
of the approved semester-table UI and does not yet expose repository dragging
in the interface. Production, aliases, databases and catalog data were
unchanged.

## Latest session — cross-track Electrical requirement validation

The requirements engine now validates Electrical global track, core-course and
advanced-lab minima without double-counting one cross-listed course as two
distinct tracks. A deterministic maximum matching assigns each selected course
to at most one track for diversity accounting, while mandatory and total-course
minima remain unique-id counts.

Strict RED proved that one core course appearing in two authoritative pools was
previously able to reach no validator at all. GREEN passes 30/30 focused
source-authority tests and 202/202 isolated curriculum/program regressions.
Electrical remains hidden until this status is integrated into board generation
and the full official corpus is materialized. Production, aliases, databases
and catalog data were unchanged.

## Latest session — truthful Electrical planner requirements boundary

The validated Electrical source model can now materialize immutable typed
planner requirements without flattening its cross-track rules into the
independent Mechanical category schema. The boundary preserves total track and
core-course minima, required distinct core tracks, advanced-lab and distinct
lab-track minima, per-track core membership, cross-track course membership and
the prerequisite requirement for laboratories.

Source-model materialization now also fails closed when any track or laboratory
membership lacks a matching authoritative catalog-course fact. Strict RED
proved both the missing requirements boundary and the missing catalog-coverage
gate. GREEN passes 29/29 focused source-authority tests and 201/201 isolated
curriculum/program regressions. Electrical remains hidden until this richer
requirements contract is consumed by the planner validator and board builder.
Production, aliases, databases and catalog data were unchanged.

## Latest session — catalog facts wired into the Electrical source model

`materialize_program_source_model` now requires the parsed catalog-course
result and preserves every accepted `CurriculumCatalogCourse` in the immutable
`CurriculumProgramSourceModel`. Callers cannot silently omit the catalog while
constructing the authoritative Electrical boundary.

Materialization also fails closed when catalog reconciliation leaves any
course unresolved, reporting the affected course ids before a planner program
can be produced. Strict RED proved both the missing catalog input and the
missing unresolved-catalog gate. GREEN passes 27/27 focused source-authority
tests and 199/199 isolated curriculum/program regressions. Electrical remains
hidden until the validated source model is converted into planner requirements
and a board. Production, aliases, databases and catalog data were unchanged.

## Latest session — authoritative Electrical catalog course facts

Course blocks beneath official Electrical sections `2.5` and `2.6` now parse
into typed `CurriculumCatalogCourse` facts: Hebrew name, weekly and credit
hours, prerequisite and concurrent course ids, and source pages. The parser
recognizes real course headers via `אופן הוראה`, so prerequisite ids are not
mistaken for new catalog entries.

Identical cross-track occurrences merge provenance while differing hours,
names or dependency facts remain explicitly unresolved and are excluded from
accepted facts. Strict RED proved both merge and conflict paths. GREEN passes
25/25 focused source-authority tests and 197/197 isolated curriculum/program
regressions. Electrical remains hidden until these facts are wired into the
source model and final planner materialization. Production, aliases, databases
and catalog data were unchanged.

## Latest session — typed Electrical program source model

Validated Electrical document facts and the canonical membership catalog can
now combine into an immutable `CurriculumProgramSourceModel`. This boundary is
deliberately not a registered planner program or board: it preserves identity,
degree structure, the resolved selection rule, mandatory courses and cross-track
memberships without forcing them into the Mechanical JSON schema.

Materialization fails closed when any curriculum course fact remains unresolved
and re-runs membership completeness against the document's selection rule.
Strict RED proved the missing boundary and unresolved-fact gate. GREEN passes
23/23 focused source-authority tests and 195/195 isolated curriculum/program
regressions. Electrical remains hidden until catalog course details and final
planner-board materialization are complete. Production, aliases, databases and
catalog data were unchanged.

## Latest session — complete Electrical membership quantity gates

Electrical membership completeness now enforces all course-count minima from
the resolved selection rule: distinct track courses, distinct explicitly core
courses, and distinct advanced laboratories. These checks complement the
existing distinct-track gates and run on canonicalized memberships, so repeated
PDF occurrences cannot satisfy an academic requirement twice.

Strict RED proved all three missing quantity gates. GREEN passes 21/21 focused
source-authority tests and 193/193 isolated curriculum/program regressions.
Electrical remains hidden pending complete source-model validation and final
program materialization. Production, aliases, databases and catalog data were
unchanged.

## Latest session — canonical Electrical track reconciliation

The composed Electrical catalog now canonicalizes typography-only course-track
label variants before applying membership completeness. Duplicate course/track
memberships merge their source pages, so repeated PDF typography cannot inflate
the number of distinct tracks. If canonical duplicates disagree on core status,
ingestion fails with an explicit source conflict instead of choosing one.

Strict RED proved both the duplicate and conflicting-core paths. GREEN passes
18/18 focused source-authority tests and 190/190 isolated curriculum/program
regressions. Electrical remains hidden pending complete source-model validation
and final program materialization. Production, aliases, databases and catalog
data were unchanged.

## Latest session — canonical Electrical lab deduplication

The composed Electrical catalog now reconciles advanced-laboratory duplicates
again after typography-only track-label canonicalization. Two PDF occurrences
that differ only by parentheses or similar typography therefore become one
course/track membership with merged source-page provenance instead of leaking
duplicate categories into future program materialization.

Strict RED reproduced the post-canonicalization duplicate. GREEN passes 16/16
focused source-authority tests and 188/188 isolated curriculum/program
regressions. Electrical remains hidden pending complete source-model validation
and final program materialization. Production, aliases, databases and catalog
data were unchanged.

## Latest session — deduplicated Electrical lab memberships

Repeated authoritative occurrences of the same Electrical advanced-laboratory
course in the same track now reconcile into one membership with the union of
its source pages. The parser no longer risks double-counting a repeated PDF
section, and it does not infer equivalence between semantically different
track labels.

Strict RED reproduced the duplicate membership. GREEN passes 15/15 focused
source-authority tests and 187/187 isolated curriculum/program regressions.
Electrical remains hidden pending complete source-model validation and final
program materialization. Production, aliases, databases and catalog data were
unchanged.

## Latest session — fail-closed Electrical core-label conflicts

Electrical track ingestion now verifies every explicit core-course label
against the authoritative `2.5.x` section containing that course. Typography-
only variants use the existing safe normalization, while a semantically
different track label raises a source mismatch instead of silently downgrading
the course to non-core.

Strict RED reproduced the silent downgrade. GREEN passes 14/14 focused
source-authority tests and 186/186 isolated curriculum/program regressions.
Electrical remains hidden until final program materialization and complete
source-model validation. Production, aliases, databases and catalog data were
unchanged.

## Latest session — canonical Electrical membership labels

The composed Electrical membership catalog now rewrites typography-only
advanced-laboratory label variants to the exact authoritative course-track
section label. This keeps one stable track identity for future program
materialization while preserving source pages and refusing semantic aliases.

Strict RED proved that a reversed-parenthesis PDF variant previously leaked
through the catalog despite matching the track completeness gate. GREEN passes
13/13 focused source-authority tests and 185/185 isolated curriculum/program
regressions. Electrical remains hidden pending semantic conflict handling and
final program materialization. Production, aliases, databases and catalog data
were unchanged.

## Latest session — typographic Electrical track reconciliation

Advanced-laboratory track labels must now match an extracted course-track
section after typography-only normalization. Parentheses, dash variants,
letter case and repeated whitespace are ignored, while semantically different
labels remain different; no alias such as `computer systems` → `computers` is
invented. An unmatched laboratory track fails source ingestion explicitly.

Strict RED proved both the safe typography boundary and the missing-track
failure. GREEN passes 25/25 focused tests and 197/197 isolated curriculum/
program regressions. Semantic label conflicts and final program materialization
remain, so Electrical stays hidden. Production, aliases, databases and catalog
data were unchanged.

## Latest session — composed Electrical membership catalog

Track-course and advanced-laboratory extraction now compose into one typed
`CurriculumMembershipCatalog`. The composition freezes the source pages, runs
both explicit section-boundary parsers, and applies the membership completeness
gate before returning a catalog suitable for the future materializer.

Strict RED proved the missing composition boundary. GREEN passes 23/23 focused
tests and 195/195 isolated curriculum/program regressions. The catalog is not
yet a registered planner program; full-source label reconciliation and program
materialization remain, so Electrical stays hidden. Production, aliases,
databases and catalog data were unchanged.

## Latest session — Electrical membership completeness minima

Parsed Electrical memberships now fail closed unless the authoritative
catalog contains at least the selection rule's required number of distinct
core tracks and distinct advanced-laboratory tracks. A partial extraction can
therefore no longer look structurally usable merely because it contains some
track and lab rows.

Strict RED proved both missing gates. GREEN passes 22/22 focused tests and
194/194 isolated curriculum/program regressions. The gate is not yet wired
into final program materialization, and whole-document course-count and label
reconciliation remain unfinished, so Electrical stays hidden. Production,
aliases, databases and catalog data were unchanged.

## Latest session — fail-closed Electrical track contradictions

Repeated authoritative course/track memberships are now reconciled by their
explicit core status. If the same course in the same track is printed once as
core and once as non-core, ingestion raises a source mismatch naming that
course and track instead of retaining contradictory records or choosing one.

Strict RED reproduced the unsafe duplicate acceptance. GREEN passes 20/20
focused tests and 192/192 isolated curriculum/program regressions. Electrical
remains hidden pending whole-document completeness and program materialization;
Production, aliases, databases and catalog data were unchanged.

## Latest session — authoritative Electrical advanced-lab boundaries

Advanced-laboratory membership can now be parsed only beneath explicit
`2.6.x` undergraduate bulletin headings. The adapter supports both official
heading forms (`track` and `in track`), preserves heading/course-page
provenance, and stops at section `2.7`; neither course-number patterns nor a
laboratory word in the title can create membership outside that boundary.

Strict RED proved the missing boundary. GREEN passes 19/19 focused tests and
191/191 isolated curriculum/program regressions. Whole-document completeness,
cross-membership reconciliation and program materialization remain unfinished,
so Electrical stays hidden and fail closed. Production, aliases, databases and
catalog data were unchanged.

## Latest session — authoritative Electrical track membership boundaries

Electrical course-to-track membership can now be parsed only from explicit
`2.5.x` undergraduate bulletin sections. The adapter preserves one membership
per course/track occurrence, includes the track heading and course block pages
as provenance, marks a course as core only when the block explicitly names the
same track, and stops before the separate advanced-laboratory section. It does
not infer membership from course ids, titles or prose.

Strict RED proved the missing boundary. GREEN passes 18/18 focused tests and
190/190 isolated curriculum/program regressions. Advanced-laboratory
membership, whole-document consistency and program materialization remain
unfinished, so Electrical stays hidden and fail closed. Production, aliases,
databases and catalog data were unchanged.

## Latest session — explicit Electrical core-track memberships

The authoritative תשפ"ה Electrical bulletin was revalidated as the 294-page
undergraduate document for program `0512-11-01-0000`; the previously surfaced
mixed graduate page is not an ingestion source. Curriculum course facts now
retain every explicitly printed `core course in track` label, including one
course belonging to multiple tracks, and include those labels in conflict
identity. No title-based track inference or label normalization was added.

Strict RED proved the membership loss. GREEN passes 17/17 focused tests and
189/189 isolated curriculum/program regressions. This is still partial source
ingestion: complete track and advanced-laboratory membership must be parsed and
validated before Electrical can be registered or shown. Production, aliases,
databases and catalog data were unchanged.

## Latest session — source-year integrity gate for Electrical

Academic-year precedence now requires each claimed year to match the year
encoded in its official TAU curriculum PDF URL. A mislabeled rule can no longer
win merely by claiming a newer year; the conflicting rules remain unresolved
and Electrical stays fail closed. Strict RED reproduced the unsafe override,
then GREEN passed 16/16 focused tests and 188/188 isolated curriculum/program
regressions. No program registration, catalog data, deployment or Production
surface changed.

## Latest session — dated curriculum-source authority for Electrical

The first fail-closed Electrical integration slice now restores visually
reversed RTL lines from official PDF extraction without reversing Latin course
identifiers or numeric values. Curriculum sources and parsed selection rules
also carry a normalized academic year, allowing a newer official-year rule to
supersede an older conflicting rule while undated or same-year contradictions
remain unresolved and fail closed.

Strict RED first proved the missing RTL helper and year-authority behavior.
Focused coverage passes 15/15, and the isolated broader curriculum/program
regression gate passes 187/187. This is source-adapter groundwork only:
Electrical Engineering remains hidden until its official-source program model
and validation rules are complete. Production, aliases, databases and catalog
data were not changed.

## Latest session — catalog-grounded elective move destinations

The manual board now preserves `offered_semesters` from the authoritative
repository through the shared wire model and React board view-model. Elective
course cards advertise only catalog-listed semester destinations, and their
drag payload carries the same allowed set so an invalid drop produces no move
intent. Missing offering metadata retains the existing server-authoritative
fallback. Mandatory courses remain fixed by the prior slice.

Strict RED proved both the incorrect keyboard destination and invalid drop.
Focused board/model coverage passes 16/16, the shared planner contract passes
35/35, the complete web suite passes 27/27 suites and 229/229 tests, both root
and web TypeScript checks pass, and the sequential optimized Next build passes.
Production, Vercel aliases, databases and catalog/data sources were not changed.

## Latest session — truthful manual move affordances

Preview acceptance had shown that mandatory-course cards advertised drag and
keyboard move destinations even though the authoritative server correctly
rejected every such request as `PLAN_INVALID`. Strict RED→GREEN coverage now
separates the behaviors: mandatory courses expose no move affordance, while
elective courses retain both drag-and-drop and the keyboard-accessible move
menu. The server validation remains unchanged and absolute.

The focused native-board and authoritative manual-edit journey pass 25/25.
Full web verification passes 27/27 suites and 227/227 tests; the web TypeScript
check and a sequential optimized Next build also pass. A deliberately parallel
test/build probe reproduced a `.next` artifact race, while the required
sequential build completed cleanly; verification commands that share `.next`
must remain serial. Production, Vercel aliases, databases and catalog sources
were not modified.

## Latest session — durable Preview manual-edit recovery (`812d248`)

The first immutable durable-storage Preview exposed a real first-edit defect:
the React board displayed the authoritative `plan_context`, while
`POST /api/ai/edit-board` required an already-persisted `planner_boards` row
for move/remove and therefore returned `COURSE_NOT_PRESENT`. Strict RED→GREEN
coverage now proves that move/remove seed their initial state from the same
authoritative planning context when no committed board row exists. The focused
service/endpoint suites pass 21/21, and the complete post-fix gate passes:
199/200 API suites (2546 passed, 1 intentionally skipped), 78/78 legacy UI
suites (835/835), 27/27 web suites (223/223), both TypeScript checks, and the
optimized Next build. The web suite remains honest about expected test-console
noise from missing `fetch` in fallback cases; it has no failing test.

Commit `812d248` is pushed to `origin/ui/frontend-modernization`. Immutable
Preview deployment `dpl_73EphR4E1tgMgNU2HTgHcqzDeNDx`
(`https://tau-course-planner-5t2aebhws-matanyaron-1633s-projects.vercel.app`,
`target:null`) was built from a clean `git archive` of that exact commit.
Production was not promoted or modified.

Browser acceptance on the new Preview established the anonymous session and
loaded the server board plus the 56-course repository. After explicitly
recording all 24 first/second-year courses as completed (92.5 authoritative
hours), manual add placed `0542-4120` in year 4 semester A, server-authoritative
move placed it in year 3 semester A, and reload returned it from durable
storage in year 3 semester A. The success announcements were visible and the
browser console had no errors; only the known Three.js `Clock` deprecation
warning remained. No external AI/LLM provider was invoked.

One truthful UI finding remains: course cards currently render generic move
destinations for mandatory courses even when the authoritative validator will
reject every displayed destination. The server correctly kept those hard
requirements absolute and returned `PLAN_INVALID`; do not weaken validation.
The smallest next slice is an impact/eligibility contract that hides or
disables destinations the server cannot authorize, followed by the remaining
durable Preview Generate/proposal/Apply/idempotency/session-isolation browser
matrix. This Preview is not a Production recommendation.

## Current priority — Unified Planner Production Recovery (R4 verified; R5 Preview acceptance in progress)

R5 recovered remote parity on 2026-08-27: local and
`origin/ui/frontend-modernization` reached `8db52b5`. An immutable Vercel
Preview was built from a clean `git archive` of that commit, with `target:null`;
Production was not promoted or modified. The Preview proved the canonical
`/planner` renders the unified RTL React workspace without an iframe, loads the
authoritative board plus 56-course repository, redirects `/plan`, `/ai-plan`
and `/planner/native`, and has no horizontal overflow at 390x844. Browser
network requests for the page and board were 2xx/304; the only console warning
remained the known Three.js `Clock` deprecation.

The first real manual add correctly exposed a deployment-boundary defect and
failed without mutating the board: `POST /api/ai/planning-context` returned 404.
Root cause is exact and local: `api/ai/planning-context.ts` exists and its
handler tests pass, but `vercel.json` omitted both its `@vercel/node` build and
rewrite. A RED deployment-contract test now proves the omission; the minimal
build/rewrite correction is GREEN together with the endpoint and API-client
tests (3 suites, 6 tests). Fresh full verification after the correction passes
187/187 API suites (2495/2495 tests), 27/27 web suites (223/223 tests), both
root and web typechecks, and the optimized Next build. The next action is to
commit/push this deployment fix, create a new immutable Preview, and repeat the
manual add/refresh and Agent symbiosis acceptance. No external AI provider was
invoked.

That corrected Preview (`62c9176`, deployment
`dpl_E5zxu8uTERQBQpzUZFEmXRqSUjwS`, `target:null`) proved the route fix:
`POST /api/ai/planning-context` changed from HTTP 404 to HTTP 200. The next
authoritative boundary then failed closed: `POST /api/ai/edit-board` executed
but returned the typed business result `ACADEMIC_CONTEXT_NOT_FOUND`; the board
did not mutate. Both requests carried the same opaque `syllo_owner` cookie.
The cause is the current process-memory `academic_context_store`: Vercel builds
planning-context and edit-board as separate serverless functions, so context
written in one function is not a reliable shared source of truth for the
other. Rewrites, warm-instance assumptions, or another global map cannot make
this durable or authoritative.

R5 is therefore blocked at the real persistence boundary, not at UI routing.
The mandatory next decision is a production-compatible shared durable adapter
for anonymous session ownership, academic context, boards, proposals,
idempotency and compare-and-swap versions. No vendor may be selected silently;
Supabase remains explicitly out of scope. Until the user approves a storage
architecture/provider and required environment/migration work, do not promote
this Preview, claim Production readiness, or delete the legacy rollback route.
The current public Production remains unchanged.

R4 route consolidation is verified on the development branch. Public
`/planner` now owns the canonical purple React workspace directly, with no
iframe. `/plan`, `/ai-plan` and `/planner/native` redirect to `/planner` and
preserve a supported program selection. `/planner/legacy` remains intact as a
diagnostic rollback reference; no legacy HTML was deleted. The deterministic
Agent Preview route remains only for fixture-based acceptance compatibility and
is still gated off by default.

Route acceptance on 2026-08-27 proved the default Mechanical 2027 workspace
loads the authoritative board and a 56-course/5-category repository at the
public `/planner` URL. Mobile 390x844 remained RTL and free of horizontal
overflow, with no iframe and no browser console errors. The only warning is the
pre-existing Three.js `Clock` deprecation. No Generate action or external AI
provider was invoked. The three historical entry URLs converged on `/planner`.

Browser acceptance also exposed a fail-closed archive boundary:
`mechanical_engineering_2025` is still registered for historical navigation,
but this checkout contains neither its declared parsed board file nor an
authoritative `data/boards` snapshot. The canonical page now stops before
mounting the planner instead of issuing client API calls, substituting 2027, or
guessing academic data. Restoring that archive requires separately approved
authoritative source data; no catalog file was changed here.

R4 RED->GREEN coverage adds public-route ownership, iframe absence, route
convergence/query preservation and missing-snapshot fail-closed behavior. Full
web verification passes 27/27 suites and 223/223 tests; root/web typechecks and
the optimized Next build pass. Preview servers were stopped. Production remains
unchanged.

R2 is now complete on the canonical purple React/Next Preview workspace. Manual
add, remove and keyboard-accessible move operations commit through the
authoritative server board/session/version boundary; the UI never mutates the
committed board before success. Every successful manual edit stales the entire
AI alternative set, disables Apply across all cards and requires explicit
Rebuild. Rebuild sends the complete updated board and active preference profile
to Generate. A selected non-default server proposal applies once and the
authoritative board survives refresh through the local Preview adapter.

R3 human/Agent symbiosis is also verified on that same board. Generate reads
the current committed manual board; alternatives remain drafts; selecting a
different card sends no mutation; every accepted manual edit invalidates the
whole proposal; stale cards cannot restore Apply; and explicit Rebuild sends
the updated board plus all active typed preferences. A non-default alternative
was selected and server-applied, replacing the committed board only after the
authoritative response. That result then survived refresh and is the board a
subsequent Agent request will read.

R2 browser acceptance on 2026-08-27 used the frozen
`test_program_grounded_preview_2027` fixture. The repository and API were proved
to use the same exact four-course snapshot; E1 was added, moved and removed with
server-confirmed live announcements. After an AI proposal, manually adding E3
staled every alternative and blocked Apply; one Rebuild request then contained
E3 in semester A and E1 in semester B. Selecting the non-default E2/E1
alternative did not mutate the current board until Apply succeeded; refresh
returned E2/E1 from the server repository. Desktop and 390x844 mobile checks
were RTL, keyboard-operable and free of horizontal overflow. Browser console
had no errors; only the pre-existing Three.js `Clock` deprecation warning was
present. Preview servers were stopped and ports 3001/3002 were released.

RED->GREEN corrections discovered by browser acceptance are commits `6f118ec`
(strict exact-program repository projection; no fallback to an unrelated
program) and `ee72a05` (truthful live announcements for authoritative remove
and move). Focused integration coverage passes 19/19. Full web verification is
25/25 suites and 215/215 tests; root/web `tsc --noEmit` and the optimized Next
build pass. Public `/planner`, Production, providers and deployment state remain
unchanged.

Exact next slice is R5: recover remote push parity, create an immutable Preview
from the verified commit, and run the same manual+Agent route acceptance there.
Before any Production promotion, resolve/configure a real production-compatible
durable board/proposal repository and record rollback metadata. Do not claim
Production readiness or delete the legacy fallback while durable storage is
absent or unconfigured.

The user explicitly paused further Electrical Engineering implementation until
the fragmented live planner is recovered into one canonical React/Next product.
The approved design is
`docs/superpowers/specs/2026-08-26-unified-planner-production-recovery-design.md`
and the active foundation plan is
`docs/superpowers/plans/2026-08-26-unified-planner-foundation.md`.

R0 establishes `docs/architecture/planner-surface-inventory.md`: the public
`/planner` still embeds the legacy HTML; the full native Agent remains behind a
Preview-only route; React already owns repository search/details, completed
status, conversation, alternatives, priority and authoritative Agent Apply, but
manual add/remove/drag/move have no React or server mutation owner. Production
durability also remains unresolved because proposals are process-memory state
and only local Preview has a file-backed board adapter.

R1 now provides one canonical purple React/Next Preview workspace at
`/planner/native/agent-preview`: the real board, Academic Decision Agent and
course repository render together without an iframe. The shared deterministic
workspace state proves that alternative selection is draft-local, manual board
commits stale the complete AI proposal, stale card switching cannot restore
Apply, and successful Apply clears the draft once. Repository search, details
and add intent use the real repository projection; the add control is
deliberately non-mutating until R2 introduces authoritative server validation.

R1 verification on 2026-08-27: all 25 web suites / 208 tests pass, web
`tsc --noEmit` passes, and the optimized Next production build succeeds.
Browser Preview acceptance passed desktop and 390x844 mobile layouts, RTL,
keyboard tab switching, named form controls, and no iframe. Mobile Lighthouse
snapshot scores are 100 Accessibility / 100 Best Practices / 100 SEO / 100
Agentic Browsing with 34 audits passed and 0 failed. The only browser warning
is the existing Three.js `Clock` deprecation emitted by the animated background
dependency; no application error, Generate request, Apply mutation or external
provider call occurred during this acceptance pass. Public `/planner` and
Production remain unchanged.

Exact next slice is R2: RED tests and one authoritative manual-add mutation
contract over the same board version/session boundary. It must reject unknown,
duplicate, completed, prerequisite-invalid and stale requests; only after that
may the repository add intent update the committed board. Remove/drag/move
follow as separate verified slices, not as UI-only state.
The executable R2 plan is
`docs/superpowers/plans/2026-08-27-unified-planner-manual-add.md`.

Do not resume the preserved Electrical RED in
`tests/test_tau_curriculum_document.py` until R0-R5 complete. Do not stage or
discard it while implementing planner Recovery. Production and public routing
remain unchanged through R1-R3; promotion requires exact-commit Preview parity,
durable storage approval and rollback evidence.

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-08-26, session on branch `ui/frontend-modernization`
(**B39 authoritative cross-track selection rules are verified.**
The source adapter now retains total electives, core-course/distinct-track and
advanced-lab/distinct-track minima with provenance, while conflicting official
sources remain explicitly unresolved. No program or catalog data was generated.
**Not Production-ready.** Not merged, not deployed.)_

_Latest entry: 2026-08-26 (cont. 31) — B39. The official Electrical bulletin
states 12 track courses excluding laboratories, at least three core courses
from three distinct tracks, and two advanced laboratories from two distinct
tracks with prerequisites. RED required all six semantics plus the exact source
page and URL. GREEN adds a typed cross-category selection rule parsed from the
official text; the planner still does not infer these constraints from category
names or course titles._

_A second official TAU School of Electrical Engineering page currently states
four core courses from four distinct tracks while retaining the same 12-course
and two-laboratory requirements. This conflicts with the תשפ"ה PDF's three/three
rule. The new reconciliation contract deliberately returns
`conflicting_authoritative_selection_rules` with both source URLs and no
resolved rule. Neither value has been silently promoted into an Electrical
program model. Resolving the applicable academic-year authority is mandatory
before beta registration._

_Focused selection-rule coverage passes 11/11. The complete curriculum/index/
GraphQL parser, Mechanical PDF-program and generic requirements regression
family passes 5/5 suites and 183/183 tests. No tracked data, Production surface,
provider, deployment or catalog output changed._

_Next: acquire or identify the current academic-year Electrical bulletin from
an official source, then parse complete track/core/laboratory membership. If
the current source cannot resolve the 3-versus-4 conflict, retain the typed
unresolved gate and do not expose Electrical planning as authoritative._

_Previous entry: 2026-08-26 (cont. 30) — B38. (**B38 source-provenanced TAU curriculum ingestion is verified.**
Official curriculum text can become typed identity, degree structure and
mandatory-course facts without title/category inference.)_

RED used exact excerpts from TAU's
official 294-page Electrical Engineering bulletin for program
`0512-11-01-0000` and required a fail-closed source adapter: exact title, code,
academic year and print-date identity; the 179-hour degree total; seven
authoritative structure components; mandatory course identity, year, semester,
weekly/credit hours, prerequisites and concurrent requirements; and page-level
provenance._

_GREEN introduces a pure typed curriculum-document parser. It stops at the
later timetable copy rather than counting courses twice, carries course blocks
across PDF page boundaries, canonicalizes prerequisite ids, is invariant to
input page order, and removes a course from accepted facts when two
authoritative blocks disagree. The disagreement is retained as
`conflicting_authoritative_course_facts` with its source pages. The adapter does
not classify a course from its Hebrew title and contains no planner ranking or
degree-specific course-id conditionals._

_Focused RED became 10/10 GREEN. The curriculum/index/GraphQL parser,
Mechanical PDF-program and generic program-requirement regression family passes
5/5 suites and 182/182 tests. The first regression invocation produced 11
environment setup errors because Windows denied pytest's default temp root;
rerunning against an isolated workspace temp directory passed all tests, and
that runtime directory was removed. No tracked data changed._

_The Electrical dataset is not yet complete or registered. The source adapter
still needs full-document extraction plus typed specialization-track and
advanced-laboratory rules from the same official bulletin. Only after those
facts are complete and validated may it materialize a program model and board.
Do not expose Electrical Engineering in the UI from this partial parse._

_Previous entry: 2026-08-26 (cont. 29) — B37. (**B37 authoritative TAU program identity discovery is verified.**
The data-acquisition boundary can query TAU's official `getPrograms` index and
select a program only by one exact normalized title, degree and school match;
missing, ambiguous, malformed and unavailable results fail closed.)_

The private-beta inventory proved
that the repository has no Electrical Engineering program model, board or
frontend registration; the generic planner cannot honestly support that degree
until a separate authoritative dataset exists. It also proved that the essential
manual add/remove/move journey already exists in the legacy planner mounted at
`/planner`, while the newer native board is intentionally read-only. The beta's
largest functional gap is therefore authoritative Electrical program data, not
a second planning algorithm._

_The first acquisition audit exposed a dangerous identity gap: the existing
TAU scraper required a caller-supplied `tcid`, and an apparently relevant search
URL resolved to an unrelated biomedical double degree. RED therefore required
the official `getPrograms` GraphQL request, a lean typed program identity, exact
normalized title/degree/school selection, and fail-closed behavior for zero,
multiple, transport-failed or malformed results. GREEN adds that discovery
boundary without changing frozen data. Focused index/parser verification passes
2/2 suites and 72/72 tests._

_An official TAU Electrical Engineering curriculum PDF was identified for
program code `0512-11-01-0000` (B.Sc., bulletin תשפ"ה). It states 179 total
hours and contains mandatory years, specialization tracks, laboratories and
prerequisites. The repository has no PDF-to-program ingestion implementation;
the existing Mechanical `*_from_pdf.json` is already materialized input, not
parser output. The next slice must therefore define and test a generic,
source-provenanced program ingestion contract before any Electrical board is
registered. Do not hand-author or infer missing course/category facts._

_Previous entry: 2026-08-25 (cont. 28) — B36. (**B36 meaningful neutral course-set alternatives is verified.**
The frozen real corpus now retains academically distinct course sets before
duplicate timetable permutations, while the greedy primary and complete
hard/policy prefix remain unchanged. Full API is 180/180 suites and 2462/2462
tests; web is 20/20 and 187/187; legacy UI is 78/78 and 835/835. **Not
Production-ready.** Not merged, not deployed.)_

The frozen-corpus audit exercised a
real neutral Mechanical Engineering request and found three valid alternatives
but only one canonical course set: every comparison card contained the same 26
courses and differed only by semester placement. Consequently the post-Generate
topic-impact contract truthfully returned `distinguishesCandidates:false`, so
the richer real evidence could not support an actionable academic choice._

_RED asserted more than one canonical course set on the real handler path and
failed with exactly one. GREEN spends the existing bounded planner-run budget
on deterministic one-elective replacement probes when no grounded objective is
confirmed. Incoming and outgoing courses come only from the authoritative model;
mandatory, completed, currently planned, disallowed, hard-wanted and pinned
courses are protected. Each probe is run through the existing authoritative
validator and retained only when every hard/policy score term equals the greedy
baseline. Frozen feature/topic evidence is used solely as an order-independent
tie-break among equally admissible probes; it cannot score or replace the greedy
primary._

_Alternative retention now exposes the first distinct canonical course set
before a second timetable permutation within the same hard/policy prefix. New
proof covers real-corpus course-set diversity and truthful topic impact, legacy
primary identity, hard-prefix equality, hard exclusion, authoritative validity,
and invariance to model/evidence insertion order. The first full API run exposed
that neutral probes consumed the deviation budget before the established
canonical choice; 8 tests failed. The corrected order preserves the established
planner recommendation, reserves at most `maxCandidates - 1` runs from the same
hard bound for neutral enrichment, and cannot promote an enrichment probe into
the primary recommendation. The formerly red family then passed 5/5 suites and
65/65 tests. Final verification passes API 180/180 and 2462/2462, web 20/20 and
187/187, legacy UI 78/78 and 835/835, root/web `tsc --noEmit`, and the Next.js
production build. No catalog/data or Production surface was changed._

_Next smallest ordered step after B36: continue Phase A with a realistic
recommendation/trade-off/explanation audit over the now meaningfully distinct
alternatives, then expand complete-student acceptance scenarios. Do not add a
question unless its server impact contract proves it can change the decision._

_Product-priority update (2026-08-25): preserve the full ordered roadmap below,
but insert one bounded milestone immediately after B36: a private beta for the
owner covering both TAU Mechanical Engineering and TAU Electrical Engineering,
with the AI journey and the essential manual add/remove/move planning journey
working against the same authoritative validation. This reorders work; it does
not delete the remaining Phase A quality audits, broader Phase B UI/site work,
or later commercialization/expansion. Electrical Engineering must enter through
a separate authoritative program model/dataset, never course-id conditionals in
the core algorithm. Production deployment, accounts, payments and cross-device
persistence remain separate gates and require explicit approval/configuration._

_Previous entry: 2026-08-25 (cont. 27) — B35. The follow-up audit found that B34
correctly removed unsupported question options but retained a deeper defect:
`DeterministicClarificationCapability` runs before candidates exist, yet still
asked three generic interest questions. It therefore could not establish that
an answer changed a recommendation. The real handler RED built topic-converged
alternatives, proved `topicQuestionImpact.distinguishesCandidates:false` with
no distinguishing topics, and still received focus, avoid and style questions._

_GREEN removes academic-interest elicitation from the pre-plan capability. The
typed `AcademicInterestProfile` and answer application contracts remain intact,
so explicit preferences still compose normally. New questions now come only
from `DeterministicPreferenceElicitation`, after Generate, using the existing
server-authored topic/delivery/priority impact contracts. This preserves the
important positive path: when applicable evidence genuinely separates retained
alternatives, the real state machine still asks one bounded question and routes
the answer into composition; converged, missing, stale or conflicting evidence
asks nothing._

_RED failed exactly on the three fabricated question ids. Focused preflight,
handler, impact-wire and elicitation coverage passes 5/5 suites and 76/76 tests;
the broader clarification family passes 7/7 suites and 77/77 tests; native
topic/priority interaction passes 4/4 suites and 42/42 tests; the legacy answer
form passes 14/14. Full API passes 180/180 suites and 2458/2458 tests. Full web
passes 20/20 suites and 187/187 tests; expected jsdom failure-path console output
remains. Full legacy UI passes 78/78 suites and 835/835 tests from the committed
tree. Root/web `tsc --noEmit` and the Next.js production build pass. No tracked
catalog/data, provider call, Production, Vercel, Supabase, `main`, or stash
change._

_Next smallest ordered step after B35: resume the frozen-corpus Phase A.2 audit
for a concrete extraction or applicability defect with demonstrated handler
impact. Do not restore a generic preference questionnaire; every optional
question must continue to be justified by its own server impact contract._

_Previous entry: 2026-08-25 (cont. 26) — B34. A realistic clarification audit
traced every academic-interest field from elicitation through composition and
found that `careerGoals` and `optimizationPriorities` have no ranking/planning
consumer. It also found that the UI offered unsupported `biomechanics`,
`general`, `exam_light`, `math_heavy`, `practical`, `theoretical`, and
`industry_relevant` choices. Because the old gate used generic profile
“meaningfulness”, any such unsupported choice could suppress the questions
that actually affect planning._

_The RED failed in seven exact places: two unsupported question families were
still emitted; five questions appeared instead of three; unsupported focus and
style options were exposed; and career-only/unsupported-only profiles silenced
the actionable bootstrap. GREEN centralizes current capability beside the
grounded adapter: 11 focus ids map to supported topic ids, while only
`project_based` and `lab_based` map to grounded style objectives. Clarification
now gates on those mappings rather than generic typed presence. The broader
typed profile and answer contracts remain backward compatible, but fields with
no consumer are not elicited._

_The focused state-machine suite passes 15/15 and the real Generate-handler
suite passes 22/22, including a career-goal-only end-to-end request. Related
clarification/profile/composition coverage passes 10/10 suites and 168/168
tests. Full API passes 180/180 suites and 2466/2466 tests; full web passes 20/20
suites and 187/187 tests. Root/web `tsc --noEmit` and the Next.js production
build pass. The full legacy UI run passes 834/835 behavior checks before commit;
its sole Git-diff guard intentionally rejects any uncommitted API file. That
guard passes 12/12 from the committed tree, completing all 835 checks without a
product failure. No tracked catalog/data, provider call, Production, Vercel,
Supabase, `main`, or stash change._

_Next smallest ordered step after B34: continue Phase A.2 with a read-only
audit of the frozen real syllabus corpus for the next concrete extraction or
evidence-applicability defect; begin with a realistic handler RED only when an
actual recommendation/explanation impact is reproduced. Do not widen the
ontology or add a question without a demonstrated consumer._

_Previous entry: 2026-08-24 (cont. 25) — B33. Tracing B30's readable rationale
through the existing `GroundedExplanation` disclosure found that the exact
official URL was preserved correctly but rendered as a plain LTR span. A
student could see a long technical address but had no native keyboard/click
action to inspect the evidence behind the recommendation._

_The component RED opened the disclosure and required a link whose accessible
name identifies the official syllabus and course, whose href is the exact
server-provided source, and whose new-tab behavior carries `noopener noreferrer`.
A second RED supplied `javascript:` and required no actionable link. GREEN adds
a narrow HTTP/HTTPS URL parser at the rendering boundary. Valid sources display
one clear Hebrew action plus the official hostname, use the existing purple and
focus tokens, and open natively; malformed or non-web references remain an
inert “official source saved in the system” status. No motion or card redesign
was introduced._

_Focused explanation coverage passes 2/2 suites and 14/14 tests. Full web
passes 20/20 suites, 187/187 tests; existing expected failure-path
`fetch is not defined` console output remains. Root/web `tsc --noEmit` and the
Next.js production build pass. API files were untouched; the immediately prior
B32 full API run remains 180/180 suites and 2463/2463 tests and was not
misreported as rerun for this React-only slice. No tracked data,
provider/network acquisition, Production, Vercel, Supabase, `main`, or stash
change._

_Previous entry: 2026-08-24 (cont. 24) — B32. The post-B31 Phase A.2 audit found
that `RuleBasedFeatureExtractor` treated the official `מטלות הקורס` value
as an exhaustive assessment inventory. The same official page explicitly warns
that additional assignments may exist and that the complete list is in the
detailed syllabus. Nevertheless, value `אחר` became project=false,
exam=false and coursework=false, and `פרוייקט` became project=true plus
unsupported exam=false/coursework=false._

_The extractor RED required `אחר` to remain unknown for every unmatched
component and required an explicit project to prove only project presence. The
Generate-handler RED pinned E3 through a hard wanted constraint and showed its
project score incorrectly treated the non-exhaustive value as known-negative
instead of disclosing E3 as unknown. GREEN makes assessment extraction
one-directional: an explicit bounded term yields true with the original source
evidence; absence yields typed unknown with no fabricated negative evidence.
`FEATURE_EXTRACTION_VERSION` is now `1.3.0`._

_Section aggregation was corrected consistently: one section stating project
and another stating `אחר` is unknown course-wide, not
`varies_by_section`, because the second source does not establish a
contradiction. Frozen-corpus evidence proves real `0542-3112` (`אחר`) remains
unknown and real `0555-4000` (`פרוייקט`) remains project=true while
exam stays unknown. Explicit project ranking and hard constraints remain green.
Focused evidence/aggregation/ranking coverage passes 8/8 suites and 155/155
tests. Full API passes 180/180 suites, 2463/2463 tests in 239 seconds. Full web
passes 20/20 suites, 186/186 tests with the existing expected failure-path
`fetch is not defined` console output. Root/web `tsc --noEmit` and the Next.js
production build pass. No tracked catalog/data, provider/network acquisition,
Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 23) — B31. The next read-only Phase A.2 audit
found a real extraction defect rather than a missing ontology entry. Official
TAU syllabus `0542-4422` states `דרישות קדם: אלגברה לינארית` on
an unpunctuated line and begins its authoritative engineering-design prose in
the next paragraph. `officialContentSection` flattened every newline before
`contentWithoutForeignClauses` ran; the exclusion rule therefore deleted the
prerequisite and all subsequent text through the next full stop._

_The unit RED reproduced that exact paragraph shape and lost
`engineering_design`. The real Generate-handler RED used two canonical
alternatives plus E3 carrying the same source shape; an explicit mechanical-
design focus incorrectly retained E1+E2. GREEN preserves normalized paragraph
boundaries in the official content section and ends a foreign prerequisite or
recommendation clause at the first sentence or paragraph boundary. It still
removes the authoritative prerequisite text itself and never reads course
titles, user prose, or syllabus silence as topic evidence. `TOPIC_MAPPER_VERSION`
is now `topic-map/1.1.0` so derived facts disclose the changed extraction
semantics._

_After GREEN the handler recommends E3 and cites its official design evidence.
A frozen-corpus regression directly proves real `0542-4422` retains an
auditable engineering-design assertion. Focused topic/evidence/ranking coverage
passes 9/9 suites and 161/161 tests. Full API passes 180/180 suites, 2460/2460
tests in 213 seconds. Full web passes 20/20 suites, 186/186 tests; existing
expected failure-path `fetch is not defined` console output remains. Root/web
`tsc --noEmit` and the Next.js production build pass. No tracked catalog/data,
provider/network acquisition, Production, Vercel, Supabase, `main`, or stash
change._

_Previous entry: 2026-08-24 (cont. 22) — B30. Tracing the handler through the
native renderer showed that `groundedExplanationHe` embedded each official
syllabus URL directly in the recommendation sentence even though the same
authoritative document was already returned in `groundedSources` and rendered
behind the keyboard-accessible “show sources” disclosure. This duplicated
provenance and made the primary Hebrew rationale unnecessarily difficult to
scan._

_The real-handler RED required project and topic explanations to contain no
raw URL while their exact source references remained in `groundedSources`.
Before GREEN the project explanation exposed `ims.tau.ac.il` inline. GREEN
changes only the two explanation provenance formatters: they retain the
official field/source type, academic year, exact supporting wording and
readable course label, while the existing disclosure remains the sole surface
for the full URL. Ranking, evidence facts, score vectors, candidate identities,
hard gates and recommendation are unchanged._

_Focused grounded explanation/ranking GREEN passes 128/128. Full API passes
180/180 suites, 2457/2457 tests in 207 seconds. Full web passes 20/20 suites,
186/186 tests; existing expected failure-path console output still includes
`fetch is not defined` where tests intentionally omit a committed-board loader.
Root and web `tsc --noEmit` and the Next.js production build pass. No catalog
or generated tracked data changed; no provider/network acquisition,
Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 21) — B29. Tracing the rendered native journey
showed `groundedExplanationHe` is displayed verbatim, while every grounded
explanation formatter named contributing courses only by technical ids such as
`0542-4425`. The authoritative planner model already carried `name_he`; the
information was lost only at the explanation boundary. Cards had readable
names, but the rationale a student was expected to understand did not.

The real-handler RED selected project-backed E3 whose model label is `קורס E3`
and expected `קורס E3 (E3)`. Before GREEN the explanation contained only `E3`.
GREEN builds a request-local label map from the same authoritative model and
threads it through the existing composition/ranking explanation functions.
Project/laboratory, topic-alignment and topic-avoidance course references now
use `name (id)`; blank, missing, or id-identical names retain the stable id and
nothing is invented. Labels affect text only: scores, objective vectors,
candidate identities, hard gates, recommendation and source evidence are
unchanged.

Focused handler/composition/priority GREEN passes 135/135. Full API passes
180/180 suites, 2457/2457 tests in 209 seconds. Full web passes 20/20 suites,
186/186 tests; its existing expected error-path console output includes
`fetch is not defined` in tests that do not inject the committed-board loader,
but no test fails and this slice did not change that boundary. Root and web
`tsc --noEmit` pass; diff gates pass. No UI/data/provider/network acquisition,
Production, Vercel, Supabase, `main`, catalog, or stash change._

_Previous entry: 2026-08-24 (cont. 20) — B28. A read-only audit over the actual
ignored frozen evidence cache enumerated all topic-unknown courses and was
removed immediately afterward. Generic project, research, space outreach,
environmental innovation and ethics prose remained outside the current focus
ontology rather than being forced into a nearby topic. Two real project courses
(`0542-4010`, `0542-4020`) did contain a direct design statement in the official
content section: students must develop requirements and `לתכן פתרון` that
answers them. The mapper previously disclosed bare `תכן` as ambiguous and did
not recognize this complete, unambiguous phrase.

The handler RED gave E3 that exact official statement and requested the
existing `mechanical_design` focus. Before GREEN the recommendation remained
E1+E2 with no design contribution. GREEN adds only the full phrase `לתכן
פתרון` to the existing `engineering_design` topic vocabulary. It does not map
bare `תכן`, course titles, generic project participation, or research activity,
and it introduces no objective: the result uses the existing generic
`prefer_topic_alignment` path.

The recommendation now changes to E3 and cites the exact proving phrase. The
live-cache regression confirms the real snapshot's topic-unknown count is now
the documented five (the two design-project courses moved from unknown on
official evidence). Focused handler/topic/audit GREEN passes 79/79. Full API
passes 180/180 suites, 2457/2457 tests in 205 seconds; root `tsc --noEmit` and
diff gates pass. The temporary audit file is absent. No UI/data/provider/
network acquisition, Production, Vercel, Supabase, `main`, catalog, or stash
change._

_Previous entry: 2026-08-24 (cont. 19) — B27. The next Phase A evidence audit
compared focus areas that were still unsupported against the frozen official
2025 snapshot. It found no substantive biomechanics statement: the only
biomedical hit was an academic-unit label on an ethics course, outside the
official course-content semantics, so biomechanics remains deliberately inert.
It did find direct energy-system content for real course `0542-4094`: the
official content section describes refrigeration/air-conditioning systems and
operation as a heat pump. Bare `אנרגיה` also appears in conservation equations,
which is not enough to establish energy-systems coverage and was explicitly
rejected as a mapping rule.

The handler-level RED requested structured `energy` focus with two canonical
lecture alternatives and E3 alone carrying the exact refrigeration/heat-pump
content. Before GREEN the focus produced no grounded objective and retained
E1+E2. GREEN adds `energy_systems` to the existing generic topic vocabulary,
maps the existing `energy` focus area to it, and adds its supported Hebrew
label. This is not a new ranking objective: it flows through the same
`prefer_topic_alignment`, evidence snapshot, soft composition, hard gates and
explanation contract as every other topic.

Only the specific phrases `מערכות קירור ומיזוג אוויר` and `משאבת חום` (plus
their direct English equivalents) assert the topic. A regression proves bare
`שימור אנרגיה` is insufficient. The RED recommendation changes to E3 and its
contribution cites the exact official phrase. Focused topic/handler GREEN
passes 97/97; composition, priority, alternatives, audit and frozen-real-corpus
regressions pass 147/147. Full API passes 180/180 suites, 2456/2456 tests in
205 seconds; root `tsc --noEmit` and diff gates pass. No UI/data/provider/
network acquisition, Production, Vercel, Supabase, `main`, catalog, or stash
change._

_Previous entry: 2026-08-24 (cont. 18) — B26. The Phase A evidence audit found a
source-truth defect in the already-implemented topic mapper. For a course with
multiple official syllabus documents, `prepareEvidence` correctly unioned the
supported topics but stored only one course-level source URL chosen from the
first content-bearing document. `scoreTopicAlignment` then attributed every
topic to that URL, even when the proving phrase existed only in another
document, and the Hebrew explanation carried no exact wording.

The real-handler RED supplied two E3 documents: the first contained only
generic content, while the second alone stated `חומרים הנדסיים`. The selected
materials contribution incorrectly cited the generic document and had no
excerpt. GREEN retains a deterministic per-topic evidence fact inside the one
prepared snapshot. It selects a canonical assertion independent of input order,
passes that assertion's source/year/wording into the ranking contribution, and
quotes the short official phrase in the existing explanation. Legacy/test
topic adapters without the richer map keep their prior source/year behavior;
ranking values, hard constraints, candidate identities and topic ontology are
unchanged.

The handler now cites the materials document and `חומרים הנדסיים` exactly.
Focused topic/handler GREEN passes 99/99; composition, priority, alternatives,
multi-combination and frozen-real-corpus regressions pass 137/137. Full API
passes 180/180 suites, 2454/2454 tests in 223 seconds; root `tsc --noEmit` and
diff gates pass. No UI/data/provider/network acquisition, Production, Vercel,
Supabase, `main`, catalog, or stash change._

_Previous entry: 2026-08-24 (cont. 17) — B25. B24 deliberately left the real
section-scoped corpus inert because `prepareEvidence` had no connected complete
group universe. Tracing found the missing link rather than missing data:
`data/import_reports/group_universe_report.json` is a tracked, frozen,
metadata-only artifact produced offline from recorded official TAU
course-details pages, and `api/ai/group_universe.ts` already owned complete/
applicable normalization, but the Generate handler loaded syllabus documents
alone and never passed the report to `prepareEvidence`.

The behavioral RED supplied one section-addressed official project assignment
plus a complete authoritative universe through the real Generate handler. The
confirmed project preference still selected canonical E1+E2 instead of E3,
proving the report stopped before ranking. GREEN adds a cache-only report loader
and passes its index into the existing immutable evidence boundary before any
candidate generation. E3 is then selected as predicted; no new objective,
ranking stage, acquisition path, or section-selecting planner was introduced.

The loader accepts only the current `group-universe/1.0.0` format, complete and
applicable rows with non-empty content-hash/source provenance, a non-empty
canonical group set, and exactly one matching syllabus year for the course.
Malformed JSON, version mismatch, incomplete/unidentified rows, ambiguous
years, missing provenance, and contradictory records all yield no universe and
therefore no ranking claim. Duplicate group ids collapse and ordering is
canonical. The tracked report/catalog/cache were not regenerated or modified.

RED observed the real handler retain E1+E2 and project score zero. GREEN passes
43/43 focused loader/handler tests, 135/135 evidence/group/project regressions,
and full API 180/180 suites, 2453/2453 tests in 214 seconds. Root typecheck and
final diff/protected-state gates pass. One optional read-only `tsx` probe failed
before module load with Windows/Node `uv_os_get_passwd` ENOMEM and is not cited
as product evidence. No UI/data/provider/network acquisition, Production,
Vercel, Supabase, `main`, catalog, or stash change._

_Previous entry: 2026-08-24 (cont. 16) — B24. B23 recovered official assessment
facts, but tracing showed they stopped at `CourseFeatures.project`:
`prefer_project_courses` read only `projectDelivery`, so a lecture course whose
official `מטלות הקורס` explicitly required a project still scored zero. This
is another evidence source for the existing confirmed project-based preference,
not a new academic objective or question.

The end-to-end RED used multiple valid candidate plans under identical hard
constraints, made E3 a lecture with an explicit official project assignment,
and observed the canonical E1+E2 recommendation remain unchanged. GREEN lets
either project delivery or an explicit project assignment contribute exactly
once per course. It remains a soft composition feature behind legality,
completion, hard wanted/avoided constraints, caps, and confirmed distribution.
The existing hard-exclusion proof remains GREEN.

A separate section-applicability RED temporarily removed assessment aggregation
and exposed the first-document defect (`true` from one section instead of
`varies_by_section`). Assessment projects now use the same complete-universe
aggregation as laboratory/project delivery: mixed sections are inert, missing
universes do not become course facts, and input order cannot select a winner.
Dual delivery+assessment evidence contributes once. Explanation REDs prove an
assessment contribution cites `מטלות הקורס`, delivery cites `אופן ההוראה`, and
unknown disclosure names both possible evidence fields.

Focused project GREEN passes 25/25; composition/priority/Generate/real-corpus
regressions pass 12/12 suites and 241/241 tests. Full API passes 179/179 suites
and 2448/2448 tests in 210 seconds. A temporary local full-handler probe
(removed) honestly found no recommendation change in the current real scenario:
all three alternatives contain the same course-id set, and the section-scoped
corpus lacks a connected complete group universe, so safe aggregation leaves
project score zero. The objective was active and coverage was disclosed; no
fixture, catalog, or safety rule was changed to force impact. Root tsc and final
diff gates pass. No UI/data change, provider call,
Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 15) — B23. B22 repaired future acquisition,
but the immutable local evidence objects had already been parsed under the old
rule: their `labeledFields` lacked `מטלות הקורס`, even though their normalized
visible text still retained the official heading, value, disclaimer, and next
field boundary. Without a read-time compatibility path, the product's frozen
snapshot would remain at the historical 0-known assessment result until a
network reacquisition.

The first RED passes a legacy-shaped `SyllabusDocument` through the real
extractor and failed with `project: unknown`. A narrow fallback now runs only
when the structured field is absent and reads only a standalone official
`מטלות הקורס` heading through the disclaimer/next-field boundary. A second RED
placed the same wording in course prose before the real section and caught an
initial overclaim (`true` instead of the official section's false); anchoring
the heading to its own line made that case GREEN. No content-description prose
is mined and all ordinary absence semantics remain unknown.

`FEATURE_EXTRACTION_VERSION` is now 1.2.0. A temporary read-only probe (removed
immediately afterward) measured the actual ignored local corpus at 21/23
documents with known project/exam/coursework state across all 18 distinct
courses, versus the historical report's 0. It made no network call and wrote no
cache/catalog data. Focused extractor GREEN passes 21/21; the evidence/source/
ranking/real-corpus boundary passes 9/9 suites and 160/160 tests. Full API
passes 179/179 suites and 2445/2445 tests in 229 seconds. Root tsc and final
diff gates pass. No UI or data file changed. No paid/
provider call, Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 14) — B22. Phase A.2 reliability tracing found
a concrete parser defect behind the prior acquisition report's 0-known
assessment result. TAU's official syllabus cells wrap ordinary values in
`span`, but render `מטלות הקורס` values such as `פרוייקט`, `בחינה סופית`, and
`דוח מעבדה` as direct text nodes before a generic disclaimer paragraph.
`extractLabeledFields` retained spans only, so the authoritative field was
absent from `SyllabusDocument` and `RuleBasedFeatureExtractor` correctly but
unhelpfully returned unknown.

The RED exercises the real acquisition→document→feature-extractor path using
that official DOM shape. It failed with `project: unknown` instead of true.
The parser now uses direct cell text only when no span value exists, removes a
marked disclaimer block before normalization, and otherwise preserves the
same unknown/absence semantics. It does not mine course prose, infer a topic,
or affect planning legality. `FEATURE_EXTRACTION_VERSION` advanced from 1.0.0
to 1.1.0 so derived evidence/snapshots cannot masquerade as old extraction.

Focused GREEN passes 19/19; source/applicability/project-ranking/composition
coverage passes 7/7 suites and 142/142 tests. Full API passes 179/179 suites
and 2443/2443 tests in 199 seconds; root `tsc --noEmit` and final diff gates
pass. No UI or catalog/data file changed. No
paid/provider call, network acquisition, Production, Vercel, Supabase, `main`,
or stash change._

_Previous entry: 2026-08-24 (cont. 13) — B21. Phase A.6 realistic-scenario
coverage now includes the degree-completion boundary against the frozen real
Mechanical Engineering 2027 program. The full native handler request reports
all twelve unique mandatory identities plus four real authoritative elective
category representatives as completed. AcademicProgress recognizes all
sixteen identities once, keeps identity-free aggregate completion from
creating course-specific consequences, closes every real requiring category,
and leaves no future planned course in any retained or fallback candidate.

The acceptance test passed on first execution in 111ms. This is meaningful
evidence that the shared academic-progress, remaining-requirement, validator,
and candidate paths already handle the boundary correctly; no production
defect was manufactured and no product code was changed. The realistic
handler matrix passes 4/4 scenarios in ~26s, including advanced combined,
near-graduation, mid-degree, and fully-completed students. Full API passes
179/179 suites and 2442/2442 tests in 196 seconds; root `tsc --noEmit` and
`git diff --check` pass. No UI code changed, so the B8 web/build/legacy
baseline remains applicable. No paid/provider call, network acquisition,
catalog/data mutation, Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 12) — B20. Profiling after B19 showed the
remaining deterministic hotspot was not validation itself but repeated setup:
`PlannerWorker` already builds one authoritative `PlanValidationContext`, yet
`greedyComplete` called `validatePlanState` without it for every candidate in
every lookahead step. Each call rebuilt legal-semester, prerequisite, load-cap,
completed/current and pinned-course facts from the same immutable model.

A call-budget RED builds the real context first, spies on the authoritative
offering resolver, and runs one non-myopic estimate. The two-course fixture
requires six legal-placement resolver calls; before the fix it made fourteen,
with eight additional calls caused solely by repeated context construction.
`greedyComplete` and `estimateFinalScore` now accept an optional typed context,
and `PlannerWorker` passes its existing `_validationCtx`. Direct callers remain
backward-compatible and still build a context when they do not own one. No
validation result is cached or skipped: every generated next state still runs
`validatePlanState` and `validatePlanProposal`; only their immutable input
context is reused.

RED observed 14 resolver calls; GREEN observes the six action-enumeration calls
only. Focused lookahead/worker/validator/candidate/real-handler coverage passes
7/7 suites and 130/130 tests. The real mid-degree handler fell from ~20s to
~11.5s and the complete three-scenario matrix from ~42s to ~27s. Full API
passes 179/179 suites and 2441/2441 tests in 211 seconds versus 322 seconds at
B19 and 580 seconds before the two performance slices (about 64% less overall);
root `tsc --noEmit` and `git diff --check` pass. No UI code changed, so the B8
web/build/legacy baseline remains applicable. No paid/provider call, network
acquisition, catalog/data mutation, Production, Vercel, Supabase, `main`, or
stash change._

_Previous entry: 2026-08-24 (cont. 11) — B19. Phase A quality profiling found a
user-visible deterministic latency problem rather than an external-provider
delay: the real mid-degree handler required six bounded candidate runs and took
~75 seconds. Each deviation worker starts from the same state and shares a long
greedy prefix, but every worker recomputed `estimateFinalScore` for identical
placement states. The search budget, validator, maxRuns, alternatives and
ranking were all legitimate; reducing them would have traded recommendation
quality for speed.

A call-budget RED creates two workers over the same immutable model/state with
a request-scoped memo. Both choose the same real action, but before the fix the
second worker repeated all seven pure lookahead rollouts (14 calls total). The
worker now canonicalizes the academic placement (sorted semester ids and
course ids, plus rollout depth), caches the deterministic score, and accepts a
shared cache explicitly scoped to one request/model. Candidate generation owns
one such cache and passes it to every baseline/deviation worker; it is never
global, never shared across requests or policies, and stores no user data after
the call returns. A candidate-set regression proves every placement state is
rolled out at most once across all deviations. No search branch, validator,
score vector, candidate identity or ordering rule changed.

RED observed 14 calls where 7 were sufficient; GREEN performs no new calls in
the second worker and selects the byte-identical action. Focused worker,
candidate, multi-combination and real-handler coverage passes 65/65. The real
mid-degree scenario fell from ~75s to ~20s; the complete three-scenario matrix
from ~128s to ~42s. Full API passes 179/179 suites and 2440/2440 tests in 322
seconds versus 580 seconds immediately before this slice (about 44% less wall
time); root `tsc --noEmit` and `git diff --check` pass. No UI code changed, so
the B8 web/build/legacy baseline remains applicable. No paid/provider call,
network acquisition, catalog/data mutation, Production, Vercel, Supabase,
`main`, or stash change._

_Previous entry: 2026-08-24 (cont. 10) — B18. B17's rejected fixture assumption
exposed a real defensive-accounting gap worth isolating. The typed
`currently_planned_hours` contract says the aggregate represents only
currently-taking/planned entries absent from the submitted board. An
older/fabricated client can nevertheless send a non-zero aggregate while its
only status course is already visibly placed. Generate previously counted the
course once through `placedHours` and again as identity-free
`aggregateOnlyHours`, letting stale input close the degree gap early and
producing a false explanation that anonymous hours had been added.

A handler RED places `CURRENT_3H`, also reports it as currently taking, and
sends a stale 3h aggregate. It failed with `inProgressHours:3` and
`aggregateOnlyHours:3`. The first GREEN attempt subtracted every placed status
course from the aggregate, but the broader shortfall suite correctly failed
two existing cases where the aggregate belonged to a different off-board entry
whose per-course hours were absent. The final bounded rule follows the actual
contract: the aggregate residual is eligible only when at least one status
entry is off-board; known hours of those off-board entries are subtracted as
before. If every status entry is already placed, the aggregate has no eligible
provenance and contributes zero. This neither invents a course identity nor
erases compatible off-board credit.

RED failed 1/7 with duplicate anonymous credit; focused GREEN passes 7/7. The
combined in-progress/degree-gap boundary passes 31/31, including both unrelated
off-board aggregate controls. Full API passes 179/179 suites and 2438/2438
tests in 580 seconds; root `tsc --noEmit` and `git diff --check` pass. No UI
code changed, so the B8 web/build/legacy baseline remains applicable. No paid/
provider call, network acquisition, catalog/data mutation, Production, Vercel,
Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 9) — B17. Phase A.6 realistic-scenario
coverage now includes a mid-degree student against the frozen Mechanical
Engineering 2027 program. The request authoritatively reports mandatory
courses `0512-1204` and `0542-2400` completed (7.5 catalog hours), real
prerequisite course `0542-4621` currently taking (3 hours), 90 aggregate
completed hours, and no elective-category completion. AcademicProgress keeps
all four requiring pools open and derives course-specific consequences only
from the two recognized completed identities and the recognized current-study
identity.

The first test draft intentionally exercised the harder on-board/current-study
case and failed because its expectation treated a course already visible in
the board as a new future proposal. Tracing the validator established the real
contract: an unchanged currently-taking placement remains visible and cannot
be moved or re-added; it is not advance-credited a second time. The fixture was
therefore corrected rather than changing production semantics. In the valid
mid-degree flow, every retained candidate excludes both completed mandatory
courses and the off-board currently-taking prerequisite, and includes each of
the ten remaining unique mandatory course identities (with the annual course
deduplicated by identity). This is a full handler/real-program acceptance gate;
existing shared progress, remaining-requirement and authoritative validation
paths already satisfy it, so no production code changed.

The focused academic-progress matrix passes 4/4 suites and 53/53 tests; the
real-student matrix passes 3/3. Full API passes 179/179 suites and 2437/2437
tests in 590 seconds; root `tsc --noEmit` and `git diff --check` pass. No UI
code changed, so the B8 web/build/legacy baseline remains applicable. No
paid/provider call, network acquisition, catalog/data mutation, Production,
Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 8) — B16. Phase A.6 coverage audit found only
one complete-student acceptance against the frozen Mechanical Engineering 2027
program: B9's advanced student had already closed all four requiring pools. A
second real native-handler scenario now represents a near-graduation student
with the fluids, solids and systems core pools authoritatively completed, 181
known aggregate completed hours, three currently-taking hours, and the real
advanced-laboratory pool still open. The aggregate closes only the degree-hour
total; it creates no lab-course identity or category contribution.

The user hard-excludes real lab `0581-4131`. AcademicProgress truthfully reports
`מעבדות מתקדמות` remaining 1 with no satisfying completion. Every retained
plan excludes `0581-4131`, all three completed core ids and currently-taking
`0542-4621`, while including another course from the frozen authoritative lab
membership (`0542-4391`, `0542-4624`, `0542-4093`, or `0542-4094`). The request
is legal, complete and unblocked. This is an acceptance gate, not a manufactured
production RED: current shared academic-progress, category reservation, hard-
constraint and validator paths already satisfy it, so no production code was
changed.

The focused real scenario matrix passes 2/2. Full API passes 179/179 suites and
2436/2436 tests in 532 seconds; root `tsc --noEmit` passes. No UI code changed,
so the B8 web/build/legacy baseline remains applicable. No paid/provider call,
network acquisition, catalog/data mutation, Production, Vercel, Supabase,
`main`, or stash change._

_Previous entry: 2026-08-24 (cont. 7) — B15. A real-handler equal-importance RED
used the existing two-plan project-versus-robotics trade-off. The Hebrew text
correctly said no legal alternative excelled on every confirmed preference and
that the system used equal weights, but source disclosure contained only the
selected project course `E2`. It omitted the official robotics document for
comparison course `E3`, even though the per-objective explanation used that
plan to establish the trade-off.

Generate now uses the same comparison selection as the text for every
composition reason. Explicit priority still uses B13's informative
non-primary-advantage selector. Equal importance, single objective, canonical
tie and other non-priority reasons use the same first available legal
non-dominated comparison already consumed by `explainGroundedComposition`.
`groundedSources` combines only selected and actually compared contributions,
then applies the existing course/source/year deduplication. In the real RED it
now exposes exactly `E2` and `E3`; no unrelated `E1`/`E4`, unknown evidence,
dominated candidate or full candidate-set source dump is added. Ranking,
recommendation, alternatives, priority policy and Apply remain unchanged.

RED failed with only `E2`; GREEN discloses exactly `E2`,`E3`. Focused equal-
importance/priority explanation coverage passes 32/32. Full API passes 179/179
suites and 2435/2435 tests in 514 seconds; root `tsc --noEmit` passes. No UI
code changed, so the B8 web/build/legacy baseline remains applicable. No paid/
provider call, network acquisition, catalog/data mutation, Production, Vercel,
Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 6) — B14. A real-handler RED exposed a split
truth after B13: the Hebrew explanation correctly said that another legal plan
was stronger on the project objective, but `groundedSources` contained only
the selected robotics course `E3`. It omitted `E2`, whose official delivery
evidence was the sole basis for the comparative project claim. Selected-plan
provenance alone cannot support a statement about another plan.

The informative-alternative selector is now a shared deterministic function
used by both explanation text and source disclosure. Generate still passes
only valid non-dominated candidate-set members. For an explicit priority,
`groundedSources` contains the selected candidate's cited documents plus the
chosen comparison candidate's actual contributing documents, deduplicated by
course/source/year. It does not add all candidate sources, dominated-plan
sources, unknown evidence or unrelated catalog records. Existing one-document-
used-by-two-objectives deduplication remains green. No wire shape changed; the
existing lean source array is more complete. Ranking, recommendation, cards,
snapshot, candidate identity and Apply remain unchanged.

RED failed because the project comparison named `E2` in meaning but disclosed
only source course `E3`; GREEN includes `E2`. Focused explanation/provenance
coverage passes 32/32. Full API passes 179/179 suites and 2435/2435 tests in 489
seconds; root `tsc --noEmit` passes. No UI code changed, so the B8 web/build/
legacy baseline remains applicable. No paid/provider call, network acquisition,
catalog/data mutation, Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 5) — B13. Audit found that Generate passed only
the first non-selected candidate into `explainGroundedComposition`. With three
legal alternatives, that card can tie the recommendation on every relevant
secondary objective while a later available card is genuinely stronger on one;
the explanation then truthfully named the explicit primary priority but hid the
surviving trade-off. A provenance-complete RED supplies a recommended topic
leader, a first legal topic tie and a later project leader. It failed because
the later alternative was ignored.

The explanation contract now accepts all available legal non-dominated
objective-score sets. For explicit priority it chooses the candidate with the
largest positive advantage on any non-primary objective (reversing the
direction for the existing avoid-topic objective), using input order only as a
deterministic exact-tie fallback. Generate supplies only other validated,
non-dominated candidate-set members; dominated or unavailable plans cannot be
described as remaining selectable. The chosen comparison is reused by every
per-objective sentence and the explicit-priority trade-off sentence. Ranking,
candidate retention, recommendation, cards and Apply are unchanged. Reversing
alternative order yields byte-identical explanation text when one alternative
has the stronger material trade-off.

RED failed 1/14 with the later project trade-off omitted; GREEN passes 14/14.
Focused composition/priority/alternative coverage passes 96/96. Full API passes
179/179 suites and 2435/2435 tests in 514 seconds; root `tsc --noEmit` passes.
No UI code changed, so the B8 web/build/legacy baseline remains applicable. No
paid/provider call, network acquisition, catalog/data mutation, Production,
Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 4) — B12. A behavioral RED started from a
valid, already-complete two-course baseline. One authoritative robotics course
and one authoritative materials course could replace the two neutral courses;
either one-course swap improved one confirmed objective, but only the legal
two-course combination improved both. The existing completed-baseline path
explored one elective replacement at a time and generic worker deviations
could not advance a plan whose degree target was already met, so the dominating
combined plan was absent.

Grounded discovery now builds deterministic one- and two-replacement proposals
when at least two grounded objectives participate. Both use the same pure
mutations, hard/policy model, authoritative validator and existing `maxRuns`
budget; no candidate bypasses validation and the product retention bound stays
unchanged. Pair construction is itself bounded to the first canonical
placement of at most `2 × maxRuns` unique single-swap course sets, preventing a
catalog-sized Cartesian expansion that validation could never consume. Course,
evidence-map and objective order reversal returns the same candidate identities
and order. Three independently grounded courses competing for two slots prove
that all three materially distinct pair combinations remain Pareto alternatives
rather than collapsing into pairwise cycles or dominated filler.

RED failed 1/26 with the combined plan absent; GREEN passes 26/26. Eight direct
composition/priority/proposal/Apply suites pass 147/147. The frozen real-corpus
materials regression passes and still retains the authoritative alternative
`0581-4131`. Full API passes 179/179 suites and 2434/2434 tests in 996 seconds;
root `tsc --noEmit` passes. No UI code changed, so the B8 web/build/legacy
baseline remains applicable. No paid/provider call, network acquisition,
catalog/data mutation, Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 3) — B11. An exhaustive four-course audit
found a deterministic counterexample at the real product bound: two topic
objectives had four reachable legal Pareto plans, but discovery stopped after
the first three valid identities and retained one dominated plan, exposing
only two frontier cards. The behavioral RED uses one materials-leading and one
robotics-leading course and proves that all three retained cards can be
non-dominated without changing the hard constraints or the three-card limit.

Grounded-objective discovery is now bounded by `maxRuns`, not by the first
`maxCandidates` identities. After authoritative validation and normal scoring,
retention computes dominance only among candidates with the same hard/policy
prefix. Within that prefix, non-dominated plans precede dominated plans and the
first plan for each canonical grounded-contribution signature precedes
redundant variants; legality, completion, mandatory/category requirements, hard
wanted/avoided constraints and confirmed distribution policy remain ahead of
all soft diversity. Generic/no-objective discovery preserves its previous
early stop. Ordering is deterministic by normalized identity and canonicalized
objective/course/feature/topic contributions.

The focused RED is GREEN at 25/25. The existing real-corpus regression initially
caught an over-broad frontier-first draft because all three retained variants
used the same selected materials course and hid authoritative alternative
`0581-4131`; contribution-diverse retention restored it, and the real handler
test passes 1/1. Root `tsc --noEmit` passes. Full API passes 179/179 suites and
2433/2433 tests. No UI code changed, so the B8 web/build/legacy baseline remains
applicable. No paid/provider call, network acquisition, catalog/data mutation,
Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont. 2) — B10. Read-only syllabus audit reconfirmed
that the frozen official corpus has delivery mode 23/23 and substantive content
23/23, but assessment/learning-outcome/skills fields remain 0/23. Topic mapping
already uses every unambiguous phrase in the corpus; the seven topic-empty
courses have no source wording that supports a new topic, and the remaining 18
ambiguous tokens are deliberately not promoted. No regex, objective or catalog
fact was invented to inflate coverage.

The next authoritative Phase A.3 source is the catalog prerequisite graph. A
real-handler RED proved a split truth: completing `PRE` legally admitted `ADV`,
but AcademicProgress exposed no prerequisite contribution or explanation. The
typed result now carries canonical `completedCourseId → unlockedCourseIds`
facts only when the completed identity is recognized and the dependent's entire
authoritative prerequisite set is satisfied. The fact enters the academic-
progress digest and lean disclosure; Hebrew explanation uses authoritative
catalog names. Duplicate/input order is inert, partial prerequisite sets unlock
nothing, and conflicting mappings produce a typed conflict and no inference.
The real Mechanical regression proves `0542-4621` unlocks only `0542-4624`.

A second handler RED found a more serious existing defect: reporting an unknown
`GHOST` id as completed made a hard-wanted dependent with prerequisite `GHOST`
legal. A third RED proved the same through `currently_taking`. The model now
keeps raw unknown completed ids in the academic disclosure/audit, but gives
course-specific hard consequences only to ids resolved in the server catalog.
Unknown currently-taking entries may retain explicit/aggregate hour credit but
cannot satisfy prerequisites or mandatory requirements. Existing recognized
currently-taking and completed flows remain green. Focused progression/hard-
constraint suites and full API 179/179 suites, 2432/2432 tests pass; root
`tsc --noEmit` passes. No UI code changed, so the B8 web/build/legacy baseline
remains applicable. No provider, network acquisition, catalog/data mutation,
Production, Vercel, Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 (cont.) — B9. A full native-handler acceptance uses
the frozen `mechanical_engineering_2027.json` program, not a synthetic planner
fixture. It reports four authoritative completed electives — one in each real
requiring pool — plus `0542-4621` currently taking, whose real catalog record is
the prerequisite for hard-wanted `0542-4624`; hard-excluded `0542-4425` is also
a positively grounded materials course. The response recognizes exactly 13
completed hours and 3 in-progress hours, closes all four category requirements
with the correct course ids, admits the wanted successor, excludes the grounded
but prohibited course, and never re-proposes a completed/current course in any
retained plan. Alternatives, when present, share one constraint fingerprint,
profile version and evidence snapshot. The test first failed because it asked
the intentionally lean client disclosure for the private `recognizedCourseIds`
field; existing E6 contracts explicitly prohibit exposing that server detail.
The corrected behavioral assertion uses recognized count/hours, category
contributions and rendered plans. It then passed with no production-code fix,
providing Phase A realistic-scenario coverage rather than fabricating a RED.
Focused 1/1 and full API 178/178 suites, 2424/2424 tests are green; root
TypeScript verification is recorded with the commit below. This slice changes
no production or UI code, so the parent B8 web/build/legacy evidence remains
the applicable product baseline.
No provider, network acquisition, catalog/data mutation, Production, Vercel,
Supabase, `main`, or stash change._

_Previous entry: 2026-08-24 — B8. A full-handler RED started with 5 authoritative
completed hours, an 8h target, a real 3h off-board `planned` entry and one
legal 3h filler. Generate reported a valid response but still added the filler:
the final shortfall gate knew about planned credit, while search did not. GREEN
adds typed model-level `inProgressHours`, computed once before search. It
credits an unplaced currently-taking course from authoritative catalog hours
(or explicit entry hours), an explicit off-board planned course the planner
cannot place, and only the bounded residual of a compatible aggregate. A
currently-taking course already visible on the board is counted by placement
only; an in-catalog planned course receives no advance credit and remains
placeable; duplicate status ids collapse; aggregate-only credit creates no
course/category/prerequisite fact; insufficient aggregate credit still causes
real planning. `degreeHours`, candidate search, validation, shortfall recovery
and response shaping now consume the same total, removing the old response-only
arithmetic and its double-count risk. The disclosure separates currently-taking
hours (used for planning but not claimed completed), off-board planned hours,
and identity-free aggregate residual. Six real-handler paths prove no filler,
no re-proposal, no double count, placeable-planned behavior, aggregate honesty
and insufficient-credit behavior. Focused 324/324, full API 2423/2423, web
186/186, legacy scope guard 12/12, both tsc and production build are green; the
immediately preceding parent has full legacy 835/835 and B8 changes no UI.
No provider, network acquisition, catalog/data mutation, Production, Vercel,
Supabase, `main`, or stash change._

_Previous entry: 2026-08-23 (cont. 6) — B7. A realistic full-handler RED started
with 5 authoritative completed hours, an 8h degree target, one still-required
3h category course, and a legal 4h filler. Generate incorrectly returned both
courses (12h) instead of the exact category course (8h). Isolation found two
independent causes. First, `buildModel` passed an absent coarse aggregate as
zero and thereby erased the 5 hours already recognized from the completed
course id. It now uses `max(authoritatively recognized hours, explicit
aggregate)`: the aggregate may supplement totals, but still creates no course,
category, prerequisite, or exclusion fact. Second, g1 reserved remaining
mandatory hours but not remaining category-course hours. It now subtracts a
safe lower bound: the cheapest reachable course hours for each unmet slot in
pairwise-disjoint requiring pools, excluding hours already reserved by a
mandatory/hard-included course. Overlapping pools return zero reservation
rather than inventing allocation policy; impossible/excluded pools likewise do
not reserve forever and remain the validator's explicit incompleteness. The
real Generate path now returns only the 3h category course, recognizes 5+3=8,
marks the requirement satisfied and is not blocked. Candidate/category order
is invariant, hard exclusions remain absolute, and all retained paths still use
the authoritative validator. Focused 141/141 plus 340/340, full API 2412/2412,
web 186/186, legacy 835/835, both tsc and production build are green. No
provider, network acquisition, catalog/data mutation, Production, Vercel,
Supabase, `main`, or stash change._

_Previous entry: 2026-08-23 (cont. 5) — B6. RED through the real Generate handler
proved that `academic_interest_profile.courseStylePreferences.project_based`
was collected but left the canonical `E1+E2` recommendation unchanged even
when a distinct valid project-led `E3` alternative existed. GREEN maps only
the already-supported official delivery modes: `project_based` composes as
`prefer_project_courses`, and `lab_based` as `prefer_laboratory_courses`.
Positive structured weights participate through the existing generic Pareto
composition; an existing typed delivery objective keeps its authoritative
provenance. Zero-weight and unsupported `practical`, `exam_light`,
`math_heavy`, `theoretical`, and `industry_relevant` styles remain inert rather
than creating guessed objectives. Real-handler tests prove project and lab
selection changes, unsupported inputs do not, hard course exclusion still
wins, and flag-off remains unchanged. Focused 192/192, full API 2405/2405,
full web 186/186, and legacy scope guard 12/12 are green. No provider, network
acquisition or catalog/data mutation._

_Previous entry: 2026-08-23 (cont. 4) — B5. RED proved that the product collected
`academic_interest_profile.avoidAreas=[materials]` but kept the canonical plan
containing a course with affirmative official materials evidence. GREEN adds
the generic `avoid_topic_exposure` soft objective. Its utility is `1 - proven
exposure / candidate-topic slots`: an affirmative avoided-topic match lowers
the score, while missing evidence and an evidenced non-match tie at neutral 1,
so sparse coverage is never rewarded. It composes through the existing Pareto,
equal-importance and explicit-priority machinery and only affects candidates
that already tie on legality/hard/policy terms. Hard wanted inclusion still
wins; flag-off is unchanged; duplicate course/evidence cannot multiply the
penalty. A topic present in both focus and avoid is removed from both and
surfaced as `conflicting_grounded_topic`, including clearing legacy objective
metadata. The explanation says only that no official exposure was found and
explicitly warns that syllabus silence is not proof of absence. No provider,
network acquisition or catalog/data mutation._

_Previous entry: 2026-08-23 (cont. 3) — B4. RED proved that a normalized
`academic_interest_profile.focusAreas=[materials]` answer left the selected
course set at `E1+E2`, while the equivalent free-text and typed-conversation
answers could select evidence-backed `E3`. GREEN normalizes the untrusted
structured profile once and merges its positive-weight focus areas through the
same ontology adapter and composed grounded objective. Structured provenance is
distinct (`structured_academic_profile`); zero weight and unsupported broad
areas remain inert; typed provenance remains authoritative on overlap. Real
handler proofs show the structured answer changes selection, hard exclusion of
the favored course still wins, and flag-off remains unchanged. No new objective,
topic id, provider call, network acquisition or catalog/data mutation._

_Previous entry: 2026-08-23 (cont. 2) — B3. RED through the real Generate handler
proved that “אני רוצה להתמקד בחומרים” was recognized by `PlanningIntent` but
did not reach grounded ranking: the selected set stayed `E1+E2` despite official
materials evidence on `E3`. GREEN adds a small ontology adapter from the
existing `AcademicFocusArea` vocabulary to the existing `TopicId` vocabulary
and composes the resulting topic objective with any typed objective already in
the preference profile. Typed provenance wins on overlap; topic ids are unioned
canonically; duplicate/input order is inert. The frozen real Mechanical 2027
board/cache acceptance now changes the recommendation from the free-text
materials request, selects the evidence-backed materials plan and labels the
2025 historical source. `intentOutcome` now reuses the selected candidate's
actual grounded contributions, so it cannot call an honored focus unmet; when
the normalized topic fact has no stored excerpt it links the official source
instead of fabricating a quote. Hard exclusions still win. `biomechanics`, `energy` and
`general` remain unsupported/inert rather than being guessed. No provider,
network acquisition or catalog/data mutation occurred._

_Previous entry: 2026-08-23 (cont.) — B2. Real-corpus measurement found the
retained alternatives had identical course sets, so a descriptive preference
could not change the recommendation even when valid evidence existed. The
generic bounded swap search fixes that root cause without bypassing legality.
On the frozen real Mechanical Engineering 2027 board/cache, a materials
preference changes the selected plan and adds `0542-4425` using labeled 2025
materials evidence; `0581-4131` remains a distinct legal alternative. The
robotics-favored `0542-4624` remains correctly blocked because prerequisite
`0542-4621` is missing. Reversed catalog/evidence order is invariant, an
evidence-equivalent heavier distractor loses, and a hard-excluded favored
course is never reintroduced. No provider or external acquisition was invoked;
no catalog/source data was changed._

_Previous entry: 2026-08-23 — B1. The B0 year gap is now an explicit product
policy rather than an accidental exact-year dead end. RED→GREEN proved the
policy on real TAU course id `0542-3792`, then proved through the real Generate
handler that 2025 descriptive evidence can change a 2027 topic recommendation.
Flag-off and callers that do not opt in remain exact-year and inert._

_Previous entry: 2026-08-19 (cont. 2) — B0. A read-only coverage audit through the
REAL loader/extractor/`prepareEvidence`. Delivery mode is 23/23 and already
used; assessment is 0/23 (re-rejected on ~3x the corpus K8A rejected it on);
skills/learning outcomes are 0/23 because the official page has no such field;
topics map 15/23. Nothing was built: with coverage at 0/56 no parser could
change a real recommendation, and closing the year gap needs acquisition or an
explicit freshness decision, not code._

_Previous entry: 2026-08-19 (cont.) — A1. E0 found one precise asymmetry in the
SHARED requirement accounting: `missingMandatory` filtered on completion,
`unsatisfiedCategories` did not. Fixed at the source, in one place. Category
allocation was proven unnecessary and no clarification question was added._

_Previous entry: 2026-08-19 — S0–S5: Apply became server-authoritative, with an
anonymous server-issued session, a CAS board repository and an idempotent
commit. Browser/HTTP acceptance 17/17._

_Previous entry: 2026-08-18 — C5. The student can say WHICH objective matters
more, and it changes the recommendation. An impact-driven priority question,
asked only when the answer would genuinely move the recommendation, routed
through the real conversation state machine. Browser checks 13–15 PASS, so the
comparison acceptance is 19/19._

_Previous entry: 2026-08-15 (cont. 2) — C0 proved only one of several validated
non-dominated plans reached the user; C1 exposes a bounded, filtered,
deterministic alternative set; C2 derives factual labels and differences; C3/C4
add the comparison UI, selection without regeneration and Apply of the selected
alternative; C6 covers RTL/keyboard/mobile/reduced-motion. C5 was NOT
implemented then — it is now._

_Previous entry: 2026-08-15 (cont.), session on branch `ui/frontend-modernization`
(**Grounded objectives now COMPOSE — no precedence.** A confirmed topic AND a
confirmed project preference both reach ranking, and the candidate satisfying
both is selected. Sixteen-check multi-objective browser acceptance PASSING.
API 160/2177, UI 78/835, web 17/142, both tsc and the production build green.
**Not merged, not deployed.**)_

_Previous entry: 2026-08-15 (cont.) — M0 reproduced the precedence loss as a lost
plan; M1 resolves an objective SET; M2 normalizes each objective to a comparable
[0,1]; M3 evaluates Pareto dominance before aggregation; M4 composes by a
documented equal-importance default and reports real trade-offs instead of
hiding them; M5 proves all seven objective combinations generically; M6/M7
compose the explanation and thread lean metadata to the UI. **Next slice: the
priority-clarification question — trade-offs are reported but not yet asked
about.**_

_Previous entry: 2026-08-15 — W1 wired `topicQuestionImpact` through the real
typed journey; W2 exposed the impact-driven topic question in the real
conversation; W3 made the explanation state the limitation of the RIGHT
objective; one browser-found defect fixed (an indifferent answer rendered its
internal token). **Next epic: composable multi-objective preference
optimization — recorded below and NOT started.**_

_Previous entry: 2026-08-14 (cont. 5) — T1 group-universe normalizer; T2 bounded
acquisition (16 requests, 15 acquired) and the content-source coverage matrix;
T3 normalized topic model; T4 typed topic-interest preference; T5 REAL
selection change; T6 impact-gated question, server side only and deliberately
NOT exposed pending browser acceptance. API 156/2104, UI 78/835, both tsc and
the production build green. **Not merged, not deployed.**_

_Previous entry: 2026-08-14 (cont. 4)
(K8A measured official coverage per candidate objective and K8 shipped the
SECOND grounded objective, `prefer_project_courses`, on 8/8 delivery-mode
coverage and its own selection-change proof. Topic alignment (1/7 courses, 0
distinguishing pairs) and assessment (0/8) were REJECTED on the evidence, and
timetable DEFERRED for lack of section-level selection. K8 has no browser
acceptance of its own — see that section.)_

_Previous entry: 2026-08-14 (cont. 3)
(K9A/B/C wired the grounded objective into the LIVE handler, conversation and
explanation; K5 freshness/conflict; K6 durable cache; K7 bounded live acquisition
(8/12); **K7.5 fixed a real semantic defect the live run exposed — one group can
no longer label a whole course**. API 149/1964 green.)_

_Previous entry: 2026-08-14 (cont. 2), session on branch `ui/frontend-modernization`
(KnowledgeCapability epic STARTED and proven end to end for one narrow chain:
official academic source → versioned evidence → normalized course features →
confirmed soft objective → **the selected candidate actually changes**. K0 also
closed the pytest test-isolation defect. Five commits: K0 `4b404a0`, K1
`d64f7f6`, K2 `bf01627`, K3 `76cf1c5`, K4 `bd812a7`. API 143/1862 green.
**Not merged, not deployed.** Remaining KnowledgeCapability slices K5–K10 are
listed below and are still required before the product is complete.)_

_Previous entry: 2026-08-14 (cont.), session on branch `ui/frontend-modernization`
(Slice 18A/18B: the wanted/avoided pickers are now HARD `must_include` /
`must_exclude` constraints enforced by a validation GATE, unsatisfiable requests
return a typed deterministic `infeasible` outcome instead of a degraded plan,
`balanced`/`compact` are user policies rather than alternatives, and the candidate
set now holds multiple genuinely different LEGAL course/period combinations found
by a bounded deterministic deviation of the SAME stable planner. Build green, API
139/1790 green, web 12/102 green. **Not merged, not deployed.** The mandatory
KnowledgeCapability sequence is recorded below and is required before the product
can be called complete.)_

_Previous entry: 2026-08-08, session on branch `ui/frontend-modernization`
(protected enrichment LIVE RUN executed after owner unblocked `workflow`
scope + `OPENAI_API_KEY`: workflow merged to `main` via PR #80, run
31251292816 performed a genuine `gpt-4o-mini` invocation, artifact
validated and grounded — but **no cache promotion is committable** (cache
homogeneity invariant + partial/failed/over-classified results), so the
committed cache stays `captured` unchanged. `semantic-only planner decision
acceptance: data-blocked` retained. All gates green. Production unchanged;
Vercel not Git-connected; no preview. See newest session section below.)._

### S1–S5 — the implementation

Five commits: S0 `c53b6dc`, S3/S4 `d557ea5`, S1 `9ac7f28`, S2 `9c0bb8e`,
S5 `f7870f4`.

**The RED.** `tests/api/server_apply_authority.test.ts` states the gap as a
capability against the real handler rather than as a missing module: a
successful Generate must hand back a handle the server can later resolve. It
failed on `proposal` being undefined, and on no session cookie being issued.
Both now pass. One fixture correction was needed first and is worth recording,
because it was a real product fact rather than a workaround: without the
completed-course knowledge marker the handler correctly answers
`clarification_required`, so there is no proposal to be authoritative about.

**S3/S4 — ownership and the repository (`d557ea5`).** Ownership is an opaque
256-bit id the SERVER issues, in an HttpOnly/SameSite=Lax cookie. It
deliberately does not reuse `anonymous_sessions.session_token`, which the client
picks. Verified in-browser: `document.cookie` is empty, so script cannot read
the ownership key.

`BoardRepository` mints versions (`bv_<n>`) and nothing else may; `commit` is
compare-and-swap; idempotency is checked BEFORE the CAS, because a legitimate
retry still carries the pre-apply version and a naive CAS would reject every
retry. The same key replaying the same work returns the original result with no
second mutation, and the same key carrying DIFFERENT work is a deterministic
conflict — otherwise "retry" would be a way to smuggle a second mutation
through. `decideCommit`/`nextRecord` hold the decision as a pure function, so
both adapters run the identical suite.

**S1 — the proposal record (`9ac7f28`).** Generate now retains what it decided:
validated candidates with their complete plans, the owner, base board version,
profile version, an academic-status digest, the constraint fingerprint and the
snapshot. The client gets a receipt of ids and versions; a test asserts it
contains no `courseIds`/`semesterId` at all. Supersession is scoped to the same
owner AND program, proven in both directions.

**S2 — `POST /api/ai/apply-plan` (`9c0bb8e`).** The client names a proposal and
a candidate; the server resolves the plan from its own record. A plan in the
body is REFUSED rather than ignored — silently dropping it would let a caller
believe they had influenced the commit.

**S5 — the journey (`f7870f4`).** Apply is a real round-trip with a pending
state; the committed board is replaced only with what the server returns, and
only after success. Mount loads the catalog and the committed board together.
Three existing journey suites were migrated to a `serverApplyStub` that enforces
the same rules the endpoint does — a stub that echoed the request back would let
them pass while the client was still the source of truth.

### Contracts

**Apply request** (everything absent is deliberate): `program_id`,
`proposal_id`, `candidate_id`, `expected_board_version` (nullable),
`expected_profile_version`, `idempotency_key`, `academic_status`. Schema is
`.strict()`.

**Reason codes:** `INVALID_REQUEST`, `PROPOSAL_NOT_FOUND`, `PROPOSAL_EXPIRED`,
`PROPOSAL_SUPERSEDED`, `SESSION_MISMATCH`, `CANDIDATE_NOT_IN_PROPOSAL`,
`CANDIDATE_NOT_APPLYABLE`, `PROFILE_VERSION_MISMATCH`,
`ACADEMIC_STATUS_MISMATCH`, `BOARD_VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`.
`SESSION_MISMATCH` returns the same 404 shape as a genuine not-found, so a
stranger cannot confirm another session's proposal exists.

### Browser / HTTP acceptance

Preview: API `scripts/dev_api_server_alternatives_preview.ts` on :3002 with
`SYLLO_BOARD_STATE_DIR=.runtime/board-state`; `next dev` on :3001. Ports
verified free before and after; runtime data removed afterwards.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Session established | PASS | `Set-Cookie: syllo_owner` HttpOnly, 43-char opaque value; `document.cookie` empty in-browser |
| 2 | Board loads from the server repository | PASS | `GET /api/ai/apply-plan?program_id=…` → `storage: file` |
| 3 | Generate returns a proposal id | PASS | `prop_ea15d867-…`, candidateIds ×3, `baseBoardVersion: null` |
| 4 | Comparison shows the stored alternatives | PASS | 3 radios matching the receipt's candidate ids |
| 5 | Selecting sends no Generate/Apply | PASS | network count unchanged at 2 across two selections |
| 6 | Apply names ids, not a plan | PASS | jest asserts the body has no `courseIds`/`semesterId`; endpoint `.strict()` refuses one |
| 7 | Server returns the updated board/version | PASS | `OK v=bv_1` |
| 8 | The NON-default alternative commits | PASS | on-disk record holds `cand_f49f0d08` = E1/E3, not the recommended E1/E2 |
| 9 | **Refresh preserves the board** | PASS | a fresh page load shows E1+E3 from the server — the exact thing that was lost before this epic |
| 10 | Duplicate Apply is idempotent | PASS | second identical request → `replayed=True`, still `bv_1` |
| 11 | Fabricated candidate id rejected | PASS | 409 `CANDIDATE_NOT_IN_PROPOSAL` |
| 12 | Stale proposal rejected | PASS | 409 `PROFILE_VERSION_MISMATCH`; changed status → 409 `ACADEMIC_STATUS_MISMATCH` |
| 13 | Another session cannot load or apply | PASS | 404 `SESSION_MISMATCH`; session B's GET returns `board: null` |
| 14 | Concurrent stale-base cannot overwrite | PASS | two racing Applies → one `OK bv_1`, one `BOARD_VERSION_CONFLICT`; a later stale attempt also rejected with `currentBoardVersion: bv_1` |
| 15 | Network failure leaves the board unchanged | PASS | covered in `NativePlannerJourney.serverapply.test.tsx` (throwing transport → board untouched, retryable) |
| 16 | RTL / live regions / console / mobile | PASS | `dir=rtl`, 2 live regions, 0 console errors, 0px horizontal overflow |
| 17 | No external/paid provider | PASS | every resource origin `http://localhost:3001`; `DATABASE_URL=unset` |

**Process restart.** The API process was killed and restarted mid-run; the
committed board read back unchanged at `bv_1`. Proposals are in-memory by
design and do not survive that — a restart costs one Rebuild, whereas losing a
committed board would look like data loss.

**One driving artifact, recorded rather than hidden.** An early browser Apply
produced no request at all. The cause was mine, not the product's: I clicked an
answer and Build in the same tick, so the Build captured the profile before the
answer landed and the proposal was correctly stale — Apply was properly
disabled with the stale note shown. Re-driven one step per tick, it committed.

### Production readiness — classified separately

| Item | Status |
|---|---|
| Server-authoritative Apply | **implemented** |
| Session ownership (anonymous) | **implemented** |
| Local Preview persistence | **implemented** (file adapter, survives refresh and process restart) |
| Production durable adapter | **NOT implemented** — no vendor chosen, per the brief |
| Authentication | **NOT implemented** |
| Cross-device persistence | **NOT implemented** (out of scope without auth) |
| Secrets / env configuration | **required** — a durable store's connection settings |
| Migrations | **required** — no table exists for board state or proposals |
| Deployment verification | **required** |

**The branch is not Production-ready.** Both configured adapters are
in-process or local-filesystem, and a Vercel function has neither shared memory
nor a durable filesystem — so on a real deployment a proposal written by the
Generate invocation may simply not exist for the Apply invocation, and a
committed board may not survive at all. `productionStorageConfigured()` returns
false so this is queryable rather than assumed.

**The remaining Production storage/auth decision, stated exactly.** Postgres is
already this project's database (`postgres` npm client, four Alembic
revisions), so adopting it introduces no new vendor. What it needs: (1) a
migration creating a session-owned board-state table and a proposal table —
board state keyed by `(owner_id, program_id)` with a version column and a
unique constraint enabling the CAS as a single conditional UPDATE, plus an
apply-receipt table for idempotency; (2) a `PostgresBoardRepository` /
`PostgresProposalStore` implementing the existing interfaces; (3) a decision on
retention for anonymous data; (4) whether authenticated accounts arrive at the
same time, since that changes the owner column from "session id" to "session id
or user id". None of it was done here because an untested SQL adapter plus an
unrun migration would be a durability claim this session cannot support.


## Session 2026-08-18 — C5: choosing WHAT MATTERS, not just which plan

Two code commits: P1 `ba94fff`, P2–P4 `e2a9b34`, plus this record.

### P0 — the gap, proved as a missing decision rather than a missing export

C1–C4 already told the student the truth: several validated plans exist, they
trade off, and `unresolvedTradeoff: true`. What they could not do was ACT on it.
Picking a card showed the other plan but expressed nothing durable — it could
not survive a Rebuild, because nothing recorded WHY it was picked.

The RED is deliberately behavioural. It drives the real
`DeterministicPreferenceElicitation` + `ConversationState` with every impact
signal the handler actually emitted, tries every answer the state machine will
accept (bounded, 8 questions deep), and asks the PRODUCTION resolver whether any
reachable profile carries an explicit relative priority. It found none — and so
no reachable conversation state could move the recommendation onto the
topic-leading plan. Both assertions failed; both now pass.

### P1 — the impact contract (`ba94fff`)

`computePriorityQuestionImpact` returns the impacted objective ids, their
localized names, the current recommendation, and — the point of the whole thing
— **the recommendation under every possible answer**, computed by replaying the
real ranking (`compareRankable`) over the already-retained candidates. Nothing
is re-planned and no evidence is re-acquired, so the prediction is made by the
same function that will decide the next Rebuild. The suite verifies this by
rebuilding against the real handler for each option and comparing.

**The gate is eight conditions, and the decisive one is that an unresolved
trade-off is NOT sufficient.** A fixture where a third candidate leads on one
objective and ties on the other has a genuine trade-off and still produces no
question, because every possible answer recommends the same plan. Proven again
in-browser: hard-excluding E3 leaves TWO alternatives and still no question.

The UI is handed `eligible` and gates on that alone — never on two alternatives
existing, on `unresolvedTradeoff`, on the objective vectors, or on card order.

### P1 ranking mechanics — extracted, not duplicated

`objectiveRankKey` groups objectives into TIERS by explicit weight, each tier
contributing its own equal-importance mean:

- no priority => one tier => `[mean(vector)]`, exactly the previous
  `composedUtility` — which is why 591 existing tests were untouched by the
  refactor;
- one primary => `[primary, mean(rest)]` — the prioritized objective decides and
  the rest only break ties among candidates equal on it.

This is a deliberate refusal to invent a numeric trade rate. A student picking
one option out of a list has not stated how many topic-matches a project course
is worth, and a weighted mean would have silently fabricated one.

`compareRankable` is now THE ranking order in one place, and the impact contract
calls it too, so a prediction cannot drift from the ranking. The
hard/legality/policy prefix is still compared FIRST — which is why a priority
can never trade away completion, legality, a hard wanted/avoided course, a
workload cap or the distribution policy.

### P2 — the generic priority (`e2a9b34`)

The `priority` field on `ResolvedObjective` was DEAD: it read a property no
`Preference` ever carried. It is now completed generically — the answer is a
preference whose value is a stable objective id, or `equal_importance`. No
`topic_over_project`, no pairwise vocabulary, and therefore no representable
cycle; a third objective needs no new field.

It is honoured only when it names an objective active in THIS request. A
priority left over from a preference the student has since removed describes a
trade-off that no longer exists, and is inert rather than an error (proven).

**One equal-importance option, no separate "doesn't matter".** Both would
produce the identical product state — the documented equal-importance
composition — and two labels for one outcome would misrepresent it as a choice.
Explicit equal importance is still a real answer: recorded, closes the question,
and different from silence.

### P3 — the real state machine

The question is an ordinary `DEFAULT_QUESTION_CATALOG` entry (impact 0.55, so
the existing higher-impact questions are asked first — condition 8 for free).
Its options come from the server contract; its `relevantWhen` reads `eligible`.

No comparison-card questionnaire and no UI-only priority state. Had the answer
lived in the cards it could not have survived the Rebuild that gives it its only
effect — which is precisely the capability P0 proved was missing.

### P4 — what it may and may not change

Proven against the real handler: topic priority recommends the topic-leading
plan, project priority the project-leading one, laboratory travels the identical
generic path, equal importance restores the equal-mean policy exactly
(`equal_confirmed_preferences`, no `prioritySource`), exact ties still fall to
canonical identity, and **hard-excluding the single course carrying the
prioritized topic still wins outright**. A workload cap still binds.

The explanation now names the objective the student chose, says THEY chose it,
names the legal alternative still stronger on the other objective, and states
that all displayed alternatives meet the same hard requirements. It still never
claims the recommended plan is objectively better.

### Browser acceptance — checks 13–15

API `scripts/dev_api_server_alternatives_preview.ts` on :3002 (PID 36140) pinned
to `data/evidence_fixtures/alternatives_preview`; `next dev` on :3001 (PID
63128). Ports verified free before and after. Snapshot `snap_0efbc0eb`.
Completed-course status resolved by explicitly saving an empty completed set
(the fixture's genuine state), exclusions by the explicit "none" control
(`aria-pressed=true`) — neither left UNKNOWN.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 13 | Priority question gating | PASS | Exactly ONE question (1 fieldset, 1 text occurrence); options `קורסים מבוססי פרויקט` / `תחום התוכן: רובוטיקה` / `שניהם חשובים לי באותה מידה`; 3 alternatives still visible and enabled; no internal id anywhere in the DOM |
| 13 | No question when it cannot decide | PASS | 1 objective => contract ABSENT; E3 hard-excluded => **2 alternatives and `eligible=false`**; no objectives => ABSENT; builds #1/#2 asked nothing |
| 13 | Selecting a card is not answering | PASS | Selected alternative 2: Generate 3→3, question still asked, captured preferences unchanged, draft swapped to E1/E3 |
| 13 | Unanswered priority does not block Apply | PASS | Apply enabled with the question open; arrow-key selection also worked with no Generate |
| 14 | Answering does not Generate | PASS | Generate count 3 → 3 |
| 14 | Profile version advances | PASS | 6 → 7, observed in the next Generate payload |
| 14 | Whole set stales, every Apply inert | PASS | All 3 radios `disabled`, Apply disabled, 3 distinct stale notices |
| 14 | Stale cards cannot restore Apply | PASS | Forced `click()` + synthetic `MouseEvent` + arrow key on every card: Apply stayed disabled |
| 14 | Committed board unchanged | PASS | Board still empty; explicit Rebuild required |
| 15 | Exactly one Generate on Rebuild | PASS | delta = 1 |
| 15 | Request carries everything | PASS | All 5 earlier confirmed preferences + `objective_priority` = `prefer_topic_alignment`, at version 7 |
| 15 | Recommendation changes as predicted | PASS | Contract predicted `cand_f49f0d08`; the rebuild recommended `cand_f49f0d08` (`{E1,E3}`), and the rendered draft is E1/E3 |
| 15 | One constraint fingerprint / snapshot | PASS | `cf_b4054a49bfce8db1`, `snap_0efbc0eb`, profileVersion 7 — single-valued across all alternatives; all non-dominated and applyable |
| 15 | Explanation cites the priority | PASS | Names רובוטיקה, "ציינת ש… חשוב לך יותר", the project-leading alternative that remains stronger, and the shared requirements |
| 15 | Valid Apply commits once | PASS | Committed E1+E3, draft cleared, Apply control removed, no Generate |
| 15 | Equal importance restores equal composition | PASS | Fresh journey: answering equal importance then rebuilding recommended `cand_dfb0ec29` (`{E1,E2}`) with reason `equal_confirmed_preferences` and no `prioritySource` |

**Accessibility.** Real `<button>`s inside a labelled `role="group"` with a
`<legend>`; focus lands on them and a `focus-visible` ring is declared; RTL
confirmed; selected state carries the text markers `נבחר`/`לא נבחר`, never
colour alone; the stale set is announced through the existing
`role="status" aria-live="polite"` region; at 375px there is **0px** horizontal
overflow, options wrap onto 3 rows fully inside the viewport, and the cards
stack to one column; no option animates (`animation-name: none`) and the cards'
only transition is `motion-safe:`. 0 console errors. Every network origin was
`http://localhost:3001` — no internet, no provider.

**Two honest limitations of the harness, not the product.**

1. The Browser pane again stopped compositing, so screenshots and the
   accessibility tree were unavailable; evidence is DOM, network and console —
   recorded as such, exactly as the previous session did.
2. Keyboard ACTIVATION of an option could not be exercised. Traced rather than
   assumed: the keydown is `isTrusted: true` and reaches the focused button with
   `key: "Enter"`, but no click follows, because the driver's dispatch lacks the
   metadata Chrome needs to synthesize a button's default activation. That key
   events DO reach handlers was proved in the same session — `ArrowLeft` moved
   the radiogroup selection AND focus, RTL-correct. So this is a driver gap; the
   product side is a native `<button>`, and jsdom covers activation.

## MANDATORY NEXT EPIC — Apply authority (audited, NOT implemented)

Recorded per this session's brief. Nothing here was changed.

**Current ownership.** Apply lives entirely in `NativePlannerJourney`:
`setCurrent(applyGeneratedToBoard(applyTarget, current))`. It is React state.

**Is there server persistence?** No, and the boundary was traced rather than
guessed:

- `api/board.ts` is GET-only and hard-rejects every other method (line 108).
- `api/ai/plan_persistence.ts` exists but provides only `InMemoryPlanRunStore` /
  `InMemoryPersistenceCapability`, and its ONLY importer is its own test — it is
  wired to no route.
- Directly observed this session: after a successful Apply the board showed
  E1+E3; a page reload restored the server's GET board and the applied plan was
  gone.

**What is trusted from the client.** The client resolves the selected candidate
id against the CURRENT response and refuses unknown or non-applyable ids, and
`isProposalApplyable` gates on blocked/errors/staleness/profile version. All of
that is client-side. The server never sees an Apply at all.

**Threat / correctness implications, stated precisely.** This is **not** a
security vulnerability today, and should not be described as one: there is no
server-side plan state, no user accounts and no cross-user data, so fabricated
client state can only mislead the tab that fabricated it. `session_token` is a
client-generated UUID used solely for quota counting against
`anonymous_sessions`; it authenticates nobody and is never verified. The real
defect is a PRODUCT one: "החל תוכנית" promises a commitment the system does not
make, and the plan is lost on reload. The moment any server-side persistence,
sharing or account exists, the same client-trusted path becomes a genuine
integrity problem — which is why this decision must precede persistence rather
than follow it.

**Authentication / user persistence.** Also absent. There is no login, no user
id, and no per-user storage anywhere in `api/`.

**Required before Production — a decision, then an implementation:** either
(a) an authoritative server-side Apply contract that re-validates candidate id,
normalized identity, constraint fingerprint, snapshot and profile version
against a server-held plan run, and persists per authenticated user; or (b) an
explicit, documented product decision that the committed board is intentionally
local-only — in which case the UI must stop implying otherwise.

## Session 2026-08-23 — B1: typed descriptive-syllabus freshness policy

**Decision.** An official syllabus may describe a later catalog offering only
when it is exact-year or no more than two academic years earlier. Exact-year
evidence always wins. A prior-year document is usable only inside
`prepareEvidence`, which owns descriptive topic/delivery evidence; it cannot
alter the board/model facts that own legality, prerequisites, credits, category
membership, mandatory status or offering availability.

**Fail-closed cases.** Future year, more than two years old, invalid/missing
year, unresolved authoritative conflict, and absence of the explicit policy all
remain inert. When several prior years are eligible, the newest is selected
independently of document order. Every historical course id and source year is
disclosed; the handler adds a concise Hebrew notice naming source year, target
catalog year, and the administrative limitation.

**RED→GREEN.** `descriptive_evidence_freshness_policy.test.ts` first failed
because no typed policy existed, then failed behaviorally because a 2025
official syllabus produced no feature for target 2027. The handler RED in
`topic_impact_wire.test.ts` retained 10 passing controls and failed only because
the 2025 corpus could not distinguish 2027 candidates. GREEN wires the named
two-year policy into the flagged Generate evidence boundary. Unit coverage uses
the real TAU course id `0542-3792`; the handler fixture proves recommendation
impact but is not represented as the complete real board.

**Verification.** Focused evidence/ranking/composition: 170/170. Full API:
173 suites / 2,373 tests. Root `tsc --noEmit`, web `tsc --noEmit`, and Next
production build all exit 0. No catalog/data file changed; no acquisition,
runtime planning-provider call, Production, `main`, Vercel, Supabase or stash
mutation occurred.

**Next smallest ordered step.** Run a deterministic acceptance over the frozen
local 2025 corpus and the real 2027 Mechanical board, measuring which retained
candidates and questions become decision-relevant under B1. Then improve only
the evidenced extraction/mapping gaps that can change that real result; do not
widen vocabulary speculatively.

**B2 acceptance follow-up (2026-08-23).** The frozen local cache contains 23
documents / 18 distinct courses, all year 2025. A regression now loads that
cache through B1 against the real handler universe (repository courses **plus**
courses already present in board semesters) and proves every relevant document
is retained, every distinct course is marked historical, source year remains
2025, and no conflict is fabricated. This caught an audit/handler boundary
difference: the B0 report's repository-only universe excluded five cached
course ids that the handler's `model.profiles` can include. No production code
changed in this follow-up. The next proof is candidate/question impact through
the real handler, not another coverage count.

## Session 2026-08-19 (cont. 2) — B0: syllabus/evidence coverage audit

One commit: `93ffc5f`. **No capability was implemented, deliberately** — the
audit's job was to decide what may be built, and it decided "not yet, and not
this".

### The traced path

`scripts/acquire_official_syllabi.ts` (bounded, out-of-band, allowlisted to
`ims.tau.ac.il`) → `api/ai/evidence_cache.ts` (content-addressed store under
git-ignored `data/evidence_cache/`) → `api/ai/evidence_loader.ts`
(`loadPreparedEvidenceDocuments`, cache-only, **no transport of any kind**, so a
Generate can never trigger acquisition) → `api/ai/evidence_provider.ts`
(`prepareEvidence`: relevance → **exact academic-year match** → conflict filter
→ feature/topic extraction → coverage) → `api/ai/course_features.ts`
(`RuleBasedFeatureExtractor`) and `api/ai/course_topics.ts`
(`extractCourseTopics`) → `api/ai/grounded_objectives.ts` (scoring) →
`grounded_objective_set.ts` (composition) → `candidate_set.ts` (ranking) →
explanation.

### The measurement (`data/import_reports/syllabus_coverage_audit_2027.json`)

Corpus: 23 documents, 18 distinct courses, **all academic year 2025**, 0
group-scoped (content is course-scoped — a multi-group course publishes an
identical content section per group, confirming the earlier
`topic_coverage_matrix` conclusion).

| | at catalog year **2027** | at corpus year 2025 |
|---|---|---|
| covered / requested | **0 / 56** | 13 / 56 |
| stale | 13 | 0 |
| conflicting | 0 | 0 |
| features map | 0 | 13 |
| topics map | 0 | 13 |

Of the **17** courses in requiring categories, only **5** have any document.

Per field, over 23 documents:

| field | coverage | verdict |
|---|---|---|
| `deliveryMode`, `laboratory`, `projectDelivery` | 23/23 | **planning-grade** (already used) |
| content section present | 23/23 | — |
| topics mapped | 15/23 (18 phrases left unmapped) | explanation-grade at best |
| `prerequisiteText` | 15/23 | evidence only — program data stays authoritative |
| assessment: `project` / `finalExam` / `coursework` | **0/23** | **absent** |
| learning outcomes / skills | **0/23** | **absent from the source itself** |

Labels the official page actually publishes: `מספר קורס`, `שם הקורס`, `יחידה
אקדמית`, `אופן ההוראה`, `שעות סמסטריאליות`, `סמסטר`, `מרצה`, `קורסי קדם נדרשים`
(15/23), `קורסים מקבילים` (1/23), plus contact/room fields. There is **no**
learning-outcome or skills field — that capability cannot be built at any
effort from this source.

### Why nothing was implemented

The binding constraint is **year alignment, not parsing**. With coverage at
0/56 on the real program, no parser improvement, vocabulary entry or new
objective could change a real recommendation — which is exactly the bar this
epic set before allowing any of them. Correcting the year gap requires either
acquisition of 2027 documents (out of scope here, and 2027 syllabi are very
likely unpublished) or an explicit product decision on whether a 2025 syllabus
may describe a 2027 offering. Neither is a decision to make silently in code.

The system's behaviour under this gap is already honest: `coverageSufficient`
is false, so no grounded question is asked and no fact is claimed. The problem
is not incorrectness — it is that a whole capability family is **dead in the
field while appearing implemented**, and until now that was not measured
anywhere.

### Accepted / rejected

- **Accepted, already shipped:** delivery-mode facts (23/23) — the only
  planning-grade family in this corpus.
- **Rejected, re-confirmed:** assessment parsing. 0/23, now on nearly 3× the
  corpus the K8A audit rejected it on (0/8).
- **Rejected, unbuildable:** skills / learning outcomes. The source has no such
  field.
- **Deferred, not rejected:** topic-vocabulary widening (15/23 mapped, 18
  ambiguous phrases). It is a real gap, but it cannot change a recommendation
  while coverage is 0/56, and widening a vocabulary against ambiguous Hebrew
  phrases without that feedback loop risks inventing topics.

### Exact sources used

`data/boards/mechanical_engineering_2027.json` →
`metadata.program_repository_courses` (universe, 56) and
`metadata.program_requirements_categories` (requiring pools, 17 courses);
`data/evidence_cache/` (23 documents, git-ignored, regenerable). Nothing was
mutated.

### Recorded, not fixed

Planner over-allocation (issue #25 Finding #4) remains live: g1 (degree hours)
outranks g2b (category satisfaction) lexicographically, so the hours budget can
be spent on a course that satisfies no remaining requirement. Any fix is a
GOAL_STACK design decision with its own RED→GREEN proof.


## Session 2026-08-19 (cont.) — A1: authoritative completed-elective recognition

Two commits: recognition `cbaaff8`, disclosure + integration `df5a50f`.

### E0 — the traced path, and the one asymmetry in it

| # | Question | Answer at HEAD |
|---|---|---|
| 1 | Completed standard courses | `plan_context.personal_status.completed[].course_id` → `buildConstraintModel` → `model.completedCourseIds` (`planner_model.ts:81`). |
| 2 | Completed electives | The SAME field. There is no separate elective channel; `CompletedCoursesPanel` merges its elective picker into one `completed` list, so dedup only has to happen once. |
| 3 | `known_completed_hours` | `total_hours_progress.known_completed_hours`, used by `completion_analysis` for the 185 ש"ש narrative only. It creates no course identity and now provably cannot satisfy a category. |
| 4 | Did completed ids contribute to elective categories? | **No — the defect.** `CategoryReq.required` was the program's full `min_courses`, and `categoriesSatisfied`/`assessCompleteness` counted only courses PLACED in the plan state, which `planContextToState` strips completed courses from. |
| 5 | One course satisfying multiple categories | Not possible in the real data (pools disjoint — proven). Now explicitly handled as `ambiguous`, contributing to none. |
| 6 | Requirement unit | `min_courses` — a COUNT of courses. Degree hours are a separate `total_required_hours` (185). Asserted for every requiring category. |
| 7 | Prerequisites | Already correct: `model.completedCourseIds` is consulted directly by the prerequisite engine (`planner_goals.ts:205, 450, 544, 639`) and by `plan_validation.ts`. Untouched by this epic. |
| 8 | Exclusion from proposals | Already correct: `planContextToState` drops them, action enumeration skips them (`generate-plan.ts:937, 1038`), and the validator rejects re-scheduling. |
| 9 | Unknown ids | Already inert for hours; now explicitly typed `unresolved` and reported rather than silently absent. |
| 10 | Same accounting for validation and scoring? | **Yes** — both go through `policy.assessCompleteness`, which is why fixing it once fixed both. |
| 11 | Generic or TAU-specific? | Generic. `buildConstraintModel` reads only board metadata; the new engine reads only typed requirements. |
| 12 | Authoritative data | `data/boards/<program>.json` → `metadata.program_requirements_categories` (`total_required_hours`, and per category `category_id` / `name_he` / `min_courses` / `course_ids`) plus `metadata.program_repository_courses` for catalog hours. Nothing else. |

The precise asymmetry, in one place: `missingMandatory` filtered on
`completedCourseIds`; `unsatisfiedCategories` did not.

### E1/E2 — one recognition, consumed by everything

`api/ai/academic_progress.ts` computes recognition once.
`buildConstraintModel` derives BOTH `categories[].required` (now the REMAINING
minimum) and `priorHours` from it, so the scorer, the authoritative validator
and the explanation cannot disagree. No parallel accounting model was added.

Rules, each proven: duplicates collapse before anything can count them twice; an
unknown id credits nothing and satisfies nothing but is still reported (unknown
is not "not completed"); a recognized course with unknown catalog hours credits
nothing rather than a guess; a course in no requiring pool credits hours but
satisfies no category; membership in a `min_courses: 0` bucket is neither a
contribution nor an ambiguity; an aggregate hours figure never becomes an
identity.

### E3 — proven unnecessary, and therefore omitted

The categories that actually require something have **pairwise disjoint pools**
in the real TAU Mechanical data. Membership is FIXED — not exclusive
allocation, not student-selectable, not optimization-dependent. A deterministic
allocation layer would have been inventing a rule this program does not have,
so none was built. The disjointness is now a committed regression test, so a
catalog update that breaks the assumption surfaces there rather than silently.

For a future program that does overlap: a course claimed by two requiring pools
is typed `ambiguous` and contributes to NEITHER. Over-crediting could let
someone believe a requirement is met that the program never said was met;
under-crediting is recoverable and is surfaced.

### E7 — no clarification added, deliberately

A question is only legitimate when two authoritative interpretations genuinely
remain. With disjoint pools no course can be ambiguous, so for this program
there is nothing to ask. Adding a question would have manufactured a decision
the rules already make. None was added.

### Verification

API **2356/2356** (171 suites), web **186/186**, legacy UI **835/835**, both
`tsc --noEmit` clean, production build green. Python **1232 passed / 33 failed**
— identical to baseline and unrelated (missing sqlite fixture; legacy-viewer
assertions from the known dead-code issue). No catalog, `data/`, alembic,
script or viewer file changed.

### Found, reported, NOT patched

- **Planner over-allocation (issue #25 Finding #4) is still live and is now
  easier to see.** In a fixture whose degree total is exactly two courses, a
  student who completed one still receives a two-course plan: g1 (degree hours)
  outranks g2b (categories) lexicographically, so the hours budget can be spent
  on a course satisfying no remaining requirement, and the required category
  course then lands on top. The existing `remainingMandatoryHours` reservation
  fixes exactly this class for mandatory courses; the category analogue does not
  exist. Deliberately NOT changed here — it is a GOAL_STACK design decision with
  its own tracked issue, and bundling it would have hidden a real behavioural
  change inside a recognition epic.
- No missing authoritative category mapping was found: every course id in every
  requiring pool resolves against the real catalog (asserted).

## Product roadmap (ordered; nothing below is implemented unless stated)

**Phase A — finish the AI product for the current program**
1. Authoritative completed-elective recognition — **this epic, done**.
2. Broader and more reliable syllabus extraction.
3. Evidence-backed mapping of courses to topics, skills and academic progression.
4. Stronger multi-combination search and diversity.
5. Better recommendation, trade-off and explanation quality.
6. Coverage/acceptance over realistic complete student scenarios.
7. AI product readiness decision.

**Phase B — site and manual planner**
1. AI journey UI/UX refinement.
2. Site architecture cleanup.
3. Full manual planning: add, remove, move and arrange courses without AI.
4. Shared validation between manual and AI planning.
5. Mobile, RTL, accessibility and browser acceptance.

**Phase C — next academic program.** TAU Electrical Engineering through a new
authoritative program model and dataset, without branching the core algorithm.

**Phase D — commercialization.** Authentication and user accounts; cross-device
persistence; privacy/data-retention decisions; usage metering; payment provider
and billing; AI-assistant access policy; production observability, support and
abuse controls.

**Phase E — expansion.** Additional degrees and universities through
program/source adapters, coverage gates and authoritative validation.


## Session 2026-08-19 — S0–S5: authoritative server Apply, board persistence, session ownership

### S0 — inventory (traced, with file/function evidence)

| Area | Finding |
|---|---|
| `api/board.ts` | GET-only (`_handle`, line 108 rejects every other method). Serves the **program CATALOG** (`program_versions.board_json`) — per-program, read-only, identical for every visitor. It is **not** a user board, so it must never be mutated by Apply. |
| Local JSON fallback | `api/ai/board_loader.ts:loadLocalBoardJson` reads `data/boards/<programId>.json`. Used when `DATABASE_URL` is unset or the query throws. Tracked catalog data — never user storage. |
| `plan_persistence.ts` | `InMemoryPlanRunStore` / `InMemoryPersistenceCapability` only. Its sole importer is `tests/api/plan_persistence.test.ts`; wired to no route, and its own header says it is deliberately not durable. Records `AgentResult`s, not boards — wrong shape for this epic. |
| DB adapters / schema | `postgres` (npm) used directly in `api/board.ts:queryBoardJson` and `api/ai/_quota.ts`. Alembic heads: `a1b2c3d4e5f6` (initial), `b2c3d4e5f6a7` (board_json), `c3d4e5f6a7b8` (quota), `d4e5f6a7b8c9` (planner_runs). |
| Existing user tables | `users`, `user_profiles`, `user_completed_courses`, `user_course_plans`, `plan_semesters`, `plan_courses` all exist — but every one is `user_id UUID NOT NULL REFERENCES users(id)`. **Unusable anonymously**, and no code writes to any of them. |
| Existing session table | `anonymous_sessions (session_token TEXT UNIQUE, credits_used, credits_paid)` — quota only. Its token is **chosen by the client** (`localStorage` `tau_ai_session`, `NativePlannerJourney.sessionToken()`), so it is an ownership key an attacker can simply pick. Not reusable as an ownership boundary. |
| `DATABASE_URL` | Read in `api/board.ts:126`, `api/ai/generate-plan.ts:1399`, `api/ai/planner-run.ts:96`. Absent ⇒ documented local fallback / dev bypass. No migration exists for a board-state or proposal table. |
| Serverless constraints | `vercel.json` builds each `api/**` entry as its own `@vercel/node` function. No shared process memory across invocations, and no durable local filesystem — module-level state and `/tmp` are per-instance and evictable. Any production adapter must be external. |
| Session/cookie utilities | **None.** Repo-wide search for `cookie` / `Set-Cookie` / `HttpOnly` in `api/`, `shared/`, `web/` returns only unrelated comments in `scripts/acquire_official_syllabi.ts`. |
| Authentication | **None.** No login, no token verification, no user id anywhere in `api/`. |
| Proposal ownership | **None.** `generate-plan` returns candidates and retains nothing; `candidateOrchestration` is built and discarded with the response. |
| Board/version fields | `metadata.board_data_version` → `CatalogRevision` (`shared/planner/model.ts:58-77`). It versions the CATALOG, not a user's committed plan. `ProposalBaseRevision` is the client's captured copy. There is no user-board version at all. |
| Feature flag | `use_academic_decision_agent` (default off). Browser entry only via `/planner/native/agent-preview`, itself gated on `ENABLE_ACADEMIC_AGENT_PREVIEW=1`, so it 404s in Production. |
| API routing | `vercel.json` rewrites `/api/board/:programId` and `/api/ai/*` to root `@vercel/node` functions; everything else to `web/`. Locally, `web/next.config.ts` proxies `/api/*` to `PLANNER_API_ORIGIN` (`scripts/dev_api_server.ts` on :3002). CORS on `/api/(.*)`: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`. |

### Decision matrix

| | A. Client-only | B. Signed stateless token | **C. Anonymous server session** | D. Authenticated user |
|---|---|---|---|---|
| Vercel compatible | yes | yes | yes (needs external store) | yes |
| Durable | no | no (browser-held) | adapter-dependent | yes |
| Survives refresh | **no** (proven) | yes | yes | yes |
| Cross-device | no | no | no (by design) | yes |
| Exactly-once | no | **no** — nothing to dedupe against | yes | yes |
| Stale-write prevention | no | **no** — two holders of v1 both verify | yes (CAS) | yes |
| Privacy | best | whole plan in token; size grows with candidates | opaque id, no PII | real PII |
| Operational cost | none | signing secret + rotation | moderate | high |
| Existing repo support | current behaviour | none | `postgres` client already a dependency | `users` table exists, **zero auth code** |
| New external service | none | none | **none** | would require one |

### Selected: C — anonymous server-owned session

It is the smallest model that is server-authoritative, and the only one of A/B/C
that can express exactly-once and compare-and-swap at all. B was rejected on a
specific technical ground rather than taste: a stateless token can prove the
client did not tamper with a plan, but two concurrent Applies both holding a
token minted at board version *v1* would both verify, so it cannot prevent the
stale write this epic exists to prevent — and it cannot revoke or supersede.

D was not invented: no authentication code exists anywhere in the repository,
and the brief forbids adding an auth provider. C upgrades to D by adding a
nullable `user_id` beside `owner_id` and preferring it when present — no
rewrite of the repository boundary.

**Ownership key.** The existing `anonymous_sessions.session_token` is deliberately
NOT reused as the owner: the client picks that value, so any caller could claim
another caller's proposals. Ownership is a new server-issued opaque id in an
HttpOnly cookie. The quota token keeps its existing, separate job.

### Production persistence: an explicit REMAINING decision

No production-compatible durable store for user board state exists today. Per
the brief, this session implements the repository interfaces, a deterministic
in-memory adapter for tests, and the safest local Preview adapter — and does
**not** silently choose a vendor. Postgres is already this project's database,
so it is the obvious candidate, but shipping an untested SQL adapter plus an
unrun migration would be a durability claim this session cannot support. What a
production adapter needs is recorded below as required work, not as done work.

## Exact next action (current — supersedes the archival block at the end)

1. **The next AI-quality step is a DECISION, not code: does a syllabus from an
   earlier academic year describe a later offering?** The B0 audit below shows
   the whole grounded-evidence family is inert in production (0/56) purely
   because the corpus is year 2025 and the board is 2027. Two legitimate ways
   forward, and both need a human call:
   - acquire 2027 documents (bounded, allowlisted, out-of-band — the existing
     `scripts/acquire_official_syllabi.ts` path), if TAU has published them; or
   - decide explicitly that a recent-but-earlier syllabus may ground a
     descriptive (never legality-bearing) fact, and implement that as a typed
     freshness policy with its own RED→GREEN proof.
   - **Smallest ordered first step once decided:** a RED asserting the intended
     applicability for one real course, then the policy, then a real
     selection-change proof.
2. Do NOT widen the topic vocabulary first. It is a genuine gap (15/23 mapped,
   18 ambiguous phrases) but it cannot change a recommendation while coverage
   is 0/56, and widening it without that feedback risks inventing topics.
3. Planner over-allocation (issue #25 Finding #4) still needs a GOAL_STACK
   design decision — see the A1 section.
4. Production durable persistence + authentication remain the blockers for
   shipping the server Apply. Unchanged.

## Session 2026-08-19 (cont.) — A1: authoritative completed-elective recognition

Two commits: recognition `cbaaff8`, disclosure + integration `df5a50f`.

### E0 — the traced path, and the one asymmetry in it

| # | Question | Answer at HEAD |
|---|---|---|
| 1 | Completed standard courses | `plan_context.personal_status.completed[].course_id` → `buildConstraintModel` → `model.completedCourseIds` (`planner_model.ts:81`). |
| 2 | Completed electives | The SAME field. There is no separate elective channel; `CompletedCoursesPanel` merges its elective picker into one `completed` list, so dedup only has to happen once. |
| 3 | `known_completed_hours` | `total_hours_progress.known_completed_hours`, used by `completion_analysis` for the 185 ש"ש narrative only. It creates no course identity and now provably cannot satisfy a category. |
| 4 | Did completed ids contribute to elective categories? | **No — the defect.** `CategoryReq.required` was the program's full `min_courses`, and `categoriesSatisfied`/`assessCompleteness` counted only courses PLACED in the plan state, which `planContextToState` strips completed courses from. |
| 5 | One course satisfying multiple categories | Not possible in the real data (pools disjoint — proven). Now explicitly handled as `ambiguous`, contributing to none. |
| 6 | Requirement unit | `min_courses` — a COUNT of courses. Degree hours are a separate `total_required_hours` (185). Asserted for every requiring category. |
| 7 | Prerequisites | Already correct: `model.completedCourseIds` is consulted directly by the prerequisite engine (`planner_goals.ts:205, 450, 544, 639`) and by `plan_validation.ts`. Untouched by this epic. |
| 8 | Exclusion from proposals | Already correct: `planContextToState` drops them, action enumeration skips them (`generate-plan.ts:937, 1038`), and the validator rejects re-scheduling. |
| 9 | Unknown ids | Already inert for hours; now explicitly typed `unresolved` and reported rather than silently absent. |
| 10 | Same accounting for validation and scoring? | **Yes** — both go through `policy.assessCompleteness`, which is why fixing it once fixed both. |
| 11 | Generic or TAU-specific? | Generic. `buildConstraintModel` reads only board metadata; the new engine reads only typed requirements. |
| 12 | Authoritative data | `data/boards/<program>.json` → `metadata.program_requirements_categories` (`total_required_hours`, and per category `category_id` / `name_he` / `min_courses` / `course_ids`) plus `metadata.program_repository_courses` for catalog hours. Nothing else. |

The precise asymmetry, in one place: `missingMandatory` filtered on
`completedCourseIds`; `unsatisfiedCategories` did not.

### E1/E2 — one recognition, consumed by everything

`api/ai/academic_progress.ts` computes recognition once.
`buildConstraintModel` derives BOTH `categories[].required` (now the REMAINING
minimum) and `priorHours` from it, so the scorer, the authoritative validator
and the explanation cannot disagree. No parallel accounting model was added.

Rules, each proven: duplicates collapse before anything can count them twice; an
unknown id credits nothing and satisfies nothing but is still reported (unknown
is not "not completed"); a recognized course with unknown catalog hours credits
nothing rather than a guess; a course in no requiring pool credits hours but
satisfies no category; membership in a `min_courses: 0` bucket is neither a
contribution nor an ambiguity; an aggregate hours figure never becomes an
identity.

### E3 — proven unnecessary, and therefore omitted

The categories that actually require something have **pairwise disjoint pools**
in the real TAU Mechanical data. Membership is FIXED — not exclusive
allocation, not student-selectable, not optimization-dependent. A deterministic
allocation layer would have been inventing a rule this program does not have,
so none was built. The disjointness is now a committed regression test, so a
catalog update that breaks the assumption surfaces there rather than silently.

For a future program that does overlap: a course claimed by two requiring pools
is typed `ambiguous` and contributes to NEITHER. Over-crediting could let
someone believe a requirement is met that the program never said was met;
under-crediting is recoverable and is surfaced.

### E7 — no clarification added, deliberately

A question is only legitimate when two authoritative interpretations genuinely
remain. With disjoint pools no course can be ambiguous, so for this program
there is nothing to ask. Adding a question would have manufactured a decision
the rules already make. None was added.

### Verification

API **2356/2356** (171 suites), web **186/186**, legacy UI **835/835**, both
`tsc --noEmit` clean, production build green. Python **1232 passed / 33 failed**
— identical to baseline and unrelated (missing sqlite fixture; legacy-viewer
assertions from the known dead-code issue). No catalog, `data/`, alembic,
script or viewer file changed.

### Found, reported, NOT patched

- **Planner over-allocation (issue #25 Finding #4) is still live and is now
  easier to see.** In a fixture whose degree total is exactly two courses, a
  student who completed one still receives a two-course plan: g1 (degree hours)
  outranks g2b (categories) lexicographically, so the hours budget can be spent
  on a course satisfying no remaining requirement, and the required category
  course then lands on top. The existing `remainingMandatoryHours` reservation
  fixes exactly this class for mandatory courses; the category analogue does not
  exist. Deliberately NOT changed here — it is a GOAL_STACK design decision with
  its own tracked issue, and bundling it would have hidden a real behavioural
  change inside a recognition epic.
- No missing authoritative category mapping was found: every course id in every
  requiring pool resolves against the real catalog (asserted).

## Product roadmap (ordered; nothing below is implemented unless stated)

**Phase A — finish the AI product for the current program**
1. Authoritative completed-elective recognition — **this epic, done**.
2. Broader and more reliable syllabus extraction.
3. Evidence-backed mapping of courses to topics, skills and academic progression.
4. Stronger multi-combination search and diversity.
5. Better recommendation, trade-off and explanation quality.
6. Coverage/acceptance over realistic complete student scenarios.
7. AI product readiness decision.

**Phase B — site and manual planner**
1. AI journey UI/UX refinement.
2. Site architecture cleanup.
3. Full manual planning: add, remove, move and arrange courses without AI.
4. Shared validation between manual and AI planning.
5. Mobile, RTL, accessibility and browser acceptance.

**Phase C — next academic program.** TAU Electrical Engineering through a new
authoritative program model and dataset, without branching the core algorithm.

**Phase D — commercialization.** Authentication and user accounts; cross-device
persistence; privacy/data-retention decisions; usage metering; payment provider
and billing; AI-assistant access policy; production observability, support and
abuse controls.

**Phase E — expansion.** Additional degrees and universities through
program/source adapters, coverage gates and authoritative validation.


## Session 2026-08-19 — S0–S5: authoritative server Apply, board persistence, session ownership

### S0 — inventory (traced, with file/function evidence)

| Area | Finding |
|---|---|
| `api/board.ts` | GET-only (`_handle`, line 108 rejects every other method). Serves the **program CATALOG** (`program_versions.board_json`) — per-program, read-only, identical for every visitor. It is **not** a user board, so it must never be mutated by Apply. |
| Local JSON fallback | `api/ai/board_loader.ts:loadLocalBoardJson` reads `data/boards/<programId>.json`. Used when `DATABASE_URL` is unset or the query throws. Tracked catalog data — never user storage. |
| `plan_persistence.ts` | `InMemoryPlanRunStore` / `InMemoryPersistenceCapability` only. Its sole importer is `tests/api/plan_persistence.test.ts`; wired to no route, and its own header says it is deliberately not durable. Records `AgentResult`s, not boards — wrong shape for this epic. |
| DB adapters / schema | `postgres` (npm) used directly in `api/board.ts:queryBoardJson` and `api/ai/_quota.ts`. Alembic heads: `a1b2c3d4e5f6` (initial), `b2c3d4e5f6a7` (board_json), `c3d4e5f6a7b8` (quota), `d4e5f6a7b8c9` (planner_runs). |
| Existing user tables | `users`, `user_profiles`, `user_completed_courses`, `user_course_plans`, `plan_semesters`, `plan_courses` all exist — but every one is `user_id UUID NOT NULL REFERENCES users(id)`. **Unusable anonymously**, and no code writes to any of them. |
| Existing session table | `anonymous_sessions (session_token TEXT UNIQUE, credits_used, credits_paid)` — quota only. Its token is **chosen by the client** (`localStorage` `tau_ai_session`, `NativePlannerJourney.sessionToken()`), so it is an ownership key an attacker can simply pick. Not reusable as an ownership boundary. |
| `DATABASE_URL` | Read in `api/board.ts:126`, `api/ai/generate-plan.ts:1399`, `api/ai/planner-run.ts:96`. Absent ⇒ documented local fallback / dev bypass. No migration exists for a board-state or proposal table. |
| Serverless constraints | `vercel.json` builds each `api/**` entry as its own `@vercel/node` function. No shared process memory across invocations, and no durable local filesystem — module-level state and `/tmp` are per-instance and evictable. Any production adapter must be external. |
| Session/cookie utilities | **None.** Repo-wide search for `cookie` / `Set-Cookie` / `HttpOnly` in `api/`, `shared/`, `web/` returns only unrelated comments in `scripts/acquire_official_syllabi.ts`. |
| Authentication | **None.** No login, no token verification, no user id anywhere in `api/`. |
| Proposal ownership | **None.** `generate-plan` returns candidates and retains nothing; `candidateOrchestration` is built and discarded with the response. |
| Board/version fields | `metadata.board_data_version` → `CatalogRevision` (`shared/planner/model.ts:58-77`). It versions the CATALOG, not a user's committed plan. `ProposalBaseRevision` is the client's captured copy. There is no user-board version at all. |
| Feature flag | `use_academic_decision_agent` (default off). Browser entry only via `/planner/native/agent-preview`, itself gated on `ENABLE_ACADEMIC_AGENT_PREVIEW=1`, so it 404s in Production. |
| API routing | `vercel.json` rewrites `/api/board/:programId` and `/api/ai/*` to root `@vercel/node` functions; everything else to `web/`. Locally, `web/next.config.ts` proxies `/api/*` to `PLANNER_API_ORIGIN` (`scripts/dev_api_server.ts` on :3002). CORS on `/api/(.*)`: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`. |

### Decision matrix

| | A. Client-only | B. Signed stateless token | **C. Anonymous server session** | D. Authenticated user |
|---|---|---|---|---|
| Vercel compatible | yes | yes | yes (needs external store) | yes |
| Durable | no | no (browser-held) | adapter-dependent | yes |
| Survives refresh | **no** (proven) | yes | yes | yes |
| Cross-device | no | no | no (by design) | yes |
| Exactly-once | no | **no** — nothing to dedupe against | yes | yes |
| Stale-write prevention | no | **no** — two holders of v1 both verify | yes (CAS) | yes |
| Privacy | best | whole plan in token; size grows with candidates | opaque id, no PII | real PII |
| Operational cost | none | signing secret + rotation | moderate | high |
| Existing repo support | current behaviour | none | `postgres` client already a dependency | `users` table exists, **zero auth code** |
| New external service | none | none | **none** | would require one |

### Selected: C — anonymous server-owned session

It is the smallest model that is server-authoritative, and the only one of A/B/C
that can express exactly-once and compare-and-swap at all. B was rejected on a
specific technical ground rather than taste: a stateless token can prove the
client did not tamper with a plan, but two concurrent Applies both holding a
token minted at board version *v1* would both verify, so it cannot prevent the
stale write this epic exists to prevent — and it cannot revoke or supersede.

D was not invented: no authentication code exists anywhere in the repository,
and the brief forbids adding an auth provider. C upgrades to D by adding a
nullable `user_id` beside `owner_id` and preferring it when present — no
rewrite of the repository boundary.

**Ownership key.** The existing `anonymous_sessions.session_token` is deliberately
NOT reused as the owner: the client picks that value, so any caller could claim
another caller's proposals. Ownership is a new server-issued opaque id in an
HttpOnly cookie. The quota token keeps its existing, separate job.

### Production persistence: an explicit REMAINING decision

No production-compatible durable store for user board state exists today. Per
the brief, this session implements the repository interfaces, a deterministic
in-memory adapter for tests, and the safest local Preview adapter — and does
**not** silently choose a vendor. Postgres is already this project's database,
so it is the obvious candidate, but shipping an untested SQL adapter plus an
unrun migration would be a durability claim this session cannot support. What a
production adapter needs is recorded below as required work, not as done work.

## Exact next action (current — supersedes the archival block at the end)

1. **Next AI-quality epic: broader syllabus understanding and evidence-backed
   course→topic/skill/progression mapping** (Phase A.2/A.3 in the roadmap
   below). Not infrastructure, not UI redesign. The recognition engine now has
   a clean authoritative boundary to hang richer course facts off.
   - **Smallest ordered first step:** measure real syllabus-extraction coverage
     per course across the committed corpus and report the gap honestly, before
     adding any new extraction rule — the same "measure, then decide" discipline
     the K8A coverage audit used to REJECT topic alignment and assessment
     parsing on the evidence.
2. Planner over-allocation (issue #25 Finding #4) is still live and is now
   easier to reproduce — see the A1 section's "Found, reported, NOT patched".
   It needs a GOAL_STACK design decision, not a drive-by fix.
3. Production durable persistence + the authentication decision remain the
   blockers for shipping the server Apply. Unchanged by this session.

## Session 2026-08-19 — S0–S5: authoritative server Apply, board persistence, session ownership

### S0 — inventory (traced, with file/function evidence)

| Area | Finding |
|---|---|
| `api/board.ts` | GET-only (`_handle`, line 108 rejects every other method). Serves the **program CATALOG** (`program_versions.board_json`) — per-program, read-only, identical for every visitor. It is **not** a user board, so it must never be mutated by Apply. |
| Local JSON fallback | `api/ai/board_loader.ts:loadLocalBoardJson` reads `data/boards/<programId>.json`. Used when `DATABASE_URL` is unset or the query throws. Tracked catalog data — never user storage. |
| `plan_persistence.ts` | `InMemoryPlanRunStore` / `InMemoryPersistenceCapability` only. Its sole importer is `tests/api/plan_persistence.test.ts`; wired to no route, and its own header says it is deliberately not durable. Records `AgentResult`s, not boards — wrong shape for this epic. |
| DB adapters / schema | `postgres` (npm) used directly in `api/board.ts:queryBoardJson` and `api/ai/_quota.ts`. Alembic heads: `a1b2c3d4e5f6` (initial), `b2c3d4e5f6a7` (board_json), `c3d4e5f6a7b8` (quota), `d4e5f6a7b8c9` (planner_runs). |
| Existing user tables | `users`, `user_profiles`, `user_completed_courses`, `user_course_plans`, `plan_semesters`, `plan_courses` all exist — but every one is `user_id UUID NOT NULL REFERENCES users(id)`. **Unusable anonymously**, and no code writes to any of them. |
| Existing session table | `anonymous_sessions (session_token TEXT UNIQUE, credits_used, credits_paid)` — quota only. Its token is **chosen by the client** (`localStorage` `tau_ai_session`, `NativePlannerJourney.sessionToken()`), so it is an ownership key an attacker can simply pick. Not reusable as an ownership boundary. |
| `DATABASE_URL` | Read in `api/board.ts:126`, `api/ai/generate-plan.ts:1399`, `api/ai/planner-run.ts:96`. Absent ⇒ documented local fallback / dev bypass. No migration exists for a board-state or proposal table. |
| Serverless constraints | `vercel.json` builds each `api/**` entry as its own `@vercel/node` function. No shared process memory across invocations, and no durable local filesystem — module-level state and `/tmp` are per-instance and evictable. Any production adapter must be external. |
| Session/cookie utilities | **None.** Repo-wide search for `cookie` / `Set-Cookie` / `HttpOnly` in `api/`, `shared/`, `web/` returns only unrelated comments in `scripts/acquire_official_syllabi.ts`. |
| Authentication | **None.** No login, no token verification, no user id anywhere in `api/`. |
| Proposal ownership | **None.** `generate-plan` returns candidates and retains nothing; `candidateOrchestration` is built and discarded with the response. |
| Board/version fields | `metadata.board_data_version` → `CatalogRevision` (`shared/planner/model.ts:58-77`). It versions the CATALOG, not a user's committed plan. `ProposalBaseRevision` is the client's captured copy. There is no user-board version at all. |
| Feature flag | `use_academic_decision_agent` (default off). Browser entry only via `/planner/native/agent-preview`, itself gated on `ENABLE_ACADEMIC_AGENT_PREVIEW=1`, so it 404s in Production. |
| API routing | `vercel.json` rewrites `/api/board/:programId` and `/api/ai/*` to root `@vercel/node` functions; everything else to `web/`. Locally, `web/next.config.ts` proxies `/api/*` to `PLANNER_API_ORIGIN` (`scripts/dev_api_server.ts` on :3002). CORS on `/api/(.*)`: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`. |

### Decision matrix

| | A. Client-only | B. Signed stateless token | **C. Anonymous server session** | D. Authenticated user |
|---|---|---|---|---|
| Vercel compatible | yes | yes | yes (needs external store) | yes |
| Durable | no | no (browser-held) | adapter-dependent | yes |
| Survives refresh | **no** (proven) | yes | yes | yes |
| Cross-device | no | no | no (by design) | yes |
| Exactly-once | no | **no** — nothing to dedupe against | yes | yes |
| Stale-write prevention | no | **no** — two holders of v1 both verify | yes (CAS) | yes |
| Privacy | best | whole plan in token; size grows with candidates | opaque id, no PII | real PII |
| Operational cost | none | signing secret + rotation | moderate | high |
| Existing repo support | current behaviour | none | `postgres` client already a dependency | `users` table exists, **zero auth code** |
| New external service | none | none | **none** | would require one |

### Selected: C — anonymous server-owned session

It is the smallest model that is server-authoritative, and the only one of A/B/C
that can express exactly-once and compare-and-swap at all. B was rejected on a
specific technical ground rather than taste: a stateless token can prove the
client did not tamper with a plan, but two concurrent Applies both holding a
token minted at board version *v1* would both verify, so it cannot prevent the
stale write this epic exists to prevent — and it cannot revoke or supersede.

D was not invented: no authentication code exists anywhere in the repository,
and the brief forbids adding an auth provider. C upgrades to D by adding a
nullable `user_id` beside `owner_id` and preferring it when present — no
rewrite of the repository boundary.

**Ownership key.** The existing `anonymous_sessions.session_token` is deliberately
NOT reused as the owner: the client picks that value, so any caller could claim
another caller's proposals. Ownership is a new server-issued opaque id in an
HttpOnly cookie. The quota token keeps its existing, separate job.

### Production persistence: an explicit REMAINING decision

No production-compatible durable store for user board state exists today. Per
the brief, this session implements the repository interfaces, a deterministic
in-memory adapter for tests, and the safest local Preview adapter — and does
**not** silently choose a vendor. Postgres is already this project's database,
so it is the obvious candidate, but shipping an untested SQL adapter plus an
unrun migration would be a durability claim this session cannot support. What a
production adapter needs is recorded below as required work, not as done work.

## Exact next action (current — supersedes the archival block at the end)

1. **Production durable persistence + the authentication decision.** The
   server-authoritative Apply now exists and is tested, but both configured
   adapters are in-process or local-filesystem, so on Vercel a proposal written
   by the Generate invocation may not exist for the Apply invocation. The exact
   decision and the work it implies are written out in the S1–S5 section below.
   - **Smallest ordered first step:** the Alembic migration for a session-owned
     board-state table (`(owner_id, program_id)`, version column, unique
     constraint enabling the CAS as one conditional UPDATE) plus a proposal
     table — then `PostgresBoardRepository` against the EXISTING
     `BoardRepository` interface, with the shared adapter suite in
     `tests/api/board_repository.test.ts` run against it.
   - Do not deploy until `productionStorageConfigured()` can honestly return
     true.
2. C5 (priority clarification) and C0–C6 (Pareto comparison) are complete;
   browser acceptance 19/19 and 17/17 respectively. Nothing open in either.
3. Vercel deploy access and canonical branch reconciliation remain the same
   human decisions recorded in the archival Blockers section. Unchanged.

## Session 2026-08-19 — S0–S5: authoritative server Apply, board persistence, session ownership

### S0 — inventory (traced, with file/function evidence)

| Area | Finding |
|---|---|
| `api/board.ts` | GET-only (`_handle`, line 108 rejects every other method). Serves the **program CATALOG** (`program_versions.board_json`) — per-program, read-only, identical for every visitor. It is **not** a user board, so it must never be mutated by Apply. |
| Local JSON fallback | `api/ai/board_loader.ts:loadLocalBoardJson` reads `data/boards/<programId>.json`. Used when `DATABASE_URL` is unset or the query throws. Tracked catalog data — never user storage. |
| `plan_persistence.ts` | `InMemoryPlanRunStore` / `InMemoryPersistenceCapability` only. Its sole importer is `tests/api/plan_persistence.test.ts`; wired to no route, and its own header says it is deliberately not durable. Records `AgentResult`s, not boards — wrong shape for this epic. |
| DB adapters / schema | `postgres` (npm) used directly in `api/board.ts:queryBoardJson` and `api/ai/_quota.ts`. Alembic heads: `a1b2c3d4e5f6` (initial), `b2c3d4e5f6a7` (board_json), `c3d4e5f6a7b8` (quota), `d4e5f6a7b8c9` (planner_runs). |
| Existing user tables | `users`, `user_profiles`, `user_completed_courses`, `user_course_plans`, `plan_semesters`, `plan_courses` all exist — but every one is `user_id UUID NOT NULL REFERENCES users(id)`. **Unusable anonymously**, and no code writes to any of them. |
| Existing session table | `anonymous_sessions (session_token TEXT UNIQUE, credits_used, credits_paid)` — quota only. Its token is **chosen by the client** (`localStorage` `tau_ai_session`, `NativePlannerJourney.sessionToken()`), so it is an ownership key an attacker can simply pick. Not reusable as an ownership boundary. |
| `DATABASE_URL` | Read in `api/board.ts:126`, `api/ai/generate-plan.ts:1399`, `api/ai/planner-run.ts:96`. Absent ⇒ documented local fallback / dev bypass. No migration exists for a board-state or proposal table. |
| Serverless constraints | `vercel.json` builds each `api/**` entry as its own `@vercel/node` function. No shared process memory across invocations, and no durable local filesystem — module-level state and `/tmp` are per-instance and evictable. Any production adapter must be external. |
| Session/cookie utilities | **None.** Repo-wide search for `cookie` / `Set-Cookie` / `HttpOnly` in `api/`, `shared/`, `web/` returns only unrelated comments in `scripts/acquire_official_syllabi.ts`. |
| Authentication | **None.** No login, no token verification, no user id anywhere in `api/`. |
| Proposal ownership | **None.** `generate-plan` returns candidates and retains nothing; `candidateOrchestration` is built and discarded with the response. |
| Board/version fields | `metadata.board_data_version` → `CatalogRevision` (`shared/planner/model.ts:58-77`). It versions the CATALOG, not a user's committed plan. `ProposalBaseRevision` is the client's captured copy. There is no user-board version at all. |
| Feature flag | `use_academic_decision_agent` (default off). Browser entry only via `/planner/native/agent-preview`, itself gated on `ENABLE_ACADEMIC_AGENT_PREVIEW=1`, so it 404s in Production. |
| API routing | `vercel.json` rewrites `/api/board/:programId` and `/api/ai/*` to root `@vercel/node` functions; everything else to `web/`. Locally, `web/next.config.ts` proxies `/api/*` to `PLANNER_API_ORIGIN` (`scripts/dev_api_server.ts` on :3002). CORS on `/api/(.*)`: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`. |

### Decision matrix

| | A. Client-only | B. Signed stateless token | **C. Anonymous server session** | D. Authenticated user |
|---|---|---|---|---|
| Vercel compatible | yes | yes | yes (needs external store) | yes |
| Durable | no | no (browser-held) | adapter-dependent | yes |
| Survives refresh | **no** (proven) | yes | yes | yes |
| Cross-device | no | no | no (by design) | yes |
| Exactly-once | no | **no** — nothing to dedupe against | yes | yes |
| Stale-write prevention | no | **no** — two holders of v1 both verify | yes (CAS) | yes |
| Privacy | best | whole plan in token; size grows with candidates | opaque id, no PII | real PII |
| Operational cost | none | signing secret + rotation | moderate | high |
| Existing repo support | current behaviour | none | `postgres` client already a dependency | `users` table exists, **zero auth code** |
| New external service | none | none | **none** | would require one |

### Selected: C — anonymous server-owned session

It is the smallest model that is server-authoritative, and the only one of A/B/C
that can express exactly-once and compare-and-swap at all. B was rejected on a
specific technical ground rather than taste: a stateless token can prove the
client did not tamper with a plan, but two concurrent Applies both holding a
token minted at board version *v1* would both verify, so it cannot prevent the
stale write this epic exists to prevent — and it cannot revoke or supersede.

D was not invented: no authentication code exists anywhere in the repository,
and the brief forbids adding an auth provider. C upgrades to D by adding a
nullable `user_id` beside `owner_id` and preferring it when present — no
rewrite of the repository boundary.

**Ownership key.** The existing `anonymous_sessions.session_token` is deliberately
NOT reused as the owner: the client picks that value, so any caller could claim
another caller's proposals. Ownership is a new server-issued opaque id in an
HttpOnly cookie. The quota token keeps its existing, separate job.

### Production persistence: an explicit REMAINING decision

No production-compatible durable store for user board state exists today. Per
the brief, this session implements the repository interfaces, a deterministic
in-memory adapter for tests, and the safest local Preview adapter — and does
**not** silently choose a vendor. Postgres is already this project's database,
so it is the obvious candidate, but shipping an untested SQL adapter plus an
unrun migration would be a durability claim this session cannot support. What a
production adapter needs is recorded below as required work, not as done work.

## Exact next action (current — supersedes the archival block at the end)

1. **The Apply-authority epic is MANDATORY and comes first.** The full audit is
   in the C5 section above. It is a DECISION before it is an implementation:
   either an authoritative server-side Apply contract with authentication and
   per-user persistence, or an explicit product decision that the committed
   board is intentionally local-only (in which case the UI must stop implying a
   commitment it does not make). Do not build persistence before that call —
   doing so would bake the client-trusted Apply path into something that finally
   does have integrity to lose.
   - **Smallest ordered first step, once the decision exists:** a RED test
     asserting that a fabricated candidate id, a mismatched constraint
     fingerprint and a stale profile version are each rejected by the SERVER,
     not by the client.
2. C5 completed the comparison epic — browser acceptance is 19/19 and nothing in
   C0–C6 remains open. No further comparison work is required.
3. Deployment remains blocked on the same human decisions recorded in the
   archival Blockers section (Vercel deploy access, canonical branch
   reconciliation). Unchanged by this session.

## Session 2026-08-15 (cont. 2) — C0–C6: choosing between validated alternatives

Four commits: C1/C2 `4229716`, C3/C4/C6 `d29f76c`, label fixes `59b8d85`.

### C0 — the gap, traced then proved

`generateCandidateSet` already retained up to `DEFAULT_MAX_CANDIDATES = 3`
validated, deduplicated combinations and computed a Pareto verdict for each. The
response emitted `summaries` — ids, differences and the raw `scoreVector` — but
**not the plan state**. So several legal, non-dominated plans existed
internally, exactly one reached the student, and a UI could only "show" another
by reconstructing it from difference text, which is forbidden.

RED proved it directly: **0 alternatives exposed** against ≥2 non-dominated
candidates.

### C1 — the exposed contract

Each alternative carries its COMPLETE plan (so nothing is reconstructed
client-side), plus `candidateId`, `normalizedIdentity`, `recommended`,
`applyable`, the shared `constraintFingerprint`, `profileVersion`, `snapshotId`,
`nonDominated`, `composedUtility`, the per-objective vector, `labelHe`,
`differencesHe` and `workload`. `scoreVector`, provenance and content hashes are
NOT promoted as client content.

**Filtering, in order:** valid and error-free → Pareto **non-dominated** →
distinct normalized identity. A dominated plan is worse on some confirmed
preference and better on none, so offering it would invite a strictly worse
choice.

**Zero / one / many:** fewer than two survivors returns an EMPTY set — one plan
is a proposal, not a comparison, and no count is ever manufactured. Verified on
a real case: forcing a wanted course made `{E2,E3}` dominate both `{E1,E3}`
placements, leaving ONE non-dominated plan and correctly no comparison.

**Deterministic bound (3):** the recommendation always survives; then the strict
extreme on each objective; then whichever remaining plan differs most from those
already chosen. Never array order, never randomness.

### C2 — factual labels and differences

Labels name what a plan **strictly leads on** among the offered set — a tie is
not a lead — and fall back to a neutral ordinal when no supported distinction
exists. A label that would repeat another card's is replaced by the ordinal,
because a label that does not distinguish is worse than a neutral one.
`balanced` / `compact` are planning INPUTS and never appear as identities.
Differences are computed from the plans: courses added/removed, courses moved
between periods, peak-load and active-period deltas.

### C3/C4/C6 — comparing, selecting, applying

Selecting an alternative never Generates, never touches the committed board or
the profile, and swaps the active draft to the EXACT candidate state the handler
returned. The selection resets on every response, so it cannot survive a Rebuild
and point into a superseded set.

Apply resolves the target by candidate id against the CURRENT response — a UI
label never decides what is applied, and an unknown or non-applyable id aborts
rather than committing something the server never validated.

A real radiogroup: arrow keys move selection **and** focus (RTL-aware), selected
state is text + border rather than colour alone, a polite live region announces
changes, cards stack on mobile, and a stale set stays readable but unselectable.

**Motion.** This is a productivity surface whose purpose is side-by-side
scanning, so nothing animates layout, size or position — a moving card would
hurt the comparison it exists to support. Measured in-browser: transitions are
colour-only (`color, background-color, border-color…`) at **0.15s**, and the
rule lives inside `@media (prefers-reduced-motion: no-preference)`, so reduced
motion removes it entirely. Selection itself is instant.

### Browser acceptance

API `scripts/dev_api_server_alternatives_preview.ts` on :3002 (PID 19892) pinned
to `data/evidence_fixtures/alternatives_preview`; `next dev` on :3001 (PID
32088). Snapshot `snap_0efbc0eb`, fingerprint `cf_466c6a18d62d862d` identical
across all three alternatives. Ports verified free before and after.

The Browser pane stopped compositing mid-run, so the accessibility tree and
screenshots were unavailable; evidence is DOM, network and console, plus a
`resize_window` call that restored a real 375px viewport for the mobile
measurements. Recorded as such rather than claimed as a11y-tree evidence.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Comparison with the right count | PASS | "3 תוכניות חוקיות לבחירתך", 3 radios |
| 2 | All satisfy the same hard constraints | PASS | One `constraintFingerprint` and one snapshot across all three |
| 3 | Labels/differences match the plans | PASS | Topic leader reads "יותר קורסים בתחום רובוטיקה"; diffs name E3/E2 |
| 4 | Recommendation reason truthful | PASS | `equal_confirmed_preferences`, `unresolvedTradeoff: true` |
| 5 | Keyboard / mobile / RTL | PASS | ArrowLeft moves selection AND focus; 3 cards single-column at 375px, 0px overflow; `dir=rtl` |
| 6 | Selecting sends no Generate | PASS | Generate count unchanged at 2 (both Builds) |
| 7 | Draft becomes the exact candidate | PASS | Draft switched to E3, E2 gone |
| 8 | Committed board unchanged while browsing | PASS | Proposal still present; board only replaced by Apply |
| 9 | Apply commits the SELECTED alternative | PASS | Committed **E3**, not the recommended E2; Apply control removed |
| 10 | Preference edit stales the whole set | PASS | Every alternative `disabled`, stale banner shown |
| 11 | Stale alternatives cannot be applied | PASS | All radios disabled while stale |
| 12 | Rebuild replaces the set | PASS | New set, staleness cleared, selection reset to recommendation |
| 16 | Missing evidence creates no fake advantage | PASS | With no confirmed objective, labels fall back to neutral ordinals |
| 17 | Flag-off unchanged | PASS | `agent=0`: no comparison, no conversation |
| 18 | Console clean | PASS | 0 console errors |
| 19 | No internet during any step | PASS | Only `http://localhost:3001` origins |

Checks 13–15 (priority clarification) were NOT exercised — see the gap below.

### Two defects found by the browser, fixed at root (`59b8d85`)

1. The topic-leading plan was labelled "חלופה 2" instead of naming robotics.
   Root cause: the builder read the LEGACY single-objective `topicIds`, which is
   populated only when the topic objective sorts first — so with project AND
   topic active it was undefined and the topic label was unreachable. It now
   reads the topic objective's own topics from the resolved set.
2. Two cards rendered the SAME label, because a plan that merely TIED on an
   objective still counted as leading it.

### Honest capability statement

**Supported:** a bounded set of validated, distinct, non-dominated plans built
under identical hard constraints, profile version and snapshot; inspect before
choosing; selection without regeneration; Apply of the selected alternative,
proven to commit B rather than the recommended A; full staleness/Rebuild
lifecycle.

**NOT supported — C5 was not implemented.** The optional impact-driven PRIORITY
clarification is not built. The trade-off is already represented truthfully
(`unresolvedTradeoff`, `equal_confirmed_preferences`) and the student can simply
choose an alternative directly, which is the escape hatch the spec allows — but
the bounded question that would let an explicit priority change the
recommendation does not exist yet. Browser checks 13–15 are therefore untested,
not passed.

**Remaining gap:** Apply enforcement lives in the journey (client-side commit),
which is where this preview's Apply has always lived. There is no server-side
Apply handler on this path to re-verify candidate id/identity, so the
"fabricated id" and "identity mismatch" rejections are enforced by the client
resolving ids against the current response rather than by a server contract.

## Session 2026-08-15 (cont.) — M0–M7: composable multi-objective ranking

Six commits: M1 `000e4b2`, M2–M5 `86e1948`, M6/M7 `40311e3`, M7 UI `afa8e51`,
trade-off + dedupe `c9bb3c5`.

### M0 — the defect, reproduced as lost intent

`resolveGroundedObjective` returned ONE objective: it collected delivery-feature
and topic preferences, returned on the first supported DELIVERY value, and only
fell through to topic when none resolved. Downstream, `candidate_set` compared a
single raw `grounded.score`, so architecturally only one objective could ever
reach ranking.

Two independent order dependencies followed: delivery always beat topic, and
inside delivery the winner was decided by preference ARRAY ORDER.

The RED was written to show a lost plan, not a missing type. Fixture: E1 neutral,
E2 project, E3 project **and** robotics. Both retained candidates tie on project;
{E1,E3} is strictly better on topic and dominates. A student confirming project
AND robotics received **{E1, E2}** — E3 was never selected and the robotics
answer was not even reported as excluded.

### M1 — an objective SET (`000e4b2`)

`grounded_objective_set.ts` resolves every eligible confirmed preference into its
own objective, each judged independently, so an unsupported delivery value can no
longer suppress a supported topic. Two preferences naming one objective merge
with provenance chosen by sorted preference id. Set order is presentation only
(sorted by id for determinism); nothing in ranking reads it.

Explicit relative priority is carried ONLY when genuinely supplied — never
inferred from array, question, enum or taxonomy order.

Backward compatible: `resolveGroundedObjective` returns the full set plus the
legacy single-objective fields describing `objectives[0]`.

### M2 — normalization (`86e1948`)

Each objective is bounded to [0,1] by a denominator derived from the CANDIDATE,
never from how much evidence exists:

| Objective kind | Denominator |
|---|---|
| delivery (laboratory, project) | candidate course count |
| topic | candidate course count × confirmed topic count |

With one confirmed topic the topic denominator reduces to the delivery one, so
single-objective ranking stays a monotone transform of the previous raw counts.

Proven consequences: a larger schedule is not rewarded for merely holding more
courses (raw grows, normalized does not); greater coverage cannot raise a score —
dividing by "courses with evidence" would have made a LESS covered candidate
score higher; an unknown course occupies the denominator and adds 0, so it is
neither reward nor penalty relative to a known negative; duplicate evidence and
repeated synonyms cannot inflate the raw count.

### M3/M4 — Pareto first, then a documented default

Dominance is decided on the full vector before any aggregation, and only among
candidates already tied on every hard/legality/distribution component. A
dominated candidate can never outrank its dominator — a property of the ranking,
not a second pass, because the composed utility is monotone in every component.

Composition is the arithmetic mean of the normalized vector: an explicitly
documented EQUAL-IMPORTANCE default, symmetric, so objective order cannot change
it. Exact ties fall to the existing legacy score vector and then canonical
identity — never array order. Explicit priority is honoured when supplied,
including a priority of 0.

Typed selection reasons: `single_objective`, `dominates_all_objectives`,
`equal_confirmed_preferences`, `explicit_priority`, `canonical_tie_break`,
`no_distinguishing_evidence`.

### M5 — generic, not pair-specific

One ranking implementation: a legacy single objective is converted to a
one-element set, so no "if single / else composed" branch exists. All seven
combinations (topic, project, laboratory, all three pairs, the triple) drive the
same path and are each proven invariant to preference order, plus
objective-order invariance and run-to-run determinism.

### M6/M7 — explanation and wire

Each objective is explained with its own already-proven wording, so ONE objective
yields byte-identical text. With several, one further sentence names how they
were combined, derived from the vectors. Source disclosure spans every active
objective and deduplicates a document cited by two objectives.

The lean composition summary travels the existing typed path (declared
explicitly in the zod contract, not via passthrough) to the draft view model.

Both impact probes are computed independently over the candidates retained for
THIS request, so answering one preference re-evaluates rather than silences the
other.

### Browser acceptance — multi-objective, on a committed fixture

API `scripts/dev_api_server_multi_objective_preview.ts` on :3002 (PID 10128)
pinned to `data/evidence_fixtures/multi_objective_preview`; `next dev` on :3001
(PID 30996). Snapshot **`snap_06a8c493`**, coverage 4/4. Ports verified free
before and after. Pixel screenshots unavailable (pane not compositing), so
evidence is accessibility-tree, DOM, network and console.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | First grounded question impact-driven | PASS | Delivery question rendered after Build; canonical E1/E2 |
| 2 | A second objective can still be asked | PASS | Topic question appeared after the delivery answer |
| 3 | Neither answer Generates | PASS | Generate count 1→1 across both answers |
| 4 | Proposal becomes stale | PASS | "ההעדפות שלך השתנו מאז הבנייה"; Apply disabled |
| 5 | Rebuild sends BOTH preferences | PASS | `preferenceEligibility.soft` carries both; version 6 |
| 6 | Both-satisfying candidate outranks | PASS | `E1,E2 → E1,E3`; canonical demoted to rank 1 |
| 7 | Render matches selected identity | PASS | DOM shows E1/E3 = `selectedNormalizedIdentity` |
| 8 | Explanation covers both preferences | PASS | Project sentence + topic sentence + composition sentence |
| 9 | Hard exclusion still wins | PASS | `disallowed:['E3']` → E1/E2, both objectives still active |
| 10 | Trade-off does not fall back to precedence | PASS (automated) | `unresolvedTradeoff:true`, reason `equal_confirmed_preferences` |
| 11 | Selection reason truthful | PASS | `dominates_all_objectives`, nonDominated 1, dominated 2 |
| 12 | Indifferent removes only that bias | PASS | Only `prefer_project_courses` active; E3 still selected |
| 13 | Valid Apply commits once | PASS | Committed E1/E3; Apply control REMOVED |
| 14 | Stale Apply blocked | PASS | `disabled:true` while stale |
| 15 | RTL / a11y / console | PASS | `dir=rtl`, `lang=he`, 2 live regions, 0 unnamed buttons, 0px overflow, 0 console errors |
| 16 | No internet during planning or Apply | PASS | Only `http://localhost:3001` origins observed |

Check 10 was proven by an automated handler test rather than a second browser
fixture — recorded as such rather than claimed in-browser.

### Composition policy, as shipped

1. Hard/legality/distribution prefix decides first, unchanged.
2. Pareto dominance is evaluated on the full normalized vector.
3. Equal-importance mean composes what dominance leaves open — a system ranking
   policy, explicitly not a claim the student assigned weights.
4. Explicit priority overrides the default when genuinely supplied.
5. Exact ties fall to the legacy score vector, then canonical identity.

### Honest capability statement

**Supported:** any number of confirmed grounded objectives composed without
precedence; topic + project proven end to end in a real browser; laboratory
composes through the identical generic path (automated).

**NOT supported, and not claimed:** the priority-clarification QUESTION. When a
material trade-off exists the system retains and reports `unresolvedTradeoff`
and ranks by the documented equal-importance default — it does NOT yet ask the
student which preference matters more. That is the immediate next slice.

**Remaining comparison-UI gap:** the composition metadata reaches the draft view
model but no candidate-comparison surface renders it; the student sees the
composed explanation, not the alternatives. Out of scope here by instruction.

## Session 2026-08-15 — W1–W3: topic alignment reaches real users, and its browser acceptance

Five commits: W1 `7e96ca7`, W2 `f7527a7`, W3 `64eb6d0`, fixture `0820443`,
defect fix `c732efd`.

The topic ENGINE was already proven (T5). What was missing was that a real
browser could never learn a topic question was worth asking, so the capability
was inert for users. This session closed exactly that gap and nothing else.

### W1 — the wire (`7e96ca7`)

RED first, and it failed at exactly the predicted boundary: the handler emitted
`topicQuestionImpact` but `generatePlanResponseToModel` dropped it, so the field
existed on the response and on neither `GeneratedPlanModel` nor `DraftVM`.

Path, all existing and typed:
`generate-plan response → shared wire contract → adapters → GeneratedPlanModel
→ draft view model → NativePlannerJourney → PreferenceConversation`.

Declared EXPLICITLY in the zod contract rather than riding on `.passthrough()`,
so a malformed probe is rejected instead of reaching the UI. The signal carries
localized labels, the snapshot id and the profile version, so the browser never
needs the topic vocabulary and an internal id can never surface as a label.
Nothing else crosses: no evidence ids, no score vectors, no candidate ids —
asserted by test.

**Topic option filtering, pinned against the REAL retained candidates**
({E1,E2} and {E1,E3}):

| Topic | In official evidence? | Offered? | Why |
|---|---|---|---|
| `robotics` | yes (E3) | **yes** | unique to E3, which is in one candidate only |
| `control` | yes (E3) | **yes** | same |
| `engineering_design` | yes (all four courses) | no | every candidate scores alike |
| `manufacturing` | yes (E1) | no | E1 is in BOTH candidates |
| `thermofluids` | yes (E4) | no | E4 is in NEITHER candidate |
| `solid_mechanics` | no | no | absent from the corpus entirely |

### W2 — the conversation (`f7527a7`)

Uses the EXISTING machinery only — `DeterministicPreferenceElicitation`,
`ConversationState`, `PreferenceProfile`, `PreferenceConversation`. No fixed
interests questionnaire was added: with no distinguishing topic, nothing is
asked.

Three changes, each with its own RED: the journey passes the server probe
straight through; the conversation re-selects when the topic signal changes
(without this the question could never surface after the first Build and could
never be retracted — the same defect class an earlier acceptance caught for the
delivery question); `labelForPreference` stopped falling through to the internal
id.

**Asked only when** ≥2 valid candidates differ, applicable official topic
evidence distinguishes them, coverage is sufficient, the topic is unanswered,
the user has not chosen indifferent, and no higher-priority question is pending.
**Suppressed or retracted when** candidates converge, evidence is missing /
stale / conflicting / ambiguous, no topic separates a pair, or the topic is
already answered.

Lifecycle: answering, editing, removing, confirming and choosing indifferent all
update DRAFT state only and never Generate; the profile version advances; the
current proposal becomes visibly stale; only an explicit Rebuild sends the
profile; Apply stays version-gated.

### W3 — the explanation (`64eb6d0`)

The coverage limitation now describes the fact that was actually MISSING. For a
content-ranked plan it reads "absence of a mention in the official content is
not a determination that the topic is not taught", instead of the delivery
objective's "no laboratory" — which would have described the wrong fact.

### Browser acceptance — ELEVEN CHECKS, ALL PASS

Local non-Production Preview only. API `scripts/dev_api_server_topic_preview.ts`
on :3002 (PID 21496) pinned to the COMMITTED fixture
`data/evidence_fixtures/topic_preview`; `next dev` on :3001 (PID 36076); route
`/planner/native/agent-preview?program=test_program_grounded_preview_2027`.
Evidence snapshot **`snap_efe2f017`**, coverage **4/4**. Both ports verified
free before starting and after stopping.

Pixel screenshots were unavailable (the Browser pane was not compositing), so
evidence is accessibility-tree, DOM, network and console — recorded honestly
rather than claimed.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Question only when impactful | PASS | Absent before any Build; rendered only after the Build that reported impact |
| 2 | Only evidence-backed distinguishing options | PASS | Exactly `רובוטיקה` + `בקרה ומערכות`; the four excluded topics absent |
| 3 | Suppressed on insufficient evidence | PASS | Board with 0/2 coverage produced a proposal, no question, no options |
| 4 | Choosing a topic sends no Generate | PASS | Generate count unchanged 1→1 |
| 5 | Version advances, proposal visibly stale | PASS | "ההעדפות שלך השתנו מאז הבנייה"; version 3→5 |
| 6 | Stale Apply disabled and inert | PASS | `disabled:true`; forced click left DOM byte-identical (45204→45204), no request |
| 7 | Rebuild sends exactly one request | PASS | Exactly 2 Generates total; carried `prefer_topic_alignment` + version 5 |
| 8 | Selected identity changes, matches render | PASS | `E1,E2 → E1,E3`; `cand_f49f0d08` rank 0, canonical demoted to rank 1; DOM shows E1/E3 |
| 9 | Explanation correct, no overclaiming | PASS | Cites topic, E3, `תוכן הקורס ומטרתו`, source URL, year 2027, coverage limit |
| 10 | Indifferent restores canonical | PASS | Back to E1,E2; no explanation; question not re-asked |
| 11 | Valid Apply commits exactly once | PASS | Committed E1/E2; Apply control REMOVED, so a repeat is structurally impossible |

Also verified: hard `disallowed_course_ids:['E3']` with a confirmed robotics
preference still placed E1/E2 with score 0 — **soft never overrides hard**;
completed-course status resolved through the real panel ("נשמר: 0 קורסים");
flag-off (`agent=0`) has no conversation at all; `dir=rtl`, `lang=he`, two
`aria-live` polite status regions, 0 unnamed buttons, 0px horizontal overflow at
375px, keyboard-reachable options with a computed solid focus outline; console
clean (React DevTools + Fast Refresh only); **every network request went to
localhost — no internet fetch during Build, ranking or Apply**.

### One browser-found defect, fixed at root (`c732efd`)

Check 10 exposed `indifferent (לא משנה)` — the internal token as the primary
label. Root cause was not topic-specific: an indifferent answer stores
`normalized:'indifferent'` with `value:null`, so no catalog option matched and
`labelForPreference` fell through to the raw value for EVERY question. Fixed by
giving catalog questions a short Hebrew `subject_he`; re-verified in the browser
as "תחום תוכן (לא משנה)".

### Honest capability statement

**Supported:** one confirmed topic interest, chosen from server-computed
distinguishing topics, changing the real selected candidate on the flagged
Preview path, with an evidence-linked explanation and full staleness/Apply
gating.

**NOT supported, and not claimed:** simultaneous multi-topic weighting (the UI
offers ONE topic answer because that is what the contract proves); combining a
topic preference with the project/laboratory objectives (see the next epic); the
7 of 18 corpus courses with no mappable official topic — they stay unknown and
contribute nothing in either direction; assessment extraction; section-level
planning.

### MANDATORY NEXT EPIC — composable multi-objective preference optimization

The current behaviour is **precedence only**: `resolveGroundedObjective` picks a
single objective, so a student who prefers a topic AND projects AND laboratories
has only one of those honoured. This is the next epic and was deliberately NOT
started here.

It must eventually let confirmed topic interests, project preference, laboratory
preference and distribution preference influence ranking TOGETHER, with a
defined, testable combination rule — not one objective winning by precedence.
Open questions it must answer: how objectives are weighted against each other,
whether the user states relative importance, how the explanation stays factual
across several objectives, and how the impact probe reports that a combination
(rather than a single topic) would change selection.

### Assessment-extractor discovery (recorded, NOT acted on)

The K8A audit reported assessment coverage as 0/8 because
`labeledFields['מטלות הקורס']` was empty on every document. The acquired text
shows the field DOES carry values for some courses (e.g. `פרוייקט` on
0509-4010) — the K2 `<small class="data-table-cell-label">` + `<span>` reader
simply does not capture that markup shape. So "0/8" measured an extractor
limitation, not the source. Assessment remains out of scope and unshipped; this
is recorded so the next audit does not repeat the wrong conclusion.

## Browser acceptance record — the grounded KnowledgeCapability journey (COMPLETE)

Local non-Production Preview only. API `scripts/dev_api_server.ts` on :3002
(`AI_DEV_MODE=true AI_DEV_BYPASS_QUOTA=true`, `DATABASE_URL` unset,
`AI_EVIDENCE_CACHE_DIR` pointing at a deterministic offering-scoped cache);
`next dev` on :3001 behind `PLANNER_API_ORIGIN`; route
`/planner/native/agent-preview?program=test_program_grounded_preview_2027`
(gated by `ENABLE_ACADEMIC_AGENT_PREVIEW=1`, 404 in every Production deploy).
Evidence snapshot `snap_2da7a25b`, coverage 4/4, `variesBySection: []`.

Applicability note: the browser fixture uses OFFERING-scoped documents (no group
suffix), so coverage is complete by construction. The incomplete live corpus was
deliberately NOT used to make the flow pass.

| # | Check | Verdict | Key browser evidence |
|---|---|---|---|
| 1 | Impact-driven question | PASS | Grounded question rendered only after the impact probe reported `distinguishesCandidates:true`; one question at a time; no internal ids/scores in the surface |
| 2 | Suppression | PASS | Mixed-section and no-evidence corpora both report `distinguishesCandidates:false`; no question rendered |
| 3 | Answer does not Generate | PASS | Three answers + completed-status save + exclusion confirm: Generate count unchanged (0→0, then 2→2) |
| 4 | Stale → Rebuild → changed selection | PASS | One Generate per click; request carried `course_feature_practical` + `profileVersion 4`; selection changed `E1,E2 → E1,E3`; canonical candidate demoted to rank 1 |
| 5 | Valid Apply exactly once | PASS | Committed board empty → `E1(א)/E2(ב)`; draft cleared; **Apply control REMOVED**, so a repeat is structurally impossible |
| 6 | Stale Apply blocked | PASS | Preference edit disabled Apply and showed "ההעדפות שלך השתנו מאז הבנייה"; a forced click on the disabled control left the DOM byte-identical |
| — | A11y / console / network | PASS | `dir=rtl`, `lang=he`, aria-live regions present, 0px horizontal overflow at 375px, every visible button named, fresh-tab console clean |

Academic status was resolved through the REAL UI (panel → "שמור את הסטטוס" with
0 courses → "נשמר: 0 קורסים שהושלמו"; then "אין קורסים שאני רוצה להימנע מהם"),
which removed BOTH critical clarifications and produced `outcome:'proposal'`,
`applyEligible:true`. Unknown and explicit-empty remain distinct.

Three defects were found by the browser that server-side HTTP checks had missed,
each fixed with a RED regression: a browser-facing fixture missing
`board_data_version`; the handler never publishing the question-impact signal;
and the conversation never re-selecting when that signal arrived. A fourth —
profile-version staleness disabling Apply *silently*, then a shared note wrongly
blaming the catalog — was fixed by deriving a typed `staleReason`.

Late-response protection is covered by the existing token-based automated test
("a late response superseded by a newer Build never becomes the proposal"); no
browser race was manufactured.

## Session 2026-08-14 (cont. 5) — T1–T6: group universe, content sources, and topic alignment

Six commits. The headline: **content/topic alignment now provably changes which
plan is selected**, and it did so only after the earlier REJECT was re-examined
and found to have measured the wrong field.

### T1 — authoritative offering/group universe normalizer (`00c1afb`)

K7.5 refused to aggregate section evidence without a complete group universe,
and nothing produced one, so every multi-section course was permanently
`unknown`. `api/ai/group_universe.ts` turns the official course-details page
into a typed universe: institution, course, year, semester, full group ids,
official group type, source ref, content hash, normalizer version, completeness
(`complete | incomplete | conflicting | unknown`) and applicability
(`applicable | course_mismatch | year_mismatch | unidentified`).

`authoritativeGroupIds` is the ONLY bridge into aggregation and yields nothing
unless the universe is both applicable and complete — so a universe can turn an
`unknown` into a known fact but can never make a known fact wrong. Completeness
is never inferred from how many syllabi downloaded. No section-level planning
was added.

28 tests. Measured against the 25 recorded official pages: **17 complete
universes over 34 groups, 8 "no results" shells correctly `unknown`, 0
anomalies, 0 mismatches.** On the live corpus it resolved 3 previously-unknown
courses; the rest stay unknown precisely because their universes list groups
that were never downloaded.

### T2 — official content-source discovery (`195630d`)

**Declared budget: 16 requests.** Read-only GET, one official host, sequential,
2 s apart, no credentials, one year. **Result: 15 acquired, 1 correctly
`no_syllabus_published`, no early stop, no access restriction.** Every group
number came from T1 rather than being guessed — acting on the first run's
central finding. Corpus grew 8 documents/7 courses → **23 documents/18 courses**.

| Source | Scope | Docs | Courses with usable topics | Unknown | Conflicting | Stale | Verdict |
|---|---|---|---|---|---|---|---|
| syllabus `נושאי לימוד` | course | 2/23 | **1/18** | 17 | 0 | 0 | INSUFFICIENT ALONE |
| syllabus `תוכן הקורס ומטרתו` | course | **23/23** | **11/18** | 7 | 0 | 0 | **USABLE** |
| official course-details page | offering+section | 25 | **0** | — | — | — | NO CONTENT — authoritative for the GROUP UNIVERSE only |
| faculty course pages | — | — | — | — | — | — | NOT INSPECTED — needs a search engine or link traversal, both forbidden |

8 distinct normalized topics; **52 distinguishing candidate pairs**.

**The correction that unlocked this.** K8A measured `נושאי לימוד` and rejected
topic alignment at 1/7. That measurement was right about that field and wrong
about the source: `נושאי לימוד` is an optional sub-heading INSIDE the official
`תוכן הקורס ומטרתו` section, and that section is present on 23/23 documents.

**Scope finding, measured not assumed:** across the 5 multi-group courses the
content section is byte-identical between groups, so content is COURSE-scoped
and may label a course-level candidate without a complete group universe.

### T3 — normalized topic knowledge (`521515e`)

Each assertion preserves raw official wording, normalized topic id, evidence id,
source, year, applicability, mapper version, confidence, ambiguity, language and
status.

**The load-bearing rule is exclusion, not matching.** The content section
routinely names OTHER subjects: 0542-3792 lists solid mechanics and fluid
mechanics as prerequisites and recommends electronics and heat transfer
alongside. A deterministic sentence rule removes those clauses before mapping,
verified on real wording — `מעבר חום` is correctly dropped from 0542-4094 and
0542-4391 where it appears only as a prerequisite.

Mapping is a controlled vocabulary of observed phrases with word-boundary and
single-Hebrew-prefix rules, so `החומר הנלמד` cannot become materials science.
Bare `בקרה`, `תכן`, `חומר`, `אנליזה`, `מודל` are AMBIGUOUS: detected, disclosed,
never mapped — active on 6 real courses. No LLM, no title inference, no semantic
expansion. **Absence is not falsehood**: a topic is affirmed or unknown, never
false. 26 tests, including an ethics course that must yield nothing.

Per-course audit found **no false positives**; 0555-4000 (ethics) and 0542-4125
(environmental) correctly yield nothing.

### T4 — typed topic-interest preference (`d029c08`)

Category `course_topic_interest`, affects `grounded_topic_interest`, resolved at
the same single boundary as the delivery preference. Confirmed+active+groundable
→ soft ranking; indifferent/uncertain/unconfirmed activate nothing; an
ungroundable topic is reported, never approximated. No legality output exists on
the path. Precedence over delivery is fixed, documented and tested rather than
emergent, because the two rest on different evidential strengths. Topics come
from the SAME snapshot as features. One contribution per (course, topic) —
duplicate wording and multiple documents never double-count. 20 tests.

### T5 — real selection-change proof (`aa0730f`)

Real `generateCandidateSet` over the real `PlannerWorker`, one policy, one
profile version, identical hard constraints, real `prepareEvidence`. Real course
ids and verbatim official wording; the board is a fixture, as in K4 and K8.

**With confirmed `materials` the SELECTED candidate identity changes** from
{0542-4094, 0542-4624} to a plan containing 0581-4131. A different confirmed
topic selects a different plan, so no topic is privileged. Indifferent restores
the canonical selection. Missing, ambiguous, stale and conflicting evidence each
leave ranking unchanged. Hard exclusion of the favoured course still wins.
Repeated runs are identical. 16 proofs.

A determinism probe over six independent runs confirmed generation is
byte-identical — the one differing assertion was a wrong assumption in the test
(this fixture's soft terms already outrank the legacy single-plan identity), not
a defect.

### T6 — impact-gated question, server side only (`f4ca174`)

`topicQuestionImpact` probes each topic over the already-retained candidates
using the same snapshot; `distinguishingTopics` is both the gate and the offered
choices, so this is not a generic interest questionnaire. Coverage counts as
sufficient only when MORE than one course carries usable content. Internal ids
are option values, never labels. 14 tests.

**NOT EXPOSED TO THE BROWSER, deliberately.** The objective has automated
end-to-end proof but no browser acceptance, so it must not reach a real user.
Non-exposure is structural: the web conversation supplies only
`groundedFeatureImpact`, never `topicInterestImpact`, so the question cannot
render — and a guard test fails the moment someone wires it through.

### Verification

API **156 suites / 2104 tests** green (session baseline 151/2000). UI **78
suites / 835 tests** green. Root and web `tsc --noEmit` clean. Production build
green. No browser acceptance run — see above.

### Honest capability statement

**Supported:** an authoritative group universe from the official course-details
page; bounded read-only acquisition addressed by real group ids; normalized,
evidence-linked, ambiguity-aware topic extraction from the official content
field; a typed topic-interest preference that provably changes the selected
candidate through the real path.

**NOT supported, and not claimed:** the topic question in the real UI (no
browser acceptance); combining topic and delivery objectives (precedence only);
assessment extraction; section-level planning; faculty course pages; any
institution or syllabus template beyond this one.

### Discovered, recorded, NOT acted on

The K8A matrix reports assessment coverage as 0/8 because
`labeledFields['מטלות הקורס']` is empty on every document. The acquired text of
0509-4010 nonetheless shows `מטלות הקורס` followed by `פרוייקט`, so the value
exists in the source and the K2 label extractor — which only reads
`<small class="data-table-cell-label">` + `<span>` — is dropping it. That makes
the recorded reason for the assessment REJECT ("the field carries a label but no
values") **an extractor limitation, not a source limitation**. Not pursued: this
session's mandate was topic alignment, and implementing an easier objective
instead was explicitly out of scope. Needs its own verification before any
assessment objective is considered.

## Session 2026-08-14 (cont. 4) — K8: a SECOND grounded objective, chosen by measurement

Two commits: K8A `75d1c7e` (the audit), K8 `b039549` (the objective). The point
of this slice was **not** "add another objective" — it was to establish that
which objective ships is decided by measured official coverage, and that an
objective without its own end-to-end selection-change proof does not ship.

### K8A — objective coverage audit (`75d1c7e`)

`scripts/audit_objective_coverage.ts` reads the already-acquired K6/K7 cache
(8 documents, 7 distinct courses, year 2025, 0 corrupted). It performs **no
acquisition and no network access**, so it is deterministic and repeatable.
Output is metadata only — counts and decisions, never syllabus prose —
committed as `data/import_reports/objective_coverage_matrix.json`.

Field coverage over the live corpus: delivery mode 8/8, day+time 7/8,
explicit topic list 2/8, learning outcomes 0/8, assignments 0/8.

| # | Candidate objective | Official source | Applicable docs | Known | Unknown | Conflict / section-varying | Coverage | Distinguishing pairs | Decision |
|---|---|---|---|---|---|---|---|---|---|
| 1 | content / topic alignment | syllabus `נושאי לימוד` + learning outcomes | 2 | 1 | 6 | 0 | **1/7 courses** | **0** | **REJECT** |
| 2 | final-exam / assessment | syllabus `מטלות הקורס` | 0 | 0 | 8 | 0 | **0/8 docs** | **0** | **REJECT** |
| 3 | project / design-based learning | syllabus `אופן ההוראה` | 8 | 8 | 0 | 0 | **8/8 docs** | **12** | **IMPLEMENT** |
| 4 | timetable / day / time | syllabus `יום` / `שעות` | 7 | 7 | 1 | 1 | 7/8 docs | 0 | **DEFER** |

**Why 1 and 2 were rejected rather than worked around.** Topic alignment is the
higher-priority product capability and was rejected anyway: with one
topic-bearing course there is no *pair* of candidates the feature can separate,
so no selection change is reachable. The available workarounds — mining
narrative prose, or reading the course **title** — are inference, not official
evidence, and are forbidden. Assessment carries the `מטלות הקורס` **label with
no values on all 8 documents**; turning that absence into "no final exam" is the
exact inference this pipeline exists to prevent. Absence is not falsehood.

**Why 4 was deferred rather than rejected.** Day/time coverage is genuinely good
(7/8) and 1 course already shows different meeting times across its groups — the
values are SECTION-scoped. Per K7.5 a section fact cannot label a course-level
candidate, and the planner selects a course and a period, never a group. The
architectural prerequisite is section-level selection plus an authoritative
timetable source mapping course+section+semester+day+time+year. That is a
planner change, not a knowledge change, and was out of scope.

### K8 — `prefer_project_courses` implemented (`b039549`)

`projectDelivery` is a second, independent reading of the SAME schema-complete
`אופן ההוראה` field: present ⇒ true *and* false are both concludable; absent ⇒
unknown for both readings. `laboratory` and `projectDelivery` are independent
questions about one enumerated value, not competing interpretations — proven by
a test asserting a `מעבדה` document is `laboratory=true, projectDelivery=false`.
Both are aggregated through the identical K7.5 rules, so a second objective can
never acquire weaker applicability than the first.

The typed preference gained one option (`project_based`) at the one existing
mapping boundary, `resolveGroundedObjective`. The internal objective id remains
an invalid input value. Indifferent / uncertain / unconfirmed still activate
nothing, and the preference stays SOFT — `effectivePlannerPreferences` puts it
in `soft` with `hard` empty.

### Real selection-change proof (`tests/api/grounded_project_objective.test.ts`)

Not a score-only proof. Every assertion runs the real `generateCandidateSet`
over the real `PlannerWorker` under one fixed `neutral` policy, one profile
version, and identical hard constraints; evidence comes from the real
`prepareEvidence`.

1. ≥2 candidates, each `validateCandidate` valid with `degreeMet`, same policy
   and profile version.
2. Official applicable evidence genuinely distinguishes them (E3 project=true,
   E1 project=false; some candidates contain E3, some do not).
3. **Without** the preference the canonical legacy selection is preserved and
   `groundedScore` is absent.
4. **With** the confirmed preference `normalizedIdentity` **changes**, the
   selected plan gains E3, and the top contribution is E3 — the identity of the
   selected candidate changes, not merely its score.
5. Explanation cites the project feature (`פרוי`), never `מעבדה`, and carries
   `ims.tau.ac.il` and the year; it makes no superiority claim.
6. Indifferent restores the canonical selection.
7. Repeated runs produce identical candidate ids and identical selection.
8. Every candidate is scored against the SAME snapshot id (recomputed and
   compared per candidate).

### Unknown / missing / section-varying behaviour

- **Missing field** ⇒ `projectDelivery = 'unknown'` with empty evidence, never
  `false`.
- **Empty corpus** ⇒ selection identical to baseline, `groundedScore.score === 0`.
  Coverage is not a signal.
- **Section-varying** ⇒ a course whose groups disagree (`0542-3003-05` project,
  `-01` lecture) is inert: selection identical to baseline, score 0, and the
  course is disclosed in `coverage.variesBySectionCourseIds`.
- **Hard exclusion of the favoured course still wins**: with `E3` disallowed no
  candidate contains it and the selected score is 0. Soft never overrides hard.

### Browser acceptance — NOT performed for K8, and not claimed

K8 changed a user-facing surface: the `course_feature_practical` question gained
a second option and its Hebrew wording changed from a laboratory-specific
sentence to a delivery-format one, and `groundedQuestionImpact` now probes both
objectives (`feature: 'course_delivery_format'`, plus a
`distinguishingObjectives` list). The committed six-check browser record above
predates those commits and covers the laboratory option only. **The project
option has automated end-to-end proof but no browser acceptance.** Recording it
here as an outstanding item rather than borrowing the earlier record.

### Remaining blocker after K8

Content/topic alignment — the highest-priority remaining capability — is blocked
on **official evidence, not on engine work**: 1/7 courses, 0 distinguishing
pairs. It cannot ship until an authoritative source raises usable topic coverage
enough to separate at least two candidate pairs.

## Session 2026-08-14 (cont. 3) — K9A–K7 live wiring, bounded acquisition, and the K7.5 applicability fix

### K9A — typed grounded preference (`891157f`)

Generic `course_feature` / `practical_laboratory` preference. ONE mapping
boundary (`resolveGroundedObjective`, alongside `resolveDistributionPolicy`) so
UI, handler and planner cannot reinterpret it differently. The internal objective
name is never a valid input. Confirmed+active+supported → objective; indifferent
records the topic without bias; uncertain/unconfirmed/rejected/absent → nothing;
unsupported value → typed `unsupported_grounded_feature`. Stays SOFT — the result
type has no legality output at all.

### K9B — live Generate + frozen snapshot (`39c71b6`)

`prepareEvidence` runs ONCE per request before planning; candidates never acquire
or resolve evidence. `evidence_loader.ts` is the single seam and has no transport,
so no fetch can occur in `PlannerWorker.step`, a rollout, ranking or Apply
(proven with a `globalThis.fetch` spy). Response carries snapshot id, extraction
version, years, covered/missing/unknown/stale/conflicting, objective and profile
version. **Coverage is not a signal**: "all covered but none a laboratory"
produces the identical plan to "no evidence".

### K9C — impact-driven question + explanation (`e2dce02`)

The topic joins the EXISTING elicitation catalog, gated on a truthful
`groundedFeatureImpact` signal: asked only when candidates genuinely differ,
coverage is sufficient and nothing conflicts. Student-facing Hebrew wording; no
evidence ids or internal names leak. `GroundedExplanation` shows one factual
sentence with source/year behind an accessible disclosure.

### K5 — freshness and conflict (`d1c0a70`)

One `FreshnessPolicy` replaces scattered timestamp comparisons. Applicability
beats recency; catalog outranks syllabus; same-level disagreement stays a
conflict with both records retained; a not-yet-effective record does not govern
the present.

### K6 — durable cache (`ddaa2e4`)

Content-addressed, atomic (temp+rename), idempotent, stable manifest, fails safe
on corruption, never erases on failure, explicit refresh. Planning reads
immutable snapshots, never mutable cache state.

### K7 — bounded live acquisition (`032336c`)

Two runs, 25 requests total, read-only, official host only, 14-request cap, 2s
delay, sequential, no credentials.

**First run: 13 requests, 0 acquired.** Discovery: the official endpoint is
addressed by **course + GROUP + year**, not course + year. Group `00` returns
HTTP 200 reading "קבוצה לא נמצא" with labels present and values empty — correctly
classified as `no_syllabus_published` rather than fabricated. Group numbers are
per-offering data and must come from the timetable source, never guessed.

**Second run: 12 requests, 8 acquired, 4 unavailable.** Delivery-mode extraction
**8/8**; **assessment extraction 0/8** — the live pages carry `מטלות הקורס` with
no values, so exam/project/coursework are all `unknown`. That is
"absence is not falsehood" working, not a silent false.

### K7.5 — scoped evidence applicability (`dd7a40a`) — a real defect, found and fixed

The live run showed 0542-3792/2025 is `laboratory=true` for group 05 and `false`
for group 01. `prepareEvidence` was doing `features.set(courseId, extract(doc))`
in document order, so **whichever group was processed last defined the whole
course**. Since the planner selects a course and a period — never a group — that
attributed a section fact to a course-level candidate.

Fixed: scopes `course | offering | section`; section id read from the document's
own course-number field; `aggregateCourseLevelFeature` with
`true | false | varies_by_section | unknown`.

> **Recorded rule: live group-level syllabus evidence does NOT influence
> course-level ranking unless applicability, or safe COMPLETE aggregation over an
> authoritative group universe, is proven.**

All-true or all-false require complete authoritative coverage; mixed →
`varies_by_section`; incomplete coverage or unknown universe → `unknown`; a
failed acquisition is never read as `false`; the first/lowest/downloaded group
never decides. Section facts are retained for a future section-selecting planner.

The K4 proof was **revalidated, not preserved**: it had bypassed aggregation and
proved ranking with section-scoped evidence. It now runs through the real
`prepareEvidence` with an explicit complete group universe, and the unfavoured
candidates carry applicable evidence saying "no laboratory" rather than merely
missing data.

### Honest capability statement

**Supported:** delivery-mode/laboratory extraction from this institution's
syllabus template; bounded read-only acquisition; deterministic evidence
resolution, caching and snapshotting; one grounded objective that provably
changes selection under complete applicable evidence.

**NOT supported, and not claimed:** general syllabus support (one template, one
institution); assessment extraction (0/8 live); an authoritative group universe
(the recorded course-details page lists groups, but no normalizer is built yet,
so multi-section courses stay `unknown`); section-level planning; any objective
beyond `prefer_laboratory_courses`.

## Session 2026-08-14 (cont. 2) — KnowledgeCapability K0–K4: the first real grounded chain

**What this session set out to prove, and did:** one narrow but genuinely
end-to-end capability —
`official academic source → versioned evidence → normalized course features →
confirmed soft objective → candidate ranking changes` — with no step stubbed.

### K0 — Python test isolation (commit `4b404a0`)

Root cause: `writeNormalizedCourseData()` wrote unconditionally to the TRACKED
`data/import_reports/normalized_courses_mechanical_2027.json`, which
`tests/test_supabase_normalize.py` reads as fixture input. Running pytest
rewrote repo state (74525 → 40733 bytes) and broke that suite on the next run
(T02/T03/T05/T07/T08), leaving the worktree dirty.

Fixed by **dependency injection, not cleanup**: `writeNormalizedCourseData(out_path)`
defaults to `defaultNormalizedOutputPath()` (production behavior unchanged);
T11/T12 inject `tmp_path`; new T13/T13b pin the contract. No assertions
weakened, no catalog data regenerated or committed.

Proof: tracked sha256 `be4178ff…` identical before and after every run;
`git status --porcelain -- data/` empty after each; affected tests pass in
forward AND reverse order; full pytest run twice → 33 failures both times,
run1 == run2 exactly; versus pre-K0 in the same tree, exactly the 5 induced
failures fixed and **zero new**.

**Honest Python status: NOT green.** 33 pre-existing, unrelated failures remain
and are not claimed fixed — `test_seed_postgres` 10, `test_viewer_structure` 4,
`test_prerequisite_graph` 4, `test_eligibility_engine` 4, `test_elective_audit` 4,
`test_recommendation_engine` 3, `test_difficulty_estimator` 3,
`test_normalize_courses` T11 1. T11 needs the raw_html corpus (68+60 files) that
was never committed — only 25+1 exist locally, 2 are tracked — and it fails
identically at HEAD.

### K1 — authoritative source + evidence contract (commit `d64f7f6`)

`api/ai/academic_evidence.ts`. Generic: institution, program, course and year are
parameters. Source hierarchy, descending: `official_catalog` → `official_syllabus`
→ `official_timetable` → `authoritative_student_record` | `secondary_descriptive`
→ `unverified`. Only the first four are authoritative; `LEGALITY_FACT_TYPES`
(course_exists, credits, prerequisites, offering_periods, classification,
exam_rules, degree_legality) may be determined ONLY by those.

Evidence record: derived stable id, institution/program/course, fact type,
normalized value, source ref, source class, academic year, source version,
retrieval timestamp, effective date, extraction method+version, confidence,
**derived** authoritative flag, copyright-safe excerpt or locator.

States: `confirmed_authoritative | confirmed_descriptive | uncertain |
conflicting | stale | missing | unsupported`. Rules: no bare facts (resolution
always carries evidence, including losers); **applicability beats recency**;
same-class authoritative disagreement → deterministic `conflicting` retaining
both; a lower official class is OUTRANKED, not conflicting; `legalityValue()` is
the single door and opens only for `confirmed_authoritative`.

### K2 — official syllabus acquisition (commit `bf01627`)

`api/ai/syllabus_source.ts`. A point-fetch of ONE document per (course, year) —
**not a crawler**: no link following, discovery, search or traversal. Real source
`https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=<8-digit><group>&year=<year>`,
proven against the genuine official page already tracked at
`data/raw_html/syllabus/syllabus_05423792.html`.

Allowlist checked before any request (exact host match, no suffix spoofing);
off-allowlist redirect classified not accepted; bounded timeout/size;
content-type validation; deterministic retry for transient failures only (a 404
is never retried); the transport boundary takes only `(url, {timeoutMs})` so no
credential can cross it. Every failure is a typed `unavailable` state with no
document. Version applicability: year mismatch, course-id mismatch and
"no syllabus published" are all typed refusals, and `selectCurrentSyllabus`
returns the requested year or **nothing** — never "the newest available".

Determinism: planning never calls the adapter. It reads a frozen,
content-addressed `EvidenceSnapshot`, so ranking cannot depend on network
availability or a source changing mid-run.

### K3 — grounded feature extraction (commit `76cf1c5`)

`api/ai/course_features.ts`, rule-based, no LLM. Governing discipline:
**absence is not falsehood**. A feature is `false` only from a SCHEMA-COMPLETE
official field (`אופן ההוראה` is always published and always names the mode);
free prose yields `unknown`. Ternary `true|false|'unknown'` throughout; a feature
with no evidence makes no claim and carries zero confidence.

Features: laboratory, project, finalExam, coursework, deliveryMode (verbatim),
topics, prerequisiteText. Never extracted: subjective difficulty, weekly
workload, teaching quality, career value, grading generosity, topic emphasis —
a test asserts those keys never appear. Prerequisite text is
`authoritativeForPlanning: false` permanently, so it can never override the
normalized prerequisite engine. Topic vocabulary is generic and versioned;
unmatched OR ambiguous phrases stay `uncertain` with raw wording preserved;
topics come only from an explicit `נושאי לימוד:` list, never mined from prose.

### K4 — one grounded objective that really changes ranking (commit `bd812a7`)

`prefer_laboratory_courses`, chosen because the delivery-mode field is the
best-evidenced feature available. Ranked at the CANDIDATE level (not inside
`scorePlan`), so plan construction is untouched. Order:
hard constraints + legality + confirmed distribution policy → **grounded
objective** → remaining soft terms → identity tie-break. No objective ⇒
byte-identical legacy ordering. Default-off.

`unknown`, missing evidence and no-document courses contribute exactly ZERO; a
genuinely `false` feature also contributes zero (a preference FOR, not a penalty
against); only a `confirmed: true` objective contributes at all.

**The proof is a selection change, not a score change:** without the preference
the selected plan lacks the laboratory course; with it, the selected plan's
identity differs and now contains the evidence-backed course. Hard exclusion of
the favoured course still wins absolutely; a hard inclusion the objective does
not favour is still honoured; every candidate is scored against the same
`snapshotId`; ranking is reproducible.

## Remaining KnowledgeCapability slices (K5–K10) — still REQUIRED

The product is **not complete** until these are implemented and proven. K1–K4
built the spine for exactly ONE feature and ONE objective against ONE recorded
document; everything below is still missing.

5. **K5 — conflict & freshness at scale.** `resolveFact` handles conflict and
   staleness for a single fact; nothing yet re-resolves a whole corpus, ages
   evidence out, or surfaces conflicts into the existing structured-clarification
   channel as non-answerable authoritative items.
6. **K6 — durable deterministic knowledge cache.** `EvidenceSnapshot` is built
   in memory per request. Needs a versioned, content-addressed on-disk cache
   with explicit invalidation, so a snapshot is reproducible across processes
   and no acquisition repeats unnecessarily.
7. **K7 — real corpus acquisition.** One document is recorded. Needs a bounded,
   rate-respecting batch acquisition for a real program's course set, with the
   allowlist and per-source access rules enforced, and the results committed as
   a cache rather than as catalog data. **Requires the owner's explicit
   go-ahead for live network access — not taken in this session.**
8. **K8 — more grounded objectives, each independently proven.** Only
   `prefer_laboratory_courses` exists. Each new objective (no-final-exam,
   project-based, confirmed topic) needs its own end-to-end ranking-change proof.
   **An objective that cannot be shown to change real candidate ranking must not
   ship** — that rule is now enforced by precedent, not just stated.
9. **K9 — grounded objectives in the live handler + preference profile.** K4 is
   proven at the candidate-set level. It is NOT yet wired into
   `generate-plan.ts`, the typed preference profile, or the confirmation flow,
   so no real request can enable it yet.
10. **K10 — evidence-backed explanation surfaced to the user.**
    `explainGroundedRanking` produces the text; the response and UI do not carry
    it yet. Needs the candidate-comparison surface that Slice 18B deliberately
    deferred.

## Session 2026-08-14 (cont.) — HARD wanted/avoided constraints + real multi-combination candidate search (Slice 18A/18B)

**Three binding product decisions were made by the owner this session and are now
authoritative policy:**

1. `balanced` / `compact` are user PREFERENCES/POLICIES that configure scoring and
   search — they are **not** the alternatives shown to the user.
2. Courses selected in the existing **"wanted"** and **"avoided"** pickers are
   **HARD constraints**, not best-effort preferences.
3. The final system must generate **multiple meaningfully different course-plan
   combinations** that all satisfy the same requirements, then rank and explain
   them using intelligent, source-grounded preferences.

### What shipped

**Baseline first.** The production build was missing after the previous final
commits — run at HEAD `2e95748` before any code change: **green**. API suite
green (136 suites / 1730 tests). The one full-UI-suite failure was confirmed to be
the long-documented jsdom **contention flake**, not a regression: the failing
suite passes alone, and a different suite fails at a different worker count.

**Slice 18A — correct constraint vocabulary + hard semantics.**
- `ConstraintModel` gained `mustIncludeCourseIds` (`must_include_course_ids`).
  `disallowedCourseIds` is `must_exclude_course_ids` (already hard). The SOFT
  channel `wantedCourseIds` (`prefer_course_ids`, the old `g5` best-effort
  behavior) is retained for backward compatibility but **the hard pickers no
  longer feed it** — the two sets are mutually exclusive by construction, so a
  hard selection can never also be scored as a tradeable preference.
- "Satisfied" is defined once, in `planner_goals.ts`: completed (academic
  history, never re-scheduled), currently taking, or fully placed.
- **Enforcement is a retention GATE, not a score term.** `validateCandidate` +
  `assessCompleteness` reject any plan with a missing hard inclusion regardless of
  score (`MUST_INCLUDE_ERROR_PREFIX`), `generate-plan`'s new `mustIncludeGate`
  turns it into a blocking error on BOTH the default and flagged paths, and
  `PlannerWorker.isGoalReached` no longer reports "goal reached" for such a plan.
  `g2a` also credits hard inclusions — but only as a **search gradient**; the gate
  is what makes them non-tradeable.
- Hard inclusions are seeded into `requiredButUnplacedCourseIds` /
  `requiredCourseSemesterBoundaries`, which is what makes `enumerateActions`
  group 1b propose them **and their prerequisite chains** unconditionally — the
  exact case the old soft path could never recover from once degree hours were
  already met. `recoverUnplacedWantedCourses` now recovers hard inclusions FIRST
  and **exempts them from the strict-improvement gate**: that gate was, for a
  hard constraint, precisely "a recovery mechanism that treats a missing
  hard-wanted course as acceptable".
- **New: `api/ai/hard_constraints.ts`** — deterministic pre-planning analysis
  returning a typed outcome (`feasible` / `infeasible`, `applyEligible`) with
  stable reason codes, affected course ids, conflicting constraints/facts, a
  concise Hebrew explanation, safe user-resolvable actions, and an
  **authoritative / non-answerable** flag. Codes:
  `wanted_and_avoided_conflict`, `wanted_course_not_in_catalog` (covers both
  catalog membership and catalog-integrity gaps),
  `wanted_course_unavailable_in_horizon`, `wanted_prerequisite_impossible`,
  `avoided_mandatory_conflict`, `wanted_exceeds_workload_cap`,
  `completed_status_contradiction`. The student is **never** asked to adjudicate
  an authoritative catalog fact. Deliberately NOT a conflict: an already-completed
  hard-excluded course (exclusion governs future scheduling; history stays truthful).
- `AcademicDecisionOutcome` gained **`infeasible`**, ranked above `blocked` and
  never apply-eligible; surfaced as `academicDecision.hardConstraints`.
- **Flag-off contract (documented + tested):** `AI_HARD_WANTED_CONSTRAINTS=false`
  routes the wanted picker back to the soft `g5` channel and produces no
  `mustIncludeCourseIds`; every new path is gated on that set being non-empty, so
  behavior is byte-identical to pre-Slice-18.

**Slice 18B — policy ≠ candidate identity, and real multi-combination search.**
- `candidate_set.ts` was rewritten. `generateCandidateSet` now takes **one
  resolved policy** and plans **every** candidate under it, with the same hard
  constraints, catalog and rules. After a confirmed `balanced`, no `compact` plan
  is retained (and vice versa).
- The balanced-vs-compact dual run survives ONLY as `probeBalanceImpact`, an
  internal elicitation probe that retains **no candidates**; `shouldAskBalanceQuestion`
  reads it. Answering still never auto-generates.
- **Search mechanism, chosen on repository evidence:** the single winner is chosen
  in exactly one place — `PlannerWorker.step()` commits the FIRST advancing action
  among already-legal, already-validated, already-ranked candidates. So the
  smallest mechanism that retains more than the greedy winner is a **bounded
  deterministic deviation**: `WorkerOptions.deviation = { atStep, rank }` commits
  the rank-th advancing action at one step, then continues greedily. **No second
  planner**, no randomness, no paid provider, bounded by `maxRuns` (default 8) and
  `maxCandidates` (default 3). (`planner_search_beam.ts` was considered and
  rejected: it drives the separate `PlannerAgent` path, so retaining its beam
  survivors would have meant switching production planning engines.)
- **Retention is the authoritative validator** (`validateCandidate`: completion,
  mandatory, categories, prerequisites, load caps, `must_exclude`, `must_include`)
  — a degraded plan is never an alternative. Zero valid candidates ⇒
  `outcome:'infeasible'`, `applyEligible:false`, never a fabricated plan.
- **Meaningful-distance rule (documented in-file):** two candidates differ iff
  their **normalized academic identity** — the sorted set of (course_id → period)
  pairs — differs. Invariant to object/array order, ids, explanation text and
  equivalent section ordering; and because one policy governs the whole set,
  balanced-vs-compact can no longer appear as a difference at all.
- **Ranking:** hard constraints/legality are the retention gate; retained
  candidates are ordered by the existing lexicographic `scorePlan` vector with the
  normalized identity as a stable final tie-break. Primary = rank 0.
  **No global-optimality claim is made** — this is a bounded deterministic search.
- **UI scope respected:** no candidate-comparison UI. The handler exposes only a
  **lean typed summary** (id, rank, normalized identity, selected flag, policy,
  profile version, provenance, course ids, factual differences, score vector) —
  no duplicate full plans. The UI still shows only the selected primary proposal;
  `infeasible` got a Hebrew label and reuses the existing blocking-errors
  disclosure.

### Verification (all run, all green)

- Production build at HEAD before changes, and again after: **green** both times.
- API suite: **139 suites / 1790 tests pass** (was 136/1730).
- `web/` suite: 12 suites / 102 tests pass. `tsc --noEmit` clean for both roots.
- New suites: `hard_wanted_constraints` (27), `candidate_multi_combination` (20),
  `generate_plan_hard_constraints` (11, through the REAL handler).
- Two pre-existing tests were updated because the NEW POLICY changes their
  expected behavior, and both changes are the policy working as intended:
  excluding a mandatory course now reports the more specific `infeasible` rather
  than the generic `blocked`; and a hard-wanted course with no sound catalog
  record now **blocks instead of being silently dropped**.
- `tests/ui/course_details_panel.test.js` contains a working-tree scope guard
  (`git diff HEAD -- api` must be empty) — it trips on any uncommitted backend
  work and clears once committed. Not a behavioral failure.

### Not done in this session (deliberately, per instruction)

No merge, no deploy, no internet access, no syllabus ingestion.

## KnowledgeCapability continuation contract (MANDATORY next sequence)

**The product is NOT complete until every item below is implemented and proven.**
Slice 18B deliberately ranks candidates on the objectives that exist today
(completion, requirements, legality, the confirmed distribution policy, existing
soft interests, difficulty). Product decision #3 requires ranking and explanation
grounded in **real, sourced course knowledge**, which does not exist yet. The
ranking stack already has a reserved slot for it, so these capabilities plug in
without another refactor. Implement in this order:

1. **Authoritative source registry and evidence model** — which sources are
   authoritative for which facts, with a typed evidence record (claim, source,
   retrieval time, confidence, provenance chain).
2. **Syllabus/document acquisition from official sources** — fetch from official
   TAU endpoints only; respect robots/ToS; no scraping of unofficial mirrors.
3. **Version / year / program matching** — bind each acquired document to the
   exact program version and catalog year it describes; never apply a document to
   a program version it was not published for.
4. **Structured extraction** — topics, assessment structure, project/lab content,
   workload signals, and skills, as typed records with per-field confidence.
5. **Conflict and freshness handling** — detect contradictions between sources,
   detect staleness, and surface both rather than silently choosing a winner
   (reuse the existing authoritative / non-answerable distinction).
6. **Deterministic cached course-knowledge records** — versioned, content-addressed,
   reproducible; the planner must never depend on a live fetch at request time.
7. **Map knowledge into explicit planner objectives** — each objective typed,
   separately toggleable, and slotted into the documented ranking order.
8. **Evidence that each objective changes ranking** — a test per objective proving
   it reorders candidates on a real fixture. An objective that cannot be shown to
   change ranking must not ship.
9. **Top-K candidate comparison using those grounded objectives** — the candidate
   set from Slice 18B, ranked and compared on real knowledge rather than
   structural facts alone.
10. **Explanation with source attribution** — every claim in a candidate's
    explanation traceable to an evidence record from step 1.

Only after step 10 does product decision #3 ("rank and explain them using
intelligent, source-grounded preferences") hold end to end.

## Session 2026-08-14 — completed-course knowledge + native completion workflow (flagged Apply UNBLOCKED)

**Blocker resolved.** The prior session's acceptance blocker (valid flagged Apply unreachable)
is closed: `outcome:'proposal'` / `applyEligible:true` is now reachable through a legitimate
explicit answer, and a real flagged Apply committed the board exactly once in the browser.

### Phase 1 — legacy archaeology (app/web/semester_board_viewer.html)
| Question | Finding (file evidence) |
|---|---|
| Modal | `openMyCoursesModal()` (13460) + `_renderMyCoursesGrid()` (13605); reached from the AI path via `OPEN_COMPLETED_COURSES` → `openCompletedCoursesUi()` (12814) |
| Course list | `YEAR_1_2_MANDATORY_COURSES` (2018–2043) — 24 static TAU-ME courses `{course_id,name_he,semester,credit_hours}`, grouped by `YEAR_1_2_SEMESTERS` |
| Why Years 1–2 | Those courses are **NOT in the board catalog** — the board holds Year 3+ only (comment at 2044–2047: they are not in `courseMap`, so accounting must fall back to the static table) |
| Electives | **Mandatory only** — no completed-elective path existed (the gap the user reported) |
| Status values | 4-way `not_taken | completed | currently_taking | planned` (`STATUS_SHORT` 13608) |
| Untouched | `getUserStatus` (13370) defaults to **`not_taken`** — legacy had NO `unknown`; untouched silently meant "not taken" |
| State owner | `userCourseStatuses[cid] = {status, planned_semester, override_reason}` |
| Persistence | `localStorage` `tau_user_course_statuses_v1` (2254), migrated from legacy `tau_my_courses` — survives refresh |
| Payload | `personal_status {completed,currently_taking,planned}` of `{course_id,name_he,hours}` (2383–2402); `not_taken` skipped (2386); ids in neither courseMap nor the Y1–2 table dropped (2393); **sent only when a list is non-empty, else `undefined` (2593)** → legacy also conflated "none" with "unknown" |
| Hours | `known_completed_hours = completed_status_hours` (2488–2499) — **DERIVED from the identified completed courses' authoritative hours**, not an independent aggregate (a separate manual `degreeHoursProfile` total also exists) |
| Planner consumption | completed ids → `excludedFromProposalIds` (2413) so never re-proposed; `_categoryPlacedCount` (2433) counts completed toward categories; `_year12PrereqIds` (11307) for prerequisites |
| Reusable vs replaced | REUSED: status vocabulary, authoritative-hours accounting, dedup/no-reschedule, category/prereq consumption. REPLACED: innerHTML grid, localStorage globals, the `not_taken` default |

### Contracts introduced
**Completed courses** — `api/ai/academic_status_knowledge.ts`:
`CourseIdKnowledge = known | known_empty | unknown` + provenance
(`explicit_user | authoritative_board | imported_record`). Wire marker
`plan_context.personal_status.completed_knowledge {status,provenance}`. **Absent → unknown**
(every legacy/unflagged caller byte-identical). A `known` claim with an unrecognized/absent
provenance falls back to unknown (fail-safe). `canonicalizeCourseIds` trims + de-dups
deterministically and never drops an unknown-to-catalog id silently.
`recognizedCompletedHours` sums only AUTHORITATIVE credits of uniquely identified courses —
derived, never additive onto an aggregate → **no double counting**; there is no code path from
an hours number to a course identity.

Server rule (`academic_clarification.ts`): the completedCourses gap now fires only while the set
is UNKNOWN. Not weakened — it stops conflating "none" with "never asked".

**Exclusions** — already correct server-side (`resolveHardExcludedCourseIds` returns `undefined`
when absent, `[]` when explicitly empty); the native UI simply never sent the key. Now: non-empty
selection = explicit; empty becomes an answer only via "אין קורסים שאני רוצה להימנע מהם" → `[]`;
untouched stays absent/unknown.

### Native workflow (replaces the legacy modal)
`shared/planner/early_year_courses.ts` — the Years 1–2 structure as typed DATA keyed by program
id (documented limitation: the catalog cannot identify early years, so this is the smallest
explicit typed configuration; components hold no course ids, other degrees are added as data).
`web/app/components/CompletedCoursesPanel.tsx` — **tri-state** per course
(completed/not_completed/**unknown**), explicit "none of these", catalog-backed completed-ELECTIVE
picker (new capability), removal/correction, recognized-credits summary from authoritative hours
only. Editing clears the confirmation and bumps a status version → a proposal built from older
status is stale → Apply blocked until an explicit Rebuild. Nothing in the panel Generates.

### Browser re-acceptance (local non-prod harness, deterministic)
- Unanswered Build → `clarification_required` / `applyEligible:false`, both criticals retained
  (**unknown is not treated as empty**).
- Panel saved as explicit "none" + explicit no-exclusions → Rebuild → `outcome:'proposal'`,
  `applyEligible:true`, criticals `[]`; candidates still the owner (`legacy_default`, proposal
  identity === `selectedNormalizedIdentity`).
- **Valid flagged Apply committed exactly once**: board went empty → C1@A + C2@B, draft cleared,
  Apply button removed (repeat structurally impossible), confirmation posted.
- One Build click = exactly one Generate (controlled delta); saving status / answering exclusions
  never generated.
- mechanical_engineering_2027: 4 semester fieldsets, **24 course groups**, explicit-none button,
  RTL, no horizontal overflow. Tri-state verified live (toggle returns to unknown); credits
  4.0 → 6.0 from authoritative data, each course counted once.
- Flag-off: no panel, no conversation, no new control, standalone Build, board renders — unchanged.
- Console/network: clean at rest (board 200, no error alert); earlier console entries are
  historical residue from the pre-fix load and the server-restart window.

**Verification:** full API **1730** (136 suites), full web **102** (12 suites), root+web tsc clean.
Commits: `8efadca` (knowledge contract), `aad8b21` (native completion UI + wiring).

**Remaining gaps (honest).** Category RECOGNITION for completed electives is not asserted by the
UI (it shows credits only and states that category comes from catalog data); the server's existing
authoritative rules do the category counting — a dedicated "uncertain recognition" surface is not
built. `known_completed_hours` remains the separate legacy aggregate the student types; it is NOT
merged with panel-derived credits (no double count, but also no unification yet). Wanted-course
semantics unchanged (soft/best-effort). currently_taking/planned are not collected natively.

## Session 2026-08-13 — flagged AI-planner journey: real-browser Preview acceptance

**Preview identity.** Local non-Production Preview (the only environment satisfying every
constraint: no Supabase, no paid provider, deterministic, non-prod). `dev_api_server.ts`
(`AI_DEV_MODE=true AI_DEV_BYPASS_QUOTA=true`, real root handlers, `DATABASE_URL=unset` →
`loadLocalBoardJson`, no DB/LLM) on :3002 behind `next dev` (:3001, `PLANNER_API_ORIGIN`
proxy). Deterministic Generate ≈15–30ms on the small fixtures (the 30–134s figure was the
full mechanical board), so the next-dev proxy timeout does NOT apply here. Vercel Production
untouched, no deploy, no alias change.

**Preview-only feature enablement (new, prod-safe).** `web/app/planner/native/agent-preview/
page.tsx` mounts `NativePlannerJourney` with `useAcademicDecisionAgent` on. Gated by
`process.env.ENABLE_ACADEMIC_AGENT_PREVIEW === '1'` (set only in git-ignored `web/.env.local`)
→ `notFound()` in every Production deployment; the canonical `/planner/native` page is
byte-identical and flag-off. `?program=` passes straight through (bypasses the registry) so
board fixtures are reachable; `?agent=0` renders the unflagged legacy path for comparison.
Fixtures: `test_program_agent_preview_2027` (2×8h dual electives, 16h target → material
balanced [8,8] vs compact [16,0]); `test_program_dual_balance_2027` (+`board_data_version` →
converged, 1 candidate, balance question suppressed). Commit `39c6f8c`.

**Verified in the REAL browser (accessibility-tree + network evidence; pixel screenshots
unavailable — Browser pane not composited).**
- Flag-off baseline (agent=0): board renders, NO conversation panel, standalone Build, legacy
  proposal [8,8], no candidate metadata leak, valid Apply commits exactly once, draft clears.
- Flag-on initial: `PreferenceConversation` visible, one question at a time, RTL, natural
  Hebrew (no ids as labels), "לא משנה לי" present, explicit Build, Build available without
  answering.
- No-auto-generate PROVEN by network count: select choice / "לא משנה לי" / free-text submit /
  confirm interpretation / remove all left the Generate count unchanged; only Build/Rebuild
  POSTs generate-plan.
- Candidate orchestration RAN in-browser and the proposal MATCHED the selected candidate
  (`selectedNormalizedIdentity` === the rendered board) every Build. First Build (no balance
  answer) → `legacy_default`, [8,8], validCandidateCount 2, hasMeaningfulAlternatives true.
  balanced → `confirmed_balanced` [8,8]; compact → `confirmed_compact` [16,0] (different
  candidate id; consolidation, not a first-semester bias — balanced distributes A+B);
  indifferent → `legacy_default`, identical candidate id/identity to neutral. Balance question
  appears once, is not re-asked after answering, and uses correct tradeoff Hebrew.
- Mobile 375px: no horizontal overflow, dir=rtl document+main.

**Defect found + fixed (RED→GREEN, TDD).** Impact-driven balance suppression only reacted to
`elicitationContext` at mount / on user transitions, so a `semester_balance` question already
on screen was NOT retracted when the first Build revealed the candidates converge
(`balanceAlternativesMaterial===false`) — it stayed askable though it could no longer change
the plan (acceptance blocker: "converged scenarios show no unnecessary question"). Fix:
`conversation_state.refreshQuestion` re-selects the current question against the latest ctx
(only while awaiting a question — never disturbs a pending confirmation/conflict/profile) +
a `PreferenceConversation` effect keyed on the irrelevant-topics set. New test
`PreferenceConversation.test.tsx` "reactive gating"; verified in-browser on the converged
fixture (balance question → time_of_day after Build). Commit `e50b493`.

**BLOCKER (pre-existing, unresolved) — flagged Apply unreachable in-browser.** The
`AcademicDecisionAgent` marks `completedCourses` and `excludedCourses` as CRITICAL clarifications
(academic_clarification.ts); unmet criticals → `outcome:'clarification_required'` →
`applyEligible:false` → `isProposalApplyable` correctly blocks Apply. The native `buildRequest`
hardcodes `personal_status.completed:[]` (prior completion is modeled as HOURS, no completed-
course-IDs input) and only sends `disallowed_course_ids` when the exclude picker is non-empty,
so `completedCourses` can never be cleared through the browser → a valid flagged Apply is not
reachable. Confirmed by curl: supplying `completed:[…]` + `disallowed_course_ids:[]` flips the
outcome to `proposal`/`applyEligible:true`. This is PRE-EXISTING (Slice 4 gating + native
completion-as-hours), surfaced by the first real browser journey. NOT fixed here (adding a
completed-courses input = new product capability, out of scope; changing clarification
criticality/sourcing = regression-sensitive core change — "do not weaken validation"). The
safety invariants it enforces are all correct (blocked/stale/version-mismatch/clarification
proposals cannot Apply; committed board never changes before a valid Apply). Recommended future
fix: source `completedCourseIds` from the board's `metadata.completed_course_ids` (+ the
journey's known_completed_hours), and send the exclude picker's value as `[]` when empty, so the
native journey answers the criticals it legitimately owns without weakening prerequisite checks.

**Late-response / stale Apply.** `NativePlannerJourney.build()` token guard (`++tokenRef.current`,
drop when `token !== tokenRef.current`) + version-gated `isProposalApplyable` — a browser race is
not reliably reproducible at ~20ms responses; covered by `NativePlannerJourney.agent.test.tsx`
(late response dropped; edit→stale→Apply rejected). In-browser: answering after a Build kept the
proposal non-applyable (version advanced), Apply stayed disabled.

**Automated verification (post-fix).** root tsc ✓; web tsc ✓; full API 1713/1713 (134 suites);
full web 92/92 (11 suites); web production build ✓ (new route builds dynamic/env-gated,
/planner/native unchanged). Lint not run (ESLint not non-interactively configured — pre-existing).

**Verdict.** Flagged journey is correct and browser-verified through conversation → Build →
candidates → balance question (+ materiality suppression) → answer → stale → Rebuild →
policy-selected proposal. Apply lifecycle on the flagged path is BLOCKED by the completedCourses
critical clarification (no native answer surface) → NOT production-ready for the flagged path;
flag-off unchanged. Do not recommend Production. Next smallest step: source completed courses
from board metadata / prior-hours so the flagged proposal reaches `applyEligible` legitimately,
then re-run the Apply-lifecycle acceptance.

## Session 2026-08-13 — candidate-set correctness gates (priority audit + neutral legacy selection)

**Gate 1 — objective-priority audit (no comparator change).** Traced the score vector
`[g1,g2a,g2b,g3,g4a,g4b,g5,g5b,gFit,g6]`. Finding: the order does NOT violate the required
hierarchy. HARD-AVOIDED (disallowed) is enforced at enumeration + validation
(`isCourseExcluded` gates `enumerateActions`; `validatePlanState` fails a plan with a
disallowed course) — ABOVE all scoring, so distribution can never place a hard-avoided
course. g5 (wanted) / g5b (unwanted) are SOFT terms, correctly BELOW the distribution
slots (distribution = required item 6, soft preferences = item 7); there is NO hard-wanted
gate (wanted = soft reward + recovery). Reordering would wrongly promote soft-wanted above
distribution and change legacy behavior → the correct action is to PROVE, not reorder.
`planner_priority_audit.test.ts` (6): disallowed never placed under any policy; distribution
can't defeat completion/mandatory; legal wanted still placed under compact. Test-only commit.

**Gate 2 — neutral = canonical legacy result (fix).** selectCandidate(neutral) no longer
means "first candidate" (order-dependent). `generateCandidateSet` runs an explicit 'neutral'
pass → records `legacyIdentity` (the flag-off stable result); neutral/indifferent selection
matches that identity independent of array/generation order; `selectionReason` labels it
`legacy_default` (never preference-derived). Proven: neutral == flag-off stable result;
reversing generation order doesn't change neutral selection; indifferent == neutral.
`candidate_set_neutral.test.ts` (4).

**Deferred — live candidate wiring (objectives 3–5).** Both gates were the explicit
prerequisite ("do not wire until proven") and are now proven. The live wiring (single
orchestration owner in generate-plan building the proposal from the selected candidate +
response metadata + impact-driven balance question through the real conversation state
machine + full Build→candidates→question→proposal→Apply lifecycle) is a large,
regression-sensitive refactor of the intricate planner-execution block — next session.
Note: the resolved distributionPolicy is ALREADY threaded into the single planner run
(17A), so the current proposal already reflects the selected policy; the wiring adds
candidate metadata + the gated question, ideally by building the proposal from the
candidate set as the single owner.

## Session 2026-08-13 — live candidate orchestration + impact-driven elicitation

**Slice 1 — candidate set is the single flagged proposal owner** (committed). generate-plan's
flagged path runs `generateCandidateSet` (neutral+balanced+compact through the SAME stable
planner over the current board/initialState — never emptyState), validates + dedups, selects
by resolved policy or canonical `legacy_default`, and builds the proposal from the SELECTED
candidate's exact PlanState (one selected state, one toProposal path, no post-selection rerun).
Provenance proven: proposal normalized identity === selected candidate id. Rationale parity:
the candidate carries `worker.explain().summary_he`, so the proposal is byte-identical to the
default single-run for the same state (fixed a rationale-only parity break found via
systematic-debugging). Lean metadata at `academicDecision.candidates` (selectedCandidateId,
selectedPolicy, selectionReason, validCandidateCount, hasMeaningfulAlternatives, converged,
contributingPolicies, differenceSummary, profileVersion, selectedNormalizedIdentity) — no full
PlanStates to the UI. Neutral/indifferent == flag-off (order-independent). Flag-off unchanged.
Tests: generate_plan_candidate_orchestration.test.ts (7); full API byte-identical.

**Slice 2 — impact-driven balance elicitation** (committed). `hasMeaningfulAlternatives` threaded
wire→adapter→GeneratedPlanModel.balanceAlternativesMaterial → the mounted journey passes an
ElicitationContext to PreferenceConversation; when a Generate's candidates showed no material
difference, semester_balance is marked `irrelevantTopicIds` so the REAL elicitation skips it (no
parallel store/banner). Test: PreferenceConversation (+1). Existing journey lifecycle tests
(answer≠Generate, edit→stale, Rebuild→profile, version-gated Apply) unchanged.

**Wanted-course semantic gap (recorded, unchanged):** disallowed/avoid is hard (enumeration +
validation); WANTED remains soft/best-effort (g5 + recovery) — the system does NOT guarantee
inclusion of every explicitly wanted course. Not redesigned (out of scope).

## Session 2026-08-12 (cont. 4) — Slice 17A investigation gate + planner policy consumption

**Investigation gate (mandatory, evidence-based).** Traced generate-plan → PlannerWorker →
scorePlan → PlanState:
- `PlannerWorker.step()` (planner_worker.ts:356-445) enumerates ALL legal mutations
  (`enumerateActions`), applies each to a `next` state, scores each with `scorePlan` (imm),
  sorts by `compareScore`, rollout-scores top-N (`estimateFinalScore`), accepts the best
  that advances. So scoring drives SELECTION, not just evaluation.
- `enumerateActions` emits "one alternative ADD_COURSE per legal semester"
  (planner_worker.ts:264) — semester placement for a dual-period course is chosen by
  `step()`'s scorePlan/compareScore comparison.
- g4a (peak) / g4b (spread) live in the score vector and participate in that per-step
  selection + rollout. Changing them CAN change the selected placement.
- Semester-A bias exists only on EXACT score ties (stable sort keeps enumeration order =
  earliest first) — the existing deterministic legacy tiebreak.
Conclusion: the stable planner already retains alternatives long enough for scoring to
affect selection. No new choice boundary needed for 17A — thread the policy into scorePlan
via the shared `model` (reaches every call), provable end-to-end via PlannerWorker.run().

**Slice 17A — real distribution-policy consumption** (committed). `scorePlan` reads
`model.distributionPolicy` for its OWNED slots (g4a/g4b) only: neutral/balanced = legacy
peak-then-spread (byte-identical); compact = fewer ACTIVE periods (order-invariant, no
earlier-period reward). Threaded via `DistributionPolicy` on `ConstraintModel` +
`BuildModelOptions`; generate-plan resolves the policy ONCE from `preference_profile`
(single source of truth, also drives eligibility disclosure) → `buildModel`; neutral →
undefined (byte-identical). Response exposes `academicDecision.distributionPolicy` +
provenance. End-to-end proof: PlannerWorker selects [8,8] under balanced, [16,0] under
compact on the same fixture. Priority preserved (g1/g2/g3 dominate). Full API 1684/1684.

**Slice 17B — internal validated candidate set** (committed). `candidate_set.ts`:
same engine per policy → existing validator → normalized-identity dedup → deterministic
FNV-1a id → real diff summary; `selectCandidate` (confirmed pref → matching candidate;
neutral → legacy first); `shouldAskBalanceQuestion` (ask one question only when ≥2
distinct legal candidates differ materially and unanswered; never on convergence).
Convergence → one candidate + empty summary. Internal module only — NOT yet wired into
the live proposal path (single-proposal UI unaffected); no Simulation/Decision/UI.
12 tests. **Remaining:** wire candidate generation + selection + the gated question into
the live flagged generate path (the single-proposal UI receives only the selected
candidate) — the final integration step.

## Session 2026-08-12 (cont. 3) — live conversation integration closure + distribution-policy mapping

**Integration closure (Slices 13/14 live).** `NativePlannerJourney` now mounts the real
`PreferenceConversation` on the flagged path. Single source of truth: the component owns
the one typed `ConversationState`; the journey mirrors only the profile VERSION scalar
(staleness) + holds the latest profile in a ref (Build payload). The conversation's
`onBuild(profile)` is the sole generation trigger when flagged (standalone Build renders
only flag-off). Proven end-to-end (no browser): answers/confirm/reject/edit/remove never
Generate; explicit Build sends the exact typed `preference_profile {version,preferences}`;
edit-after-Generate advances the version → proposal stale → the REAL Apply handler rejects
it (isProposalApplyable currentProfileVersion + the hard `apply()` guard, not a disabled
button); a late response superseded by a newer Build is dropped by the existing generation
token; valid Apply commits once. Flag-off byte-identical. `PreferenceConversation` no
longer calls `markPlanning` on Build (generation ownership belongs to the real action).
Tests: `NativePlannerJourney.agent.test.tsx` (7). Commit — feat(web): ...slice 13/14 closure.

**Slice 17A part 1 — distribution-policy mapping** (`distribution_policy.ts`):
`resolveDistributionPolicy` maps a confirmed active `semester_balance` → balanced|compact|
neutral; never infers compactness from missing data; provenance preserved. 6 tests.
**Deferred (own session, regression-sensitive):** 17A scorer consumption (make g4a/g4b
policy-dependent + thread through PlannerWorker/generate-plan; neutral must stay
byte-identical) and 17B (candidate-set retention + normalized dedup + preference-sensitive
elicitation). Design ready.

## Session 2026-08-12 (cont. 2) — preference lifecycle through Generate (14) + conversation UI (13)

**Slice 14 — preference lifecycle through Generate + Apply version gate.**
`preference_eligibility.ts` (`effectivePlannerPreferences`): classification filtering
BEFORE planning — confirmed hard→legality bucket, confirmed soft/goal→ranking bucket,
indifferent/uncertain/unconfirmed→excluded with a deterministic reason (never silently
dropped); source preserved (safe_default distinguishable). Generate request gains optional
typed `preference_profile {version,preferences[]}` (typed profile is the source of truth,
not the transcript). Flagged response echoes `academicDecision.profileVersion` +
`preferenceEligibility {hard,soft,excluded}`. Apply boundary (`isProposalApplyable`) now
rejects a flagged proposal whose `profileVersion` differs from / is missing against the
current draft profile version — at the real gate, not UI-hidden. Flag-off byte-identical.
No scorePlan consumption claimed (that's 17); unsupported categories stay typed, never
become hard constraints. Tests: preference_eligibility (5), generate_plan_preference_profile
(4), apply-eligibility (+4). Commit — feat(agent): ...slice 14.

**Slice 13 — native conversation UI (component).** `PreferenceConversation` is a thin
driver over the REAL `conversation_state` machine + elicitation (no parallel model): one
question at a time, options + "לא משנה לי" + free text, confirmation for vague consequential
answers, "מה הבנתי ממך" summary with remove, ready-to-build state. Answers/confirm/reject/
remove update DRAFT state only and never Generate; only Build calls onBuild(profile). Added
`removeCapturedPreference`/`rejectPending` transitions. 9 behavioral tests. web tsc clean.
**Remaining integration:** mount `PreferenceConversation` in `NativePlannerJourney` and route
its `onBuild` through the real generate request (`preference_profile` + `currentProfileVersion`
into `isProposalApplyable`). Deferred to keep the change safe (no broad journey redesign this
budget).

**Slice 17 — NOT STARTED** (planner balance policy + candidate-set retention + dedup). Design
ready from the Slice 16 investigation (two balance policies over the stable scorer,
candidate contract). It touches core `scorePlan`/candidate machinery and must preserve every
planner regression — reserved for its own full-rigor session.

## Session 2026-08-12 (cont.) — preference elicitation core + outcome details (slices 9–12, 15) + candidate investigation (16)

**Slice 10 — typed preference model** (`preference_model.ts`): generic Preference
(id, category, originalWording, normalized, value, classification [hard_constraint|
soft_preference|goal|indifferent|uncertain], confidence, source, confirmationStatus,
affects, scope/expiry, mayAffectPlanningBeforeConfirmation) + versioned
PreferenceProfile. Invariant: vague → uncertain + inert, never a hard constraint.

**Slice 11 — DeterministicPreferenceElicitation** (`preference_elicitation.ts`):
impact-driven single-question selection over a generic catalog; skips known/irrelevant/
cosmetic; sufficiency = nothing impactful left; vague answer → uncertain +
requiresConfirmation; contradictions surfaced. No external provider.

**Slice 12 — conversation state machine** (`conversation_state.ts`): typed bounded state
(status/profile/currentQuestion/pendingInterpretation/conflicts/proposalProfileVersion/
rebuildRequired). Answers update draft only, never auto-generate; proposal records
profile version; later change → stale + rebuildRequired; revise bumps version.

**Slice 9 — AgentOutcomeDetails** (web): accessible progressive disclosure (aria-expanded
toggle, labelled region, text-not-color) for clarification_required/validation_failed/
blocked/error; answerable vs authoritative distinction, provenance, safe error copy.
Lean VMs threaded wire→adapter→GeneratedPlanModel→DraftVM; rendered in the draft view.

**Slice 15 — authoritative_resolution.ts**: narrow auditable domain contract for an
AUTHORIZED actor to correct an academic fact (fixed AUTHORITY_TYPES; requires
provenance+actor+timestamp+original facts). Rejected without authority/provenance.
Contract only — no student-facing control, no persistence.

**Slice 16 — candidate-readiness investigation (read-only).** `scorePlan` (planner_goals.ts)
is a lexicographic vector `[g1,g2a,g2b,g3,g4a,g4b,g5,g5b,gFit,g6]`:
completion(g1) > mandatory(g2a) > categories(g2b) > legality/workload-cap(g3) >
balance-peak(g4a) > balance-spread(g4b) > wanted(g5) > unwanted-avoid(g5b) >
interest-fit(gFit) > difficulty(g6). **Exam load, morning/free-days: NOT represented.**
The `PlannerWorker` is greedy/rollout (topN) and `BeamSearchStrategy` (beamWidth 6)
collapse to ONE `getPlan()` — no distinct candidate SET is retained/compared. Alternatives
are discarded at each step's topN truncation and final single-plan selection. Dual-semester
A/B: balance (g4a/g4b) already lets B be chosen to cut peak ("[16,4] beats [20,0]"), but
the course is placed once, not kept as an alternative; `semester_balance` (compact vs
balanced) preference is elicited but NOT yet consumed by scorePlan (always balances).
**Smallest next candidate slice:** run the stable planner twice under two balance policies
(balanced vs compact) → two distinct legal candidates distinguished by `semester_balance`;
reuses existing scoring, needs no new search. (Deferred — Simulation/Decision not authorized.)

Remaining: Slice 13 (full conversational UI) and Slice 14 (thread confirmed preferences +
profile version through Generate, stale-profile Apply rejection) — next.

## Session 2026-08-12 — class-native grounding/validation/clarification stages (slices 5–8)

**THERMO-2 web test** — diagnosed (systematic-debugging) as a STALE test, not a
regression: commit 92f473a turned the native exclude control into a CourseNamePicker
(id added only on ranked-match selection); the MVP test (e7c0e14) typed a raw id and
expected exclusion without selecting. Hard-exclude mapping intact; planner invariant
covered by API regressions. Fixed by driving the picker (add THERMO-2 to the board,
type the name, select) — committed separately.

**Slice 5 — class-native GroundingCapability.** `AcademicDecisionAgent.run()` now owns
grounding: narrow `GroundingCapability` + default `PlanGroundingCapability`, invoked
AFTER Plan (grounds placed courses — documented ordering deviation), returned on
`AcademicDecisionResult.grounding`. Wrapper no longer calls `groundPlan` (single owner).

**Slice 6 — grounding-consuming ValidationCapability.** `DeterministicGroundingValidation`:
class-native stage turning unresolved authoritative conflicts into typed,
provenance-carrying findings (`GROUNDING_AVAILABILITY_CONFLICT` /
`GROUNDING_COMPLETION_CONFLICT`, severity error) that block Apply. Never re-plans,
never picks a source, never downgrades known facts or blocks on non-critical unknowns.
API `validation_failed` now derived from `agentRun.validation.applyBlocked` (real agent
result, not an API re-count); findings at `academicDecision.validationFindings`.

**Slice 7 — unified structured clarification.** `buildStructuredClarification` projects
clarification + validation into one list preserving the distinction:
`answerable_preference` (user-resolvable, answerType+inputKey; critical blocks Apply) vs
`authoritative_conflict` (answerable:false, provenance, blocks Apply — user never asked
to invent academic truth). At `academicDecision.structuredClarification`.

**Slice 8 — dev-only native flag.** Injectable `useAcademicDecisionAgent` prop (default
false) on `NativePlannerJourney`; Build sends `use_academic_decision_agent:true` only
when set. Production page never sets it → feature stays off. Tests prove both payloads.

Final `AcademicDecisionAgent.run()` sequence: Observe → detectGaps → Clarify → Plan
(injected stable planner) → **Ground** → **GroundingValidation** → (state Validate if
wired) → Simulate → Decide → Persist.

Verification: API 1623/1623, web 64/64, root+web tsc clean. Lint: ESLint not configured
in repo (interactive setup prompt) — pre-existing, unchanged. No paid provider, no
Supabase, no browser/Preview. Production/main/Vercel/env unchanged.

## Session 2026-08-11 (cont.) — real AcademicDecisionAgent class integration + Knowledge Grounding (owner-authorised)

Owner authorised integrating the real `AcademicDecisionAgent` class behind the
default-off flag, with the stable planner injected as its PlanningCapability (no
emptyState re-planning, proposal parity preserved).

**Slice 1+2 — real class/factory executes on the flagged Generate path** (commit
`1c262fb`). New `academic_decision_integration.ts` is the injection seam: reuses
the already-loaded board + already-built model as the ProgramProvider, wraps the
stable planner's final `PlanState` as the injected `AgentResult`, reuses the
already-computed `ClarificationResult`. So the real class runs its full
Observe→detectGaps→Clarify→Plan→Validate→Decide→Persist pipeline while the plan
stays byte-identical. `academicDecision.orchestration.engine ===
'AcademicDecisionAgent'` is class-only proof (adapter fallback marks
`'runtime-adapter-fallback'`). LEGACY_KEYS untouched (metadata nested inside
`academicDecision`). Controlled failure → adapter fallback, committed state never
touched. TDD: `generate_plan_academic_decision_agent_class.test.ts` RED→GREEN.

**Slice 3 — plan-inert Knowledge Grounding on the flagged path** (commit
`22f8913`). New `plan_grounding.ts` classifies every placed course's facts as
known/unknown/inferred/conflicting with provenance, and surfaces structured
conflicts (catalog `offered_semesters` vs normalized `effective_allowed_semesters`;
user-asserted-completed course also placed). Deterministic, no LLM/I/O, never
mutates the plan or fabricates a fact. Invoked from `academic_decision_integration.ts`
on the real flagged path (not a bare unit call), exposed at
`academicDecision.grounding`. TDD: `plan_grounding.test.ts` (8 unit) + integration
assertions (invoked/plan-inert/grounds-only-placed) RED→GREEN.

**Slice 4 — structured agent outcomes + Apply-eligibility** (commit `2e7aa65`).
`classifyAgentOutcome` (error > blocked > clarification_required > proposal) at
`academicDecision.outcome`; `applyEligible` server floor (true only for a clean
proposal). A draft is always still returned; Generate never mutates the committed
board. TDD: `academic_decision_outcome.test.ts` + integration outcome assertions
RED→GREEN.

**Slice 3b — grounded conflicts drive a structured outcome** (commit follows).
An unresolved grounding conflict on a placed course now yields
`academicDecision.outcome='validation_failed'` + `applyEligible=false` instead of a
clean proposal; neither source is silently chosen, the plan is unchanged, both facts
+ provenance survive. Outcome precedence: error > blocked > clarification_required >
validation_failed > proposal. TDD: `generate_plan_grounding_conflict.test.ts`
(full-boundary, generic mocked synthetic board — no catalog patch) +
`academic_decision_outcome.test.ts` RED→GREEN.

**Slice 4-ui — native contract for the 5 outcomes** (commit follows). Wire schema
types `academicDecision.outcome/applyEligible`; `generatePlanResponseToModel` maps
them onto `GeneratedPlanModel` (undefined on the legacy response); `buildDraftVM`
carries them into `DraftVM`. New pure `isProposalApplyable(proposal, stale)` is the
single native Apply gate — preserves blocked/errored/stale, and blocks Apply when
`applyEligible===false` even with no blocking error. `NativePlannerJourney` uses it +
renders a Hebrew badge per non-proposal outcome. Draft invariants unchanged. TDD:
`apply-eligibility.test.ts` + `draft-vm.test.ts` RED→GREEN. Root + web `tsc` clean.
Native UI now **consumes** `academicDecision` (was: not integrated).

Pre-existing unrelated failure: `NativePlannerJourney.test.tsx` THERMO-2 preferences
test fails at HEAD `8313c3b` independent of this work (proven by stash) — flagged as a
separate task, not touched.

**Corrected status (was overclaimed in the prior section as "reachable"):**
- Runtime adapter — reachable (unchanged).
- **AcademicDecisionAgent CLASS — now reachable/executing on the flagged path**
  (stable planner injected; proposal parity proven).
- **Knowledge Grounding — now invoked (plan-inert) on the flagged path.**

Default-off preserved; default response backward-compatible (LEGACY_KEYS). No paid
provider, no Supabase, no browser/Preview. Production/`main`/aliases/Vercel
unchanged. Native web/ app does NOT yet consume `academicDecision` → native-UI
contract tests deferred until that consumer seam is built.

## Session 2026-08-11 — planner-quality: wanted-course prerequisite recovery (issue #75 fixed)

**Starting state verified.** Branch `ui/frontend-modernization`, HEAD `ae4c68e`
== remote, clean tree. No unrelated uncommitted/untracked work. Test cmd
`npx jest --testPathPattern=tests/api` (+ `jest.ui.config.js`), `tsc --noEmit`.

**Integration-gap map (code evidence).** Active Generate path: native UI →
`POST /api/ai/generate-plan` → default `buildModel`→planner→`proposal` (stable).
`use_academic_decision_agent` (generate-plan.ts:132/1395/1708) drives (a)
pre-plan `clarifyForAcademicDecision` and (b) post-plan `buildAcademicDecision`
(academic_decision_runtime.ts) — an ADAPTER that WRAPS the already-generated
proposal (validation/evaluation/decision/explanation), NOT the
`AcademicDecisionAgent` class. That class + `createDefaultAcademicDecisionAgent`
factory remain **implemented-but-unintegrated** by deliberate design (their Plan
stage `runPlanningOrchestration` builds a different model from emptyState →
would change the plan; documented at academic_decision_runtime.ts:20-27).
Knowledge Grounding Slice 1 (`KnowledgeCapability`, 679ce47) is plan-inert /
reachable only via `runPlanningOrchestration` → **not used by the active
generate path**. Default-path response is locked byte-identical by
`LEGACY_KEYS` (generate_plan_academic_decision_agent.test.ts:67) — so a
top-level path-diagnostics field is intentionally NOT added (would break that
deliberate contract; the agent path is already observable by the presence of
`academicDecision`).

**Slice implemented (Workstream D — wanted-course enforcement).** Fixed
**issue #75** (was an `it.skip` in planner_orchestrator.test.ts:200, documented
as cross-cutting and deferred by prior sessions). Root cause: a wanted course
whose own bare-elective prerequisite is removed is unrecoverable — group 3
offers the wanted course but it fails strict-timing legality, the prerequisite
is only offered by the degree-fill group (gated off once degree hours are met),
and step()'s strict-improvement gate + the greedy rollout (same invariant)
cannot chain the two-step unlock. Fix: `PlannerWorker.recoverUnplacedWantedCourses`
— a deterministic finishing pass at run() convergence that places a wanted
course TOGETHER WITH its missing prerequisite chain atomically, committing only
when the bundle is valid AND strictly out-scores the current plan
(peak-minimizing layout preserves balance objective g4a). Monotonic-safe (never
a worse/illegal plan); seeded only from `wantedCourseIds` and kept OUT of
`requiredButUnplacedCourseIds` so `remainingMandatoryHours` reservation scoring
is untouched — the exact cross-cutting risk #75 flagged.

**Verification.** issue #75 test RED (WANTED absent) → GREEN. Full API suite
**115 suites / 1583 tests pass**; `tsc --noEmit` clean. No paid provider, no
Supabase, no browser/Preview (deferred per owner). Commit `4965004` on
`ui/frontend-modernization`. Production/`main`/aliases/Vercel settings
unchanged; unrelated work preserved.

## Session 2026-08-08 (cont.) — live enrichment run EXECUTED; promotion structurally blocked (no cache change)

**Owner unblocked both prerequisites** (verified by name only, secret value never retrieved): gh token now
carries the `workflow` scope, and GitHub Actions secret `OPENAI_API_KEY` exists (`gh secret list`).

**Workflow landed on default branch.** Opened a single-file PR (`.github/workflows/enrich-syllabi.yml`,
copied byte-identical from `c97ea6f` — blob `345a87a…` matched on both PR and `c97ea6f`) targeting `main`;
merged as **PR #80** (mergeCommit `b406a7d`). `main` is unprotected; `ci.yml` on `main` runs tests only (no
deploy step); Vercel project is **not connected to a Git repo** (owner-confirmed) → the merge cannot deploy.
Production/aliases unchanged.

**Genuine live run confirmed.** Dispatched workflow (id **329892984**) against `ref: ui/frontend-modernization`,
inputs `program=mechanical_engineering_2027`, `courses=0542-4425,0571-4174,0542-4226,0542-4420`.
Run **31251292816** — success. Provider/model: **OpenAI `gpt-4o-mini`** (`llm:gpt-4o-mini`). Log:
`[enrich] LIVE semantic extraction via llm:gpt-4o-mini`. Per-course status:
- `0542-4425` **enriched (live)** accepted=1 — explicit/0.9; matches reviewed `explicit`.
- `0542-4226` **enriched (live)** accepted=1 — explicit/0.9 — **OVER-CLASSIFIES** vs reviewed `derived`.
- `0571-4174` **provider_failed_kept_previous** — no live result; kept captured `derived`/0.6.
- `0542-4420` **provider_failed_kept_previous** — no live result; kept captured (no evidence).

**Artifact validated** (`enriched-profile-mechanical_engineering_2027`, id 9020080496): no secrets. Every
`snapshotHash` re-matched a freshly-built snapshot; every live excerpt is grounded **verbatim** in
`normalizedContent`; offsets consistent. Live spans for 0542-4425 (SOLIDWORKS/FEA/Injection-Molding phrases)
differ entirely from the captured fixture spans (`שיטות התכן`,`לתכן מתקדם`) → the live result is genuinely
model-produced, **not** a copy/rename of captured evidence.

**PROMOTION STRUCTURALLY BLOCKED → committed cache UNCHANGED (stays `captured`, honestly labeled).** Three
independent reasons: (1) the committed cache's homogeneity invariant — `semantic_provider_boundary.test.ts`
asserts every profile's `extractorKind` equals the top-level kind — forbids a mixed 1-live/6-captured cache;
(2) a full `live_semantic` promotion is unachievable from this run (only 4 of the 7 cached courses were in the
allowlist; 2 of those 4 hit provider failures); (3) promoting 0542-4226's live `explicit`/0.9 would break
`semantic_enrichment_acceptance.test.ts` (expects that course `derived`, ≤0.6) and would over-state a
precision-oriented claim beyond human review. So no `live_semantic` cache entry was written. The run stands as
**verified external validation** of the captured cache (0542-4425 confirmed), not a promotion.

**Planner control-vs-focus (rerun via the acceptance suite).** Design-focus (`interpret_free_text` +
`extra_request_he:'…להתמקד בתכן'`) places `0542-4425` where control does not (evidence-backed, cited) — but
that course is `explicit` design the **legacy** extractor also catches. Semantic-ONLY courses
(`0571-4174`,`0542-4226`) reach the fit map and influence fit-score (fit==cache strength) but are never shown
to flip a final legal proposal. Distinction holds: evidence→matcher ✓, fit-score influence ✓, final legal
proposal change ✗ for semantic-only. **`semantic-only planner decision acceptance: data-blocked` RETAINED.**

**Generate consumes the committed cache with NO model invocation** — `api/ai/generate-plan.ts` imports only
`loadEnrichedProfileCache`/`lookupProfile` (no `LlmSemanticExtractionProvider`/`ClaimSpecProvider`); boundary
test green.

**Gates (all green):** root `tsc --noEmit` ✓; web `tsc --noEmit` ✓; web `next build` ✓; full API suite
**1535 passed** (1 skipped) ✓; UI suite **835 passed** ✓. Working tree clean apart from this doc.

**Production unchanged; no preview created.** Change is documentation-only (no functional/UI delta), Vercel is
not Git-connected, no Vercel CLI is installed, and the sole available deploy MCP remains unsuited for this repo
— a preview would prove nothing, so none was made (not fabricated).

## Session 2026-08-08 — protected enrichment workflow + Supabase-503 diagnosis; live run owner-blocked

**Accepted baseline:** `5b6aa86` (HEAD=origin, clean tree). Production unchanged. Focus: close the
live-run gap via a protected execution mechanism, and diagnose the preview Supabase 503.

**Protected execution mechanism (implemented).** `.github/workflows/enrich-syllabi.yml` — a
manually-dispatched (`workflow_dispatch`) GitHub Actions workflow that runs the REAL
`scripts/enrich_syllabi.ts --live` (LlmSemanticExtractionProvider) and uploads the validated profile
as a REVIEWABLE ARTIFACT. Security boundary: dispatch-only (collaborators/write-access only);
`permissions: contents: read` (cannot push or deploy); inputs passed via env (`"$PROGRAM"`/`"$COURSES"`),
never interpolated into the shell → no command injection; a new `parseCourseAllowlist` re-validates the
allowlist (strict `NNNN-NNNN`, max 12) and bounds model calls to one per course; `timeout-minutes: 10`;
fails fast with the exact required-secret message if no provider credential is present; no secret/full-
prompt logging.

**Credential availability by environment (names only, never values).**
- Local: NO provider key (`OPENAI_/ANTHROPIC_/GOOGLE_*_API_KEY` absent; Vercel-Sensitive values pull as
  empty) → `resolveModel()` = null.
- Vercel Preview/Production: `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`AI_PROVIDER` configured but **Sensitive**
  (not retrievable to any non-runtime environment).
- **GitHub Actions: NO provider secret** (`gh secret list` empty).

**LIVE RUN — NOT PERFORMED (owner-blocked, two exact actions).** Dispatch of the workflow returned
`HTTP 404: workflow not found on the default branch` — GitHub only exposes `workflow_dispatch` for
workflows present on the **default branch (`main`)**; the workflow is on `ui/frontend-modernization`, and
this run must not merge. So a live run requires the OWNER to: **(1)** land
`.github/workflows/enrich-syllabi.yml` on the default branch (merge), and **(2)** add a GitHub Actions
repository secret **`OPENAI_API_KEY`** (or `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`; optional
`AI_PROVIDER`). No local key exists and I did not ask for or fabricate one. **No live_semantic profile was
produced this run; the committed cache remains `extractorKind:'captured'`** (honestly labeled; never
relabeled live). Gaps 1–3 remain OPEN pending those owner actions; the mechanism to close them is now in
place and tested.

**Preview Supabase 503 — ROOT CAUSE DIAGNOSED (external, owner-only; no code defect).** The failing call
is `POST /api/ai/generate-plan` → `runQuotaCheck` → `checkAndEnsureSession` (generate-plan.ts:147). When
the quota-check DB is unreachable it throws (verified locally: `getaddrinfo ENOTFOUND` on the pooler host)
→ fail-closed **503 `DB_ERROR` phase `quota_check`**. The app's Supabase project `lxwtycowmqosuyfumcbo`
(tau-course-planner, eu-north-1) is **currently `ACTIVE_HEALTHY`** — the 503 was the **free-tier
auto-pause** (paused project → pooler DNS NXDOMAIN → throw). This is correct fail-closed behavior:
generation must NOT bypass the quota/authorization policy when the DB is down (a test now locks this;
`AI_TEST_MODE` does not rescue a DB-down check). **Not a code defect — no code change.** Owner action for a
permanent fix: keep the DB reachable (upgrade the Supabase project off the auto-pausing free tier, or add a
keep-alive). While the project is ACTIVE, preview Generate is not DB-blocked; it re-pauses on inactivity.
(The board-load path already has a local fallback; the quota path deliberately does not.)

**RED→GREEN.** enrich_workflow.test.ts (7): parseCourseAllowlist accepts valid/dedupes/empty, rejects
shell-metachar/arbitrary tokens and over-cap sets; the committed workflow is dispatch-only, cannot
push/deploy, invokes `--live` (not ClaimSpecProvider), passes inputs via env (no injection), gates on the
secret. generate_plan_quota_db_error.test.ts (2): DB-unreachable → 503 DB_ERROR/quota_check, no plan
generated, `AI_TEST_MODE` no bypass. (Existing boundary tests already cover: Generate imports no provider;
captured never relabeled live; live run tags live_semantic + calls provider once/course; provider failure
keeps previous profile; version invalidation.)

**Planner decision (unchanged, honest).** No live profile exists yet, so no re-run against live evidence
was possible. Semantic-only status retained: **semantic-only planner decision acceptance: data-blocked**
(0571-4174/0542-4226 reach the fit map but never change the final generated plan on this board;
searched again k=84..100 last run — not manufactured). Matcher influence ≠ final-plan change: the cached
semantic-only evidence DOES reach the fit map (proven), but does NOT change the final legal proposal.

**Files changed.** New: `.github/workflows/enrich-syllabi.yml`, tests/api/enrich_workflow.test.ts,
tests/api/generate_plan_quota_db_error.test.ts. Modified: api/ai/syllabus_enrichment.ts (parseCourseAllowlist),
scripts/enrich_syllabi.ts (--courses). No production data relabeled.

**Verification.** Full API 1536 (1535 passed, 1 skipped); full UI 835/835 (clean tree, guard passes);
root+web typechecks clean; web build clean. Pre-existing: 38 pytest failures (no Python touched);
side-effect file restored, not staged. Live workflow NOT executed (owner-blocked, above).

**Production prerequisites (updated).** Before live semantic evidence can ship: (1) land the enrichment
workflow on the default branch; (2) add the `OPENAI_API_KEY` GitHub Actions secret; (3) dispatch the
workflow for the reviewed course allowlist; (4) review the artifact + re-verify grounding locally; (5)
commit the `live_semantic` cache; (6) keep Supabase reachable (upgrade off free tier) so preview/prod
Generate isn't 503'd by auto-pause. Everything else (real provider, validator, versioned cache, provenance,
deterministic wiring, deployment-safe artifact) is in place.

**Next recommended slice.** Once the two owner actions are done, execute the workflow (live), promote the
cache to `live_semantic`, and re-run the control-vs-focus acceptance against live evidence; then revisit the
data-blocked semantic-only decision on a program/state where a legacy-missed course is decision-relevant.

## Session 2026-08-07 (d) — REAL semantic provider (LLM) + protected enrichment; live call credential-blocked

**Accepted baseline:** `c1154b9` (HEAD=origin, clean tree). Production unchanged. This slice
turns the c1154b9 foundation into a production-capable real-model path and removes the manual
claims from the authoritative provider role.

**Manual-claim limitation removed.** `ClaimSpecProvider` (human-authored captured claims) is no
longer the intended production provider — it is now the deterministic test fixture / captured
evaluation artifact / comparison tool. A real model provider replaces it on the authoritative path.

**Real semantic provider (`api/ai/llm_semantic_provider.ts`, executable production code).**
`LlmSemanticExtractionProvider` uses the repo's existing AI SDK abstraction: `resolveModel()`
(course-planner.ts → `ai` `generateObject` with a strict zod schema). Guarantees: the syllabus
snapshot is the ONLY prompt authority (title excluded; no course ids / expected classifications /
planner choices injected — only a neutral bilingual capability gloss); bounded input (8k chars),
timeout (raced, 30s), retries (2); provider/timeout/parse/schema/no_model failures are CLASSIFIED
(`SemanticProviderError.kind`); the model returns verbatim excerpts only and WE compute offsets
against the snapshot (buildCapturedExtraction) so a bad offset can't smuggle a claim past grounding;
raw output never reaches the user; injectable `generate`/`model` for tests; NEVER imported by
generate-plan (Generate stays deterministic). Model default gpt-4o-mini (Hebrew-capable) via
resolveModel's OpenAI→Anthropic→Google fallback.

**Protected enrichment (`scripts/enrich_syllabi.ts --live`).** `--live` instantiates the real
provider (throws `no_model` naming the exact env vars if no credential), runs one real model call
per evaluated course, validates deterministically, fail-closed preserves the previous valid profile
on failure, and writes a validated, versioned, provenance-tagged profile. Not a public endpoint (a
script/job). Default (no `--live`) uses the captured fixture. Distinguishes enriched / no_content /
provider_failed_kept_previous / provider_failed_no_previous.

**Provenance (`extractorKind`: 'live_semantic' | 'captured' | 'legacy').** Added to every
ValidatedProfile and the ProfileCache; the app can distinguish live vs captured vs legacy. The
committed cache is honestly tagged `captured` (not mislabeled live). A test asserts a captured
profile never claims `llm:` provenance.

**Durable/deployment cache.** The committed `data/enriched_profiles/<program>.json` is a
deployment-safe IMMUTABLE PRECOMPUTED ARTIFACT bundled with the function exactly like `data/boards`
(which already works in deployed functions) — production-capable persistence with NO DB migration.
`loadEnrichedProfileCache` reads it read-only at plan time; Generate performs no extraction.

**LIVE model call — BLOCKED (precise blocker, not "missing credential").** `vercel env ls` shows
`AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL` configured for Preview+Production.
BUT they are stored **Sensitive/encrypted**: `vercel env pull --environment=preview` writes EMPTY
values for them (verified: key value length = 2 chars `""`), so locally `resolveModel()` → NULL and
a live call cannot run from this environment. The raw key values are injected only inside the
deployed preview/production runtime. I did NOT ask for or fabricate a key, and deleted the pulled
env file immediately (no secrets committed/logged). **The one live verification (an actual model
call) is blocked by the Sensitive-secret retrieval, isolated exactly here.** Everything else —
provider code, enrichment, validation, cache, provenance, wiring, deterministic tests — is complete
and GREEN. The provider's full code path (prompt build → schema → grounding → validation → error
classification) is proven with an INJECTED `generate` (identical code, deterministic).

**Semantic-only decision change — DATA-BLOCKED (searched thoroughly, not manufactured).** The two
semantic-only courses (0571-4174, 0542-4226; legacy-missed, semantic-derived, validated, bounded
0.6) reach the planner fit map, but a fine prior-credit sweep (k=84..100, this run) plus last slice's
exhaustive with/without-exclusion search finds NO state where either is placed by focus-only:
0542-4226 is always a control filler (never focus-only) and 0571-4174 (2h, cross-faculty) is never a
selected filler. Their design fit reaches scoring but does not flip the decision on this board's real
authoritative data. Reported honestly per the task; not forced by editing offerings/prereqs/syllabi
or deleting patterns. The real-board change remains 0542-4425 @92h (identified by both extractors),
now cache-sourced.

**Priority/legality (unchanged, re-verified).** interest_fit stays below legality/completion/
mandatory/offerings/prereqs/exclusions/hard-load/explicit-wanted; exclusion of 4425 → absent; explicit
wanted (4351) honored; no surplus; validated absence (4420) never introduced; Apply preserves the
proposal.

**RED→GREEN.** llm_semantic_provider.test.ts (6): structured-output parsing, verbatim grounding,
confidence bounding through the real provider path, timeout/schema/provider error classification,
no_model naming the env var, empty-content no-call. semantic_provider_boundary.test.ts (4): Generate
imports no provider (source scan); cache honestly provenance-tagged (never live-mislabeled); a live
run tags live_semantic and calls the provider once/course; provider failure keeps the previous valid
profile. course_profile_cache updated for extractorKind.

**Files changed.** New: api/ai/llm_semantic_provider.ts, tests/api/llm_semantic_provider.test.ts,
tests/api/semantic_provider_boundary.test.ts. Modified: api/ai/course_profile_cache.ts (extractorKind
+ ExtractorKind type), api/ai/syllabus_enrichment.ts (thread extractorKind), scripts/enrich_syllabi.ts
(--live real provider), data/enriched_profiles/mechanical_engineering_2027.json (regenerated with
extractorKind), tests/api/course_profile_cache.test.ts (extractorKind).

**Verification.** Full API 1526 passed (1 skipped); full UI 835 passed post-commit (pre-commit lone
failure = course_details_panel working-tree git-diff guard, green committed); root+web typechecks
clean; web build clean. Browser/network: control (4425 absent, no outcome) + focus (4425
@year_3_semester_b, 4420 absent, honored cites cached quote) via direct :3002; **server log shows NO
model/provider invocation during Generate** (deterministic); rendered /planner/native + Apply
preserves 4425; console clean. Pre-existing: 38 pytest failures (no Python touched); side-effect file
restored, not staged.

### PRODUCTION ROLLOUT CHECKLIST (semantic enrichment — do NOT auto-deploy)
- **Env vars (already set on Vercel, Sensitive):** `OPENAI_API_KEY` (and/or `ANTHROPIC_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY`), optional `AI_PROVIDER`. No values in repo.
- **Model config:** default gpt-4o-mini via resolveModel; override with `AI_PROVIDER`. Cost control:
  bounded 8k-char input, 2 retries, 30s timeout, one call per evaluated course; enrichment is manual/
  batched (never per Generate).
- **Durable cache:** committed `data/enriched_profiles/<program>.json` (immutable artifact, bundled).
  No DB migration. (Optional future: durable store if profiles must be written at runtime.)
- **Enrichment trigger + authz:** run `npx tsx scripts/enrich_syllabi.ts <program> --live` in an
  environment that HAS the raw key (protected CI job / local with key), review the produced cache +
  `evaluation.json` diff, then commit the artifact. It is NOT a public endpoint.
- **Failure/rollback:** enrichment fails closed (keeps last valid profile); if the cache is absent/
  corrupt, `loadEnrichedProfileCache` returns null → Generate proceeds with NO fit (honest, available).
  Rollback = revert the cache artifact commit.
- **Deployment ordering:** commit the validated cache artifact BEFORE/with the deploy so Generate reads
  it; no runtime enrichment on the request path.
- **Observability:** provider errors are classified (`SemanticProviderError.kind`); enrichment prints a
  per-course summary (status/accepted/rejected) without raw output or secrets.
- **Stale profiles:** `lookupProfile` returns `stale` on syllabus content-hash change and
  `refresh_required` on schema/ontology/extractor-version change → re-run enrichment.
- **Before production:** run one real `--live` enrichment with the key (in a key-bearing env), review
  the live cache vs `evaluation.json`, commit as `extractorKind:'live_semantic'`, then deploy.

**Next recommended slice.** Run `--live` enrichment where the key is available (protected CI or a
key-bearing local env) to promote the committed cache to `live_semantic`; then broaden the ontology
(practical/lab/theoretical/assessment) through the same grounded pipeline. The semantic-only decision
change remains data-blocked on this board — revisit with a program/state where a legacy-missed course
is genuinely decision-relevant.

## Session 2026-08-07 (c) — semantic syllabus-enrichment pipeline (validated, versioned, cache-fed planner)

**Accepted baseline:** `22d9f3f` (HEAD=origin, clean tree). Production unchanged.

**Why.** `22d9f3f` extracted course-capability evidence with hand-written phrase patterns over
official syllabus text — sound but non-scaling. This slice adds the semantic-extraction pipeline
that supersedes the pattern extractor on the authoritative path.

**Provider status (audited).** The repo uses the Vercel AI SDK (`ai` + `@ai-sdk/anthropic|openai|
google`) via `resolveModel()`, which builds a model only if a provider API key env var is set.
`.env.local` has NO model key → **no runtime model provider is configured**. Per the provider rules
the semantic-model step is CAPTURED (real-source-grounded, reviewed, labeled) not live; a fake
provider covers failure/timeout tests; the LLM provider path (`resolveModel` + AI SDK generateObject)
is a documented deferred boundary. No checkpoint blocker (22d9f3f in history, tree clean, no DB/
crawler needed, grounding validator cleanly separates untrusted model output from evidence).

**Pipeline (real vertical, model-independent safety core):**
snapshot → semantic provider (untrusted) → grounding validator → validated versioned profile →
cache → evidence-backed matcher → real planner → traceable explanation.
- `syllabus_snapshot.ts` — `SyllabusSnapshot` {courseId, institution, programOrCatalog, sourceType,
  sourceUrl, sourceAuthority, sourceYear, language, retrievedAt, contentHash, normalizedContent},
  built from the board's official syllabus text (TITLE excluded); `contentHash`=sha256(normalized).
- `semantic_course_extraction.ts` — ontology (`mechanical_design`, ONTOLOGY_VERSION), untrusted
  `CandidateClaim` {capability, inferenceLevel, confidence, evidenceSpans[{excerpt,section,offsets}],
  rationale}, `SemanticExtractionProvider`, `ClaimSpecProvider` (captured, grounds excerpts against the
  live snapshot), `runExtractionWithTimeout` (bounded).
- `semantic_extraction_validator.ts` — DETERMINISTIC grounding: excerpt must exist verbatim in the
  snapshot, offsets must match, capability∈ontology, level/confidence valid, non-empty evidence for
  explicit/derived, title-citation rejected, contradictions reconciled (strongest grounded wins),
  `boundedConfidence` caps the model's number by inference level (explicit≤0.9 / derived≤0.6 /
  estimated≤0.35) × source authority + small span bonus. Accepted claims map to the existing
  `CourseCapabilityEvidence`.
- `course_profile_cache.ts` — versioned cache; key = courseId + snapshot contentHash + schema/
  ontology/extractor versions; `lookupProfile` → hit / stale (hash changed) / refresh_required
  (missing course, version mismatch, or capability never evaluated) / insufficient_evidence
  (evaluated, no positive evidence) / quarantined. `loadEnrichedProfileCache` reads the committed
  JSON. Storage = committed JSON (narrowest versioned storage; persistent DB is deferred).
- `syllabus_enrichment.ts` — the explicit (not-per-Generate) enrichment op; provider failure keeps
  the previous valid profile (fail-closed). `scripts/enrich_syllabi.ts` writes
  `data/enriched_profiles/mechanical_engineering_2027.json`.

**Legacy pattern extractor — contained.** `course_capability_evidence.ts` is RETIRED from the
authoritative planner path (`buildCourseFitById` now reads ONLY the validated cache) and kept only for
regression/comparison in the evaluation. It never overrides validated evidence and never produces new
high-confidence profiles.

**Real courses + official sources evaluated (data/enriched_profiles/evaluation.json).** All TAU IMS
syllabi already committed in the board (source urls + fetch dates + conf 0.8). Legacy vs semantic:
- BOTH catch (explicit): 0542-4425 (הדפסת תלת מימד; "שיטות התכן"), 0542-2400 (תכן מכני 1;
  "שיטות תכן שונות"), 0542-4722 (MEMS; "עקרונות תכן וייצור").
- **SEMANTIC-ONLY** (legacy MISSING → semantic DERIVED, validated, bounded conf 0.6):
  **0571-4174** (תיכון וחשיבה המצאתית; paraphrase "פתרונות יצירתיים וישימים"),
  **0542-4226** (יישומי אלמנטים סופיים; "משלבי התכן הראשוניים" = early design stages).
- Correct NEGATIVES (both missing): 0542-4420 (תורת המכונות — machine theory), 0542-4351 (marine/waves).

**Confidence bounding demonstrated.** Captured model confidences were 0.9–0.95; the deterministic
policy capped derived claims to 0.60 and explicit to 0.90 in the written cache — the model cannot
self-certify high confidence.

**User-goal → capability → course evidence chain.** "אני רוצה להתמקד בתכן" → focusArea/capability
mechanical_design → cache lookup on each course's content-hashed snapshot → validated official-syllabus
evidence → planner fit. External context (ABET, 22d9f3f) still attached to the explanation.

**Control vs preference (real board, prior credit 92h).** Control: 26 courses, blocked=false, 0542-4425
ABSENT, no intentOutcome. Focus: 0542-4425 placed at year_3_semester_b (real B offering), blocked=false,
errors=[], **fit sourced from the validated cache** (honored cites the cached quote "שיטות תכן שונות …");
0542-4420 (validated absence) NOT introduced. Exclusion of 4425 → absent (exclusion beats fit); explicit
wanted (0542-4351) honored alongside; no surplus.

**Honest planner-level limitation (NOT manufactured).** The semantic-only courses (0571-4174, 0542-4226)
carry validated design evidence that reaches the planner fit map, but on THIS board they do not change
the FINAL generated plan in any reachable legal state: 0571-4174 (2h, cross-faculty) is not a filler the
planner selects, and 0542-4226 is already a control filler / is out-competed by 4425 (explicit, 0.9). The
real-board plan change is driven by 4425 (which both extractors identify), now cache-sourced. Per the task
("do not manufacture this case"), this is reported, not forced. The semantic signal's ability to reach and
affect scoring IS proven (buildCourseFitById includes 0571-4174 & 0542-4226 with positive fit; scorePlan's
interest_fit consumes courseFitById — 544544d). Deferred: a board/state where a legacy-missed course is
genuinely decision-relevant, or connecting a runtime model provider to broaden coverage.

**Provider actually used.** CAPTURED (ClaimSpecProvider over reviewed real-source claims), deterministic,
no live model. Live LLM extraction is DEFERRED (no key configured) — the boundary (`SemanticExtractionProvider`
+ resolveModel/AI-SDK) exists but is not exercised.

**Cache key + reuse/refresh/invalidation.** Reuse only when snapshot contentHash matches AND schema/
ontology/extractor versions match AND the capability was evaluated. Changed syllabus → new hash → stale.
Changed schema/ontology/extractor version → refresh_required. Generate performs NO extraction — it builds
snapshots + reads the committed cache (proven: buildCourseFitById only calls loadEnrichedProfileCache +
lookupProfile; generate-plan imports no provider).

**Security/operability.** No secrets committed or logged; bounded timeout + fail-closed enrichment (keeps
last valid profile); raw provider output never reaches the user (validated first); planner remains available
with no fit when the cache is absent.

**RED→GREEN.** 4 core suites (snapshot/extraction/validator/cache, 24 tests) RED (modules missing) → GREEN.
A probe caught NO integration bug this time; a TS-narrowing fix in buildCapturedExtraction. Acceptance
suite (6) GREEN: semantic>legacy, hallucination rejected, cache→matcher, real cache-sourced plan change,
exclusion>fit, validated-absence-not-introduced.

**Files changed.** New: api/ai/syllabus_snapshot.ts, api/ai/semantic_course_extraction.ts,
api/ai/semantic_extraction_validator.ts, api/ai/course_profile_cache.ts, api/ai/syllabus_enrichment.ts,
scripts/enrich_syllabi.ts, data/enriched_profiles/{captured_extractions.json, mechanical_engineering_2027.json,
evaluation.json}, tests/api/{syllabus_snapshot, semantic_course_extraction, semantic_extraction_validator,
course_profile_cache, semantic_enrichment_acceptance}.test.ts. Modified: api/ai/generate-plan.ts
(buildCourseFitById reads the validated cache; legacy extractor retired from the fit path).

**Verification.** Full API 1516 passed (1 skipped); full UI 835 passed post-commit (pre-commit lone failure
= course_details_panel working-tree git-diff guard, green committed); root+web typechecks clean; web build
clean. Browser/network: control (4425 absent, no outcome) + focus (4425 @year_3_semester_b, 4420 absent,
honored cites the CACHED quote, ABET note) via direct :3002 and rendered /planner/native + Apply preserves
4425; console clean. Pre-existing/out-of-scope: 38 pytest failures (no Python touched); pytest side-effect
file restored, not staged.

**Next recommended slice.** (1) Connect a runtime model provider (resolveModel + AI SDK generateObject with
the schema) behind the same validator + cache, and run one real extraction; (2) broaden the ontology
(practical/lab/theoretical/assessment) with the SAME grounded pipeline; (3) find/curate a board state where a
legacy-missed course is decision-relevant so the semantic signal changes the generated plan end to end.

## Session 2026-08-07 (b) — evidence-backed course matching (three-layer): syllabus evidence replaces title inference

**Accepted baseline:** `544544d` (HEAD=origin, clean tree). `project_native_planner_journey_mvp.md`
is EXTERNAL Claude memory (not tracked in repo). Production unchanged.

**Problem fixed.** The 544544d fit path classified design from broad TITLE tokens
(`מכונות → mechanical_design`), so "תורת המכונות" (theory of machines — a machine-THEORY
syllabus, not design) got a false 0.7 design weight and was the course the design request
pulled in. Title is not proof of content.

**Three-layer evidence architecture implemented (smallest real vertical slice).**
1. COURSE-KNOWLEDGE (`api/ai/course_capability_evidence.ts`): `CourseCapabilityEvidence`
   {courseId, capability, claim, strength, sourceType, sourceUrl, sourceAuthority, sourceYear,
   extractedEvidence, inferenceLevel, confidence, retrievedAt}. `extractCourseCapabilityEvidence`
   reads ONLY the official syllabus text the board already carries (`syllabus_summary_he` +
   provenance: `syllabus_source_url`, `syllabus_last_fetched_at`, `syllabus_confidence`), title-
   blind. Distinguishes explicit / derived / estimated / missing. False-friend guard: "תכן הקורס"
   (=course CONTENT) and "תוכן" are neutralized before design matching (TAU syllabi head their body
   with "תכן הקורס", which otherwise reads nearly every course as design). Only `mechanical_design`
   has an extractor this slice; other capabilities → honest `missing`.
2. EXTERNAL-CONTEXT (`api/ai/external_context_evidence.ts`): `ExternalContextEvidence`
   {goalOrContext, capability, relationship, strength, sourceType, sourceUrl, publisher,
   publishedOrUpdatedAt, retrievedAt, confidence, corroborationCount, extractedEvidence} + a
   `ExternalContextProvider` boundary (NOT connected to a runtime provider this slice). One CACHED,
   real, authoritative relationship: engineering_design → mechanical_design, source **ABET**
   (Engineering Accreditation Commission), Criteria for Accrediting Engineering Programs 2026-2027,
   Criterion 3 Outcome (2) + Criterion 5, retrieved 2026-08-07 (fetched live during dev). It links
   GOAL→CAPABILITY and carries NO courseId — never a claim that a course teaches it.
3. USER-GOAL: reuses the 544544d `PlanningIntent.focusAreas` (the requested capability), unchanged.
4. MATCH → PLANNER: `buildCourseFitById(board, focusAreas)` now derives the per-course soft fit
   from course evidence strength (explicit 0.9 / derived 0.6 / estimated 0.3 / missing 0), feeding
   the same `interest_fit` scorePlan goal (544544d). It also returns `evidenceById`; the explanation
   (`buildIntentOutcome` focus branch) cites the OFFICIAL SYLLABUS quote per aligned placed course,
   plus the ABET external-context provenance as a note — the two layers stay distinct.

**Unsound behavior removed/contained.** `מכונות` removed from the mechanical_design TITLE rule
(`course_topic_profile_inference.ts`) — a machine course is not a design course. Negative regression
added (title `מכונות`/`תורת המכונות` alone ≠ mechanical_design). One machine-only course moved
inferred→default (static distribution pin updated 47/21 → 46/22). The planner fit no longer uses
title-topic-profiles at all.

**User-goal → capability → course evidence chain (proven).** goal "אני רוצה להתמקד בתכן" →
focusArea/capability `mechanical_design`; ABET (external) establishes the capability's relevance to
the design goal; official TAU syllabus (course) establishes that 0542-4425 teaches it — quote
"…שיטות התכן והחומרים…" (explicit). The two links are independent (external never asserts a course
teaches X).

**Official syllabus sources + extracted evidence (real, in-repo).**
- 0542-4425 הדפסת תלת מימד ותכן חלקי פלסטיקה — EXPLICIT ("שיטות התכן"×2, "לתכן מתקדם", SOLIDWORKS/FEA),
  src ims.tau.ac.il/…course=0542442501&year=2025, conf 0.8.
- 0542-2400 תכן מכני (1) — EXPLICIT ("שיטות תכן שונות", "נושאים מתקדמים בתכן"). (mandatory)
- 0542-4722 MEMS — EXPLICIT ("עקרונות תכן וייצור, תכן מפורט של התקנים").
- 0542-4420 תורת המכונות — MISSING (syllabus is machine THEORY; title "מכונות" is not proof).
- 0542-4422 תכן הנדסי — MISSING (official summary is boilerplate; not fabricated into evidence).

**Control vs preference (real board, fixed prior-credit 92h — a legitimate exposing state, NOT an
artificial fixture; scanned states 96/93/92/89/88 all expose it, 90/91 do not).**
- Control (no request): 26 courses, 94h, blocked=false, 0542-4425 ABSENT, no intentOutcome.
- Focus "אני רוצה להתמקד בתכן": 26 courses, **94h (equal — no surplus)**, blocked=false, errors=[],
  **0542-4425 placed at year_3_semester_b** (its real B offering). Equal-cost swap: 4425 (design, 3h,
  explicit evidence) IN ↔ **0542-4226 יישומי אלמנטים סופיים בתעשייה** (applied FEM, 3h, NOT design)
  OUT — so the soft interest_fit legitimately decides among equal-hours, equally-complete plans.
  **0542-4420 NOT placed** (the previously-unsound title swap is gone).
- Why 90h shows no change (honest data note): the only evidence-backed design ELECTIVES are 4425 (3h)
  and 4722 (5h, already in control); the 4h design-TITLED courses (4135/4422) have no extractable
  syllabus evidence. So a change needs a state where a 3h design course completes the plan with
  equal/less surplus than a 4h filler.

**Legality/priority/consistency.** interest_fit stays a soft tie-break BELOW explicit wanted/unwanted,
ABOVE difficulty. Verified: explicit exclusion of 4425 → absent; explicit wanted (non-design 4351) →
honored alongside focus; offerings/prereqs/annual/completion/mandatory/category all still enforced as
blocking gates; no surplus (equal hours); unsupported domain → honest unmet; control attaches no
intentOutcome. Evidence quality drives the score (explicit>derived>estimated; missing→0); estimated is
never presented as certain.

**RED→GREEN.** RED: 2 new modules missing + `מכונות` still resolved. Probe-driven fix of a FALSE-FRIEND
bug ("תכן הקורס"=content matched as design) — tightened to unambiguous design signals. GREEN: extractor
units (real fixtures + explicit/derived/estimated/missing), external-context units (ABET provenance, no
courseId), negative regression, and the real-board acceptance (evidence-backed swap, no surplus, syllabus-
cited outcome, priority, honesty).

**Capability matrix (end-to-end = a verified change in the ACTUAL legal proposal).**

| Dimension | User-goal repr | External ctx | Official course evidence | Confidence/authority | Changes course choice | Changes sem arrangement | Verified E2E | Missing provider/data |
|---|---|---|---|---|---|---|---|---|
| Academic domain / design | focusArea mechanical_design | ABET (cached, real) | official syllabus extractor | explicit 0.9 / high | **yes** | no | **YES** (4425 swap @92h) | broaden domains → per-capability extractors |
| Practical/project/lab | focusArea/style | none | styles inferred (partial) | low | potential | no | no | style extractor from syllabus + free-text style markers |
| Theoretical | style theoretical | none | none | absent | no | no | no | reviewed evidence rule/source |
| Assessment style | style exam_light + assessment_type | none | assessment_type mostly null | low/absent | no | no | no | populate assessment metadata |
| Difficulty | difficulty_score | none | difficulty_score present | present | as g6 tiebreak only | no | no | free-text difficulty + semester aggregation |
| Semester workload/balance | balance_load/max_hours | n/a | per-sem loads (authoritative) | authoritative | no | yes (existing) | balance/maxHours wired; free-text not | plan-level scheduling policy (separate slice) |
| Career/industry alignment | (careerGoals) | ExternalContextProvider boundary only | none | absent | no | no | no | connect runtime research provider + goal→capability ingestion |
| Personal project/activity | — | boundary only | none | absent | no | no | no | same as career |

**Cached vs live vs deferred vs unsupported.** Course evidence: CACHED from committed board syllabus
text (no live fetch at Generate; refresh path documented — re-run the board pipeline). External context:
CACHED (ABET), provider boundary DEFERRED (no runtime research connected). Runtime web-search research:
UNSUPPORTED at runtime (boundary only). Non-design course-fit dimensions: DEFERRED/data-limited.

**Files changed.** New: api/ai/course_capability_evidence.ts, api/ai/external_context_evidence.ts,
tests/api/course_capability_evidence.test.ts, tests/api/external_context_evidence.test.ts. Modified:
api/ai/course_topic_profile_inference.ts (remove מכונות token), api/ai/generate-plan.ts (evidence-driven
buildCourseFitById + evidence/external-context threaded to outcome), api/ai/planning_intent.ts
(buildIntentOutcome cites evidence + external context), tests/api/course_topic_profile_inference.test.ts
(negative regression), tests/api/course_topic_profiles_static.test.ts (distribution pin 46/22),
tests/api/generate_plan_free_text_fit_real_board.test.ts (rewritten to evidence-backed @92h).

**Verification.** Focused RED→GREEN; full API 1486 passed (1 skipped); full UI 835 passed post-commit
(pre-commit lone failure is the course_details_panel working-tree git-diff guard, green once committed);
root+web typechecks clean; web production build clean. Browser/network: control (4425 absent, no outcome)
+ focus (4425 @year_3_semester_b, 4420 absent, honored cites "שיטות התכן", ABET note) verified via direct
curl to :3002 AND the actual :3001 next-dev proxy (both HTTP 200 ~8.5s), AND rendered in /planner/native
with Apply → applied board preserves 4425 @year_3_semester_b; console clean. (Browser-automation note: ref-
based clicks intermittently failed to fire the build/apply onClick; JS-dispatched element clicks worked —
an automation quirk, not a product bug.) Pre-existing/out-of-scope: 38 pytest failures (test_seed_postgres
sqlite, test_supabase_normalize DB/network, test_viewer_structure) — no Python touched; pytest mutates
data/import_reports/normalized_courses_mechanical_2027.json as a side-effect (restored, not staged).

**Next recommended slice.** Course-STYLE evidence extractor (practical/project/lab from syllabus, e.g.
SOLIDWORKS/מעבדה/פרויקט) + free-text style markers → same evidence→fit path; then connect a real runtime
ExternalContextProvider (web research with provenance) for career/industry goals. Keep plan-level workload
free text as a separate scheduling-policy slice.

**Doc duplication (report only):** AUTONOMOUS_PROGRESS.md canonical; `.remember/current.md` detailed log;
`docs/current.md` still EMPTY (stray) — recommend deleting in a dedicated docs pass, not here.

## Session 2026-08-07 — general user-fit (focus-area) preferences connected to the real plan

**Accepted baseline:** `45e5a11` (branch `ui/frontend-modernization`, HEAD=origin, clean tree).
Prior accepted work untouched: explicit Hebrew exclusion, positive course preference,
fuzzy search, authoritative offering (4220 B-only / 4224 A-only / 3620 A+B). Production
unchanged. `project_native_planner_journey_mvp.md` is EXTERNAL Claude memory (not tracked
in the repo) — its earlier edit is intentionally external, no repo impact.

**Product outcome delivered.** A broad Hebrew user-fit request "אני רוצה להתמקד בתכן"
(focus on design) now measurably shifts the ACTUAL native proposal's ELECTIVE selection
toward design-aligned courses, resolved to a canonical `AcademicFocusArea` (mechanical_design)
+ strength — NOT a design-only flag — and reaching the planner as a soft per-course fit
signal. Verified through `/planner/native` end to end.

**Existing user-fit path + canonical representations (all pre-existing, were UNWIRED).**
The generic representation already existed but its own headers said "FOUNDATION EPIC ONLY —
nothing wired into planner scoring/generate-plan/UI": `AcademicInterestProfile`
(academic_interest_profile.ts) with canonical `AcademicFocusArea` (incl. `mechanical_design`,
`control_systems`, `robotics`, …) + `CourseStyle` (project_based/practical/lab_based/
theoretical/exam_light/math_heavy/industry_relevant) + `OptimizationPriority`; the course-side
evidence `CourseTopicProfile` inferred deterministically by `inferCourseTopicProfile`
(course_topic_profile_inference.ts, Hebrew/English keyword rules, e.g. `תכן|תיכון|מכונות|
design|cad → mechanical_design` @0.7, source `inferred`) over the committed catalog
(`getMechanicalEngineering2027TopicProfiles`); the per-course evaluator
`matchCourseToAcademicInterests → interestFitScore ∈[0,1]`; and the post-hoc, display-only
`buildGeneratePlanInterestEvaluation` (explicitly "no plan mutation, no ranking involvement").

**Smallest proven gap (non-vacuous baseline, real board, 90h prior credit).** CONTROL (no
request) designFitSum=3.50 (electives 4422, 4135 + mandatory design). Free-text
"אני רוצה להתמקד בתכן" via `interpret_free_text` → `interpretPlanningIntent` returned
`recognized:[{kind:'prefer',phrase:'להתמקד בתכן',status:'unresolved'}]`, NO focus preference
(the `רוצה` course-marker stranded it) → plan IDENTICAL to control. Two gaps: (A) no
focus-area recognition at the intent boundary; (B) `scorePlan` (GOAL_STACK) had no interest/
fit term, so even the existing `AcademicInterestProfile` could never change placements.

**Exact missing connection (reuse-first; canonical dimension+strength, not a boolean).**
1. `inferFocusAreasFromText` exported from course_topic_profile_inference.ts — reuses the SAME
   keyword→area vocabulary for the user's phrase (one taxonomy, supply+demand side).
2. planning_intent.ts extended: `PlanningIntent.focusAreas:{area,weight}[]` + a `focus`
   recognized kind; FOCUS_MARKERS (`להתמקד`/`להתמחות`/…) checked per clause BEFORE the
   course-prefer markers; negated `אל תשבץ` etc. still EXCLUDE (checked first).
3. generate-plan.ts `buildCourseFitById(focusAreas)` — builds `AcademicInterestProfile` and
   scores every catalog course via `matchCourseToAcademicInterests` (reused evidence+evaluator)
   → `Map<courseId, fit>`, threaded into `buildModel`/`buildConstraintModel`.
4. ConstraintModel gains `courseFitById?`; scorePlan gains goal `interest_fit` = Σ fit of
   placed courses, inserted BELOW `preferences`+`unwanted_avoidance`, ABOVE `difficulty_comfort`
   (soft: inert/zero when no fit map → control byte-identical).
5. `buildIntentOutcome` gains a `focus` branch driven by `fitAlignedPlacedCourseIds` computed
   from the FINAL proposal — truthful, placement-derived.
   No new parser/agent/policy/planner/endpoint/validator/UI; no course names/ids in production
   logic; ids are acceptance fixtures only.

**Control vs user-fit real proposal (before/after, evidence-backed).** With the focus request,
the planner SWAPPED `0542-4351 הנדסה ימית` (marine/fluids, mechanical_design weight 0) OUT for
`0542-4420 תורת המכונות` (mechanical_design 0.7 via `מכונות`) IN — one swap, same course count/
hours (NO surplus), designFitSum 3.50→4.20, blocked:false, errors:[]. Repository evidence:
`getTopicWeight(profile,'mechanical_design')` = 0.7 for 4420 (and 4422/4135/2400/4010/4020),
0 for 4351. intentOutcome.honored (derived from actual placements): "הותאמו קורסים להעדפת
ההתמקדות שלך («בתכן»): … תורת המכונות, …".

**Legality/priority/consistency.** interest_fit is a soft tie-break only: explicit exclusion
beats it (disallowed design course stays absent), explicit wanted-course outranks it
(0542-4220 honored alongside focus), authoritative B-only/A-only offerings + prereqs + degree
completion + mandatory/category + hard load all still enforced (all as blocking gates above
scoring). No surplus hours added. Unsupported focus domain ("...משהו שלא קיים כתחום") →
honest `unmet`, never fabricated. Control (no request) attaches NO intentOutcome. Browser:
Generate 200, 4420 at year_4_semester_a, 4351 dropped, UI honored text == network response,
Apply → applied board preserves 4420 (once) at year_4_semester_a; console clean; no server errors.

**Capability matrix (end-to-end = a verified change in the ACTUAL legal proposal).**

| Dimension | Canonical repr | Evidence | Confidence | Affects | Recognized (free text) | Verified E2E | Missing connection if deferred |
|---|---|---|---|---|---|---|---|
| Academic domain (design/control/fluids/robotics/…) | `AcademicFocusArea` | `CourseTopicProfile.topics` (keyword-inferred) | inferred, 0.6–0.7 | course choice | **yes** (`להתמקד ב…`) | **YES** (design proven; other domains share the identical path) | — |
| Practical / project / lab orientation | `CourseStyle` (practical/project_based/lab_based) | `CourseTopicProfile.styles` (keyword-inferred) | inferred (partial) | course choice | no (no style markers yet) | no | add style free-text markers → reuse `matchCourseToAcademicInterests` style path (already scores styles) → same `courseFitById` |
| Theoretical orientation | `CourseStyle.theoretical` | no inference rule emits `theoretical`/`math_heavy` yet | absent | course choice | no | no | add a deterministic evidence rule (or syllabus source) for theoretical/math_heavy; then same path |
| Assessment style (exam vs project) | `CourseStyle.exam_light`, `assessment_type` on CourseProfile | `assessment_type` largely null in catalog | low/absent | course choice | no | no | populate assessment metadata; consume via style fit |
| Difficulty | `difficulty_score` (planner) / no interest dim | `CourseProfile.difficulty_score` exists | present (course-level) | course choice + semester load | no (free text) | no | difficulty is already a scoring tiebreak (g `difficulty_comfort`); a "prefer easier" free-text request + semester-level aggregation is a distinct slice |
| Semester workload / balance | `balance_load`, `max_weekly_hours` | per-semester loads | authoritative | semester ARRANGEMENT | partial (balance/maxHours markers exist) | balance/maxHours already wired; "lighter semesters"/"spread demanding courses" free text NOT | plan-level scheduling policy — deliberately NOT forced into the course-fit score |
| Career / activity alignment | `careerGoals` (profile) / combine focus dims | none direct | absent | course choice | no | no | map career phrases → focus-area set (reuse focusAreas path) |

**Additional non-domain fixture — DEFERRED (data-limited, honest).** Preferred order was
practical/lab → assessment → difficulty. Practical/lab: `CourseStyle` styles ARE inferred
(lab_based/project_based/practical) and `matchCourseToAcademicInterests` already scores styles,
BUT there are no free-text STYLE markers yet and style evidence is partial; assessment_type is
largely null; no theoretical/math_heavy rule emits. Rather than fabricate classifications
(forbidden), the second fixture is deferred — the exact consumer (`courseFitById` via the style
branch of `matchCourseToAcademicInterests`) already exists; only free-text style markers + a
reviewed style/assessment evidence pass are missing.

**Files changed (this slice):** api/ai/course_topic_profile_inference.ts, api/ai/planning_intent.ts,
api/ai/generate-plan.ts, api/ai/planner_types.ts, api/ai/planner_model.ts, api/ai/planner_goals.ts;
tests/api/course_topic_profile_inference.test.ts, tests/api/planning_intent.test.ts,
tests/api/planner_goals.test.ts, new tests/api/generate_plan_free_text_fit_real_board.test.ts.

**Verification.** Focused RED→GREEN (4 suites); full API 1472 passed (1 skipped); full UI
835 passed post-commit (the lone pre-commit failure is the `course_details_panel.test.js`
working-tree git-diff guard, green once the api change is committed); root + web typechecks
clean; web production build clean; browser+network verified via `/planner/native` + Apply.
Pre-existing/out-of-scope: 38 pytest failures (test_seed_postgres sqlite env,
test_supabase_normalize DB/network, test_viewer_structure) — this slice touches no Python;
pytest mutates data/import_reports/normalized_courses_mechanical_2027.json as a side-effect
(restored, not staged).

**Next recommended product slice:** free-text COURSE-STYLE fit ("אני מעדיף קורסים מעשיים / יותר
פרויקטים ומעבדות") — add style free-text markers feeding the SAME `courseFitById` via the style
branch of `matchCourseToAcademicInterests` (already implemented), plus a reviewed
style/assessment evidence pass so theoretical/exam-style dims have authoritative data. Keep
plan-level workload free text ("סמסטרים קלים יותר") as a separate scheduling-policy slice — do
not fold it into the course-fit score.

**Doc duplication (report only):** AUTONOMOUS_PROGRESS.md canonical; `.remember/current.md`
detailed log; `docs/current.md` still EMPTY (stray) — recommend deleting in a dedicated docs
pass, not here. Not modified this slice.

## Session 2026-08-06 (b) — positive free-text course preference connected end to end

**Accepted baseline:** `92f473a` (branch `ui/frontend-modernization`). Prior accepted
work untouched: explicit Hebrew exclusion end-to-end, fuzzy course-name search,
authoritative offering (0542-4220 = תורת התנודות, Semester-B only). Production unchanged.

**Product outcome delivered.** The Hebrew request "שבץ לי את תורת התנודות" now makes the
ACTUAL native proposal prefer and include course `0542-4220`, placed ONLY in a Semester-B
slot (its authoritative offering), whenever a legal complete plan can contain it — verified
on the real Mechanical-Engineering board through `/planner/native`.

**Existing positive-preference path (reused, unchanged):**
`NativePlannerJourney.buildRequest` (always sends `interpret_free_text: true` +
`extra_request_he`) → `POST /api/ai/generate-plan` → `interpretPlanningIntent`
(planning_intent.ts) → `mergeIntentIntoPreferences` (wanted = union(UI, intent) MINUS
disallowed; exclusion always wins) → `buildModel` `wantedCourseIds` →
`buildCourseProfiles` `is_wanted` + `model.wantedCourseIds` → `enumerateActions` group 3
("wanted courses — every legal semester", offering-restricted via `addCourseActionsFor`/
`legalSemestersFor`) + `scorePlan` g5 (GOAL_STACK `preferences`, below degree/mandatory/
balance) → `buildIntentOutcome` (honored/unmet derived from ACTUAL placements) →
ProposalView. Every legality/workload gate (offered-semesters, prereqs, annual, degree
completion, hard load cap, explicit exclusion) already governs this path.

**Baseline behavior + smallest proven gap (non-vacuous).** On the real board (prior credit
90h): CONTROL (no preference) → `0542-4220` NOT placed; structured `wanted_course_ids:[4220]`
→ placed in `year_4_semester_b` (B); free-text "שבץ לי את תורת התנודות" via
`interpret_free_text` → NOT placed, `intentOutcome` empty. Root cause:
`interpretPlanningIntent` returned `preferCourseIds: []`, `recognized: []` — `PREFER_MARKERS`
had no imperative "schedule for me" verb, so the sentence produced an empty intent and never
reached `wanted_course_ids`. The downstream planner was already fully correct.

**Exact missing connection (reuse, not new machinery).** Added the imperative markers
`'תשבץ לי','שבץ לי','תשבץ','שבץ'` to `PREFER_MARKERS` in `api/ai/planning_intent.ts` — the
positive symmetry of the already-accepted `אל תשבץ` exclusion marker. `'לי'` (dative)
variants precede the bare verb so `afterMarker` consumes "שבץ לי" as one unit and the
accusative "את" strip yields the course phrase. `afterMarker` itself untouched, so the
exclusion phrase-extraction is byte-identical. No new parser/agent/policy/planner/endpoint/
validator/UI. The course id is used only as an acceptance fixture; no sentence/id is
special-cased in production logic (negated "אל תשבץ" is an EXCLUDE marker checked first per
clause, so it always wins).

**RED→GREEN evidence.** RED: 6 focused tests failed for the missing marker (intent empty →
4220 not placed). GREEN after the marker append: all pass. Before/after real proposal (curl
to the real handler): before → 4220 absent, `intentOutcome` undefined; after → 4220 in
`year_4_semester_b`, `intentOutcome.honored:["שובצו לפי העדפתך: תורת התנודות."]`, `unmet:[]`,
`blocked:false`, `errors:[]`.

**Acceptance results (files):** `tests/api/generate_plan_free_text_preference_real_board.test.ts`
(8 real-board tests — placement, B-only slot, structured↔free-text convergence, balance-load
non-discard, exclusion-beats-preference structured + free-text, never-into-A, non-vacuous
control) + 3 boundary unit tests in `tests/api/planning_intent.test.ts` (imperative resolve,
marker variants, negated-stays-exclusion). Full API suite 1459 passed; UI suite 834 passed
(1 pre-existing git-diff working-tree guard, `course_details_panel.test.js`, trips only on
an uncommitted api change — green once committed); root + web typechecks clean; web
production build clean; browser+network verified through `/planner/native` (Generate 200,
4220 in a B slot, UI "✓ שובצו לפי העדפתך: תורת התנודות" matching, Apply → applied board keeps
4220 in year_4_semester_b; console clean).

**Legality/workload/explanation/Apply consistency.** Positive preference never overrode
availability (B-only respected; never in an A slot), prereqs, annual rules, degree
completion, hard load cap, or explicit exclusion. Under `balance_load` the preference was not
discarded. `intentOutcome` is derived from the final proposal; proposal, validation, summary,
and Apply agree; the control does not falsely claim the preference was honored.

**Deferred product gaps (narrow):** broad NL preference phrasing beyond the imperative/
"מעדיף/רוצה" markers (e.g. "אני רוצה לשבץ …" strands "לשבץ"); domain-interest ranking; workload
requests in free text; the 3 single-syllabus-group offering records (4226/4559/4621) + 13
downgraded self-referential records still need authoritative multi-group verification. All
out of this slice's scope.

**Pre-existing, out of scope:** 38 pytest failures (test_seed_postgres sqlite env,
test_supabase_normalize network/DB, test_viewer_structure) exist on the baseline — this slice
touches no Python. `python -m pytest` also mutates
`data/import_reports/normalized_courses_mechanical_2027.json` as a side-effect (restored, not
staged).

**Doc duplication (report only, not redesigned):** `AUTONOMOUS_PROGRESS.md` canonical;
`.remember/current.md` its detailed log; `docs/current.md` still exists and is EMPTY (stray)
— recommend deleting in a dedicated docs pass, not here. Not modified this slice.

## Session 2026-08-06 — free-text exclusion locked + approximate course-name search across all bars

**Accepted baseline:** `966be5f` (authoritative offering-data remediation — 4220
B-only / 4224 A-only inversions corrected, self-referential provenance downgraded).

**Slice A — real-board free-text exclusion (commit `8346243`).** Investigated the
native path (NativePlannerJourney.buildRequest → `POST /api/ai/generate-plan` →
`interpret_free_text` → `planning_intent.ts interpretPlanningIntent` →
`mergeIntentIntoPreferences` → `buildModel` `disallowedCourseIds` → planner +
`disallowedGate`). Finding: **already works end-to-end** — "אל תשבץ תרמודינמיקה 2"
resolves to `0542-4120` and is enforced (reqA absent; reqB exclusion beats a
competing want; reqD pre-placed → honest BLOCK, never silently kept; reqC control
shows 4120 IS placeable). The only gap was **missing acceptance coverage** on the
real board (existing tests used a synthetic ALPHA/BETA fixture). Added
`tests/api/generate_plan_free_text_exclusion_real_board.test.ts` (5 tests) and
verified the real /planner/native browser journey (Generate + Apply keep 4120
absent). No production code changed.

**Slice B — approximate (fuzzy) Hebrew course-name search in ALL course bars
(this commit).** Reused: nothing existed (repository search was plain
`.includes`). New: one runtime-neutral matcher `shared/search/course-name-match.ts`
(normalize parens/nikkud/punct/spacing + ranked exact→prefix→substring→token-subset→
bounded-Levenshtein typo; 9 unit tests). Wired into all three surfaces:
`RepositoryExplorer.tsx` (fuzzy+ranked filter), new `CourseNamePicker.tsx` ranked
chooser in `NativePlannerJourney` add/exclude fields (name→id chips), and the
legacy `semester_board_viewer.html` repo-search + `setupCoursePicker` (mirrored JS
matcher). Browser-verified: "תרמודינמיקה 2" (no parens) and "תרמודנמיקה" (typo) both
find "תרמודינמיקה (2)"; native picker ranks "התנודות" → "תורת התנודות 0542-4220".

**Reused vs new:** reused the existing intent/exclusion pipeline unchanged (Slice A);
Slice B added one shared matcher + one picker component + three thin call-site swaps.

**Deferred (next product slices):** positive-preference / domain-interest ranking in
free text; the 3 single-syllabus-group offering records (4226/4559/4621) + 13
downgraded self-referential records still need authoritative multi-group
verification; broad NL intent coverage.

**Doc duplication (report, not redesigned):** `AUTONOMOUS_PROGRESS.md` is canonical;
`.remember/current.md` is its detailed log; `docs/current.md` exists but is EMPTY
(stray) — recommend deleting it in a dedicated docs pass, not here.

## Latest session — re-verification only: queue still resolved (PR #14 parked), deploy blocker unchanged (still `26500d4`, now 235 commits behind, still `source: cli`)

Re-checked from scratch rather than trusting this file's prior entry:
`list_pull_requests` (open) → exactly PR #14. `list_issues` (open) → #75,
#21, #20, #18, #15, none newly actionable under this session's release-gate
pause (all either pre-existing human-decision items or explicitly deferred
Agent-quality work). Vercel (`list_teams` → `list_projects` → `get_project`
→ `list_deployments` → `get_deployment`) → `tau-course-planner`'s latest
deployment is byte-identical to the prior session's finding: same deployment
ID, same `source: "cli"`, same `gitCommitSha: 26500d4`. No Git-integration
tool exists in this session's Vercel MCP surface to fix this autonomously.

Full detail in `.remember/current.md`'s matching entry. No code changed,
no PR opened for implementation work, no deploy attempted (the raw-upload
`deploy_to_vercel` path remains correctly declined — it has no Git linkage
and would break commit traceability for this multi-language repo, per
established precedent). This docs-only update is the sole change this
session made.

## Prior session — PR queue resolved (PR #77 merged, PR #74 closed as duplicate); production deploy blocker re-verified: still pinned at `26500d4`, now 232 commits behind

**Per this session's own external operating instructions, stopping here
rather than starting new Agent-quality work** (not a standing rule of this
file — see the correction the immediately-preceding session already made
about exactly this framing, a few sections below): this session's own
*external* scheduled-task prompt, given by the human operator, told it to
pause new roadmap work until the open-PR queue was resolved and a verified
production release was deployed, with an explicit escape valve for exactly
this situation — if deployment is blocked by missing authorization/
credentials, record the single external blocker and stop before deployment
rather than proceed. That instruction's own stored checkpoint (PR #53,
commit `36de50f`) was stale, as the prompt itself warned it might be —
verified fresh against GitHub before acting.

**Branch hygiene, same recurring gap as several prior sessions (issue #18's
finding, still not permanently fixed)**: this session's assigned branch
(`claude/youthful-tesla-xx4car`) was created from stale `main` (`92c19e0`,
0 unique commits, 391 behind `origin/ui/frontend-modernization` at session
start), not from `ui/frontend-modernization` as directed. Reset to
`ui/frontend-modernization` HEAD before doing anything else.

**Queue at session start**: two open PRs beyond the permanently-parked #14 —

- **PR #77** — a comment-only correction (a real Codex finding on PR #76's
  docs recap: `LlmOrchestrator.run()`'s code comment overclaimed safety/cost
  guarantees PR #73 didn't actually provide). CI green (TS/Python tests +
  Next.js build all passed), Codex reviewed the exact head commit (`b68d52d`)
  with no findings ("Didn't find any major issues"), current against
  `ui/frontend-modernization` HEAD. All merge gates satisfied — **merged as
  `1ce8bf2`**.
- **PR #74** — turned out to be a duplicate: it implemented the exact same
  fix as the already-merged PR #73 (`681d883`, closing issue #67), built
  independently in a parallel session against a now-stale base. Diffed both
  PRs to confirm before acting (not assumed) — functionally identical
  `LlmOrchestrator.run()` change and regression test. **Closed as superseded**
  with an explanatory comment; issue #67 was already closed by #73, so this
  PR had nothing left to contribute and would only have been a second,
  competing implementation of the same root cause.
- **PR #14** (Decision capability) — reconfirmed still correctly parked: a
  3rd consecutive D-classified milestone with no named production consumer,
  per issue #18's still-unresolved governance conflict. Left untouched, per
  every prior session's precedent.

With PR #74 closed, only PR #14 remains open — a deliberate, already-decided
parked state, not an unresolved item.

**Production deploy blocker — re-verified this session, not just carried
forward from memory**: queried the real Vercel API directly (`list_teams` →
`list_projects` → `get_project` → `get_deployment`). `tau-course-planner`
(the `fastapi`-framework project that's actually live) has no Git
integration — its `latestDeployment.meta` shows `"source": "cli"` and
`gitCommitSha: 26500d4ffe56fff145eadc0a8745cf7803cb788e`, deployed via a
one-off CLI upload, not linked to any branch. That commit is now **232
commits behind** `origin/ui/frontend-modernization` HEAD (confirmed via
`git log 26500d4..origin/ui/frontend-modernization --oneline | wc -l`) —
every Agent-quality and correctness fix from PR #27 onward, including every
milestone this file's history below documents, is unshipped. The sibling
`web` (Next.js) project is in the same state (`source` not git-linked,
`target: null`, never promoted to production). This is the exact blocker
Blockers item 1 (below) and many prior sessions have already recorded —
confirmed unchanged, not a new finding, but now quantified precisely rather
than just "some fixes are unshipped."

Per that scheduled-task prompt's own explicit fallback — *"if deployment is
unavailable because authorization or credentials are missing, prepare and
verify the exact release candidate, record the single external blocker and
stop before deployment"* — this session did not attempt `deploy_to_vercel`'s
raw-upload path (no git linkage, would break `gitCommitSha` traceability for
this multi-language repo, previously declined by name in this same file) and
did not attempt to reconfigure Vercel Git integration unilaterally. **Which
Vercel project is canonical is already resolved, not a second open
decision** (a real Codex finding on this PR correctly caught an earlier
draft of this entry re-opening it) — the root `vercel.json` wires the
Next.js app, the real serverless API endpoints, and the legacy static board
viewer into ONE deployment, and `tau-course-planner` deploying that root
config is the complete, correct production setup; `web` is a leftover
single-subdirectory deploy from before the root config existed, not a real
second candidate (see the fuller writeup a few sections below, from the
session that originally settled this via a real Codex finding). The
remaining blocker is purely authorization/configuration access — linking
`tau-course-planner`'s Vercel Git integration to this GitHub repo, or a
`vercel` CLI login reachable from an autonomous session — which is exactly
the kind of infrastructure/deployment-configuration action this routine's
own prohibited-actions list reserves for a human.

**No implementation milestone was started this session.** This session's
own scheduled-task instructions paused new roadmap work until the queue was
resolved and a release deployed and smoke-tested; the queue is now
resolved, but deployment remains externally blocked, so that instruction's
own "done" condition can't be reached this session. Stopping here rather
than starting new Agent-quality work, per that instruction — **not because
this file mandates it**; per the established multi-session convention a
few sections below, absent a specific directive to pause, the norm here is
to keep running the Agent Diagnosis Loop in parallel with this same
standing deploy blocker rather than block on it. A future session without
this same external pause instruction should default to that convention.

**Classification**: not applicable (no code changed) — a queue-resolution
housekeeping session (merge one clean PR, close one duplicate) plus a
verification pass. Does not enter the rolling A/B/C/D window.

## Prior session — PR #73 merged: LlmOrchestrator now always guarantees its finishing pass (issue #67), plus PR #71/#68 earlier the same session; a Codex finding on #73 uncovered and documented a distinct, still-open gap (issue #75)

Continuation of the same session as PR #71/#68 below (that entry is now
"Prior session" — see it for the branch-hygiene/queue-state notes at
session start, unchanged for this second milestone). After PR #71 and its
docs recap (PR #72) merged, picked up **issue #67** next — the other
Agent-quality item the immediately prior session had flagged and
deliberately left untouched to avoid parallel work on `planner_worker.ts`.

**The bug**: `buildPlannerTools`'s `finalize_plan` tool (`api/ai/planner_tools.ts`)
calls `worker.repair()` (which places any still-legal wanted course/balance
move, per PR #65/#68's fix), but its `execute()` does not terminate the
AI-SDK tool-calling loop — nothing stops the model from mutating further
afterward (e.g. removing a wanted course `finalize_plan` had just placed),
with no later `finalize_plan` call to recover it. `LlmOrchestrator.run()`'s
own outer fallback only re-ran the deterministic finishing pass when
`worker.validateCandidate().valid` was false, and that check has zero
`wantedCourseIds`/balance awareness — verified against `planner_validate.ts`
before writing any code. Also didn't match the class's own docstring
("Whatever the model does ... a deterministic finishing pass guarantees a
valid, complete plan" — unconditional in the comment, conditional in the
code).

**Fix** (`api/ai/planner_orchestrator.ts`): `LlmOrchestrator.run()` now
always calls `worker.run(500, 'greedy')` after the model's tool-calling loop
ends, not just when the candidate is invalid. Safe in the sense that
matters here — it only ever takes further legal actions, so it can never
corrupt the plan or reintroduce an error the model's own choices avoided.
**Correction (2nd Codex finding on PR #76)**: this entry originally also
claimed "no added cost in the common case" for an already-converged plan —
unsupported and likely false, not backed by any profiling. Removed. **3rd
correction on this same claim (Codex found the 2nd correction still
understated the worst case)**: three distinct cases exist, only one of
which is pre-existing behavior:
- **Already valid AND fully converged** (e.g. the model called
  `finalize_plan` and did nothing since) — `worker.run()` executes exactly
  one `step()` call: real, nonzero work under production defaults
  (`lookahead:true`, `topN:6`, `rolloutSteps:80` — enumerate/validate/score
  every legal action, forward-check, roll out the top `topN` candidates),
  bounded to that single check before it confirms nothing advances and
  stops. **New cost this fix adds** — the old validity gate skipped this
  entirely (plan already read as valid, so the gate never fired).
- **Valid but NOT fully optimized** — the exact motivating scenario for
  this whole fix (e.g. issue #67's own regression test: removing a wanted
  course still leaves `validateCandidate()` `true`) — `worker.run()` now
  takes further real ADD/MOVE/REPLACE actions until it reconverges, up to
  its full `500`-iteration bound, each iteration paying the same `step()`
  cost as above. **Also new cost this fix adds**, same reason.
- **Invalid** (legality/degree-hours/mandatory/category not yet satisfied)
  — `worker.run()` runs up to the same `500`-iteration bound. **Unchanged
  from before this fix** — the old validity gate already called
  `worker.run(500,'greedy')` unconditionally in this case.

None of the three cases' real-world latency was measured or profiled this
session — a future session should record real profiling evidence, not
assume any of these bounds is negligible in production. **Also corrected
(1st Codex finding on PR #76)**: the stronger claim this entry originally
made — "can't discard anything the model validly chose to keep" — is
inaccurate and has been removed. `enumerateActions`' group 6
(`REPLACE_COURSE`, `planner_actions.ts`)
CAN swap out one of the model's own validly-placed, legal, movable courses
(if it's among the placed set's bottom-3 by preference score) for a
higher-preference unplaced alternative when that improves the score — this
is pre-existing `worker.run()`/`step()` behavior, not new to PR #73 (the
same replace logic already fired via `finalize_plan`'s `repair()` call
before this fix), but PR #73's own code comment repeats the same overclaim
and still needs the same wording correction — **not yet fixed in the
merged code, flagged here as a fast-follow for the next session** (a
comment-only change, no behavior change, low risk).

**Tests**: new regression test reproduces the exact repro condition from
issue #67's own (twice-corrected) writeup, RED-verified against the
pre-fix code first (empirically confirmed `placedCourseIds` lost `WANTED`).
Full API suite: **86/86 suites, 1354/1354 tests**, zero regressions across
every pre-existing `LlmOrchestrator`/`GreedyOrchestrator`/tool test.
`tsc --noEmit` clean.

**One real Codex finding on this PR, NOT fixed inline (filed as issue #75
instead)**: if the model removes a wanted course AND that course's own
(non-mandatory, non-category) prerequisite post-`finalize_plan`, this fix
still can't recover it — `requiredButUnplacedCourseIds` (`planner_goals.ts`)
only seeds its prerequisite walk from `requiredMandatoryCourseIds`, never
`wantedCourseIds`, so no `enumerateActions` group ever proposes re-adding
that prerequisite once degree hours are otherwise met. **Verified this is
NOT a regression from this PR** — empirically confirmed the identical
outcome against the pre-PR-73 code too (its conditional fallback is equally
skipped whenever the resulting state already reads as valid). **Not fixed
inline**: `requiredButUnplacedCourseIds` also feeds `remainingMandatoryHours`'
reservation-budget scoring — broadening its contract is a cross-cutting
change to sensitive, shared scoring logic needing its own dedicated pass,
not a hasty addition inside this PR's narrower scope. Filed as **issue #75**
with the full analysis and a suggested fix direction; added a RED-verified
(empirically, via a throwaway repro script), currently `.skip`'d regression
test in `tests/api/planner_orchestrator.test.ts` as a ready starting point.

**Final state**: CI green, Codex clean on the final commit (`c548969`), the
one real finding documented with a filed issue and a resolved thread
(not silently dismissed — a new issue + a skipped test is the "fixed" outcome
for a deliberately-scoped-out finding, per this routine's own review-gate
rules). Full suite 86/86 suites, 1354 passing + 1 documented skip. `git
diff --stat` = `api/ai/planner_orchestrator.ts` (comment + one conditional
removed) + its test file only. **Merged as `681d883`.** Issue #67 closed
with the fix commit and evidence in the closing comment.

**Classification: C** (correctness/honesty — closes a reproduced gap on the
actual default production Agent path, `LlmOrchestrator`, same "valid plan
misreported" bug family as PR #48/#56/#58/#60/#62/#65/#71).

**Rolling window, corrected (Codex finding on PR #76 — the version below this
replaces an earlier draft that only counted this session's own two entries
and understated the streak)**: PR #65 (the milestone immediately preceding
this session's PR #71) is also classified **C**. The real sequence is
...62(C), 65(C), 71(C), 73(C) — `(62,65,71) = C/C/C` was ALREADY
non-compliant before this session started (not something either PR #71 or
#73 individually caused), and `(65,71,73) = C/C/C` extends it: **four
consecutive C-classified milestones in a row**. Per this routine's own
governance rule ("a fourth C-in-a-row pattern... worth a human sanity
check"), this is now explicitly that trigger — flagged here, not corrected
by picking an artificial A/B next just to satisfy the counter (each of these
four Cs was independently a legitimate, reproduced, real correctness fix,
not a rule violation in intent). **The next milestone genuinely should be A
or B** unless yet another higher-priority correctness finding preempts it
(a legitimate preemption per the priority order, but a fifth C in a row
would be worth escalating to the human product owner as an explicit
question rather than continuing to self-justify). Issue #75 (P2, just
filed) would itself be a fifth C if picked up next — prefer a fresh Agent
Diagnosis Loop pass specifically hunting for an A/B (UI-exposing or
end-to-end-integration) opportunity first.

**State as of this update**: only PR #14 remains open (still correctly
parked). Issues #67 and #68 both closed this session. Issue #75 newly filed,
open, not yet fixed. `AUTONOMOUS_PROGRESS.md`/`.remember/current.md` recap
for this merge: **PR #76** (this docs update — corrected from an earlier
draft that guessed #74 before the actual PR number was known; two real
Codex findings on PR #76 itself, including this one, are folded into this
entry rather than requiring a reader to cross-reference a separate PR).

## Prior session — PR #71 merged: a truly converged plan could be falsely reported as maxSteps-blocked (issue #68), including a Codex-caught rollout-cost fix mid-review

This was a scheduled autonomous run under the standing product-engineering
mandate (no special "release gate" directive this time). State inspected
fresh first, per this routine's own start-of-session order:

- **Branch hygiene, recurring issue**: this session's assigned branch
  (`claude/youthful-tesla-wq1g2x`) was created from stale `main` (0 unique
  commits, 375 behind `origin/ui/frontend-modernization`) — the same
  recurring gap issue #18 and several prior sessions have hit. Reset to
  `ui/frontend-modernization` HEAD (`4174abc`, PR #70) before doing
  anything else.
- **PR queue at session start**: only PR #14 (Decision capability) was
  open — reconfirmed still correctly parked (D-classified infra, no named
  production consumer), left untouched per multi-session precedent (issue
  #18, Blockers item 6).
- **Open issues reconfirmed**: #15 (superseded by #14's status), #18
  (reconciliation/D-stacking audit, still substantively accurate), #20 (386
  pre-existing UI jest failures, needs a human fixture decision), #21
  (dead-code decision, needs a human call), **#67** (LlmOrchestrator
  wanted-course reliance on `finalize_plan` — needs a repro before a fix,
  deliberately left untouched this session to avoid parallel work in the
  same file family as #68), **#68** (this session's subject, now closed).
- Vercel/production-deploy state **not re-checked this session** — no new
  directive to re-verify it; the prior 5+ sessions' identical finding
  (production pinned at `26500d4`, no Git integration on either Vercel
  project) has no reason to have changed on its own. **Still the single
  most valuable pending human action, stated directly here (the file's own
  `Blockers`/`Exact next action` sections near the bottom are a stale,
  superseded PR #48-era snapshot — do not follow them, per this file's own
  note at that section):** a human (or a session with real `vercel` CLI
  credentials, or the ability to configure Vercel Git integration) needs to
  either (a) link the `matan2439/syllo-course-planner` GitHub repo to the
  `tau-course-planner` Vercel project (Project Settings → Git), with
  `ui/frontend-modernization` (soon `main`, once branch reconciliation
  completes) as the production branch, or (b) explicitly authorize an agent
  session to use `deploy_to_vercel`'s raw-upload path as an interim
  measure, accepting that its deployment won't carry a verifiable
  `gitCommitSha`. No autonomous session can make this call unilaterally.

**This session's milestone**: picked up issue #68 (filed by the immediately
prior session, a real Codex finding on PR #66) — the highest-impact,
already-diagnosed, already-scoped, reproducible correctness gap on the
queue — rather than starting a fresh diagnosis pass, per this routine's own
"resume unfinished work before selecting anything new" instruction.

**The bug**: PR #65 removed `PlannerWorker.step()`'s early return on
`isGoalReached()` so post-goal optimization (wanted courses, balance moves)
keeps running to real convergence instead of silently dropping still-legal
improvements. That made a previously-unreachable state reachable: when the
very last permitted `step()` call inside `run(maxSteps)`'s loop is itself
the action that reaches full convergence, `run()`'s post-loop fallback has
no further `step()` call left to detect "nothing left to improve" — it
always recorded the "maxSteps" truncation message whenever
`isGoalReached()` was true, even when nothing was actually left undone.
`generate-plan.ts`'s `hitMaxSteps` detection then reported a complete,
fully legal, fully optimized plan as **blocked** (`STEP_LIMIT_ERROR`) — a
valid plan presented as broken, the mirror image of the bug PR #65 itself
fixed.

**Verified empirically before touching anything**: the existing PR #65
regression test turned out to be a live demonstration of the exact bug —
running the pre-fix code against it confirmed the "maxSteps" message fired
even though its own fixture's 3rd/last permitted step (placing `WANTED`)
was genuinely the plan's convergence point.

**Fix** (`api/ai/planner_worker.ts`): `run()` now performs one
non-consuming check when `isGoalReached()` is true — new private
`hasFurtherAdvancingAction()`, mirroring `step()`'s own "Reason" decision
without applying anything or touching the trace. When nothing legal
remains, `run()` records the same honest convergence message `step()`
itself would have. When something genuinely does remain, the existing
truncation message is unchanged.

**One real Codex finding, fixed same session** (P2): the initial version of
`hasFurtherAdvancingAction()` called `estimateFinalScore` (an expensive
`rolloutSteps`-deep rollout) once per *every* legal candidate when
lookahead was on — unbounded, unlike `step()`'s own `topN`-truncated
rollout (production uses `topN: 6`, `rolloutSteps: 80`). At the exact
convergence boundary this check exists to detect, a plan with many legal
but non-improving remaining moves could trigger roughly quadratic work and
risk a timeout instead of returning the valid plan. Fixed by splitting into
two passes: a cheap, unbounded immediate-score check over every legal
candidate first (no rollout needed to prove something advances), then a
lookahead rollout pass bounded to the same `opts.topN` candidates `step()`
itself would ever roll out per iteration. New regression test spies on
`estimateFinalScore` directly (`jest.spyOn` on the `planner_lookahead`
module) with a 20-legal-candidate fixture and proves the call count stays
≤9 regardless of how many legal candidates exist — empirically confirmed,
not just reasoned about. Codex re-reviewed the fix commit and came back
clean ("Didn't find any major issues").

**Tests**: updated the existing PR #65 regression test to assert the
corrected convergence message (renamed to describe what it now proves),
added a new two-independent-wanted-course fixture so genuine truncation
stays covered, and added the rollout-bound regression test above. Full API
suite: **86/86 suites, 1353/1353 tests**, zero regressions elsewhere.
`tsc --noEmit`: clean. `git diff --stat` = `api/ai/planner_worker.ts` (one
`run()` change + one new private method) + its test file only — no UI, no
`generate-plan.ts`, no other planner files touched.

**Final state**: CI green on the final commit (`19775da`), Codex clean on
that commit, the one real review finding fixed with evidence and its
thread resolved, `mergeable_state: clean`. **Merged as `5f67194`.** Issue
#68 closed with the fix commit and evidence recorded in the closing comment.

**Classification: C** (correctness/honesty — closes a reproduced regression
in already-merged code, same "valid plan misreported" bug family as PR
#48/#56/#58/#60/#62/#65).

## Prior session — Release-gate re-check: PR queue confirmed resolved (only PR #14, deliberately parked); production deploy still blocked by the same external Vercel gap, now directly reconfirmed via live Vercel MCP access

This was a scheduled autonomous run whose own external task prompt (from the
human operator) carried an explicit "CURRENT RELEASE GATE — AUTHORITATIVE"
directive: pause all new roadmap work, resolve the open PR/branch queue,
then deploy a verified production release — with the same standing fallback
every session since PR #27 has used: if deploy access is unavailable, record
the single external blocker and stop before deployment, rather than guess.

**State inspected fresh, per that instruction's own mandatory order** (not
assumed from the prompt's own stale checkpoint hints, which named PR #53 as
the "latest known open implementation" — that PR was merged 5 sessions ago,
per PR history):

- `git ls-remote`/GitHub API: **exactly one open PR — #14** (the Decision
  capability). No open PRs matching the old "#12/#13" checkpoint remain (both
  merged long ago). No competing `claude/*` or `feat/*` branch has an open PR
  against it. PR #14 was re-read in full and reconfirmed correctly parked —
  same D-classification precedent every session since issue #18 has upheld
  (no production consumer named, `academic_decision_factory.ts` untouched);
  left untouched again this session.
- `ui/frontend-modernization` HEAD is `0dc09f9` (merge of PR #69, the last
  docs-only PR). CI green on that commit (per PR #69's own merge gate,
  re-verified at merge time by the prior session). This branch remains the
  authoritative release candidate.
- Open issues: #67 and #68 (both real, both about the `LlmOrchestrator`/
  beam-search wanted-course-preservation edge cases from PR #65) are Agent-
  quality follow-ups, correctly left unfixed this session — the release gate
  explicitly pauses new roadmap work, and neither is a release blocker for
  the already-merged `ui/frontend-modernization` candidate. #18/#20/#21
  reconfirmed unchanged, zero new human comments on any of the four.

**Production/deploy re-check — this session had live Vercel MCP tool access
for the first time (previous sessions repeatedly reported no reachable
credentials at all)**, so this was verified directly rather than inferred:
- `tau-course-planner` (the canonical project — root `vercel.json` wires the
  Next.js app + real serverless API + legacy static board viewer into one
  deployment, settled by PR #41, re-confirmed unchanged): `get_project`
  shows `latestDeployment.target: "production"`,
  `gitCommitSha: 26500d4ffe56fff145eadc0a8745cf7803cb788e`
  ("Merge PR #11") — **byte-identical to every session's check since PR #27
  first flagged this, now 5+ sessions running**. `ui/frontend-modernization`
  HEAD (`0dc09f9`) has never been deployed.
- `list_deployments` (20 most recent): every single one has
  `creator.username: "matanyaron-1633"` and `meta.actor` set to a
  `claude-code_*_agent` identity — i.e. every past production deployment was
  a manual `vercel --prod` / `deploy_to_vercel`-style push by an agent
  session, never an automatic git-triggered build.
- `get_project` returns **no `link` field** on either `tau-course-planner` or
  `web` — Vercel's API only populates that field when a project has real Git
  integration configured. Its absence, directly observed this session (not
  inferred from tooling failures like prior sessions had to), is definitive
  confirmation: **neither project has Git integration to any branch**, so
  merging to `ui/frontend-modernization` (or eventually `main`) cannot
  trigger a deploy on its own, and no MCP tool in this session's toolset can
  configure that integration (`list_projects`/`get_project`/
  `list_deployments`/`get_deployment` are read/list-only; the one write tool,
  `deploy_to_vercel`, uploads a raw file tree with no git linkage — the same
  tradeoff every prior session declined to accept without an explicit human
  decision, upheld again this session for the same reason: it would break
  the "confirm the exact production commit after deployment" gate this same
  release-gate instruction requires).

**Why this session stops here rather than using `deploy_to_vercel` anyway**:
the release gate's own escape valve is explicit — "prepare and verify the
exact release candidate, record the single external blocker and stop before
deployment" — precisely for this situation. The release candidate
(`ui/frontend-modernization` HEAD, `0dc09f9`) is already prepared and CI-
verified. Using the raw-upload tool would produce a deployment that cannot
be traced back to a specific verified commit via the normal
`gitCommitSha` field, undermining the same release gate's own
post-deployment verification requirement ("confirm the exact production
commit after deployment"). That tradeoff is a product/ops decision for the
human operator, not something to guess at autonomously — consistent with
this repo's "never invent undocumented product policy" rule.

**The actual blocker, stated plainly for the human operator**: production
(`tau-course-planner`, `tau-course-planner.vercel.app`) is pinned at commit
`26500d4` ("Merge PR #11"), which predates every fix since — including PR
#48 (missing-mandatory legality), #56 (misattributed block cause), #58
(wanted-vs-excluded disclosure), #60 (prerequisite-sequencing disclosure),
#62 (degree-hours shortfall gate), #65 (post-goal wanted-course search
continuation), and everything else recorded below. **To unblock**: either
(a) link the `matan2439/syllo-course-planner` GitHub repo to the
`tau-course-planner` Vercel project via the Vercel dashboard (Project
Settings → Git), with `ui/frontend-modernization` (soon `main`, once branch
reconciliation completes) as the production branch, or (b) explicitly
authorize an agent session to use `deploy_to_vercel`'s raw-upload path as an
interim measure, accepting that its deployment won't carry a verifiable
`gitCommitSha`. No autonomous session can make this call.

**No code merged, no deploy performed, no roadmap work started this
session** — per the release gate's explicit pause, correctly upheld now that
the PR queue is confirmed resolved and the deploy blocker is confirmed
external and unchanged.

## Prior session — PR #66 merged (docs-only, records PR #65); release-gate queue now resolved down to the standing Vercel deploy blocker; no new roadmap work started this session

This was a scheduled autonomous run whose own external task prompt (from the
human operator, not anything written into this file — see the correction
below) said to pause new roadmap work, resolve the open PR queue, then
release. State inspected first, per that instruction's own mandatory order.

**Queue found at session start**: two open PRs — **#14** (Decision capability,
reconfirmed still correctly parked, see Blockers item 6, untouched) and
**#66** (this entry's subject — docs recording PR #65's merge), already deep
into a same-day Codex review cycle (11 commits, several real findings already
fixed) when this session picked it up.

**Concurrency note, worth recording explicitly**: partway through reviewing
PR #66's two newest (at the time) unresolved threads — narrowing issue #67's
repro condition, and making the beam-search priority claim conditional on
`AI_USE_AGENTIC_PLANNER`'s live status rather than absolute — this session
independently drafted the same fix, then found a **different concurrent
session** had already pushed an equivalent fix (`bc30909`, then one more
round `cd3bd90`) moments earlier. Discarded this session's own redundant
commit before pushing (`git reset --hard` back to the remote branch) rather
than create a duplicate/competing commit, per this routine's own "one
implementation owner" rule — then waited for that session's round to finish
rather than racing it.

**This session's actual contribution to PR #66**: once all 14 review threads
were resolved and CI was fully green (Python tests / Next.js build /
TypeScript API tests, 3/3) with `mergeable_state: clean` and no further
pushes for several minutes, merged it as `c923e0f`. No product code changed
(`AUTONOMOUS_PROGRESS.md` + `.remember/current.md` only). Not separately
classified (docs-only, same convention as PR #36/#38/#47).

**Fresh production/deploy re-check this session** (Vercel MCP tools, working
for the second session running now): `tau-course-planner`'s `latestDeployment`
is still `dpl_HJZTB8zqondbwuSnHx6TveggoPVg`, `target: production`,
`gitCommitSha: 26500d4` ("Merge PR #11") — byte-identical to the last several
sessions' checks, confirming **no deploy has happened since this was first
flagged, now 4+ sessions ago**. `web` (the Next.js project) still shows
`target: null` on its latest deployment — never successfully promoted to
production, unchanged. Neither `get_project` response exposes a linked git
repository, consistent with every prior session's finding that both projects
are still CLI-deployed (`vercel --prod`) with no Git integration configured.

**Per this session's own external operating instructions, stopping here
rather than starting new Agent-quality work** (see the correction below —
this is NOT a standing rule of this file): this session's own *external*
operating instructions (the scheduled-task prompt this specific session was
launched with, given by the human operator — **not** any section of this
file, and not something a future session should assume it also has, unless
its own task prompt says so too) told it to pause new roadmap work until the
open-PR queue was resolved and a verified production release was deployed,
with an explicit escape valve for exactly this situation: if deployment is
blocked by missing authorization/credentials, record the single external
blocker and stop before deployment rather than proceed. **Correction, per a
real Codex finding on this PR**: an earlier version of this entry described
that instruction as if it were an actual "CURRENT RELEASE GATE — AUTHORITATIVE"
section written into this file, quoted a "Definition of Done" from it, and
told future sessions to keep halting on it — none of that text exists
anywhere in this file or its history (verified via repo-wide search). That
was a real error, now fixed: the pause was this session's own one-off
instruction-following, not a standing rule recorded here. The open-PR-queue
part of it is still accurate on the merits regardless of that instruction's
source: PR #14 remains a deliberate, non-blocking exception (established
multi-session precedent), so the queue genuinely is resolved, and production
genuinely is still stuck on the same external Vercel tooling gap every
session since PR #27 has independently hit (no Vercel CLI login reachable
from any sandbox so far, no Git integration configured on either project,
and the one available deploy tool, `deploy_to_vercel`, uploads a raw file
tree with no git linkage — deliberately not used without a human decision to
accept that tradeoff). **The release candidate is `ui/frontend-modernization`
HEAD as of `c923e0f`** — already fully CI-green (every merge gate re-runs the
full suite) — ready to deploy whenever that access exists.

**Exact next action for the next session**: **a human (or a session with
real `vercel` CLI credentials or the ability to configure Vercel Git
integration) needs to deploy `ui/frontend-modernization` HEAD (`c923e0f`) to
production** — same standing ask as every session since PR #27. **The
"which Vercel project is canonical" question is already resolved, not a
second open decision** — a real Codex finding on this PR correctly pointed
out that `.remember/current.md`'s own PR #41 entry settled this by reading
the root `vercel.json` directly (re-verified this session): it wires the
Next.js app, the real serverless API endpoints, and the legacy static board
viewer into ONE deployment, and `tau-course-planner` deploying that root
config IS the complete, correct production setup — `web` is a leftover
single-subdirectory deploy from before the root config existed, not a real
second candidate. Deploy `tau-course-planner` from the root config; no
project-choice decision is needed first. **This file does not mandate
pausing Agent-quality work until that happens** — every session from PR #48
through PR #65 correctly kept shipping real Agent-quality fixes in parallel
with this same standing deploy blocker, treating it as a separate,
continuously-recorded, human-decision item rather than a gate on other work.
Follow whatever your own session's actual operating instructions say; absent
a specific directive to pause, the established multi-session convention here
is to keep running the Agent Diagnosis Loop (issue #67/#68 are the next
concrete leads) rather than block on this.

## Prior session — PR #65 merged: search stopped the instant bare goal was met, silently dropping a still-legal wanted course

Standing audit (scheduled autonomous run): production/branch/PR/CI/Codex/issue
state inspected first, per this routine's own start-of-session checklist.
`main` remains far behind `ui/frontend-modernization` (full reconciliation
still not done — unchanged, no new evidence this session, not re-investigated
further). Two open PRs existed: **#14** (Decision capability) — reconfirmed
still correctly parked per the standing D-stacking-cap precedent (issue #18);
left untouched, no new evidence changed that call — and **#65** (this entry's
subject), already opened earlier the same day by a prior session, one commit
deep, with CI still pending and only its first commit Codex-reviewed. Picked
up #65 per the anti-duplication/queue-resolution rule (resolve the oldest
in-flight item before starting anything new) rather than beginning a fresh
Agent Diagnosis Loop pass. Issues #15/#18/#20/#21 reconfirmed unchanged, zero
new human comments since the last check.

**The bug** (found by the prior session's fresh Agent Diagnosis Loop pass,
targeting dual-semester/multi-alternative **plan quality itself** — the area
every recent session's "exact next action" had flagged as not yet exercised):
`PlannerWorker.step()` (`api/ai/planner_worker.ts`) began with an
unconditional `if (this.isGoalReached()) return this.recordStop(...)`.
`isGoalReached()` reflects only bare degree-hours/mandatory/category/
legality/annual completion — it has zero awareness of
`model.wantedCourseIds` or of any further balance improvement. The instant
that bare goal became true, the loop stopped for good, even though
`enumerateActions`' group 3 (wanted courses) and group 5 (balance moves) are
unconditional and can still legally, strictly improve the plan's score at
that point. Reproduced against the real `mechanical_engineering_2027` board
fixture: a student with `preferences.wanted_course_ids: ['0512-2508']` (a
real dual-offered elective) got a plan back reporting `blocked:false`,
"valid and complete," while the wanted course was silently never placed —
the same "invalid/incomplete-in-effect plan reported as complete"
self-contradiction class this track exists to close (same family as PR #48's
`legalityGate`, PR #62's `degreeHoursGate`), this time for a dropped
preference rather than a dropped requirement. Reachable on `generate-plan.ts`'s
greedy `worker.run(500,'greedy')` call (used when no model is configured, or
in dev mode) and the beam-search fallback alike — **see the "Known related
gaps" section below for the `LlmOrchestrator` path's own, narrower, unverified
version of this gap (issue #67, downgraded from an initial overclaim after a
Codex correction).**

**Fix**: `step()` no longer exits early on `isGoalReached()`; it always falls
through to the same Reason → Act → Validate machinery and only stops once the
existing terminal "no legal action advances the plan" check finds nothing
left to improve. Can't reintroduce runaway extra-hour bloat: `g1` (degree
completion) is capped at a reservation budget, and group 4 (arbitrary
elective fill) stays gated on `degreeHours < target`, so neither fires
post-goal — only wanted-course and balance-move actions become newly
reachable, still filtered through the existing legality/hard-cap validation.

**One real Codex finding on the initial commit, fixed this session**: the
`run(maxSteps)` fallback recorded a truncation STOP only when
`!isGoalReached()` — correct before this fix (since `step()` used to STOP
the instant bare goal was met), but exactly wrong now that post-goal
optimization can consume the remaining step budget: a run that exhausts
`maxSteps` mid-optimization exited silently, with no STOP recorded and no
signal that further legal improvements existed and were never attempted.
Fixed (`006aad6`) by tracking whether `step()` itself ever produced a STOP,
rather than inferring it from the bare-goal predicate. New regression test
RED-verified against the pre-fix code first (trace ended on `ADD_COURSE`
with no STOP). This session requested a fresh Codex review of the fix commit
(the first round had only reviewed the initial commit) before merging, per
the standing "Codex must review the latest commit" gate — round 2 came back
clean ("Didn't find any major issues"). **This fix itself has its own residual
gap — see "Known related gaps" item 3 below (filed as issue #68): it can't
yet distinguish "genuinely truncated, real work left" from "the last
permitted action already reached convergence," so a complete, goal-reached
plan can in principle be falsely reported as blocked. Not reached at this
session's review time — found afterward on this docs PR, not before merging
PR #65.**

**Final state**: CI green (3/3: Python tests, Next.js build, TypeScript API
tests) on the final commit, `mergeable_state: clean`, the one review thread
resolved with evidence. Full API suite at merge time: **86/86 suites,
1351/1351 tests** (+2 across both commits), zero regressions; `tsc --noEmit`
clean. `git diff --stat`: `api/ai/planner_worker.ts` (+29/-4 for the base
fix, plus the maxSteps-truncation fix) + its test file only — no UI changes,
no other planner files touched. **Merged as `8d4b5f5`.**

**Classification: C** (correctness/honesty — same bug class as the
already-fixed disallowed/annual/legality/missing-mandatory/degree-hours
gates, this time for a silently-dropped preference rather than a dropped
requirement).

**Known related gaps PR #65 does NOT fix (three real Codex findings on this
docs PR, #66 — all three verified against the code, not taken on faith, before
acting):**

1. **[Filed as issue #67 — downgraded after a real Codex finding on this
   docs PR corrected the initial P0/P1 severity claim, see below]** PR #65
   only changed `PlannerWorker.step()`. `generate-plan.ts`'s actual default
   branch, whenever a model is configured and the app is not in dev mode,
   calls `LlmOrchestrator`, NOT `worker.run(500,'greedy')` directly
   (`generate-plan.ts:1529-1532`; `isDevMode()` always returns `false` under
   `VERCEL_ENV=production`). `LlmOrchestrator.run()`'s OWN outer fallback
   (`planner_orchestrator.ts:74-76`) only re-runs the deterministic loop when
   `!worker.validateCandidate().valid`, which has zero `wantedCourseIds`
   awareness. **However — verified after a Codex finding on this docs PR
   correctly pushed back on the initial severity claim — the LLM's `tools`
   include `finalize_plan` (`planner_tools.ts:82-95`), whose `execute()`
   calls `worker.repair()`, which itself calls `this.run(500,'greedy')`: the
   SAME fixed post-goal loop PR #65 patched.** The system prompt
   (`planner_orchestrator.ts`'s `DEFAULT_SYSTEM`) explicitly instructs the
   model to finish by calling `finalize_plan` ("סיים בקריאה ל-finalize_plan"),
   so the normal, designed flow already gets PR #65's fix on this path too.
   **A further Codex finding refined the condition once more**: `finalize_plan`'s
   `execute()` only calls `worker.repair()` and returns a report — it does
   NOT terminate or lock the tool-calling loop, so nothing stops the model
   from issuing more tool calls afterward (e.g. adding an ordinary filler,
   then removing the just-placed wanted course) and finishing in a state
   where `validateCandidate().valid` is still `true` — the outer fallback
   never fires, and the wanted course is dropped again. **A third Codex
   finding narrowed this further**: a mutation after `finalize_plan` only
   removes the deterministic convergence *guarantee* — it doesn't by itself
   reproduce the wanted-course loss (e.g. a post-finalize `move_course` can
   easily leave the wanted course placed and the plan still fully optimized).
   So the precise repro condition is not "any run whose final mutation
   happens after its last `finalize_plan` call," but one where that
   post-finalize activity **actually undoes or fails to redo an optimization**
   `worker.repair()` had achieved (e.g. removes a wanted course, or
   unbalances load) with no later `finalize_plan` call to recover it — still
   an LLM-behavior-dependent compliance mode, not an unconditional missing
   deterministic backstop.
   **Not reproduced against a real/mocked `LlmOrchestrator` run** — genuinely
   unknown how often real models exhibit either variant in practice. Filed as
   **issue #67** (now corrected twice) with this precise condition and a
   suggested repro-first approach, rather than fixed inline — this docs PR's
   diff stays docs-only, across both `AUTONOMOUS_PROGRESS.md` and
   `.remember/current.md`, no product code touched. **Downgraded from the
   initial P0/P1 label**: per Codex's correction, an unverified, conditional, model-dependent
   preference-quality gap should not automatically preempt the rolling-
   classification-window preference below without production reproduction
   first — that decision is deferred to whichever session actually
   reproduces (or rules out) the no-`finalize_plan` case.
2. The `AI_USE_AGENTIC_PLANNER=true` path (`PlannerAgent` +
   `planner_search_beam.ts`) has the identical predicate gap one level down —
   `TauPolicyProvider.isGoal` (`planner_policy.ts`) is the same bare
   degree/mandatory/category/legality/annual completion check, with zero
   `wantedCourseIds` awareness, and `planner_search_beam.ts`'s loop
   terminates (`terminationReason = 'goal_reached'`) the instant every beam
   state satisfies it. This session confirmed only that `AI_USE_AGENTIC_PLANNER`
   is not set in any *committed* config — no tool in this session's Vercel
   MCP access exposes live environment-variable values (`get_project` doesn't
   include them, and no dedicated env-var tool is available), so **this does
   NOT independently verify the live Vercel configuration** (real Codex
   finding on this docs PR, `discussion_r3663503721` — a fair correction:
   every prior session's identical "unreachable in production" claim about
   this flag carries the same unverified gap, worth a future session actually
   checking via `vercel env ls` or equivalent if/when that access exists).
   Recorded here as **default-off / not committed / not independently
   confirmed against the live environment** rather than "unreachable," per
   Codex's suggested wording. **A further Codex finding correctly caught
   that priority here is NOT "regardless" of #67 — it's conditional on the
   live flag**: `generate-plan.ts:1495-1526`'s `if
   (process.env.AI_USE_AGENTIC_PLANNER === 'true')` is a mutually-exclusive
   dispatch — if that flag IS set live, every real request routes through
   `PlannerAgent`/`planner_search_beam.ts` exclusively, the `LlmOrchestrator`
   path issue #67 describes is never reached at all, and this beam-search gap
   becomes the sole active production defect, not a lower-priority one. Not
   separately filed as its own issue; worth folding into the same future fix
   session as #67 since it's the identical bug class, but whichever of the
   two is confirmed live-reachable should be treated as the priority one (see
   "exact next action" below, which already states this correctly).
3. **[Filed as issue #68]** PR #65's OWN maxSteps-truncation fix (the
   `006aad6` commit, "One real Codex finding on the initial commit" above)
   has a residual regression, itself a real bug in already-merged code, not
   just a docs-accuracy gap: before PR #65, `step()` returned an instant STOP
   the moment `isGoalReached()` became true (message never mentions
   "maxSteps"), so `run(maxSteps)`'s loop always exited via that internal
   STOP well before the budget could run out in the goal-reached case — this
   was structurally unreachable. PR #65 removed that early return, making it
   newly possible for the loop's very last permitted iteration to be a real
   accepted action that itself reaches full convergence, with no further
   `step()` call left in budget to detect it and emit the normal convergence
   STOP — so `run()`'s post-loop code now always records a truncation STOP,
   and BOTH of its message variants contain the substring `"maxSteps"`.
   `generate-plan.ts:1543`'s `hitMaxSteps` detection (`.some(a => a.action
   === 'STOP' && a.reason?.includes('maxSteps'))`) doesn't distinguish the
   two cases, and `generate-plan.ts:1559-1561` unconditionally pushes
   `STEP_LIMIT_ERROR` into `blockingErrors` whenever `hitMaxSteps` is true —
   so a plan that is actually complete (bare goal met, fully legal) but
   merely ran out of step budget mid-optimization can be falsely reported as
   **blocked**, the mirror-image failure mode of the bug PR #65 fixed. Not
   reproduced against the real default production budget (`worker.run(500,
   'greedy')`) — 500 legal actions in one plan is implausible for any real
   board, so low real-world likelihood at that scale (Codex's own badge on
   this finding was P2, not P1) — but readily reproducible at small
   `maxSteps` values, which is exactly how PR #65's own regression test
   demonstrates the underlying mechanism. Filed as **issue #68** with a
   suggested fix direction (distinguish real truncation from
   last-action-was-the-convergence-point via a non-consuming post-loop
   convergence check) rather than fixed inline — needs its own RED-verified
   regression test isolating the exact boundary, out of scope for this
   docs-only PR.

**Rolling-three check: (60, 62, 65) = A/C/C — compliant** (all three are
A/B/C; PR #60 is the A/B). **Net: positions 62 and 65 are both C, so the
immediate next milestone should be A or B** — picking another C next would
produce (62, 65, next) = C/C/C, the same non-compliant pattern already
avoided once before at the (53, 56) juncture. Candidates already on record:
naming a real production consumer for one of the unwired Simulation/
Persistence/Decision capabilities (PRs #12/#13/#14) and wiring it in (B), or
a UI improvement to how `academicDecision.explanation`/blocked-plan states
are surfaced (A) — the diagnosis pass this session inherited also reconfirmed
a minor, not-yet-fixed accessibility gap in the blocked-plan panel
(`app/web/semester_board_viewer.html`: no `aria-live`/focus-move on
appearance) as one concrete A-classified candidate.

**Production check**: not re-verified via the Vercel API this session (no
new evidence prompting a re-check; standing pin at `26500d4`, "Merge PR #11",
unchanged since every session's check going back to PR #27). PR #65 (along
with every other merged fix since PR #11) joins the same growing
merged-but-not-deployed backlog — this remains the standing, previously
human-flagged (issue #18) deploy-mechanism blocker, not re-litigated this
session absent new evidence.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #65 is merged and closed — do
not reopen it or re-address the greedy-path (`PlannerWorker.step()`) fix
itself. **Issue #67 is NOT an automatic P0/P1 preemption** — corrected this
session after two real Codex findings: `finalize_plan` (the LLM's own tool,
which its system prompt instructs it to call to finish) already runs the
SAME fixed `worker.repair()` → `run(500,'greedy')` loop PR #65 patched, but
that tool doesn't terminate or lock the model's tool loop — so the precise
gap is any run whose final relevant mutation is NOT followed by a
`finalize_plan` call (covers both "never calls it" and "calls it, then
mutates again afterward and drops the wanted course"), unreproduced,
model-dependent, not a confirmed default-path break. Treat issue #67 as a
normal rolling-window candidate (reproduce both variants against a
real/mocked `LlmOrchestrator` first, per its own suggested approach), not
something that must jump the queue. The
`planner_search_beam.ts`/`AI_USE_AGENTIC_PLANNER` analog (gap #2
above) is lower priority — but per the "Known related gaps" caveat above,
its live-production status is **default-off/not-committed, not
independently confirmed**, not "unreachable"; if a future session with
Vercel env-var access confirms the flag IS set live, this stops being
lower priority and becomes as urgent as issue #67. Worth folding into the
same fix session as #67 regardless, since it's the identical bug class.
**Issue #68**
(the maxSteps-truncation false-block regression in PR #65's own merged code)
is real but lower real-world likelihood at the actual production `maxSteps:
500` budget — worth fixing in the same session as #67 given the shared file
(`planner_worker.ts`), but not itself urgent enough to preempt #67. Absent a
decision to pick up issue #67 immediately, run a fresh **Agent Diagnosis
Loop** against the real `generate-plan.ts` handler (both paths) if no A/B candidate
is otherwise picked up from the open queue; standing human-decision blockers
above (issues #15/#18/#20/#21) remain untouched pending a human call, and
this does not override the standing P0/correctness-preemption rule.

## Prior session — PR #62 merged: unrecoverable degree-hours shortfall silently reported as a soft warning instead of a blocking error, plus 20 real rounds of Codex-caught recovery-probe correctness gaps

Standing audit (scheduled autonomous run): this session's assigned branch
(`claude/youthful-tesla-cihf6a`) had zero commits of its own and was already
level with `origin/main`'s tip — `main` remains ~190+ commits behind
`ui/frontend-modernization`, unchanged, full reconciliation still not done
(see prior entries). At session start, PR #62 (this entry's subject) was
already open, mid-review, from a session provisioned earlier the same day —
picked it up per the anti-duplication/queue-resolution rule (resolve the
oldest in-flight item before starting anything new) rather than beginning a
fresh Agent Diagnosis Loop pass. PR #14 (Decision capability) remained the
only other open PR, correctly still parked per the standing D-stacking-cap
precedent; issues #15/#18/#20/#21 reconfirmed unchanged, zero new human
comments. Production reconfirmed via the Vercel API — `tau-course-planner`
still pinned at `26500d4` ("Merge PR #11"), unchanged since every check going
back to PR #27; every deployment's `creator`/`meta.actor` shape confirms
deploys remain one-off CLI `vercel --prod` invocations with no Git
integration on any branch (`get_runtime_errors` came back `403 Forbidden`
this session — a permissions gap on that specific endpoint, not evidence of
either a healthy or unhealthy production state, so not treated as a status
signal either way).

**The bug** (found via a fresh Agent Diagnosis Loop pass targeting
blocked/error-state honesty, an area no prior session had exercised): when a
plan satisfies every mandatory course and elective-category requirement, is
otherwise fully legal, but the visible catalog is genuinely exhausted before
reaching `model.degreeRequiredHours`, `generate-plan.ts` already computed
this internally (the pre-existing "מיצית את כל הקורסים הזמינים" `warnings_he`
message) but only ever surfaced it as a **soft warning** — never a
`blockingErrors` entry. Concretely reproduced: a 100h-target fixture against
a 12h catalog returned `blocked:false`, `academicDecision.validation.valid:
true`, *and* `academicDecision.explanation.whyThisPlan[0]` stating outright
"התוכנית אינה מלאה עדיין" (the plan is not yet complete) — a machine-visible
self-contradiction inside one API response, directly violating this repo's
own "no incomplete plan may be presented as complete" policy. Same bug class
as PR #48's `legalityGate` and PR #41's structural-gap disclosure, but the
one sibling case (of disallowedGate/annualCompletenessGate/legalityGate/
missingMandatoryGate) that had never gotten its own gate.

**Fix**: new `degreeHoursGate` (`generate-plan.ts`) independently re-derives
the same unrecoverability condition the existing warning already computed,
mirroring every other gate's "re-derive from the final placed set" pattern.
New `DEGREE_HOURS_SHORTFALL_ERROR_PREFIX` (`planner_validate.ts`) gives
`academic_decision_runtime.ts` a distinct cause-attribution instead of
folding into the generic overload catch-all, with its own `suggestedNextActions`
("expand the catalog/planning window or consult an advisor" — neither
"reduce load" nor "rebuild" can fix a catalog-side shortfall).

**Then 20 real, concrete, RED-verified Codex rounds followed**, each closing
a genuine gap in the recovery-probe logic that decides whether a shortfall is
truly unrecoverable (i.e. safe to hard-block) — every one reproduced with a
specific numeric scenario before being fixed, none rubber-stamped:
benign currently-taking-course-on-board reuse wrongly suppressing the gate
(round 1); the same course's hours double-counted, masking a genuine
shortfall (round 2); the recovery rollout itself having no currently-taking
awareness at all (round 3, widened round 5); the rollout's state
reconstruction dropping empty-semester keys that `applyMutation` needs
(round 4); the blocked-branch template suggesting a rebuild for a cause a
rebuild can't fix (round 5); recovery accepted on "any hours added" instead
of actually reaching the target (round 7); needing to search *combinations*
of soft-avoided electives, not just one at a time (round 8); needing to mix
soft-avoided and ordinary actions in one sequence (round 9); off-board
`personal_status.planned` hours never credited (round 10); the coarse
`total_hours_progress.currently_planned_hours` aggregate never credited when
per-course hours are missing (round 11); that credit applied as an
unconditional skip instead of a magnitude-bounded amount (round 12); the
generic completion warning and agent rationale still using uncredited raw
hours even after the gate itself was fixed (round 13); a decisive single-step
recovery candidate starved by 200+ smaller ones ahead of it in enumeration
order (round 14); `REPLACE_COURSE` always illegal for an `is_annual` inId,
and no `REMOVE_COURSE` candidate existing at all for "free this slot for
something bigger" recoveries (rounds 22/24 per the code's own inline
numbering); and, in the final two rounds, the off-board aggregate-credit
subtraction double-discounting an already-*placed* currently-taking course
(round 15) and then an already-placed `personal_status.planned` course
(round 16) — the live frontend's own placed-id filter
(`app/web/semester_board_viewer.html:2496-2498`) applies identically to both `personal_status`
arrays, and the fix had only reached one of them.

**One finding pushed back on rather than fixed blind**: a final review
comment (no concrete repro given, unlike all 20 prior ones) raised that the
hours-delta candidate sort (round 14's own fix) could in principle starve a
`REMOVE_COURSE` candidate the same way it once starved small ADDs, since
REMOVE always sorts last (non-positive delta). Replied with the technical
tradeoff rather than iterating further: this is an irreducible property of
any finite-budget heuristic search asked to prove a negative ("no legal path
exists") — already stacked with four independent mitigations (best-first
frontier expansion, the hours-delta sort itself, illegal candidates never
consuming budget, and the REMOVE_COURSE inclusion this exact concern is
about) — and, critically, the failure direction is the *safer* one
(over-conservative false-positive block, not the "invalid plan presented as
complete" direction this whole PR exists to close). Left the thread
unresolved rather than dismissing it, per this routine's own "reply with
evidence, leave unresolved if uncertain" rule — a concrete fixture would
still get fixed the same RED-verified way as every other finding here.

**Final state**: CI green (3/3: Python tests, Next.js build, TypeScript API
tests) on the final commit, `mergeable_state: clean`. **16 of 17 review
threads resolved with evidence** (15 by the prior session, the 16th — the
round-16 planned-course double-discount — resolved this session once its fix
landed); the 17th (the REMOVE_COURSE-starvation concern described above) was
**deliberately left unresolved**, not an oversight — see the paragraph above
for why. **Merged by the human product owner as `1a2fda2`** while that one
thread was still open (this session was subscribed to PR activity and
handled the final round's Codex finding and thread resolution; the merge
notification itself arrived as a webhook event, auto-unsubscribed per the
tooling's own notice). Full API suite at merge
time: 86/86 suites, 1349/1349 tests, zero regressions; `tsc --noEmit` clean.

**Classification: C** (correctness/honesty — closes a reproduced,
machine-verifiable in-product self-contradiction, same pattern as PR #48;
not a new user-facing explanation the way PR #58/#60 were).

**Rolling-three check: (58, 60, 62) = A/A/C — compliant** (3 of 3 are
A/B/C; 2 of 3 are A/B). No forced classification requirement on the
immediate next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #62 (along with every other merged fix since PR #11) joins the
same growing merged-but-not-deployed backlog.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #62 is merged and closed — do
not reopen it or re-address it. Rolling-three window (58, 60, 62) = A/A/C is
compliant with no forced constraint on the next pick. Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler (both paths)
targeting areas still not yet exercised by any session: dual-semester/multi-
alternative comparison PLAN QUALITY itself (distinct from "is a comparison
mechanism reachable at all," already answered clean by the PR #60 session),
simulate-then-apply user flows (once/if a real one ever becomes reachable —
currently confirmed not to exist), and accessibility/error-state UI behavior
for blocked plans. Standing human-decision blockers above (issues
#15/#18/#20/#21) remain untouched pending a human call; this does not
override the standing P0/correctness-preemption rule.

## Prior session — PR #60 merged: prerequisite-driven placement delay never explained, found via a fresh Agent Diagnosis Loop

Standing audit (scheduled autonomous run): session branch `claude/youthful-tesla-bybfn4`
was, again, the same recurring mistake several prior sessions have had to
correct, provisioned from a stale `main`-derived commit (`92c19e0`) — reset to
`ui/frontend-modernization` tip (`19d65f9`), zero commits lost. Only one open
PR existed (**#14**, Decision capability — correctly still parked per the
D-stacking-cap precedent; issues #15/#18/#20/#21 reconfirmed unchanged, zero
new human comments, `mergeable_state: dirty` against its own stale base but
deliberately left untouched). CI green on the base tip. Production
re-confirmed healthy via Vercel MCP tools (`tau-course-planner`, zero runtime
errors in the last 24h) but still pinned at `26500d4` ("Merge PR #11") — no
new deployment, same standing no-git-integration/no-CLI-credentials blocker
every session since PR #27 has confirmed; re-verified via `list_deployments`
that every deploy remains a one-off CLI `vercel --prod` invocation.

Per the prior session's own "exact next action," ran a fresh **Agent
Diagnosis Loop** (delegated to a background agent driving the real
`api/ai/generate-plan.ts` handler end-to-end with real Hebrew scenarios, both
the default and `use_academic_decision_agent` paths) targeting the four areas
explicitly flagged as not-yet-covered by any prior pass: multi-alternative
comparison, simulate-then-apply flows, multi-turn conversation honesty, and
in-plan prerequisite sequencing.

**Three areas came back clean** (reproduced against the real handler, not
just static-read): multi-alternative comparison (the only comparison-capable
path, `AI_USE_AGENTIC_PLANNER`, is unreachable in production — same standing
finding as Simulation/Persistence/Decision — and the reachable
`academicDecision.decision.rationale` already honestly discloses "זוהי
התוכנית היחידה שנוצרה בסבב זה", no false "best option" claim); simulate-then-
apply (no chat/free-text NLU entrypoint or simulate/apply distinction exists
anywhere reachable — every call is a real full recompute); multi-turn honesty
(the handler is fully stateless per request — a real 3-turn sequence produced
byte-identical, non-stale explanations turn to turn).

**The one real, reproduced finding — in-plan prerequisite sequencing**: when
a course's own prerequisite forces it to be placed later than its earliest
nominally-legal semester (the only gate is `plan_validation.ts`'s
prerequisite strict-timing rule), nothing in the response ever explained why.
`PlannerWorker`'s trace-reason buckets (mandatory/category/wanted/filler-
hours) never reference sequencing, and
`academicDecision.explanation.whyThisPlan` is plan-aggregate-only. A user who
explicitly wanted a course "as soon as possible" got zero signal that
prerequisite ordering — not preference, capacity, or any other visible
constraint — is why it landed a year later. Reachable on the real default
production path, not gated behind any inert flag.

**Fix** (`1f8cfc2`, PR #60): new `prerequisiteSequencingNotes()` in
`generate-plan.ts`'s `toProposal()`, following the file's existing gate
convention (`disallowedGate`/`annualCompletenessGate`/`legalityGate`) — a pure
function of `(finalState, model)` that re-derives the same strict-timing fact
`plan_validation.ts`'s own validator enforces, pushing a Hebrew explanatory
note into `warnings_he` when a placed course's delay is attributable to an
unresolved prerequisite's own placement. Reaches both the default path's UI
rendering and, via the shared warnings-composition,
`academicDecision.explanation.risksAndTradeoffs` on the agent path.

**Self-caught correctness guard, before any Codex round**: only fires when
the course's nominal legal-semester data is *confident*
(`getLegalSemesters`'s own flag) — the same "confident-or-stay-silent"
convention `buildValidationContext`/`addCourseActionsFor`/`annualSpansFor`
already use. Without this guard, an elective with no known offering
restriction would get a false-positive note for almost any unresolved
prerequisite (`legalSemestersFor`'s unconfident fallback treats every known
semester as "legal", making semester 0 look spuriously early). Caught during
self-review via a dedicated regression test, RED-verified specifically
against the unguarded implementation before the guard was added.

**Tests**: new `tests/api/generate_plan_prerequisite_sequencing_explanation.test.ts`
(5 tests — real scenario, negative/no-delay sanity check, agent-path
disclosure, agentic-planner-path disclosure, and the false-positive
confidence-guard check) + a dedicated new fixture
`data/boards/test_program_prereq_sequencing_2027.json` (the existing shared
`test_program_prereq_2027.json` fixture can't reproduce this scenario — its
`ADV` is only nominally legal starting *after* `PRE`'s own semester already,
so there's no gap to explain; a new fixture avoids touching the two existing
test files that depend on the shared one's exact shape). All 5 RED-verified
(both against the unfixed code, and the confidence guard specifically against
the unguarded version) before confirming green. Full API suite **85/85
suites, 1325/1325 tests** (+5, zero regressions), `tsc --noEmit` clean. `git
diff --stat`: `generate-plan.ts` (+90/-1) + the 2 new files only.

**PR #60 opened against `ui/frontend-modernization`, marked ready, `@codex
review` posted, subscribed to PR webhook activity.** Codex reviewed the only
commit (`1f8cfc2`) clean ("Didn't find any major issues"), CI completed
`success` (3/3: Python tests, Next.js build, TypeScript API tests),
`mergeable_state: clean`, no review threads. **Merged as `0e4ec0d`** in the
same session via the webhook-driven continuation; auto-unsubscribed on merge
per the tooling's own notice.

**Classification: A** (user-visible — the new note renders in the real chat
UI: `semester_board_viewer.html`'s `warnings_he` classifier has no
special-case regex match for this text, so it falls through to the generic
`details` bucket and is displayed, not dropped).

**Rolling-three check: (56, 58, 60) = C/A/A — compliant** (all three are
A/B/C; two are A/B). No forced A/B/C-mix requirement on the immediate next
milestone, though two A's in a row is worth noting for future tracking (not a
violation — the rule only forbids 0-A/B windows and >2-D windows).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed, re-verified this session. PR #60 (along with every other merged
fix since PR #11) joins the same growing merged-but-not-deployed backlog.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #60 is merged and closed — do
not reopen it or re-address it. Rolling-three window (56, 58, 60) = C/A/A is
compliant with no forced constraint on the next pick. Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler (both paths)
targeting areas still not yet exercised by any session: dual-semester/multi-
alternative comparison PLAN QUALITY (distinct from the "is a comparison
mechanism reachable at all" question this session answered — e.g. does the
single plan the default greedy search produces actually balance dual-offered
electives well?), simulate-then-apply user flows (once/if a real one ever
becomes reachable — currently confirmed not to exist), and
accessibility/error-state UI behavior for blocked plans. Standing
human-decision blockers above (issues #15/#18/#20/#21) remain untouched
pending a human call; this does not override the standing
P0/correctness-preemption rule.

## Prior session — PR #58 merged: wanted-vs-excluded contradiction disclosure, including a Codex-caught stale-placement wording bug

Start-of-session audit: session branch `claude/youthful-tesla-t0vt3j` was —
again, the same recurring mistake several prior sessions have had to
correct — provisioned from a stale `main`-derived commit (`92c19e0`); reset
to the current `ui/frontend-modernization` tip (`95321e4`), confirmed zero
unique commits lost. Two open PRs found: #14 (Decision capability, still
correctly deferred per the issue #18 D-stacking-cap decision — reconfirmed
no new human comments on issues #15/#18/#20/#21 since the last check, so
left untouched) and #58, already opened this same day with the exact minor
finding the prior session's entry had flagged and deliberately deferred
("low severity... a candidate for a future minor milestone").

**Picked up PR #58** rather than starting new diagnosis work, since an
open PR already addressed the selected finding (per this routine's
own anti-duplication rule) and it already had one live Codex finding to
resolve: Codex correctly caught (`discussion_r3632198441`) that the new
wanted-vs-excluded disclosure text unconditionally claimed the exclusion
"won" and the course "was not placed" — but when the overlapping course was
already on the **incoming board**, `planContextToState` seeds that
pre-existing placement and the planner never removes it on its own;
`disallowedGate` then reports it as a blocking `DISALLOWED_PLACED_ERROR_PREFIX`
error instead, so the course is actually still present in
`proposal.semesters`. The old wording self-contradicted that same
response's own semesters/error content in that scenario.

**Fix** (`718945c`): split `contradictoryWantedNames` into two groups —
names that also appear in a `DISALLOWED_PLACED_ERROR_PREFIX` error (still
placed, stale) vs. names that don't (correctly excluded, genuinely not
placed) — each with its own accurate, non-contradictory
`risksAndTradeoffs` wording. Extraction mirrors the existing
`missingMandatoryNames` pattern (strip fixed Hebrew prefix, exact match).
New regression test RED-verified against the pre-fix code (reproduced the
exact self-contradiction Codex flagged) before confirming green.

**Tests**: full API suite **84/84 suites, 1320/1320 tests** (+6 from
baseline 1314 across both PR #58 commits), zero regressions. `tsc --noEmit`
clean.

**Merged** PR #58 (`5ea5d2f`) after CI green (3/3: Python tests, Next.js
build, TypeScript API tests) and a final clean Codex review on the fix
commit ("Didn't find any major issues"), with the one review thread
resolved with evidence. **Classification: A** (user-visible —
`risksAndTradeoffs`/`suggestedNextActions` render verbatim in the real chat
UI panel via `academicDecisionHtml()`).

**Rolling-three check: (53, 56, 58) = C/C/A — compliant** (at least two of
three are A/B/C — all three are; at least one is A/B — 58 is A). The
prior session's own note correctly anticipated this: two trailing C's
(53, 56) left no room for a third C, and this A-classified pickup
satisfied that constraint rather than extending the streak.

**Production check**: re-confirmed directly via Vercel MCP tools (now
reachable this session) — `tau-course-planner` (the project actually
serving production traffic) is still pinned at its newest `target:
production` deployment, commit `26500d4` ("Merge pull request #11"),
unchanged since every prior session's check going back to PR #27. No new
deployment exists. Deploys remain one-off `vercel --prod` CLI invocations
with no Git integration wired to any branch (confirmed again: `list_deployments`
shows every production deploy's `creator`/`meta` matches this known
mechanism, not a webhook-triggered one). This sandboxed session still has
no safe path to perform the deploy itself — `deploy_to_vercel` would upload
a raw file tree with no git linkage, breaking `gitCommitSha` traceability,
so deliberately not used, matching every prior session's same call. PR #58
(and every other merged fix since PR #11) joins the same growing
merged-but-not-deployed backlog — still not recomputing a precise count
this session (the counting methodology was never pinned down precisely
enough per the correction chain on PR #57), but confirming the trend is
unchanged: still growing, not shrinking.

**Standing blockers, unchanged, not re-investigated further this session
(no new evidence since last check)**: issue #15/#18 (PR #14 D-stacking
merge decision, Vercel production-architecture question — `tau-course-
planner` fastapi project vs. `web` nextjs project), issue #20 (386/386
`jest.ui.config.js` failures, 100% one root cause — the gitignored
`supabase_board_backup_2027_pre_sync.json` fixture — needs a human call on
committing a sanitized replacement), issue #21 (dead-code delete-vs-restore
call). All confirmed still open with zero human comments as of this
session's check.

**Exact next action for the next session**: PR #58 is merged and closed —
do not reopen it or re-address it. The rolling-three window (53, 56, 58) =
C/C/A is compliant with no forced constraint on the next pick beyond the
standing rule (never two C's followed by a third C). Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler with Hebrew
scenarios in areas not yet covered (multi-alternative comparison,
simulate-then-apply flows, multi-turn conversation honesty, in-plan
prerequisite sequencing remain the standing candidates several prior
sessions have named but not yet exercised) to find the next highest-impact
real Agent failure — per this routine's "repeat until all critical
scenarios pass" instruction. This does not override the standing
P0/correctness-preemption rule, nor the standing human-decision blockers
above (issues #15/#18/#20/#21), which remain untouched pending a human
call.

## Prior session — PR #56 merged: missing-mandatory cause misattributed to the user's own hard exclusion

Start-of-session audit: no human comments landed on the standing decision
issues (#15/#18/#20/#21) since the last session — all still open, all still
correctly un-acted-on pending a human call (see "Standing blockers" below).
Only one open implementation PR existed (#14, Decision capability) — left
untouched per the D-stacking-cap precedent, unchanged. No Vercel MCP tools
were reachable this session either (confirmed via ToolSearch) — the
standing "no deploy path" blocker is unchanged, not re-investigated further
since no new evidence exists. Session branch `claude/youthful-tesla-sgzgz9`
was — again, the same recurring mistake several prior sessions have had to
correct — provisioned from a stale `main`-derived commit (`92c19e0`); reset
to the current `ui/frontend-modernization` tip (`4bda2ab`) before starting,
confirmed zero unique commits lost.

Per the exact next action the prior session (PR #53) left in this file, ran
a fresh **Agent Diagnosis Loop** (delegated to a background agent driving
the real `api/ai/generate-plan.ts` handler end-to-end via the same
dev-bypass/on-disk-fixture pattern `tests/api/generate_plan_academic_decision_agent.test.ts`
uses — read-only, no product code touched during diagnosis) with Hebrew
scenarios in areas not yet covered by issue #25's closed findings:
hard-avoid-vs-mandatory conflict wording, and contradictory
wanted-vs-disallowed preferences on the same elective course.

**The finding**: when a mandatory course is missing from the plan *solely*
because the user hard-excluded it themselves (`disallowed_course_ids` /
`strongly_avoided_course_ids`), `academic_decision_runtime.ts`'s
`buildAcademicDecision` told them to "check what prerequisites it needs, or
request a rebuild" — advice that can never help (a rebuild reproduces the
identical result while the exclusion stands; the course may have zero
prerequisites). Root cause: `hasMissingMandatoryError` was a single flat
boolean, never cross-referenced against `input.context.excludedCourseIds`
(already available at the call site, unused for this purpose). Same "wrong
remedial advice" bug class PR #44/#48 fixed for the annual/step-limit/
legality causes — a sub-case (missing-mandatory itself has two distinct
root causes) those fixes never covered.

**Fix** (`b84c1d9`, PR #56, against `ui/frontend-modernization`): splits the
flag into `hasMissingMandatoryDueToExclusion` vs
`hasMissingMandatoryOtherCause` (matched by course name extracted from the
error text, exact-match after stripping the fixed prefix — not a substring
check, which would false-positive on the prefix's own generic wording), each
with its own correct `blockingCauseClauses` entry and
`suggestedNextActions` line. Both fire together when a plan has one of each
cause. `api/ai/generate-plan.ts` and every other caller untouched — the
`excludedCourseIds` wiring this fix reads already existed at the real call
site.

Minor secondary finding from the same diagnosis pass, **not acted on** (low
severity — a disclosure gap, not a blocking-correctness bug): when a course
is both `wanted_course_ids` and `disallowed_course_ids` simultaneously, the
exclusion correctly wins silently, and the category-unsatisfied warning
already gives a truthful signal, but nothing states the two preferences
directly conflicted. Left as a candidate for a future minor milestone, not
worth a P1-priority fix on its own.

**Tests**: 3 new cases in `tests/api/academic_decision_runtime.test.ts`
(RED-verified against the unfixed code first), full API suite **1314/1314**
across 84 suites (+3, zero regressions), `tsc --noEmit` clean. `git diff
--stat`: only the runtime file + its test file.

**PR #56 opened, marked ready, `@codex review` requested, subscribed to PR
activity.** Codex reviewed the final commit (`edd69c1`) clean ("Didn't find
any major issues"), CI (`.github/workflows/ci.yml`) completed with
`conclusion: success` on that same commit, `mergeable_state: clean`, no
unresolved review threads. **Merged as `24d8877`** via the webhook-driven
continuation of this same session.

**Classification: C** (correctness/honesty — real, reproduced, in-product
wrong advice on a production-reachable path). **Rolling-three check: (50,
53, 56) = A/C/C — currently compliant, but constrained going forward.**
(Two rounds of real Codex findings on the docs PR #57 that recorded this,
`discussion_r3631848828` and `discussion_r3631880980`: round 1 caught that
an earlier draft skipped merged-and-A-classified PR #50, mis-deriving (48,
53, 56) = C/C/C; round 2 caught that the fix then over-corrected to "no
forced requirement at all," ignoring that positions 53 and 56 are BOTH C —
picking another C next would immediately produce (53, 56, next) = C/C/C,
the exact non-compliance already seen once before at (32,34,37). Both
corrected here.) **Net: the immediate next milestone should be A or B** —
not because the current window is broken, but because two trailing C's
leave zero room for a third before the window breaks. Candidates: wiring
one of the unconsumed Simulation/Persistence/Decision capabilities (PRs
#12/#13/#14) into a real production caller (B), or a UI improvement to how
`academicDecision.explanation` is surfaced (A).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed; re-confirmed this session that no Vercel MCP tool is reachable
either. PR #56 (now merged) joins the same growing backlog of merged-but-
not-deployed work. (Codex review on docs PR #57,
`discussion_r3631939655`, correctly caught that an earlier draft here
regressed this count to 14 — below the 17 already recorded as of PR #51's
merge — with no recount to justify a decrease. `git log
26500d4..origin/ui/frontend-modernization` shows at least 25 distinct
merged PR numbers since production's pin, several with many Codex-round
commits each; the backlog has only grown since the 17 count, not shrunk.
Not asserting a new precise "fixes only" number here — the 17-count's own
methodology (which PRs count vs. pure docs) was never pinned down
precisely enough to extend reliably — but the trend is unambiguously
upward, and the next session should either recompute a real count with a
stated methodology or simply state "unchanged, still growing" rather than
inventing a smaller figure.)

**Standing blockers, unchanged, not re-investigated further this session
(no new evidence since last check)**: issue #15/#18 (PR #14 D-stacking
merge decision, Vercel production-architecture question — `tau-course-
planner` fastapi project vs. `web` nextjs project), issue #20 (386/386
`jest.ui.config.js` failures, 100% one root cause — the gitignored
`supabase_board_backup_2027_pre_sync.json` fixture — needs a human call on
committing a sanitized replacement), issue #21 (dead-code delete-vs-restore
call). All confirmed still open with zero human comments as of this
session's check.

**Exact next action for the next session**: PR #56 is merged and closed —
do not reopen it or re-address it. The current rolling-three window is
compliant ((50, 53, 56) = A/C/C — see correction above), but positions 53
and 56 are both C, so **the next milestone selected should be A or B** —
picking another C now would immediately create a non-compliant (53, 56,
next) = C/C/C window. Two standing candidates: naming a real production
consumer for one of the unwired Simulation/Persistence/Decision
capabilities (PRs #12/#13/#14) and wiring it in (B), or improving how
`academicDecision.explanation` is actually surfaced in the UI (A). **This
does not override the standing P0/correctness-preemption rule**: a newly
discovered production incident, hard-constraint violation, or other P0/P1
correctness break still takes priority over the rolling-window preference,
exactly as this routine's own priority order already states ("Never select
a lower-priority item while feasible higher-priority work remains"). Absent
such an emergency, prefer A/B before returning to another C-classified
Agent Diagnosis Loop finding (candidates already surfaced: the
wanted-vs-disallowed disclosure gap noted above, or a fresh sweep of
multi-turn conversation honesty / simulate-then-apply areas per the P1
checklist).

## Prior session — PR #53 merged: issue #25 Finding #4 (planner front-loads elective hours ahead of mandatory obligations), closing issue #25

Resumed PR #53 (issue #25 Finding #4), found already 20 commits deep across
21 rounds of real Codex findings from prior sessions the same day. Picked up
the outstanding unresolved Codex finding (a shared-prerequisite boundary
that was tightened but never re-propagated to that prerequisite's own
prerequisites) and fixed it, then re-merged the base (`ui/frontend-
modernization` had moved 2 docs-only commits ahead) to clear the branch's
`dirty` mergeable state.

Four more real Codex rounds followed, each a genuine narrower gap in the
same reachability/reservation mechanism, all fixed with RED-verified
regression tests:
- Round 22: category-candidate (group 2) and wanted-course (group 3) action
  proposals had no boundary awareness, letting a required-but-unplaced
  prerequisite that was ALSO a category candidate/wanted course get offered
  at a semester that could never satisfy its dependent mandatory course.
- Round 23: two findings — (a) a required mandatory course that's ALSO
  another mandatory course's prerequisite wasn't boundary-filtered by group
  1 (fixed); (b) a repair MOVE that crosses a mandatory course's
  reachability threshold can transiently lower g1 in a no-lookahead
  configuration — empirically verified via two `PlannerWorker.run()` repros
  (including an adversarial one with 15 competing elective actions) that
  this does NOT reproduce under the ACTUAL production configuration every
  real caller constructs explicitly (`{ topN: 6, rolloutSteps: 80 }` —
  `generate-plan.ts`'s primary worker and fallback, `planner-run.ts`'s
  worker; a first verification pass only checked `PlannerWorker`'s bare
  default (`{ topN: 8, rolloutSteps: 200 }`), a looser and non-representative
  configuration, and was corrected by a Codex finding on the docs PR (#55)
  recording this fix) — documented as a known, investigated limitation
  rather than fixed, since a general fix would mean loosening the search's
  core accept-if-strictly-improves invariant.
- Round 24: a prerequisite id with no profile at all in `model.profiles`
  (data-integrity gap) was wrongly treated as "ambiguous, bias reachable"
  instead of definitively unreachable — fixed.
- Round 25: `isImmovableOccupant`'s "does this occupant have a real
  destination" check only verified raw load headroom, never whether
  relocating there would actually be legal under prerequisite strict-timing
  ordering (for the occupant's own prerequisites, or for another
  already-placed course depending on the occupant) — fixed by a different,
  concurrently-active session on this same branch (`f7e74ca`); verified
  correct (full suite green) and picked up from there rather than pushing a
  duplicate fix, per this repo's established concurrent-session-collision
  handling precedent.

**Concurrent-session note**: confirmed a second session was actively working
this same PR branch during this session (its fix for round 25 landed while
this session was independently implementing an equivalent one). Discarded
the redundant local commit rather than risk a force-push collision — same
handling precedent as the earlier `5742ded`/`isImmovableOccupant` collision
documented lower in this file.

**Merged** PR #53 (`2ccac27`) after CI green (3/3) and a final clean Codex
review ("Didn't find any major issues") with all 26 review threads resolved.
Full API suite: 1311/1311 across 84 suites. `tsc --noEmit` clean.
**Classification: C** (correctness).

**Closed issue #25** — all 5 ranked findings from the original Agent
diagnosis report are now resolved (Findings #1–#4 fixed and merged across
PRs #27/#31/#32/#53; #5 correctly deprioritized as non-exploitable
defense-in-depth debt).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #53 (along with every other merged fix this routine has
produced) is not live for real users yet.

**Standing blockers, unchanged, not re-investigated this session**: PR #14
(Decision capability) correctly remains unmerged per the D-stacking-cap
precedent (issue #18); issue #21 (dead code delete-vs-restore) still needs a
human call; issue #18's Vercel-architecture/canonical-branch reconciliation
question is unchanged.

**Exact next action for the next session**: with issue #25 now fully closed,
re-run the mandated Agent Diagnosis Loop against the real `generate-plan.ts`
handler with fresh Hebrew scenarios (targeting areas not yet covered — see
the "not fully verified" list issue #25 originally flagged, now stale) to
find the next highest-impact real Agent failure, per this routine's own
"repeat until all critical scenarios pass" instruction.

## Prior session — PR #48: Agent Diagnosis Loop finding — prerequisite/duplicate/pinned legality violations were silently discarded, fixed, 1 real Codex finding

Ran the standing start-of-session audit (production health, open `claude/*`
branches, open PRs, Codex reviews, CI, issues, `.remember/current.md`,
`AUTONOMOUS_PROGRESS.md`). Found the assigned session branch was — again, the
same recurring mistake every prior session has had to correct — provisioned
from a stale `main`-derived commit (`92c19e0`, 2026-06-30) instead of current
`ui/frontend-modernization`; confirmed it had zero unique unmerged commits
(fully contained in current history) and reset it. Merged the one
already-ready item in the queue, **PR #47** (docs-only recap of PR #46's
merge, CI green, no product code — same treatment as PR #36/#38).

**New finding this session: real Vercel API access, but no safe deploy path.**
For the first time, this session had genuine Vercel API credentials (not just
CLI-login failure like every prior session) — confirmed via `list_teams`/
`list_projects`/`get_project`/`list_deployments` against the real
`tau-course-planner` project. Re-confirmed production is still pinned at
`26500d4` (PR #11), now 13 merged fixes behind. However, the only deploy tool
available (`deploy_to_vercel`) uploads a raw inline file tree with no git
linkage — impractical and risky for this existing multi-language repo
(hundreds of files across a FastAPI backend and a Next.js app), and would
break the `gitCommitSha` traceability every real deployment has had so far.
**Deliberately did not use it.** The blocker is unchanged in substance: still
needs either a real `vercel` CLI login or Vercel Git integration configured —
now confirmed as an actual tooling gap rather than a credentials gap.

**Then ran the mandated Agent Diagnosis Loop** (delegated to a background
agent driving the real `generate-plan` handler via a throwaway Jest harness,
no product code touched), targeting the areas the last several sessions
flagged as still untested: multi-alternative comparison, simulate-then-apply
flows, multi-turn conversation honesty, and in-plan prerequisite sequencing.
Areas A/B (Simulation/Persistence/Decision wiring) re-confirmed clean — still
zero reachable production trigger path, matching every prior check.

**The finding, fixed as PR #48**: `validatePlanState` (`planner_validate.ts`)
already enforces prerequisite strict-timing, duplicate placement, completed/
currently-taking course reuse, pinned-course "don't move," and illegal
offering-semester placement against the FINAL state — but `generate-plan.ts`'s
`toProposal()` only ever read that same `validateCandidate()` call's
`report.warnings`, never `report.errors`/`report.legal`. Reproduced: a course
already on the board whose prerequisite was never completed or scheduled
anywhere reported `blocked:false, errors:[]`, and on the
`use_academic_decision_agent:true` path rendered a **green "passed legality ✓"
checkmark** right next to explanation text (`whyThisPlan`) admitting the plan
can't legally place the course — a reproduced, rendered, in-product
self-contradiction. Same "computed-but-discarded validation signal" bug class
as issue #25 Finding #1 (PR #27) and the `is_annual` gap (PR #37).

Fix: new `legalityGate()` in `generate-plan.ts`, mirroring the established
`disallowedGate`/`annualCompletenessGate` pattern — re-derives against the
final placed set via `validatePlanState`, prefixes each message with a new
`LEGALITY_VIOLATION_ERROR_PREFIX` so `academic_decision_runtime.ts`'s
cause-attribution (added in PR #44) names it correctly instead of defaulting
to overload guidance — the exact "fifth cause" gap that file's own comment
had anticipated.

**1 real Codex finding, fixed**: the initial version excluded only overload
and annual-incompleteness from the gate's output (to avoid duplicating
`overloadGate`/`annualCompletenessGate`'s own messages), but Codex correctly
caught that `validatePlanState`'s "currently_taking course must not be
re-proposed" check would now false-positive-block **any actively-enrolled
student** — the real board legitimately keeps a currently-taking course
visible in its placed semester slot (`buildPlanContext` in
`semester_board_viewer.html` filters only completed courses out of
`plan_context`, deliberately keeping current ones so they still render).
Verified against the real client code before fixing. Added a third exclusion
marker (`CURRENTLY_TAKING_REUSE_ERROR_MARKER`) and a regression test proving
a currently-taking course shown on the board is not blocked and still
satisfies a dependent course's prerequisite. Round 2: Codex clean.

**Merged** (`fe84c02`). Full API suite **1279/1279** (83 suites, +7 new tests
across both commits), `tsc --noEmit` clean. `web/` (Next.js) build untouched
— confirmed via grep that no file under `web/` references any changed
module. **Classification: C** (correctness/honesty — closes a real, rendered,
in-product self-contradiction; found via the mandated Agent Diagnosis Loop).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged. PR #48
(along with PR #12/13/27/31/32/34/37/39/41/44/46/47) is not live for real
users yet.

## Prior session — PR #46: issue #43 (track_or_focus clarification question) fixed, 3 rounds of real Codex findings

Continuing the same session that merged PR #44. Picked up issue #43 (filed in that same session) as the next milestone — small, already fully diagnosed, ready to implement, and the rolling window was already compliant so there was no forced A/B pressure.

**The bug**: `academic_clarification.ts`'s `track_or_focus` question gates on `!context.track`, but `academic_decision_runtime.ts`'s `extractClarificationContext` never set it — no field for track exists anywhere in `plan_context`/`preferences` (deliberate: `academic_clarification_plan_inputs.ts` documents no planner input consumes it). So the question re-asked identically forever, even after being validly answered — unlike every other clarification field.

**The fix, and 3 real rounds of Codex escalation, each a genuine narrower gap in the same mechanism**:
1. Base fix: `extractClarificationContext` reads a `track_or_focus` answer straight from the raw `clarification_answers` array (presentation-layer only, never reaches planning).
2. Codex: that only resolved the question for the SAME request as the answer — a later, separate submission answering a different question would forget it (the form only renders currently-unresolved questions). Fixed with a client-side accumulator (`_aiClarificationAnswersSoFar`) merging and resending answers across a clarification exchange.
3. Codex: the accumulator then had no scope boundary and could let a stale answer silently override fresh UI state on a later, UNRELATED build (since the server-side merge lets `clarification_answers` win over `preferences`). Fixed by clearing it on any fresh non-resume `requestPlanProposal` call.
4. Codex: the track-answer lookup picked the first matching entry regardless of validity, not the latest valid one. Fixed to scan from the end.

Round 5 (final): Codex clean, no further findings. All 3 threads resolved with evidence.

**Merged** (`b9823c8`), issue #43 closed. Full API suite **1272/1272** (82 suites), `tsc --noEmit` clean. Full `jest.ui.config.js` suite: 386 failing (unchanged pre-existing baseline, issue #20) / 447 passing (+6 new tests), zero regressions. **Classification: C** (correctness — real "the agent ignores my answer" defect on the production-reachable `use_academic_decision_agent:true` path).

Rolling-three check: (41,44,46) = A/C/C — compliant (3 of 3 are A/B/C; PR #41 is the A). No forced A/B requirement on the immediate next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same standing Vercel deploy-mechanism blocker every session since PR #27 has confirmed. PR #46 (along with PR #12/13/27/31/32/34/37/39/41/44) is not live for real users yet.

## Prior session — PR #44: misattributed block-cause explanation, fixed via a fresh Agent Diagnosis Loop pass

Rolling window was compliant after PR #41 (no forced A/B pressure), so per the
standing instruction, ran the mandated **Agent Diagnosis Loop** again before
picking anything — this time targeting P1-checklist areas issue #25's prior
diagnosis pass hadn't covered: draft/applied-state isolation, explanation-vs-
plan-data faithfulness, multi-turn trace consistency, and the clarification-
answer round-trip. Delegated to a subagent driving the real `generate-plan.ts`
handler with real board fixtures (read-only; no product code touched during
diagnosis), then independently reviewed its evidence before acting.

Two areas came back clean (no finding): no surprise-rebuild path exists
(`action_type` is parsed but never read — matches the already-tracked,
deprioritized issue #25 Finding #5; `plan_simulation.ts`/
`planner_orchestration.ts` confirmed not wired into `generate-plan.ts`); the
handler is fully stateless per request, so no stale-trace/metadata leakage
across turns is possible.

Two real findings surfaced:

1. **[Fixed, PR #44]** `academic_decision_runtime.ts`'s `buildAcademicDecision`
   classified any blocking error that wasn't a disallowed-placed-course as
   "overload" — correct when PR #27 introduced this logic (disallowedGate was
   the only other `blockingErrors` source then), but PR #37
   (`annualCompletenessGate`) and PR #39 (`PLANNER_STEP_LIMIT`) both added new
   blocking-error sources afterward without this classification ever being
   extended. A plan blocked only by an incomplete annual course, or only by
   the step-limit cutoff, told the user to "reduce your weekly load or
   confirm an exception" — wrong remedial advice for a block with nothing to
   do with load. Reproduced via the real handler on
   `test_program_annual_course_blocked_2027`. Fixed by replacing the
   two-bucket classification with four explicit cause flags composed into the
   explanation/rationale/suggested-actions, with new shared constants
   (`ANNUAL_INCOMPLETE_ERROR_PREFIX`/`STEP_LIMIT_ERROR` in
   `planner_validate.ts`, avoiding a circular import with `generate-plan.ts`).
   TDD RED-verified (3 new tests reproduced the real "עומס" wording before the
   fix). Full API suite 1267/1267 (82 suites), `tsc --noEmit` clean. **Merged**
   (`c11df8a`) after a clean Codex review round (no findings) and green CI
   (3/3). **Classification: C** (correctness/honesty; production-reachable via
   `use_academic_decision_agent:true`, which the live frontend auto-enables
   for any AI-interested user).
2. **[Filed as issue #43, not fixed this session]** The clarification loop's
   `track_or_focus` question can never be resolved once answered — re-asked
   identically on every turn forever, unlike every other clarification field.
   Distinct root cause (`academic_clarification.ts`/
   `academic_clarification_plan_inputs.ts`), kept out of PR #44 to keep that
   PR's diff narrow. P2 — doesn't block or corrupt a plan, but a real
   user-visible "agent ignores my answer" trust defect.

Rolling-three check: (39,41,44) = C/A/C — compliant. No forced A/B
requirement on the next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
Vercel deploy-mechanism blocker every session since PR #27 has confirmed. PR
#44 is not live for real users yet, same as every other merged fix this
routine has produced so far.

Also re-confirmed at start of this session (no new evidence, not
re-investigated further): PR #14/#15 (Decision capability) correctly remain
unmerged (would be a 3rd consecutive D-classified milestone with no named
production consumer); issue #18's Vercel-architecture/canonical-branch
reconciliation question is unchanged and still a genuine human decision;
issue #25 Findings #4/#5 still need a human `GOAL_STACK` design call /
remain correctly deprioritized; production is healthy (Vercel `READY`, zero
runtime errors in the last 24h) — no incident, just the same standing
staleness.

## Prior session — PR #41: structural degree-hours gap disclosure, merged after 25 Codex rounds

This is exactly the A-class milestone the prior session's own "Exact next
action" #1 (below) called for: "does the frontend surface ANY signal when a
plan is far from the degree target because the board window itself is too
narrow?" It didn't — the Agent Diagnosis Loop (mandated before selecting a
milestone, run against the real `handler` export with real Hebrew scenarios
and the real `mechanical_engineering_2027` fixture) found that a fully
mandatory/category-satisfied plan that legitimately can't reach
`degreeRequiredHours` (catalog exhausted within the visible window) got the
exact same generic "X/Y ש״ש" line as an ordinary, still-fixable shortfall —
and the live frontend then suggested actions (approve a risky elective, wait
for missing data) that don't exist in this scenario. Fixed additively in
`toProposal()` (`api/ai/generate-plan.ts`) and `postPlanChangeSummary`
(`semester_board_viewer.html`): a new, distinct Hebrew warning fires only
when mandatory/category requirements are fully satisfied AND no legal action
can still close the hours gap.

**25 rounds of real Codex review**, each a genuine, narrow, independently
reproduced-and-fixed gap — not rubber-stamped. Full history is in
`.remember/current.md` (top two entries); the short version: rounds 1–20
each caught one more actionable-recovery combination the exhaustion check
missed (soft-avoided electives, currently-taking hours, off-catalog
YEAR_1_2 mandatory courses, replace, move-then-add, annual bundling, ...).
By round 21 the guard had grown into four separate hand-rolled combinatorial
scans — round 22 was a genuine redesign, not another patch: replaced all
four with one `canRecoverMoreHours`, a bounded best-first branching rollout
(budget 200, matching this codebase's existing `rolloutSteps`/`maxSteps`
convention) reusing the same primitives `PlannerWorker.step()` itself uses
(`enumerateActions`/`applyMutation`/`validatePlanState`/`scorePlan`/
`compareScore`). Rounds 23–24 found two more real gaps in the redesign
itself (a budget-accounting bug counting illegal candidates; `REPLACE_COURSE`
having no atomic multi-semester form for `is_annual` courses) — both fixed,
the second by a follow-up session implementing a previously-paused analysis.
Round 25: clean, no new findings.

**Merged** (`d355e7a`, normal merge into `ui/frontend-modernization`). Full
API suite 82/82 suites, 1264/1264 tests; `tsc --noEmit` clean; CI green
(3/3). **Classification: A** (user-visible — honest vs. misleading guidance
for a real, reachable board-window scenario).

**Production check**: still pinned at `26500d4` (PR #11), unchanged — same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #41 is not live for real users yet.

## Prior session — PR #39: silent empty-plan bug found via the Agent Diagnosis Loop, fixed, merged

After PR #37 merged (see below), the rolling-three window (32,34,37)=C/C/C
was non-compliant per this routine's own governance rules (0 A/B in the
window). Per the standing instruction ("run the Agent Diagnosis Loop before
selecting a new milestone"), ran a throwaway Jest harness against the real
`generate-plan.ts` handler with realistic Hebrew/real-board scenarios
(delegated to a subagent for the initial sweep, independently verified the
top finding before acting on it — see below).

**Found and fixed a severe, previously-unknown bug**: whenever a board's
visible semester window can't mathematically fit the FULL remaining
degree-hours target (e.g. a real student's recorded prior-hours is
missing/low — the live frontend's `manual_completed_degree_hours` field,
`app/web/semester_board_viewer.html`, is optional and defaults to `null`,
falling back to `known_completed_hours`), the planner **silently returned a
completely empty plan**: 0 courses, `blocked:false`, `errors:[]`, on the
default (highest-traffic) path and the `use_academic_decision_agent` path
alike. Independently reproduced on the real `mechanical_engineering_2027`
fixture before trusting the subagent's report: `known_completed_hours: 80`
→ 0 courses; `known_completed_hours: 81` → 20 courses. A 1-hour data
difference flips a real user from a full plan to total silence.

Root cause: `planner_lookahead.ts`'s `projectFeasibility` computes an
aggregate "can the remaining degree-hours gap still close within total
headroom" check — its own docstring says an infeasible action "must be
ranked down" (a ranking signal). But `PlannerWorker.step()`
(`planner_worker.ts`) hard-filtered on `.feasible`, so when the full target
is structurally unreachable from the board's window, EVERY candidate
(including a trivially legal, clearly-needed mandatory course) looks
infeasible, and the filter removes 100% of candidates — the worker takes
zero actions and stops on step 1.

**Fixed in PR #39** (`ui/frontend-modernization` ← `claude/determined-
thompson-8ideqq`, merged `5de999f`), after **4 real rounds of Codex
findings**, each progressively subtler, all fixed with RED-verified
regression tests — none dismissed:
- Round 1 (initial fix, `b5fb243`): replaced the hard `.filter(x =>
  x.feasible)` with a sort that ranks feasible actions first but never
  eliminates infeasible ones. Verified end-to-end: the real-board repro
  went from 0 courses to 27, `blocked:false`.
- Round 2 (`fc8f902`): the initial fix collapsed `projectFeasibility`'s
  report to one boolean, so an action blocked ONLY by the aggregate
  `degree_hours` check ranked identically to one that blocks a SPECIFIC
  still-needed mandatory/category course. Fixed by ranking on
  `report.blocked.some(b => b !== 'degree_hours')` instead of the raw
  boolean — the aggregate reason alone no longer counts against ranking,
  but a genuine course-specific block still does.
- Round 3 (`b01d5ec`): the blocker-aware sort ran only on
  `legal.slice(0, topN)` — truncation-by-immediate-score happened BEFORE
  blocker status was known, so >topN blocking high-score actions could
  crowd the one non-blocking action out of consideration entirely. Fixed by
  computing blocker status for the FULL legal set and sorting before
  truncating (the expensive `estimateFinalScore` rollout still only runs
  post-truncation, preserving the original performance intent).
- Round 4 (`0c8be5f`): the `degree_hours` reason was excused
  unconditionally, but that's only correct when it was ALREADY blocked
  before the action (the structural case). An action that NEWLY makes a
  previously-reachable target unreachable (e.g. a "wanted" `is_annual`
  course consuming headroom in multiple semesters for single-count degree
  credit) could still win via preference even though it sabotages
  completion. Fixed by computing `projectFeasibility` once for the CURRENT
  state per step and only excusing `degree_hours` when it was already
  blocked pre-action. This test needed `rolloutSteps: 0` to isolate the bug
  from `estimateFinalScore`'s own (separately correct) downstream-impact
  reasoning, which already happened to mask it in a full-rollout scenario —
  a reminder that this file's two impact-reasoning mechanisms
  (`projectFeasibility` ranking + `estimateFinalScore` rollout) can each
  independently mask bugs in the other; both need direct test coverage.
- Round 5: Codex clean, no further findings — CI 3/3 green, all 3 review
  threads resolved with evidence, merged.

Final state: full API suite 81/81 suites, **1241/1241 tests** (was
1238/1238 at merge time of PR #37), zero regressions. `tsc --noEmit` clean.

**Classification: C** (correctness) — a core planner search-loop defect
causing silent, total planning failure on the default production path. Per
this routine's own priority order, a P0/C-severity correctness fix always
preempts the rolling-window classification rule — this surfaced via the
mandated Agent Diagnosis Loop rather than forcing an A/B milestone
artificially. The rolling-window history below reflects this honestly.

## Prior session work (PR #37) — real Agent-quality fix, finished and merged

Picked up where the prior session left off: PR #37 (`is_annual` course atomic
multi-semester placement fix) was open with a Codex review loop already 9
rounds deep. Re-synced the assigned branch to `ui/frontend-modernization` HEAD
first (this session was, again, provisioned from a stale intermediate point
in history rather than the branch tip — same recurring provisioning issue
prior sessions have had to correct each time).

Round 10 Codex review on commit `b94cad3` left 2 unresolved findings, both
fixed in commit `7a26bc9`:
- **P1**: when a partially-placed annual course's missing span can't legally
  accept it (e.g. the target semester is already at/over `HARD_LOAD_CAP`),
  the repair correctly rejects, but the loop then fell through to the normal
  search/STOP path with the annual course still split — and the
  `generate-plan.ts` response only turned `overloadGate`/`disallowedGate`
  findings into `blocked`, so this returned `blocked:false` even though
  `validateCandidate()` internally knew the plan was invalid. Fixed with a
  new `annualCompletenessGate()`, mirroring the existing `disallowedGate`
  pattern (same one issue #25 Finding #1 established): re-derives
  `incompleteAnnualCourseIds` against the FINAL placed set and turns an
  unrepaired split into a real blocking error.
- **P2**: `placedHours()` only deduplicated annual-hour double-counting via
  the older `root_course_id`+`count_hours_once` pairing (two distinct ids).
  The newer atomic `is_annual`/`spans_semesters` mechanism this PR added
  places the SAME id into multiple `state.semesters` entries — a board
  omitting the optional `count_hours_once`/`root_course_id` metadata had its
  hours counted once per occurrence (8h instead of 4h). Fixed by
  deduplicating on the course id itself first.

Round 11 Codex review on `7a26bc9` surfaced one more (fixed in `7546c21`):
`toProposal()`'s moves-diff reported a repaired annual span as
`{from: <original semester>, to: <new semester>}` even though the course
still occupied the original semester — any consumer applying `moves`
literally could undo the just-completed atomic placement. Fixed: a move's
`from` is only set when the course no longer occupies ANY of its original
semesters in the final state; otherwise `from: null` (an addition, not a
relocation).

Round 12 Codex review on `7546c21`: **clean, no further findings.** CI 3/3
green, all 13 review threads resolved with evidence, base still current.
**Merged** (`c325eb6`, normal merge commit) — 12 real Codex review rounds
across the PR's full lifetime (this session handled rounds 10–12), every
finding fixed with a regression test, none dismissed.

Full API suite at merge: **1237/1237 tests, 81/81 suites**, zero
regressions. `tsc --noEmit` clean. New fixture:
`data/boards/test_program_annual_course_blocked_2027.json` (an annual course
whose missing span is legally unrepairable — pinned to a fixed 23h mandatory
course, breaching the 26h hard cap if completed).

Re-confirmed production state (Vercel API): **unchanged from prior
sessions** — still stale at `26500d4` (`Merge pull request #11`), `live:
false`, no git integration on the project, same sandbox blocker (no Vercel
CLI credentials, `deploy_to_vercel` MCP deliberately avoided — see Blockers).
Now **7** merged, tested, Codex-reviewed fixes are unshipped to real users:
PR #12, #13, #27, #31, #32, #34, and now **#37**.

## Prior session (`claude/determined-thompson-fewuif`) — audit only, no new code

Ran the standing start-of-session audit (production health, open PRs/branches,
Codex/CI state, issues, this doc). Findings below; deliberately took no
autonomous action beyond one safe docs merge, since every substantive item
found is already a fully-diagnosed, open human decision from a prior session
— re-investigating them found nothing new to add.

- **Production confirmed healthy, no incident.** Vercel `tau-course-planner`
  (`prj_8Wn5yOXOxvOSfB6pZ3XVAnf8Y21e`) latest deployment `READY`, zero runtime
  errors in the last 24h. Still stale at `26500d4` ("Merge PR #11") — confirmed
  again via the Vercel API — now missing PR #12/#13/#27/#31/#32/#34, i.e. **6**
  merged, tested, Codex-reviewed fixes including the P0 hard-avoid gate
  (issue #25 Finding #1, PR #27) are unshipped to real users. Also confirmed
  via `get_project` on both Vercel projects: neither `tau-course-planner` nor
  `web` has a linked git repo, so there genuinely is no push-to-deploy path —
  this isn't a missing-secret problem, it's an unmade infra decision (also
  ties into issue #18's canonical-project question).
- **Issue #25 re-checked end to end**: Findings #1 (P0), #2 (High), #3
  (Medium-High) are all confirmed fixed and merged (PR #27/#31/#32) per the
  issue's own comment thread — the issue's top-level body is just stale (still
  describes #1 as unfixed; the comments tell the real story). Only #4
  (`GOAL_STACK` over-allocation, needs a design decision) and #5 (low severity,
  not exploitable) remain open. **No live P0 in the Agent today.**
- **PR #35 merged** (`2b74fd0`) — pure `.remember/current.md` +
  `AUTONOMOUS_PROGRESS.md` correction recording PR #34's already-merged state
  (independently verified accurate against the real merge and diff before
  merging). CI was 3/3 green; no functional change, so merged without waiting
  on a Codex round for this one docs-only PR.
- **PR #14/#15 (Decision capability) left untouched** — correctly still held
  per issue #18's D-milestone-stacking finding; nothing new to add.
- Did **not** attempt a production deploy via the MCP `deploy_to_vercel` tool
  (now available in this session's toolset, wasn't in prior sessions'). Not
  using it because (a) it uploads a raw file tree with no git linkage,
  permanently breaking `gitCommitSha` traceability for every future
  deployment inspection, same risk prior sessions flagged, and (b) it
  wouldn't even resolve the real open question — *which* of the two Vercel
  projects should be canonical is still undecided (issue #18). Deploying to
  the wrong/undecided target, or via a lossy mechanism, is a harder-to-reverse
  mistake than staying stale one more session. Flagging this explicitly as a
  human decision point rather than guessing.

> **⚠️ HISTORICAL SNAPSHOT — SUPERSEDED, DO NOT FOLLOW AS CURRENT STATUS.**
> Everything from here (`## Branch / release state`) through the end of this
> file (`## Exact next action`) is the unedited tail of the
> `claude/determined-thompson-fewuif` session write-up above, current only as
> of PR #48. It predates the "Latest session" / "Prior session" heading
> convention used everywhere above it, so it was never trimmed as newer
> sessions prepended their own summaries. Its rolling-window figures (e.g.
> `(44,46,48)`), blockers list, and "exact next action" are all several
> merged PRs stale (PR #53/#56/#58 and others happened after it) and must
> NOT be treated as the current handoff — **the "Latest session" section at
> the very top of this file is the only authoritative current status and
> next action.** Kept below only for historical/archival continuity, per
> this routine's own instruction to never delete durable progress history —
> flagged as stale rather than silently trusted, per a real Codex finding on
> PR #59 (`discussion_r3632582211`) that a reader could otherwise follow this
> obsolete block and skip the fresh work the top of the file authorizes.

## Branch / release state

- **Canonical development branch:** `ui/frontend-modernization` (transitional —
  `main` is ~190 commits behind it and contains nothing `ui/frontend-modernization`
  doesn't; full reconciliation to make `main` canonical again is NOT done —
  see "Blockers"). This session's assigned branch was, again, provisioned from
  stale `main` by default — reset to `ui/frontend-modernization` HEAD before
  starting, same recurring mistake every session so far has had to correct.
- **Production branch / deploy mechanism:** Vercel project `tau-course-planner`
  (prod domain `tau-course-planner.vercel.app`). **Deploys are one-off local
  `vercel --prod` CLI invocations, not Git-integration-driven** — confirmed via
  the Vercel API (every deployment's `source` is `"cli"`). No branch auto-deploys
  on push.
- **Production commit:** still `26500d4` ("Merge PR #11", 2026-07-19) as of this
  writing — re-confirmed directly via the Vercel API this session (latest
  `tau-course-planner` deployment, `dpl_HJZTB8zqondbwuSnHx6TveggoPVg`, `target:
  production`, unchanged since last session's check). **Stale** — missing PR
  #12/#13 (infra), #27/#31/#32 (issue #25 Findings #1–#3), and now #34 (issue
  #28, this session, merged). No deploy has happened since this was first
  flagged (3+ sessions ago).
- **Deploy blocker:** no session so far (including this one) has had Vercel CLI
  credentials in its sandbox (`vercel login` has no reachable network path).
  Deploying via the MCP `deploy_to_vercel` tool was deliberately avoided — it
  uploads a raw file tree with no git linkage, breaking every existing
  deployment's `gitCommitSha` traceability. **A human (or a session with real
  Vercel CLI access) needs to run a production deploy from `ui/frontend-modernization`
  HEAD.** Flagged repeatedly in issue #18, unresolved across at least 3 sessions.

## This session's milestones (in order)

1. Reset assigned branch from stale `main` to `ui/frontend-modernization` HEAD
   (recurring, see above).
2. Requested fresh Codex review on the two docs-only PRs left open from the
   prior session:
   - **PR #30 closed without merging** — its content (Finding #2 "needs a
     product decision") was superseded the same day by PR #31 actually
     shipping that fix, and it had a real git conflict against the current
     base. Closed with an explanation; the analysis it preserved is still on
     record in issue #25's comment thread.
   - **PR #33 merged** (`8ad6eee`) — Codex-clean on its final commit
     (`13a8017`, which itself already fixed the one prior Codex finding about
     a rolling-three compliance-claim error).
3. **PR #34 merged** (`19cb1e3`) — issue #28 (P2, deferred from PR #27's Codex
   review): client-side stale `blocked`/`overloadBlocked` signal in
   `semester_board_viewer.html` after `applyExplicitAvoidPostFilterLocal`
   locally resolves a disallowed-placement error the server flagged. Fix: new
   pure `resolveStaleDisallowedBlockLocal()`, mirrors the existing
   `hardOverloadRemains` re-check pattern. **2 rounds of real Codex findings
   fixed**, not rubber-stamped:
   - Round 1: the initial `.includes()` name match could wrongly resolve a
     *different*, still-disallowed course's error when one course's name is a
     substring of another's (real catalog prefix pairs exist, e.g. a course
     and its "- מעבדה" lab companion). Fixed with exact-name parsing
     (`parseDisallowedPlacedNameLocal`) instead of substring search.
   - Round 2: the resolution ran too early — right after the avoid
     post-filter, before later eligibility/degree-hours refills (which only
     exclude `unwantedCourseIds`, not hard-excludes) could silently re-add the
     exact flagged course from the elective pool. Fixed by checking the
     ACTUAL final placed course set (ground truth) after every repair/refill
     finishes, instead of a snapshot from one intermediate step.
   Final state: CI 3/3 green, Codex clean on the final commit, both review
   threads resolved with evidence, 8 regression tests (up from the initial 6),
   full API suite unaffected (1202/1202), full `jest.ui.config.js` suite at
   the same pre-existing fixture-gap baseline (386 failing out of 819, zero
   regressions), `tsc --noEmit` clean. Issue #28 closed. Classification: **C**
   (correctness/disclosure fix to an already-shipped feature).
4. Re-investigated issue #25 Finding #4 before picking a milestone: confirmed
   the previous session's conclusion still holds — a naive "cap goal-1's
   marginal near the target" mitigation only helps once the running total is
   close to the target minus remaining mandatory hours; it does NOT fix the
   general case (a large elective outranking a small mandatory course far from
   the target), which would require reordering/reweighting `GOAL_STACK`
   itself. Still a genuine design-tradeoff decision, not attempted this
   session either — picked issue #28 instead as the next item that doesn't
   require a product decision.

## Rolling A/B/C/D milestone history (most recent last)

1. PR #12 — Simulation capability — **D**
2. PR #13 — Persistence capability — **D**
3. PR #27 — hard-avoid plan correctness fix (Finding #1) — **C**
4. PR #31 — agent-path over-blocking fix (Finding #2) — **B**
5. PR #32 — max_weekly_hours disclosure fix (Finding #3) — **C**
6. PR #34 — client-side stale block-state fix, issue #28, merged (`19cb1e3`)
   after 2 rounds of real Codex findings fixed — **C**.
7. PR #36 — docs-only audit recap, merged (`b460f42`) — not classified (no
   product code).
8. PR #37 — `is_annual` course atomic multi-semester placement fix, **merged**
   (`c325eb6`) — **C** (correctness: prevents a real course's true weekly
   load from being silently under-reported, plus a latent state-corruption
   risk where an already-valid annual placement could be split during a
   routine rebuild).
9. PR #38 — docs-only progress recap, merged (`b0d0771`) — not classified (no
   product code).
10. PR #39 — feasibility-ranking fix for the silent-empty-plan bug, **merged**
    (`5de999f`), after 4 real rounds of Codex findings fixed — **C**
    (correctness: the default/highest-traffic planner path could silently
    return a totally empty, `blocked:false` plan; found via the mandated
    Agent Diagnosis Loop, not forced to satisfy the rolling-window rule).
11. PR #41 — structural degree-hours gap disclosure, **merged** (`d355e7a`),
    after 25 real rounds of Codex findings fixed (including a mid-stream
    redesign at round 22) — **A** (user-visible: honest vs. misleading
    guidance for a real, reachable board-window-exhaustion scenario; found
    via the mandated Agent Diagnosis Loop, specifically satisfying the prior
    session's own "must-be-A-or-B" rolling-window requirement).
12. PR #44 — academicDecision explanation block-cause misattribution fix,
    **merged** (`c11df8a`), Codex-clean on the first review round, CI green
    (3/3) — **C** (correctness/honesty: the agent path told users to reduce
    workload for blocks that were actually an incomplete annual course or a
    step-limit cutoff; found via a fresh Agent Diagnosis Loop pass targeting
    previously-uncovered P1-checklist areas).
13. PR #46 — issue #43, track_or_focus clarification question never
    resolving once answered, **merged** (`b9823c8`), after 3 real rounds of
    Codex findings fixed (each a narrower gap in the same fix — single-request
    resolution → multi-step accumulation → cross-flow staleness → duplicate-
    answer ordering) — **C** (correctness: real "agent ignores my answer"
    defect in the clarification-answer round-trip).
14. PR #47 — docs-only progress recap of PR #46's merge, merged (`d1235d8`)
    — not classified (no product code).
15. PR #48 — `legalityGate`: prerequisite-timing/duplicate-placement/pinned-
    move/illegal-semester violations were computed by `validatePlanState` but
    silently discarded from `blockingErrors`, **merged** (`fe84c02`), after 1
    real Codex round (a false-positive block on any currently-taking-course-
    on-board scenario, fixed) — **C** (correctness/honesty: closes a
    reproduced, rendered, in-product self-contradiction — a green "passed
    legality ✓" badge next to explanation text admitting the same violation;
    found via a fresh Agent Diagnosis Loop pass).

Rolling-three checks:
- (12,13,27) = D/D/C — **NOT compliant** (only 1 of 3 is A/B/C; 0 are A/B).
  Pre-existing shortfall from before PR #27 existed — the exact gap issue #18
  already flagged as the reason PR #14 could not be merged as a 3rd D
  milestone. Not retroactively fixable; recorded as an acknowledged historical
  exception, not a compliant window.
- (13,27,31) = D/C/B — compliant (2 of 3 are A/B/C; 1 is A/B).
- (27,31,32) = C/B/C — compliant (3 of 3 are A/B/C; 1 is A/B).
- (31,32,34) = B/C/C — compliant (3 of 3 are A/B/C; 1 is A/B).
- (32,34,37) = C/C/C — **NOT compliant** (0 are A/B). Flagged prospectively
  before #37 merged; the window is real once #37 landed.
- (34,37,39) = C/C/C — **STILL NOT compliant** (0 are A/B). PR #39 was a
  legitimate P0/C-severity correctness preemption (per this routine's own
  priority order: correctness always outranks the rolling-window rule), not
  a violation of the rule's intent — but it does NOT cure the window on its
  own, since the rule counts classifications, not justifications. **The
  next milestone genuinely must be A or B now** unless yet another
  higher-priority correctness issue surfaces (which would be the third in a
  row — still individually justified each time, but worth a human sanity
  check if a fourth C-in-a-row pattern continues, since that starts to look
  less like "correctness keeps winning" and more like "A/B work is being
  systematically avoided").
- (37,39,41) = C/C/A — **compliant** (3 of 3 are A/B/C; 1 is A/B). PR #41
  is the A milestone the prior window's own note required — resolves the
  two-consecutive-non-compliant-window flag; no rolling-window pressure on
  the immediate next milestone.

- (39,41,44) = C/A/C — **compliant** (3 of 3 are A/B/C; 1 is A/B, from PR #41).
  No rolling-window pressure on the immediate next milestone.
- (41,44,46) = A/C/C — **compliant** (3 of 3 are A/B/C; 1 is A/B, from PR #41).
  No rolling-window pressure on the immediate next milestone.
- (44,46,48) = C/C/C — **NOT compliant** (0 are A/B). PR #47 (docs-only) is
  skipped from the window, same convention as PR #36/#38. Like the
  (32,34,37)/(34,37,39) precedent, PR #48 was a legitimate Agent Diagnosis
  Loop correctness finding, not a rule violation in intent — but it does not
  cure the window on its own. **The next milestone genuinely should be A or
  B** unless another higher-priority correctness issue surfaces first.

Every merged window from PR #27 through PR #46 was compliant except the two
historical/prospective exceptions above ((12,13,27), now permanently
unfixable, and the now-cured (32,34,37)/(34,37,39) pair). (44,46,48) is a new
non-compliant window — the next real milestone should target A or B unless a
higher-priority correctness finding preempts it again.

## Blockers

1. **Vercel deploy access** — see above. Everything merged so far (PR #12,
   #13, #27, #31, #32, #34, #37, #39, #41, #44, #46, #48) is inert for real
   users until someone deploys `ui/frontend-modernization` HEAD. This session
   confirmed real Vercel API access for the first time (`list_projects`/
   `get_project`/`list_deployments` all work against the real
   `tau-course-planner` project) — but the only deploy-capable tool
   (`deploy_to_vercel`) uploads a raw inline file tree with no git linkage,
   impractical/risky for this existing multi-language repo and would break
   the `gitCommitSha` traceability every real deployment has had. **Still
   need either a real `vercel` CLI login or Vercel Git integration
   configured** — this is now a confirmed tooling gap, not a credentials gap.
   Do not attempt `deploy_to_vercel` as a substitute without a human decision
   to accept that tradeoff. Real, tested, Codex-reviewed correctness fixes
   (including a silent-empty-plan P0-severity bug, PR #39, the structural-gap
   disclosure fix, PR #41, the block-cause explanation fix, PR #44, the
   clarification round-trip fix, PR #46, and the legality-gate fix, PR #48)
   are sitting unshipped.
2. **Canonical branch reconciliation** (main rewrite / Vercel production-branch
   config, including the open question of which of the two Vercel projects —
   `tau-course-planner` (fastapi, currently serving prod) vs. `web` (nextjs,
   never successfully deployed to production) — is meant to be canonical) — a
   genuine human product decision, flagged multiple times in issue #18, not
   attempted unilaterally by any session including this one.
3. Issue #21 (dead code decision: delete or restore
   `requestPlanProposalFromDraft`/`runPrimaryAiAction`), issue #20 (386
   pre-existing UI test failures, single root cause: missing gitignored
   `supabase_board_backup_2027_pre_sync.json` fixture, needs a decision on
   whether a synthetic/sanitized fixture can replace it) — both need a human
   product call, already fully diagnosed, not blocking Agent-quality work.
4. Issue #25 Finding #4 — planner over-allocation (203h vs 185h target) — see
   milestone 4 above; needs a `GOAL_STACK` design decision before
   implementation, not just an approval to proceed.
5. Issue #25 Finding #5 — no server-side chat-vs-rebuild distinction. Assessed
   this session and **deprioritized, not just left pending**: `action_type`'s
   schema enum has no "chat" value, and the one real caller already never
   sends a rebuild request for a plain chat turn — a server-side gate would
   have zero reachable trigger path in production, i.e. an unused capability.
   Do not pick this up again without a concrete reason a real caller could
   hit it (e.g. a new client, or the field gaining a "chat" meaning).
6. PR #14 (Decision capability) remains open, deliberately unmerged — would be
   a 3rd consecutive D-classified milestone with no named production consumer.
   Recommend a human decide: close/park it as a reference implementation, or
   hold until a real multi-candidate producer exists to consume it. **This is
   also now the most obvious candidate production-consumer question for the
   next A/B milestone** (see Exact next action #1) — wiring Decision (or
   Simulation/Persistence) into a real caller would both resolve this blocker
   and satisfy the rolling-window B requirement in one milestone, IF a real
   multi-candidate producer can be justified by an actual Agent scenario
   (not manufactured just to consume the capability — that would violate
   "Do not build unused capabilities merely to advance an architectural
   checklist" from the other direction).
7. Issue #43 — **closed, fixed in PR #46** (see Latest session above). No
   longer a blocker.

## Exact next action

1. **Rolling window is NOT compliant ((44,46,48) = C/C/C, 0 are A/B) — the
   next real milestone genuinely should be A or B**, unless a higher-priority
   correctness finding preempts it (a legitimate preemption, per this
   routine's own priority order, but track it — a fourth C-in-a-row would be
   worth a human sanity check). Still run the mandated **Agent Diagnosis
   Loop** first (real Hebrew scenarios against the real `generate-plan`
   handler, both default and `use_academic_decision_agent` paths, using a
   real board fixture) to find the next highest-impact real Agent failure
   before picking anything. This session's diagnosis pass covered: Simulation/
   Persistence/Decision wiring (still clean, still unreachable), and
   prerequisite/duplicate/pinned-move/illegal-semester legality (now fixed,
   PR #48) — areas still flagged as untested by prior sessions and not yet
   covered by this one either: dual-semester/multi-alternative comparison
   quality, simulate-then-apply user flows once/if a real one exists, and
   accessibility/error-state UI behavior for blocked plans.
   - PR #14's Decision capability is the standing D candidate that could
     become a B if a genuine multi-candidate producer scenario exists — do
     not force this without a real scenario, per Blockers item 6's caveat.
     **PR #14 must stay unmerged** — D-classified infra with no production
     consumer, per established precedent (multiple sessions now). Wiring it
     into a real caller would satisfy BOTH the rolling-window B requirement
     above AND resolve Blockers item 6, IF a genuine scenario justifies it.
2. **Whoever has Vercel CLI access (or can configure Git integration): deploy
   `ui/frontend-modernization` HEAD to production.** Still the single most
   valuable pending action — 12 real, tested, Codex-reviewed fixes (PR #12,
   #13, #27, #31, #32, #34, #37, #39, #41, #44, #46, #48) are merged and
   waiting. This session confirmed real Vercel API access for the first time
   but found the only available deploy tool unsuited for this repo (see
   Blockers item 1) — do not re-investigate the `deploy_to_vercel` path
   further without a human decision to accept its tradeoffs (no git linkage,
   raw file-tree upload of a large multi-language repo).
3. Issue #25 Finding #4 (planner over-allocation) still needs a human decision
   on the intended `GOAL_STACK` tradeoff before implementation — see Blockers.
   If a decision arrives, the recommended starting point is unchanged: a
   dedicated failing test reproducing the 203h/185h scenario (TDD RED), then
   treat the exact scoring mechanism as an open design question, and run the
   FULL planner test suite (`planner_goals.test.ts`, `planner_scorecard.test.ts`,
   `generate_plan_load_distribution_policy.test.ts`,
   `generate_plan_dual_semester_load_balance.test.ts` at minimum) before
   considering it done.
4. Finding #5 is deprioritized (see Blockers item 5) — do not resume it as
   "the next unblocked item" without a new reason it's reachable in production.
5. Issues #20/#21/#18(reconciliation)/#14 all still need a human product call
   — already fully diagnosed by prior sessions, not re-investigated further
   this session since nothing new was learned.

## 2026-08-30 — durable planner Preview acceptance

- Verified branch and remote at `ef6fb08fb3a421e87c5c40bee7608756b788b20b`.
  `main` remained `a1fb964364d3cab287e2c73e58dab12a850db0f8` and the
  unrelated stash remained untouched.
- Provisioned Preview-only Neon through Vercel Marketplace, pulled only Preview
  environment configuration, and ran the additive planner migration. The
  migration was idempotent and reported schema version 1 current. Production,
  Production environment variables, aliases, domains, Supabase, remote catalog
  data, and `main` were not modified.
- Deployed an immutable clean archive of `ef6fb08` to Preview only:
  `https://tau-course-planner-myhoohvkn-matanyaron-1633s-projects.vercel.app`.
- Live browser acceptance proved the server-side path, not just test doubles:
  a manual elective add changed year 4 semester A from 2 to 3 courses and
  survived reload; the explicit completed-course state (24 identified courses,
  92.5 authoritative hours) also survived reload.
- The deterministic Academic Decision Agent generated three alternatives from
  that state. Apply remained fail-closed until completed-course identity and the
  explicit no-exclusions answer were known. Alternative 2 was selected and
  applied; after reload the committed board still contained its distinguishing
  course `0509-4010` in year 3 semester B, proving selected-candidate persistence.
- No browser errors were observed. The only console output was the existing
  non-blocking Three.js `Clock` deprecation warning.
- Post-acceptance verification added 160 passing focused assertions: 47 native
  journey/agent/completion/server-Apply tests, 71 atomic Apply/proposal/manual
  edit/storage-failure tests, and 42 owner-key/context/proposal/board repository
  tests. Root and web TypeScript checks passed, as did the optimized Next build.
- Mobile Preview acceptance at 390x844 remained RTL, had no horizontal overflow,
  exposed 115 enabled focusable controls, and produced no browser errors. The
  temporary viewport override was reset after the check.
- Acceptance UX finding: the proposal details expose optional academic questions
  in English, while the separate Hebrew preference conversation can look like
  the place to answer them. The actual critical gate in this scenario was the
  explicit no-exclusions control. The next smallest product slice is to make the
  required academic clarification and its answer control visibly co-located and
  Hebrew, without weakening the fail-closed Apply gate.
## Latest session — publish the board-and-repository drop fix as Preview

The latest isolated Preview was rebuilt from `8f3f91b` and is READY. The
browser acceptance at an 885px viewport confirms that opening `מאגר קורסים`
keeps `לוח סמסטרים` mounted and visible beside it; the board owns a concrete
semester-table drop surface, while repository course cards expose the native
`draggable` contract and the visible keyboard fallback (`הוסף לסמסטר`). The
browser session reported zero errors. Focused UI verification passed 34 tests
across `NativePlannerBoard`, `UnifiedCourseRepository`, and
`UnifiedPlannerWorkspace`; root and web typechecks passed; and `web npm run
build` passed. Playwright's synthetic `dragTo` does not preserve the custom
browser MIME payload, so successful live mutation is not claimed from that
harness; the deterministic drop and server-authority tests remain the source
of truth. Production was not changed.

The release plan now records only the gates actually evidenced by this run:
the branch push, READY Preview metadata, and no-legacy-iframe planner load are
complete. Full Python/root-Jest release coverage, real browser MIME drag
mutation, mobile acceptance, provider smoke, and Production promotion remain
open rather than being inferred from unit tests or a synthetic drag harness.

## Latest session — tolerate plain-text-only dragover payloads

Added a focused regression for browsers that expose only the `text/plain`
fallback during `dragover`. RED reproduced the gap (`hasPlannerDragType` was
false); GREEN now treats that MIME type as an eligible visual drop protocol
while keeping `readPlannerDrag` as the fail-closed authority at `drop`, so
arbitrary text cannot invent a course or bypass server validation. Focused
payload and board tests pass (24 tests), the full web suite passes (29 suites,
260 tests), root and web typechecks pass, and the web production build passes.
Production remains unchanged.

## Latest session — remove empty repository add control

Cards without an authoritative destination no longer expose an interactive
`הוסף לסמסטר…` summary that cannot actually add anything. They remain
inspectable and show `אין סמסטר זמין` directly, while cards with known
destinations keep their drag and keyboard-add controls. RED reproduced the
misleading empty add control; GREEN passed the focused regression, all 29 web
suites (263 tests), root and web typechecks, and the web production build. The
isolated Preview deployment and browser verification are the next release
Preview `https://tau-course-planner-95x6utu06-matanyaron-1633s-projects.vercel.app`
was browser-verified with the repository open: the board remained a concrete
720px surface beside the 352px repository rail, 35 cards with known targets
were draggable, 21 cards without a known target showed no fake add control,
and there were zero unavailable cards with an add summary. Production remains
unchanged.

## Latest session — verify mobile workspace surfaces

The latest Preview was checked at 390×844. Board view kept the semester list
inside an internal horizontal scroller (`342px` client width over `1088px` of
semester content), while the document stayed at `375px` with no page-level
horizontal overflow. The repository and academic-assistant views both opened
without removing the mounted board; drawer and tab controls stayed within the
viewport. This completes only the mobile acceptance checkbox in the release
plan; live MIME drag mutation, full Python/root-Jest release coverage, provider
smoke, and Production promotion remain open.

## Latest session — verify repository search and drawer recovery

The latest Preview acceptance checked the desktop-width repository interaction:
searching `בקרה` reported `2 מתוך 56 קורסים` and exposed two draggable course
cards with authoritative semester add actions. Closing the repository set its
panel to `aria-hidden="true"`, restored focus to `פתח מאגר קורסים`, and left the
semester board and `semester-table` drop surface visible. This is an
interaction check only; real MIME drag mutation, the full keyboard acceptance,
provider smoke, and Production promotion remain open.

## Latest session — surface rejected manual drops beside the board

The live Preview drag path was verified to reach the authoritative
`/api/ai/edit-board` endpoint; a server rejection was returned for an illegal
course/semester placement. The rejection had previously rendered after the
long semester board, making a valid fail-closed response look like a broken
drag. The manual-edit error now renders as an assertive feedback banner before
the board, so the student immediately sees why the drop was refused while the
authoritative rules remain unchanged. RED reproduced the missing feedback
placement; GREEN passed the focused regression, all 29 web suites (261 tests),
root and web typechecks, and the web production build. The isolated Preview
`https://tau-course-planner-bhavesv9r-matanyaron-1633s-projects.vercel.app`
was then browser-verified with the repository open: the board kept a concrete
720px layout box, 56 repository cards remained draggable, a real MIME drop
reached the server and showed the rejection at the board top, and closing the
drawer restored the full-width board with `aria-hidden="true"` on the
repository panel. Production remains unchanged.

## Latest session — derive repository add targets from the board

The repository now receives its manual-add semester destinations from the
authoritative board payload rendered by `/planner`, instead of a component
hard-coding only years ג׳–ד׳. The fallback remains the existing four-semester
view for isolated component usage, while the real route passes every semester
id and its Hebrew label from the loaded board. RED reproduced the stale fixed
destination list; GREEN passed the focused workspace/page tests (16 tests),
root and web typechecks, and the web production build. This keeps drag and
keyboard add paths aligned with the actual board without weakening server
validation. A new isolated Preview deployment and browser verification remain
the next release step.

## Latest session — fail closed for courses without known destinations

Repository cards with no authoritative offered semester were previously
marked `draggable` even though every semester target correctly rejected the
empty destination list. Such a card now remains inspectable and explains
`אין סמסטר זמין`, but does not advertise a drag source or emit a misleading
payload. RED reproduced the contradictory draggable/no-target state; GREEN
passed the focused regression, all 29 web suites (263 tests), root and web
typechecks, and the web production build. This preserves the fail-closed rule
for incomplete academic facts while keeping valid repository cards draggable.
The isolated Preview
`https://tau-course-planner-qlvacuqih-matanyaron-1633s-projects.vercel.app`
was browser-verified with the repository open: the board remained a concrete
720px surface beside the 352px repository rail, 35 cards with known targets
were draggable, 21 cards without a known target were not draggable, and all
four board semester labels remained present. Production remains unchanged.

## Latest session — inspect Preview isolation before release

Read-only Vercel inspection confirms that the accepted deployment
`dpl_HrFieR6XzTwfDdVEeNzzwjrRJRd4` is `READY` with target `preview`. The
project exposes dedicated `SYLLO_PLANNER_*` storage variables only to Preview;
their secret values were intentionally not read or changed. Because the
remaining `DATABASE_URL` value is hidden and appears in both Preview and
Production scopes, database identity cannot be independently proven without
accessing a secret or remote database. Production promotion therefore remains
blocked until an approved isolation and rollback check is available. The
Python release suite also emitted early DB/fixture errors unrelated to this
UI slice, so no Production promotion was attempted.

## Latest session — make repository drag state explicit

Repository course cards now announce the active drag in an RTL live region,
mark the exact source card while it is being dragged, and clear that state on
release. This makes the existing typed repository-to-semester drop flow
discoverable and gives immediate feedback without changing authoritative server
validation or pretending an illegal placement succeeded. RED reproduced the
missing drag-state announcement; GREEN passed the focused repository suite.
The next release step is sequential regression verification followed by a new
isolated Preview deployment and browser check.

## Latest session — add a dedicated repository drag handle

Each draggable repository card now exposes a visible, dedicated `⠿ גרור
ללוח` handle with a tooltip. The handle writes the same typed payload as the
card surface, so drag initiation does not compete with the details or
semester-choice controls. RED reproduced the missing handle; GREEN passed the
focused repository suite. Preview deployment is still waiting on explicit
security approval to upload this repository snapshot to the existing Vercel
project.

## Latest session — make the repository drag handle the native source

The visible `⠿ גרור ללוח` affordance is now the single native HTML5 drag
source for an eligible repository course. The surrounding card remains an
inspectable, labelled course container without competing with its details and
semester-choice controls. RED reproduced the missing dedicated drag source;
GREEN passed the focused repository suite (7 tests), the board/workspace
regression (37 tests), web typecheck, and the production build. The typed
repository payload and authoritative server validation remain unchanged.
The next release step is a new isolated Preview deployment and browser check;
the current Preview still cannot show this commit until the Vercel snapshot
upload authorization gate is cleared.

## Latest session — keep drag affordance truthful

After moving native drag initiation to the dedicated handle, the course card
no longer carries a misleading grab cursor, drag role, or drag label. The
handle now carries the visible grab affordance and accessible course-specific
label, while the keyboard add menu remains the non-drag equivalent. RED
reproduced the card still advertising drag ownership; GREEN passed the focused
repository suite (7 tests), the board/workspace regression (37 tests), web
typecheck, and the production build. The approved full-snapshot Preview
deployment is now READY at
https://tau-course-planner-j9m8yiy3g-matanyaron-1633s-projects.vercel.app
(deployment `dpl_4mcSpxPA9CnbnTRSnfDgwvJLn1k5`). Browser verification confirmed
the persistent semester board, repository drawer open/close behavior, AI drawer
open/close behavior, and visible dedicated drag handles for eligible courses.

## Latest session — distinguish legal and illegal drop targets

Semester targets now expose three truthful drag states: green `ניתן לשחרר כאן`
for an accepted destination, red `לא ניתן לשחרר כאן` for a known invalid
destination, and a neutral checking state when the browser withholds drag data
until drop. The target border, feedback label, and motion now match the state;
drawer entry and repository drag-handle hover/press transitions are also
explicit and reduced-motion safe. RED reproduced the missing invalid state;
GREEN passed the focused board suite (17 tests), the repository/workspace
regression (38 tests), web typecheck, and the web production build. Production
remains unchanged; a new isolated Preview is the next release step.

# Unified Planner Production Recovery Design

**Status:** Approved for implementation
**Date:** 2026-08-26
**Canonical branch:** `ui/frontend-modernization`

## Objective

Replace the fragmented public planning experience with one canonical React/Next
planner that combines the complete manual planning workflow and the Academic
Decision Agent on one shared board. The purple animated product experience is
the public shell. The legacy HTML remains only as a temporary behavioral
reference and is removed after verified parity.

This is a recovery and consolidation epic. It precedes further Electrical
Engineering ingestion work. It does not add payments, authentication, new
academic objectives, new catalog facts, or a new degree model.

## Product contract

The planner has one authoritative committed board. A student may change that
board manually or ask the Agent for help:

- Manual planning supports repository search/filter, add, remove, drag, move,
  semester arrangement, course details, and immediate authoritative validation.
- Agent Generate reads the current committed board and its version.
- Agent output is always a separate draft. No Agent action mutates the committed
  board before explicit Apply.
- Alternative selection remains draft-local.
- Apply resolves the selected candidate from the authoritative server proposal,
  validates it against the current board and academic state, and then commits it.
- A manual edit after Generate stales the entire proposal and blocks its Apply.
- A later Agent request observes all accepted manual changes.
- The Agent explains the consequences of manual edits without presenting itself
  as the sole owner of the plan.

Future paid entitlement gates access to the Agent panel, not the manual planner
or the underlying board. Entitlement implementation is out of scope here. Until
then the Agent may be enabled for the private owner without adding fake payment
state.

## Canonical routes and public experience

- `/planner` is the canonical unified planner.
- `/plan` and `/ai-plan` redirect to `/planner` while preserving safe query
  parameters where needed.
- `/planner/native` and `/planner/native/agent-preview` cease to be competing
  product destinations. During migration they may redirect to or render the
  canonical implementation for test compatibility.
- `/planner/legacy` remains a non-promoted diagnostic reference until parity is
  complete, then is removed with the legacy HTML.
- Navigation and homepage calls to action point only to `/planner`.

Production promotion occurs only after the unified route passes complete manual
and Agent acceptance in a Vercel Preview deployment. The currently deployed
site remains available during development.

## Architecture

### Unified planner shell

`UnifiedPlannerPage` owns layout, responsive composition, RTL direction, the
purple animated background, and the relationship between:

- `PlannerBoard`: interactive semester board;
- `CourseRepository`: searchable/filterable course source;
- `AcademicAgentPanel`: conversation, clarification, alternatives, explanation,
  Rebuild and Apply;
- `PlannerStatus`: validation, stale, pending, conflict and success messages.

Desktop uses a board-first workspace with the repository and Agent available in
adjacent resizable or tabbed regions. Mobile uses a single-column order with
explicit view switching. No operation depends on animation.

### Shared domain state

One typed planner store contains:

- authoritative committed board and opaque board version;
- academic-progress digest and program identity;
- local manual interaction state;
- current Agent draft/proposal receipt and selected candidate;
- pending operation state;
- validation and conflict outcomes.

The store does not duplicate academic rules. UI projections consume existing
server/domain contracts. Candidate plans, requirement completion and hard
constraints remain authoritative outside presentation components.

### Manual command boundary

Manual interactions become typed commands such as `addCourse`, `removeCourse`
and `moveCourse`. Every command includes the current board version and is
validated through the shared board/academic validator. During the initial
migration, commands may update a local draft projection for responsive drag
feedback, but a committed board change is acknowledged only by the authoritative
board mutation boundary. Rejection restores the last server board and explains
the reason without losing the attempted action context.

The client never chooses a new board version and never bypasses mandatory,
prerequisite, duplicate-placement, completed-course, hard wanted/avoided or
offering constraints.

### Agent boundary

The existing Generate, proposal, alternatives, preference conversation and
Apply contracts are retained. Generate receives the current board snapshot or
server-resolvable board identity/version. Apply sends only proposal id,
candidate id, expected versions and idempotency identity; the browser does not
supply an authoritative plan.

Manual board mutation after Generate marks every displayed Agent alternative
stale. Stale alternatives may remain visible for comparison but cannot Apply.
Explicit Rebuild is required.

### Persistence and ownership

Production cannot rely on process memory or the local file adapter. Before
promotion, the implementation must either:

1. configure an existing production-compatible durable repository, or
2. present a separate explicit storage decision for approval.

No storage vendor is selected implicitly. Supabase, remote database mutation,
authentication and cross-device identity remain outside this design unless
separately approved. Anonymous/private-session ownership may be retained for the
private beta, but its refresh, process-restart, cookie-clear and cross-device
limits must be stated and tested honestly.

## Migration slices

### R0 — Git and product-surface inventory

- Classify tracked runtime, test, data, generated, historical and local-only
  files.
- Map every public and preview route to its actual implementation.
- Map legacy behaviors to existing React capabilities and identify parity gaps.
- Identify obsolete files only through reachability, tests and history.
- Do not delete `.agents`, `.codex`, stash content, catalog sources, or unfinished
  Electrical RED work.

### R1 — canonical store and read-only unified route

- Introduce the shared typed store around the existing native board pipeline.
- Render committed board, repository and Agent panel in the purple shell.
- Keep existing public routing unchanged until Preview acceptance.

### R2 — manual planning parity

- Port repository search/filter and course details.
- Port add/remove and semester placement.
- Port keyboard-accessible drag/move with a non-drag alternative.
- Use shared validation and completed-course state.
- Prove parity against an explicit legacy behavior matrix.

### R3 — human/Agent symbiosis

- Generate from the current committed board.
- Keep proposals as drafts.
- Stale proposals on every accepted manual mutation.
- Apply authoritative candidates to the same board.
- Feed the resulting board into the next Agent request.

### R4 — route consolidation and legacy retirement gate

- Point all planning entry routes to the unified implementation.
- Remove duplicate placeholder and preview-only product surfaces.
- Retain the legacy implementation only until every required behavior has an
  automated or browser acceptance proof.
- Delete legacy files in a separate reversible commit after parity.

### R5 — Preview and Production promotion

- Deploy an immutable Vercel Preview from a verified commit.
- Run desktop/mobile, RTL, keyboard, console and network acceptance.
- Verify provider usage controls and production storage configuration.
- Promote the exact verified commit to Production with rollback metadata.
- Run live-domain smoke tests without invoking paid providers unless explicitly
  authorized for one bounded acceptance request.

## Error and concurrency behavior

- Network or server failure never mutates the committed UI board optimistically.
- Version conflicts return the latest authoritative board and preserve an
  inspectable attempted change where safe.
- Duplicate Apply with the same idempotency key returns the same result.
- A stale proposal, academic digest or board version cannot commit.
- Failed manual validation identifies the actual hard rule and leaves the board
  unchanged.
- Unknown evidence or course identity fails closed and is displayed as
  unresolved rather than guessed.
- User-visible errors contain no stack traces, internal hashes or session ids.

## Accessibility and visual requirements

- Full RTL layout and understandable Hebrew labels.
- All repository, board and Agent actions are keyboard accessible.
- Visible focus and non-drag alternatives for moving courses.
- Stale, pending, conflict and success status is not color-only and uses an
  appropriate live region.
- Animations respect reduced-motion preferences and are not required to
  understand or operate the planner.
- Mobile supports repository, board and Agent access without horizontal loss of
  controls.
- Existing alternative cards are not broadly redesigned unless integration
  exposes a concrete usability defect.

## Verification and release gates

Each behavior change follows RED -> GREEN -> refactor and is committed as a
coherent slice. Required gates include:

- store/reducer and board-version tests;
- manual add/remove/move and validation tests;
- completed-course, prerequisite and hard-constraint regressions;
- Generate request composition from the current board;
- manual-edit staleness and stale-Apply rejection;
- authoritative Apply, concurrency and idempotency suites;
- alternative, preference and priority regressions;
- full API, web and legacy suites while legacy remains;
- root/web typecheck and production build;
- deterministic local browser acceptance;
- Vercel Preview acceptance on the exact candidate commit;
- post-promotion live smoke and rollback readiness.

Production is not promoted when any of the following remains true:

- required manual parity is missing;
- Agent and manual UI use different committed boards;
- full Agent behavior remains hidden behind a preview-only route;
- authoritative Apply cannot survive the selected Production runtime contract;
- Electrical is presented as supported before authoritative data is complete;
- tests, build, browser acceptance or console/network audit fail.

## Git consolidation rules

"Make order" means establishing ownership and removing proven duplication, not
rewriting history or deleting files by age.

- `ui/frontend-modernization` remains the development source until a separate
  approved branch-reconciliation step.
- `main` is not modified or merged as part of implementation slices.
- Existing user work and `stash@{0}` are protected by recorded identities.
- Generated runtime data remains ignored and outside tracked catalog paths.
- Every deletion names its replacement and has regression coverage.
- Historical branches are audited for unique commits; relevant work is ported
  or documented before branch cleanup is proposed.
- Production deployment references the exact Git commit that passed Preview.

## Explicitly deferred work

- Electrical Engineering program completion resumes after unified-planner
  recovery reaches the agreed milestone.
- Payments and Agent entitlement enforcement.
- Authentication, user accounts and cross-device persistence.
- New storage vendor selection.
- Broad visual redesign beyond the unified purple experience.
- New objectives, timetable/exam planning, additional degrees or universities.

## Completion definition

The epic is complete when the live `/planner` page presents the new purple React
experience; a user can manually build and edit a valid plan from the repository;
the Agent reads that same plan, proposes only drafts, applies an explicitly
approved authoritative candidate, observes later manual changes, and explains
their consequences; refresh behavior matches the approved persistence model;
all former public planning routes converge on this experience; and the legacy
HTML is no longer required for any accepted behavior.

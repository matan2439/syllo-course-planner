# R2 — Authoritative Manual Course Add

## Outcome

The repository's “add” action commits one catalog-backed course to the same
session-owned board used by Agent Generate and Apply. React never supplies an
authoritative plan and never mutates the committed board before server success.

## Contract

Add `POST /api/ai/edit-board` with a typed `add_course` operation:

- request: `program_id`, `expected_board_version`, `operation_id`, `course_id`,
  `semester_id`, and the current academic-status digest/version;
- caller ownership comes only from the existing anonymous session cookie;
- response success returns the complete authoritative board and its repository-
  minted version; failure returns a stable reason code and current version;
- no client-supplied semester array, candidate plan, owner id, hard-constraint
  result or new version is accepted.

## Task 1 — RED handler contract

Add wire schemas and endpoint tests proving the route is currently absent, then
requiring method gating, session ownership, catalog-backed course identity,
known semester identity, expected-version CAS and operation idempotency.

## Task 2 — Pure authoritative edit decision

Create a pure `prepareManualBoardEdit` service. It loads the owner's committed
board (or the canonical initial board view), resolves the course and semester
from the frozen program model, rejects unknown/duplicate/completed entries,
builds the proposed full board, and runs the existing authoritative legality
validator. Return typed failures; do not weaken the validator or infer missing
catalog facts.

Required invariants:

- completed, avoided or prerequisite-invalid additions fail closed;
- annual courses are added atomically according to authoritative spans;
- hard workload and semester availability remain absolute;
- equivalent input/catalog ordering yields the same board;
- successful output contains only canonical ids.

## Task 3 — Repository commit semantics

Extend the board repository with a generic mutation receipt while preserving
existing Agent Apply replay behavior. Compare-and-swap must allow only one
winner for a base version. Identical owner + operation id + payload replays the
same result; reusing the operation id for different work fails deterministically.
Both in-memory and local file adapters must share the same pure decision logic.

## Task 4 — Endpoint and route

Implement the handler using the existing session-owner and apply runtime
boundaries. Map failures to concise Hebrew messages without stack traces. Add
the local development route without changing public routing or Production.

## Task 5 — Unified workspace integration

Wire the repository intent to the typed client. On click, let the student choose
only an authoritative eligible semester, send one edit request, show pending
state, and replace the board only with the server response. On success stale
the entire Agent proposal and announce the change. On rejection preserve both
the committed board and inspectable Agent draft.

## Verification gate

Run focused RED→GREEN endpoint/repository/validator/workspace tests, all Apply
authority and stale-proposal regressions, full API and web suites, root and web
typecheck, production build, then local browser acceptance for valid add,
duplicate, completed, invalid prerequisite, stale version, replay, refresh,
session isolation, proposal staleness, RTL, keyboard, mobile, console and
network. Do not promote Production in R2.


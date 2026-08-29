# Durable Planner Storage Design

**Date:** 2026-08-29
**Status:** Approved direction; implementation requires a separate reviewed plan
**Scope:** Durable anonymous-session state for the unified planner on Vercel Preview

## Purpose

The unified planner currently has correct server-authoritative interfaces for committed boards, academic context, proposals, Apply ownership, compare-and-swap versions, and idempotency. Its Production runtime is not durable: Vercel executes the API routes as separate functions, while `AcademicContextStore` and `ProposalStore` use process memory. A planning-context request can therefore succeed in one function and be absent from the next edit-board or Apply request.

This design makes those existing authority boundaries durable through one relational Postgres store provisioned as Neon through the Vercel Marketplace. It does not add authentication, change academic rules, redesign the UI, deploy Production, or make the Electrical Engineering dataset authoritative.

## Decision

Use one Vercel Marketplace Neon Postgres integration and the repository's existing `DATABASE_URL`/`postgres` client pattern. Do not split planner state between Postgres and Redis. Do not use Supabase, Blob, Edge Config, a Vercel function filesystem, or global process memory as Production persistence.

Postgres fits the existing state model because Apply needs a transaction that combines ownership checks, proposal validity, idempotency lookup, board-version compare-and-swap, board mutation, and an immutable receipt. The current `BoardRepository`, `ProposalStore`, and `AcademicContextStore` remain the domain interfaces; Postgres adapters implement them without moving SQL into handlers.

## Ownership and retention

The existing server-issued `syllo_owner` cookie remains the ownership key:

- opaque 256-bit random value;
- `HttpOnly`, `SameSite=Lax`, `Secure` outside local development, `Path=/`;
- no academic data in the cookie;
- no client-selected owner identifier;
- a cleared or expired cookie creates a new isolated anonymous owner;
- another browser or device cannot access the original owner's records;
- this is anonymous browser ownership, not authentication or cross-device identity.

The database stores a one-way SHA-256 digest of the cookie owner id, not the raw bearer value. Runtime requests hash the resolved cookie before repository access. This reduces the value of a database disclosure while preserving deterministic ownership lookup. Raw session tokens must never be logged.

Boards are retained until an explicit future retention policy exists. Academic contexts are replaced per owner and program. Proposals expire after the existing two-hour TTL and may be deleted by opportunistic bounded cleanup; expiry is enforced during reads even if cleanup has not run. Apply receipts retain the existing bounded replay history semantics.

## Data model

All JSON payload columns hold server-produced normalized domain records. Clients never write them directly.

### `planner_boards`

- `owner_hash` text
- `program_id` text
- `version_number` bigint, starting at 1 and increasing by exactly one
- `semesters_json` jsonb
- `updated_at` timestamptz
- last-Apply metadata for lean board responses
- primary key `(owner_hash, program_id)`

The public version remains `bv_<n>`. The database stores `n`; only the repository formats or parses the public version.

### `planner_apply_receipts`

- `owner_hash` text
- `program_id` text
- `idempotency_key` text
- `proposal_id` text
- `candidate_id` text
- `produced_version_number` bigint
- authoritative committed-board response needed for a stable retry
- `applied_at` timestamptz
- unique key `(owner_hash, program_id, idempotency_key)`

An identical retry returns the original result. Reusing a key for a different proposal or candidate returns `IDEMPOTENCY_CONFLICT`.

### `planner_academic_contexts`

- `owner_hash` text
- `program_id` text
- `digest` text
- `personal_status_json` jsonb
- `plan_context_json` jsonb
- `preferences_json` jsonb
- `updated_at` timestamptz
- primary key `(owner_hash, program_id)`

The digest is an expected-value guard. Academic facts are resolved from this authoritative record, not reconstructed from a digest supplied by the browser.

### `planner_proposals`

- `proposal_id` text primary key
- `owner_hash` text
- `program_id` text
- creation/expiry timestamps
- nullable `superseded_by`
- base-board version, profile version, academic-status digest
- constraint fingerprint and evidence snapshot id
- recommended candidate id, outcome, and apply eligibility
- index on `(owner_hash, program_id, created_at)`

### `planner_proposal_candidates`

- `proposal_id` text
- `candidate_id` text
- complete normalized plan JSON
- normalized identity
- validity/applyability/recommended flags
- primary key `(proposal_id, candidate_id)`

Apply accepts only `proposalId`, `candidateId`, expected versions/digests, and an idempotency key. It resolves the complete plan from this table and never trusts a client-supplied plan.

## Transaction semantics

### Academic-context write

Upsert one record by `(owner_hash, program_id)`. The handler returns only the lean digest/version response already required by the client.

### Proposal creation and supersession

One transaction:

1. lock the current unsuperseded proposal set for the owner and program;
2. insert the proposal and all validated candidates;
3. mark every older unsuperseded proposal for that owner/program as superseded by the new proposal;
4. commit and return the existing lean receipt.

Different owners or programs never supersede each other. Partial proposal/candidate records cannot become visible.

### Apply

One database transaction:

1. derive `owner_hash` from the server-owned cookie;
2. load and lock the proposal, selected candidate, current board, and matching idempotency receipt;
3. fail closed for missing/cross-session, expired, superseded, invalid, non-applyable, stale profile/academic status/fingerprint/base-board, or candidate-membership mismatch;
4. return the stored result if an identical idempotency receipt exists;
5. reject incompatible idempotency reuse;
6. compare the current board version with the expected base version;
7. re-run the required authoritative validation against stored proposal/context facts;
8. insert or update the board with `version_number + 1`;
9. insert the Apply receipt;
10. commit and return the authoritative board.

The board row lock and unique idempotency constraint guarantee that two conflicting Applies from one base version cannot both commit. No committed React state changes before this transaction succeeds.

## Runtime adapter selection

`apply_runtime.ts` gains an explicit `postgres` storage kind selected only when the required database configuration is present. Expected behavior:

- deterministic in-memory adapters remain for unit and API tests;
- the ignored file adapter remains for local Preview where explicitly selected;
- Postgres is mandatory for deployed authoritative planner mutation routes;
- deployed routes fail closed with a typed storage-unavailable response if Postgres is absent or migrations are not current;
- `productionStorageConfigured()` reports true only when configuration and schema compatibility have both been verified, not merely when `DATABASE_URL` exists.

Handlers keep using repository interfaces. They must not select adapters independently or fall back from Postgres to process memory after a database error.

## Migrations and compatibility

Add explicit, reviewed SQL migrations under a dedicated planner migration directory. Migrations are additive and idempotently tracked in a schema-version table. Application startup/request handling may check schema compatibility but must not run destructive or broad migrations implicitly.

The first deployment target is an isolated Preview database/environment. No Production database, environment variable, alias, or deployment is modified during implementation. Production provisioning and migration require a later explicit promotion decision after Preview acceptance and rollback evidence.

The existing catalog/database readers are not silently migrated. Shared `DATABASE_URL` use must be audited before environment wiring; if planner state and existing catalog/quota tables cannot safely share one database, the planner adapter uses a distinct named planner connection variable supplied by the Marketplace integration. The implementation plan must settle this from the actual generated integration variables rather than guessing.

## Error handling

Repository failures map to stable, non-sensitive reason codes. At minimum:

- `PLANNER_STORAGE_UNAVAILABLE`
- `PLANNER_SCHEMA_MISMATCH`
- existing proposal ownership/expiry/supersession codes
- existing fingerprint/profile/academic-status/base-board mismatch codes
- `BOARD_VERSION_CONFLICT`
- `IDEMPOTENCY_CONFLICT`

The UI preserves the committed board and inspectable draft on failure, announces the issue in Hebrew, and never exposes SQL, connection details, owner hashes, stack traces, or raw stored records.

## Verification strategy

Implementation follows RED-to-GREEN slices:

1. repository contract tests run unchanged against in-memory and Postgres adapters;
2. academic-context persistence is proven across fresh adapter/process instances;
3. proposal plus candidate persistence and deterministic supersession are proven transactionally;
4. Apply validates ownership, membership, versions, fingerprint, expiry, supersession, and stored candidate identity;
5. duplicate Apply returns one result; incompatible duplicate fails; concurrent conflicting Apply commits exactly once;
6. same anonymous session survives refresh and a new function/process; another session remains isolated;
7. planning-context followed by edit-board works across distinct deployed Preview functions;
8. Generate, manual edits, proposal staleness, Rebuild, non-default Apply, refresh, and subsequent Agent use operate on one authoritative board;
9. network/server failures never mutate committed client state;
10. flag-off and all existing planner, hard-constraint, priority, completed-course, Apply, API, web, typecheck, and build suites remain green.

Browser acceptance runs only against non-Production Preview first. It records proposal id, board versions, requests, cookies (presence/attributes only), console findings, refresh persistence, session isolation, stale rejection, and exactly-once behavior. No paid or LLM provider is invoked.

## Rollout and rollback

1. Provision Neon through Vercel Marketplace for Preview only after the implementation plan is approved.
2. Pull generated Preview environment names without printing secret values.
3. Apply migrations to the isolated Preview database.
4. deploy an immutable Preview from a clean verified commit;
5. run full automated and browser acceptance;
6. retain the legacy route and current Production deployment as rollback references;
7. stop and report if data ownership, migration, or reliability evidence fails.

Production promotion is a separate explicitly approved operation. It requires a configured Production database, reviewed migrations, retention/privacy decision, rollback metadata, and live smoke checks. Passing this epic does not add authentication or cross-device persistence and does not by itself make the product Production-ready.

## Out of scope

- authentication, accounts, OAuth, payments, and cross-device identity;
- Supabase or any unapproved additional vendor;
- Electrical Engineering rule/data completion;
- new preferences, ranking objectives, timetable behavior, or broad UI redesign;
- catalog regeneration or mutation;
- Production environment changes, database changes, aliases, deployment, or deletion of the legacy fallback.

## Acceptance outcome

The design is complete when a Preview proves that separate Vercel functions share authoritative academic context, proposals, candidates, boards, versions, and idempotency records; valid Apply commits a stored candidate once; refresh returns that board; stale, fabricated, mismatched, or cross-session operations fail closed; and Production remains unchanged pending a separate promotion decision.

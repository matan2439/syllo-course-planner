# Durable Planner Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified planner's anonymous academic context, proposals, candidates, committed board, versions, and Apply receipts durable and authoritative across separate Vercel functions.

**Architecture:** Keep the existing domain interfaces and deterministic in-memory/file adapters, add one Postgres-backed planner-state adapter, and route deployed mutation handlers to it explicitly. A dedicated transactional Apply operation locks proposal/candidate/board state, rechecks all stored guards, performs compare-and-swap, and records idempotency in one transaction.

**Tech Stack:** TypeScript, Jest, `postgres` 3.4.x, SQL migrations, Vercel Functions, Vercel Marketplace Neon Postgres, Next.js web acceptance.

**Spec:** `docs/superpowers/specs/2026-08-29-durable-planner-storage-design.md`

## Global Constraints

- Provision storage through Vercel Marketplace; do not use Supabase or hand-wire a different vendor.
- Preview is the first and only deployed target in this plan; Production, aliases, domains, and Production environment variables remain unchanged.
- Preserve the server-issued `syllo_owner` cookie; store only a SHA-256 owner digest in Postgres and never log either value.
- The browser never supplies an authoritative candidate plan or a new board version.
- Deployed authoritative routes must fail closed; they may not fall back from Postgres to process memory or the Vercel filesystem.
- In-memory adapters remain deterministic test adapters; the file adapter remains an explicitly selected local Preview adapter.
- Preserve feature-default-off behavior, all academic hard constraints, proposal staleness, explicit Rebuild, and server-authoritative Apply.
- Do not invoke paid or LLM providers, regenerate catalog data, stage unrelated Electrical RED work, modify `main`, or modify `stash@{0}`.

---

## File Map

- Create `api/ai/owner_key.ts`: one-way owner hashing for durable keys.
- Create `api/ai/postgres/planner_schema.ts`: migration version and SQL migration runner/checker.
- Create `api/ai/postgres/postgres_academic_context_store.ts`: durable `AcademicContextStore`.
- Create `api/ai/postgres/postgres_proposal_store.ts`: durable transactional proposal/candidate storage and supersession.
- Create `api/ai/authoritative_apply_store.ts`: adapter-independent atomic Apply input/result contract.
- Create `api/ai/postgres/postgres_authoritative_apply_store.ts`: one-transaction Apply implementation.
- Create `api/ai/postgres/postgres_board_repository.ts`: durable board loads and manual-edit CAS commits.
- Create `api/ai/postgres/postgres_planner_state.ts`: one lazy Postgres client and cohesive adapter bundle.
- Create `scripts/migrations/planner/001_planner_state.sql`: additive planner schema.
- Create `scripts/migrate_planner_state.ts`: explicit schema migration command.
- Modify `api/ai/apply_runtime.ts`: explicit memory/file/postgres selection and schema truthfulness.
- Modify `api/ai/apply-plan.ts`: use atomic stored-candidate Apply when supported.
- Modify `api/ai/edit-board.ts`, `api/ai/planning-context.ts`, and `api/ai/generate-plan.ts` only where async storage/configuration errors need typed fail-closed mapping.
- Modify `package.json`: add the explicit migration script; retain the existing `postgres` dependency.
- Add focused tests under `tests/api/` and update `AUTONOMOUS_PROGRESS.md` only after verified Preview acceptance.

### Task 1: Owner key and explicit storage configuration

**Files:**
- Create: `api/ai/owner_key.ts`
- Modify: `api/ai/apply_runtime.ts`
- Test: `tests/api/owner_key.test.ts`
- Test: `tests/api/apply_runtime_storage_selection.test.ts`

**Interfaces:**
- Produces: `ownerStorageKey(ownerId: string): string`
- Produces: `StorageKind = 'memory' | 'file' | 'postgres'`
- Produces: `plannerDatabaseConfigured(env?: NodeJS.ProcessEnv): boolean`

- [ ] **Step 1: Write RED owner-key tests**

```ts
expect(ownerStorageKey('A'.repeat(43))).toMatch(/^owner_[a-f0-9]{64}$/);
expect(ownerStorageKey('A'.repeat(43))).toBe(ownerStorageKey('A'.repeat(43)));
expect(ownerStorageKey('A'.repeat(43))).not.toBe(ownerStorageKey('B'.repeat(43)));
expect(ownerStorageKey('A'.repeat(43))).not.toContain('AAAA');
```

- [ ] **Step 2: Write RED runtime-selection tests**

```ts
expect(storageKindFor({ SYLLO_PLANNER_DATABASE_URL: 'postgres://preview' })).toBe('postgres');
expect(storageKindFor({ SYLLO_BOARD_STATE_DIR: 'runtime/boards' })).toBe('file');
expect(storageKindFor({})).toBe('memory');
expect(() => storageKindFor({ VERCEL: '1' })).toThrow('PLANNER_STORAGE_UNAVAILABLE');
```

- [ ] **Step 3: Run RED**

Run: `npx jest tests/api/owner_key.test.ts tests/api/apply_runtime_storage_selection.test.ts --runInBand`
Expected: FAIL because the owner-key and selection functions do not exist.

- [ ] **Step 4: Implement minimal deterministic hashing and pure selection**

```ts
export function ownerStorageKey(ownerId: string): string {
  return `owner_${createHash('sha256').update(ownerId, 'utf8').digest('hex')}`;
}

export function storageKindFor(env: NodeJS.ProcessEnv): StorageKind {
  if ((env.SYLLO_PLANNER_DATABASE_URL ?? '').trim()) return 'postgres';
  if ((env.SYLLO_BOARD_STATE_DIR ?? '').trim()) return 'file';
  if (env.VERCEL === '1') throw new PlannerStorageError('PLANNER_STORAGE_UNAVAILABLE');
  return 'memory';
}
```

- [ ] **Step 5: Run GREEN and typecheck**

Run: `npx jest tests/api/owner_key.test.ts tests/api/apply_runtime_storage_selection.test.ts --runInBand`
Run: `npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- api/ai/owner_key.ts api/ai/apply_runtime.ts tests/api/owner_key.test.ts tests/api/apply_runtime_storage_selection.test.ts
git commit -m "feat(storage): select durable planner runtime"
```

### Task 2: Additive schema and explicit migration runner

**Files:**
- Create: `scripts/migrations/planner/001_planner_state.sql`
- Create: `api/ai/postgres/planner_schema.ts`
- Create: `scripts/migrate_planner_state.ts`
- Modify: `package.json`
- Test: `tests/api/planner_schema.test.ts`

**Interfaces:**
- Produces: `PLANNER_SCHEMA_VERSION = 1`
- Produces: `checkPlannerSchema(sql: Sql): Promise<'current' | 'missing' | 'mismatch'>`
- Produces: `migratePlannerSchema(sql: Sql): Promise<void>`

- [ ] **Step 1: Write RED schema-contract tests**

```ts
expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_boards');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_apply_receipts');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_academic_contexts');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_proposals');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS planner_proposal_candidates');
expect(migration).toContain('PRIMARY KEY (owner_hash, program_id)');
expect(migration).not.toMatch(/DROP\s+TABLE|TRUNCATE|data\//i);
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/planner_schema.test.ts --runInBand`
Expected: FAIL because the migration and checker do not exist.

- [ ] **Step 3: Add schema with exact constraints**

The SQL must include a one-row `planner_schema_versions` table, board primary key, unique Apply idempotency key, proposal foreign-key cascade to candidates, proposal owner/program/current indexes, JSONB payloads, and timestamp defaults. No destructive statement is allowed.

- [ ] **Step 4: Add explicit runner**

```ts
const url = process.env.SYLLO_PLANNER_DATABASE_URL?.trim();
if (!url) throw new Error('SYLLO_PLANNER_DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try { await migratePlannerSchema(sql); } finally { await sql.end(); }
```

- [ ] **Step 5: Run GREEN and typecheck**

Run: `npx jest tests/api/planner_schema.test.ts --runInBand`
Run: `npx tsc --noEmit`
Expected: all pass and no tracked data file changes.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/migrations/planner/001_planner_state.sql api/ai/postgres/planner_schema.ts scripts/migrate_planner_state.ts package.json tests/api/planner_schema.test.ts
git commit -m "feat(storage): define planner Postgres schema"
```

### Task 3: Durable academic-context adapter

**Files:**
- Create: `api/ai/postgres/postgres_academic_context_store.ts`
- Test: `tests/api/postgres_academic_context_store.test.ts`

**Interfaces:**
- Consumes: `AcademicContextStore`, `ownerStorageKey`
- Produces: `PostgresAcademicContextStore implements AcademicContextStore`

- [ ] **Step 1: Write RED contract tests with a deterministic SQL test double**

Cover upsert/load, owner isolation, program isolation, replacement, JSON clone behavior, and absence of raw owner ids in bound query values.

```ts
await first.put(input);
expect(await second.load(input.ownerId, input.programId)).toEqual(
  expect.objectContaining({ digest: input.digest, personalStatus: input.personalStatus }),
);
expect(boundValues).not.toContain(input.ownerId);
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/postgres_academic_context_store.test.ts --runInBand`
Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement parameterized upsert/load**

Map database `owner_hash` back to the caller's in-memory `ownerId` only in the returned domain object. Parse timestamps into milliseconds and clone JSON values before returning.

- [ ] **Step 4: Run GREEN plus existing context suites**

Run: `npx jest tests/api/postgres_academic_context_store.test.ts tests/api/academic_context_store.test.ts tests/api/planning_context_endpoint.test.ts --runInBand`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -- api/ai/postgres/postgres_academic_context_store.ts tests/api/postgres_academic_context_store.test.ts
git commit -m "feat(storage): persist academic planner context"
```

### Task 4: Durable proposal and candidate authority

**Files:**
- Create: `api/ai/postgres/postgres_proposal_store.ts`
- Test: `tests/api/postgres_proposal_store.test.ts`

**Interfaces:**
- Consumes: `ProposalStore`, `ProposalRecord`, `ownerStorageKey`
- Produces: `PostgresProposalStore implements ProposalStore`

- [ ] **Step 1: Write RED proposal tests**

Prove exact candidate round-trip, owner/program isolation, transactional insertion, same-owner/program supersession, no cross-program supersession, expiry retention, and rollback when candidate insertion fails.

```ts
await store.put(first);
await store.put(second);
expect((await store.get(first.proposalId))?.supersededBy).toBe(second.proposalId);
expect((await store.get(second.proposalId))?.candidates).toEqual(second.candidates);
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/postgres_proposal_store.test.ts --runInBand`
Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement one-transaction supersession and candidate insert**

Use `sql.begin(async tx => ...)`; insert the new proposal, insert all candidates, then update older unsuperseded proposals matching the owner hash and program. `get()` joins or separately reads candidates in stable `candidate_id` order.

- [ ] **Step 4: Run GREEN plus existing proposal authority**

Run: `npx jest tests/api/postgres_proposal_store.test.ts tests/api/proposal_authority.test.ts --runInBand`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -- api/ai/postgres/postgres_proposal_store.ts tests/api/postgres_proposal_store.test.ts
git commit -m "feat(storage): persist authoritative proposals"
```

### Task 5: Durable board repository and manual-edit CAS

**Files:**
- Create: `api/ai/postgres/postgres_board_repository.ts`
- Test: `tests/api/postgres_board_repository.test.ts`

**Interfaces:**
- Consumes: `BoardRepository`, `CommitInput`, `CommitResult`, `ownerStorageKey`
- Produces: `PostgresBoardRepository implements BoardRepository`

- [ ] **Step 1: Write RED adapter-parity tests**

Run the existing board repository contract against the Postgres adapter and add fresh-instance persistence, owner isolation, version monotonicity, identical idempotency replay, incompatible idempotency rejection, and two-concurrent-writer coverage.

```ts
const [left, right] = await Promise.all([
  repo.commit({ ...base, candidateId: 'left', idempotencyKey: 'left-key' }),
  repo.commit({ ...base, candidateId: 'right', idempotencyKey: 'right-key' }),
]);
expect([left, right].filter((x) => x.ok)).toHaveLength(1);
expect((await freshRepo.load(owner, program))?.version).toBe('bv_1');
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/postgres_board_repository.test.ts --runInBand`
Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement row-locked CAS and receipt persistence**

Use one transaction, select the board `FOR UPDATE`, query idempotency first, compare expected version, normalize semesters with existing domain helpers, and insert/update board plus receipt. Never mint a version from client input.

- [ ] **Step 4: Run GREEN plus manual-board suites**

Run: `npx jest tests/api/postgres_board_repository.test.ts tests/api/board_repository.test.ts tests/api/manual_board_edit_endpoint.test.ts --runInBand`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -- api/ai/postgres/postgres_board_repository.ts tests/api/postgres_board_repository.test.ts
git commit -m "feat(storage): persist versioned planner boards"
```

### Task 6: Atomic stored-candidate Apply

**Files:**
- Create: `api/ai/authoritative_apply_store.ts`
- Create: `api/ai/postgres/postgres_authoritative_apply_store.ts`
- Modify: `api/ai/apply-plan.ts`
- Test: `tests/api/postgres_authoritative_apply.test.ts`
- Test: `tests/api/apply_plan_endpoint.test.ts`

**Interfaces:**
- Produces: `AuthoritativeApplyInput` containing owner, proposal/candidate ids, expected board/profile/academic values, idempotency key, and an authoritative validation callback.
- Produces: `AuthoritativeApplyResult` using existing public reason codes and authoritative board shape.
- Produces: `AuthoritativeApplyStore.apply(input): Promise<AuthoritativeApplyResult>`

- [ ] **Step 1: Write RED attacks and race tests**

Cover valid Apply, fabricated candidate, candidate from another proposal, cross-session access, expired/superseded proposal, invalid candidate, profile/academic/fingerprint/base-board mismatch, identity mismatch, identical retry, incompatible retry, and two conflicting candidates racing from one base.

```ts
expect(await apply({ ...valid, candidateId: 'fabricated' })).toMatchObject({
  ok: false,
  reason: 'CANDIDATE_NOT_IN_PROPOSAL',
});
expect((await Promise.all([apply(left), apply(right)])).filter((x) => x.ok)).toHaveLength(1);
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/postgres_authoritative_apply.test.ts --runInBand`
Expected: FAIL because no atomic Postgres Apply store exists.

- [ ] **Step 3: Implement one locked transaction**

Load proposal/candidate/board/receipt inside `sql.begin`, lock mutable rows, run all stored guard checks, invoke the existing authoritative validator on the stored plan, then write board and receipt. Return the stored committed response on an identical retry. Map cross-session records to the existing non-sensitive rejection behavior.

- [ ] **Step 4: Route handler through the atomic store**

When runtime kind is Postgres, `apply-plan.ts` calls `AuthoritativeApplyStore.apply`. Memory/file tests retain current deterministic behavior through an adapter-independent in-process implementation or the existing handler path with identical reason codes.

- [ ] **Step 5: Run GREEN and endpoint regressions**

Run: `npx jest tests/api/postgres_authoritative_apply.test.ts tests/api/apply_plan_endpoint.test.ts tests/api/completed_elective_integration.test.ts --runInBand`
Expected: all pass; a request body containing a plan remains rejected/ignored as non-authoritative.

- [ ] **Step 6: Commit**

```powershell
git add -- api/ai/authoritative_apply_store.ts api/ai/postgres/postgres_authoritative_apply_store.ts api/ai/apply-plan.ts tests/api/postgres_authoritative_apply.test.ts tests/api/apply_plan_endpoint.test.ts
git commit -m "feat(apply): commit stored candidates atomically"
```

### Task 7: Cohesive Postgres runtime and fail-closed handlers

**Files:**
- Create: `api/ai/postgres/postgres_planner_state.ts`
- Modify: `api/ai/apply_runtime.ts`
- Modify: `api/ai/planning-context.ts`
- Modify: `api/ai/edit-board.ts`
- Modify: `api/ai/generate-plan.ts`
- Test: `tests/api/postgres_apply_runtime.test.ts`
- Test: `tests/api/planner_storage_failure_contract.test.ts`

**Interfaces:**
- Produces: `getPostgresPlannerState(): PlannerStateAdapters`
- Produces: `ensurePlannerSchemaCurrent(): Promise<void>`
- Produces typed `PLANNER_STORAGE_UNAVAILABLE` and `PLANNER_SCHEMA_MISMATCH` mapping.

- [ ] **Step 1: Write RED fresh-function and failure tests**

```ts
await runtimeA.academicContext.put(context);
expect(await runtimeB.academicContext.load(owner, program)).toEqual(
  expect.objectContaining({ digest: context.digest }),
);
expect(storageFailureResponse.body.code).toBe('PLANNER_STORAGE_UNAVAILABLE');
expect(consoleOutput).not.toContain(databaseUrl);
```

- [ ] **Step 2: Run RED**

Run: `npx jest tests/api/postgres_apply_runtime.test.ts tests/api/planner_storage_failure_contract.test.ts --runInBand`
Expected: FAIL because runtime has no cohesive Postgres bundle.

- [ ] **Step 3: Implement lazy client and adapter bundle**

Create the client only inside `getPostgresPlannerState()`, never at module import/build time. All three stores and atomic Apply share the same client/configuration. Cache schema compatibility per warm process, but fail every request closed if the check fails.

- [ ] **Step 4: Add typed handler mapping**

Catch only known storage configuration/schema errors at the API boundary and return stable 503 responses. Unexpected errors retain sanitized logging. Do not retry through memory.

- [ ] **Step 5: Run GREEN and touched handler suites**

Run: `npx jest tests/api/postgres_apply_runtime.test.ts tests/api/planner_storage_failure_contract.test.ts tests/api/planning_context_endpoint.test.ts tests/api/manual_board_edit_endpoint.test.ts tests/api/proposal_authority.test.ts tests/api/apply_plan_endpoint.test.ts --runInBand`
Run: `npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- api/ai/postgres/postgres_planner_state.ts api/ai/apply_runtime.ts api/ai/planning-context.ts api/ai/edit-board.ts api/ai/generate-plan.ts tests/api/postgres_apply_runtime.test.ts tests/api/planner_storage_failure_contract.test.ts
git commit -m "feat(storage): activate durable planner state"
```

### Task 8: Provision isolated Preview storage and verify real SQL

**Files:**
- Modify only if generated names require it: `api/ai/postgres/postgres_planner_state.ts`
- No secrets or generated runtime data are committed.

**Interfaces:**
- Consumes: Vercel Marketplace Neon integration and Preview-only environment configuration.
- Produces: migrated isolated Preview schema with no Production resource changes.

- [ ] **Step 1: Re-run Marketplace guide and install Neon for the linked project**

Run: `vercel integration guide neon --framework nextjs`
Run: `vercel integration add neon --yes --no-claim`
Expected: integration provisioned or a browser/account claim step. If a claim step appears, stop only for that required user action.

- [ ] **Step 2: Inspect environment names without values**

Run: `vercel integration env ls`
Expected: database variable names only; do not print secrets.

- [ ] **Step 3: Pull Preview environment to an ignored temporary file**

Run: `vercel env pull .env.preview.local --environment=preview --yes`
Expected: ignored local file; verify `git status --short` does not expose or track it.

- [ ] **Step 4: Run migration against Preview Neon**

Run: `npx tsx scripts/migrate_planner_state.ts` with `SYLLO_PLANNER_DATABASE_URL` loaded from the generated Preview variable.
Expected: schema version 1, no destructive statements, no Production connection.

- [ ] **Step 5: Run real-Postgres contract suites sequentially**

Run: `npx jest tests/api/postgres_academic_context_store.test.ts --runInBand`
Run: `npx jest tests/api/postgres_proposal_store.test.ts --runInBand`
Run: `npx jest tests/api/postgres_board_repository.test.ts --runInBand`
Run: `npx jest tests/api/postgres_authoritative_apply.test.ts --runInBand`
Expected: all pass against isolated Preview Neon; cleanup removes only test-owned rows.

### Task 9: Full verification, immutable Preview, and browser acceptance

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`
- Test existing web journey files only if acceptance reveals a reproducible regression.

**Interfaces:**
- Produces: evidence that distinct Vercel functions share durable authoritative state.

- [ ] **Step 1: Run focused and full suites sequentially**

Run focused storage, session, proposal, Apply, concurrency, manual-edit, native journey, alternatives, composition, priority, completed-course, hard-constraint, and stale-response suites.
Run: `npx jest --testPathPattern=tests/api --runInBand`
Run: `npx jest --config jest.ui.config.js --runInBand`
Run: `npm --prefix web test -- --runInBand`
Run: `npx tsc --noEmit`
Run: `npm --prefix web exec tsc -- --noEmit`
Run: `npm --prefix web run build`
Expected: all applicable suites green, with honest reporting of any pre-existing baseline.

- [ ] **Step 2: Verify protected state**

Run: `git status --short`
Run: `git diff -- data`
Run: `git rev-parse main`
Run: `git rev-parse 'stash@{0}'`
Expected: no generated catalog/data change; protected identities unchanged; unrelated Electrical RED remains unstaged.

- [ ] **Step 3: Commit verified implementation slices and push branch**

Run: `git push origin ui/frontend-modernization`
Expected: local HEAD equals remote branch; `main` unchanged.

- [ ] **Step 4: Deploy immutable non-Production Preview**

Build from a clean archive of the verified commit and deploy with `target:null`. Record commit SHA, deployment id, URL, database environment, and rollback reference. Do not promote aliases or Production.

- [ ] **Step 5: Run browser acceptance**

Prove: session cookie established; board loaded server-side; Generate returns proposal id; selecting an alternative sends no mutation; Apply body names proposal/candidate and contains no authoritative plan; selected non-default candidate commits; refresh preserves it; identical retry is idempotent; fabricated/stale/cross-session requests fail; concurrent stale-base Apply cannot overwrite; network failure leaves committed board unchanged; manual edit stales proposals; subsequent Rebuild uses the updated board; RTL, keyboard, mobile, live regions, console, and network are clean; no external AI provider is invoked.

- [ ] **Step 6: Update ledger and commit evidence**

Record exact verification counts, Preview identifiers, persistence semantics, Production-not-configured status, authentication/cross-device absence, remaining Production migration/configuration decision, and next ordered product slice.

```powershell
git add -- AUTONOMOUS_PROGRESS.md
git commit -m "docs(planner): verify durable Preview persistence"
git push origin ui/frontend-modernization
```

## Final completion gate

Completion requires all of the following: server-authoritative Apply uses only stored candidates; fabricated/stale/mismatched/cross-session operations fail; Apply is atomic and idempotent; academic context and proposals survive separate functions; the board survives refresh and process restart in Preview; sessions remain isolated; Preview browser acceptance passes; protected Git/data state is unchanged; and Production remains unmodified and explicitly not ready until its own Neon environment, migrations, retention/privacy decision, and promotion verification are approved.

# Unified Planner Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the audited, typed and browser-reachable React foundation for the one-board manual-plus-Agent planner without changing the current Production route.

**Architecture:** Preserve existing academic and Agent contracts, introduce one pure planner workspace state machine, and compose the existing native board, repository and flagged Agent journey inside one purple ProductShell Preview surface. This first plan covers R0 and R1 only; manual mutation, server persistence, route promotion and legacy deletion remain separately gated follow-up plans.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Jest/Testing Library, existing shared planner contracts and Vercel Preview routing.

**Spec:** `docs/superpowers/specs/2026-08-26-unified-planner-production-recovery-design.md`

## Global Constraints

- Work only on `ui/frontend-modernization`; do not modify or merge `main`.
- Do not touch Production, deployments, Vercel configuration, Supabase, remote databases, catalog source data, `.agents`, `.codex`, or `stash@{0}` in R0/R1.
- Preserve the unfinished Electrical RED changes in `tests/test_tau_curriculum_document.py`; never stage them in unified-planner commits.
- The current public `/planner` remains unchanged until full manual and Agent parity passes Preview acceptance.
- The browser never treats a client-supplied plan as authoritative.
- Agent output is a draft until explicit Apply; a board edit makes every proposal stale.
- No paid or LLM provider may be invoked by tests or browser fixtures.
- Follow RED -> GREEN -> refactor and verify each coherent commit.

---

### Task 1: R0 product-surface and Git ownership inventory

**Files:**
- Create: `docs/architecture/planner-surface-inventory.md`
- Modify: `AUTONOMOUS_PROGRESS.md`
- Test: read-only Git, route and import searches described below

**Interfaces:**
- Consumes: current route tree, `ProductShell`, legacy HTML, native journey, API endpoints, Vercel deployment audit recorded in the approved spec.
- Produces: a parity matrix and exact deletion/promotion gates consumed by Tasks 2-5 and later R2-R5 plans.

- [ ] **Step 1: Record protected identities and current dirty paths**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse origin/ui/frontend-modernization
git rev-parse main
git stash list --format="%gd`t%H`t%gs" | Select-Object -First 1
git status --short
```

Expected: branch `ui/frontend-modernization`; only the known Electrical test and local `.agents/.codex/.tmp` paths are unrelated dirty state.

- [ ] **Step 2: Trace every planner route and runtime owner**

Run:

```powershell
rg -n "LegacyPlannerFrame|NativePlannerJourney|RepositoryExplorer|redirect\(|notFound\(" web/app web/lib
rg -n "semester_board_viewer|postMessage|drag|drop|moveCourse|removeCourse|addCourse" app/web tests/ui web
rg -n "generate-plan|apply-plan|BoardRepository|ProposalStore|session" api shared web tests/api
```

Expected: enough evidence to name the owner of public routing, manual interactions, Generate, Apply, board loading, persistence and session ownership.

- [ ] **Step 3: Write the inventory and parity matrix**

The document must list each capability as `legacy owner`, `React owner`, `server owner`, `test evidence`, and `migration disposition`. Include search/filter, details, add, remove, drag/move, validation, completed courses, conversation, alternatives, priority, Apply, refresh persistence, RTL, keyboard and mobile. Every proposed deletion names its replacement; unknown ownership is marked unresolved.

- [ ] **Step 4: Verify inventory claims against paths**

Run each command embedded in the inventory and confirm every referenced path exists with `Test-Path`. Run:

```powershell
rg -n "unresolved|no replacement|Production blocker" docs/architecture/planner-surface-inventory.md
git diff --check -- docs/architecture/planner-surface-inventory.md AUTONOMOUS_PROGRESS.md
```

Expected: unresolved items are explicit and no whitespace errors exist.

- [ ] **Step 5: Commit only the audit slice**

```powershell
git add docs/architecture/planner-surface-inventory.md AUTONOMOUS_PROGRESS.md
git commit -m "docs: inventory unified planner migration surface"
```

### Task 2: Pure unified planner workspace state

**Files:**
- Create: `web/lib/planner/workspace-state.ts`
- Create: `web/lib/planner/workspace-state.test.ts`

**Interfaces:**
- Consumes: opaque `boardVersion`, `academicStatusDigest`, proposal id and candidate ids from existing API contracts.
- Produces: `PlannerWorkspaceState`, `PlannerWorkspaceEvent`, `createPlannerWorkspaceState()` and `reducePlannerWorkspace()`.

The state contract is:

```ts
export type PlannerWorkspaceState = {
  boardVersion: string
  academicStatusDigest: string | null
  proposal: null | {
    proposalId: string
    baseBoardVersion: string
    selectedCandidateId: string
    candidateIds: readonly string[]
    staleReason: null | 'manual_board_change' | 'academic_status_change' | 'preferences_change'
  }
  manualRevision: number
}
```

Events are `proposal_received`, `alternative_selected`, `manual_board_committed`, `academic_status_changed`, `preferences_changed`, `proposal_cleared`, and `agent_apply_committed`. Selection must reject candidate ids outside the current proposal. Manual commit advances board version and revision and stales, rather than clears, the proposal. Agent Apply replaces the board version and clears the proposal.

- [ ] **Step 1: Write RED reducer tests**

Tests must prove: proposal receipt; candidate membership enforcement; selection does not change board; manual commit stales the full proposal; stale selection cannot restore validity; academic/preference edits use truthful reasons; Apply clears once; event order is deterministic; unknown proposal events leave state unchanged.

- [ ] **Step 2: Run RED**

```powershell
npm test -- --runInBand lib/planner/workspace-state.test.ts
```

Working directory: `web`. Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure reducer**

Use exhaustive discriminated unions and return frozen-value-compatible plain objects. Do not fetch, mutate React state, infer versions, or import UI components.

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
npm test -- --runInBand lib/planner/workspace-state.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```powershell
git add web/lib/planner/workspace-state.ts web/lib/planner/workspace-state.test.ts
git commit -m "feat(planner): add canonical workspace state machine"
```

### Task 3: Read-only repository projection for the unified workspace

**Files:**
- Create: `web/app/components/UnifiedCourseRepository.tsx`
- Create: `web/app/components/UnifiedCourseRepository.test.tsx`
- Create: `web/app/components/RepositoryExplorer.test.tsx`
- Modify: `web/app/components/RepositoryExplorer.tsx`

**Interfaces:**
- Consumes: existing `RepositoryVM`, `buildCourseDetails`, fuzzy Hebrew search and `selectedCourseIds`.
- Produces: `UnifiedCourseRepository({ repo, selectedCourseIds, onRequestAdd, onRequestDetails })` with read-only add intents. It does not mutate a board in R1.

- [ ] **Step 1: Write RED component tests**

Prove real Hebrew name/id/category search, selected-course status, keyboard-accessible details, an explicit “הוסף ללוח” intent, and no direct mutation or Generate request. Assert understandable empty-state and RTL-compatible controls.

- [ ] **Step 2: Run RED**

```powershell
npm test -- --runInBand app/components/UnifiedCourseRepository.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Extract shared repository presentation and implement the intent boundary**

Reuse existing search ranking and details construction. Keep `RepositoryExplorer` behavior unchanged by adapting it to the extracted pure pieces. The R1 add callback records intent only; its UI copy must say the manual mutation arrives in the next verified slice.

- [ ] **Step 4: Run focused and repository regressions**

```powershell
npm test -- --runInBand app/components/UnifiedCourseRepository.test.tsx app/components/RepositoryExplorer.test.tsx
npm run typecheck
```

Expected: focused and existing repository tests pass.

- [ ] **Step 5: Commit**

```powershell
git add web/app/components/UnifiedCourseRepository.tsx web/app/components/UnifiedCourseRepository.test.tsx web/app/components/RepositoryExplorer.tsx
git commit -m "feat(planner): expose repository intents in unified workspace"
```

### Task 4: Purple unified Preview shell

**Files:**
- Create: `web/app/components/UnifiedPlannerWorkspace.tsx`
- Create: `web/app/components/UnifiedPlannerWorkspace.test.tsx`
- Modify: `web/app/planner/native/agent-preview/page.tsx`
- Modify: `web/app/components/ProductShell.tsx`
- Test: `web/app/planner/native/agent-preview/page.test.tsx` if route behavior is not already covered

**Interfaces:**
- Consumes: `NativePlannerJourney`, `UnifiedCourseRepository`, current program id and existing Preview flag.
- Produces: one browser surface containing board/Agent and repository regions under the animated ProductShell. R1 does not change public `/planner`.

- [ ] **Step 1: Write RED integration tests**

Prove exactly one planner heading, one Agent journey, one repository region, desktop and mobile region navigation, purple non-lightweight background, RTL, keyboard focus, and no iframe. Prove the route still returns 404 when `ENABLE_ACADEMIC_AGENT_PREVIEW` is absent and enables the full Agent when set.

- [ ] **Step 2: Run RED**

```powershell
npm test -- --runInBand app/components/UnifiedPlannerWorkspace.test.tsx app/planner/native/agent-preview/page.test.tsx
```

Expected: FAIL because the unified component and route composition are absent.

- [ ] **Step 3: Implement the smallest composed shell**

Render accessible tabs/regions for `לוח ועוזר` and `מאגר קורסים`, with both mounted from one component boundary. Pass `useAcademicDecisionAgent={true}` only from the protected Preview route. Set `preferLightweightBackground={false}`. Do not duplicate Agent state or introduce manual mutation yet.

- [ ] **Step 4: Run GREEN, all web tests, typecheck and build**

```powershell
npm test -- --runInBand app/components/UnifiedPlannerWorkspace.test.tsx app/planner/native/agent-preview/page.test.tsx
npm test -- --runInBand
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add web/app/components/UnifiedPlannerWorkspace.tsx web/app/components/UnifiedPlannerWorkspace.test.tsx web/app/planner/native/agent-preview/page.tsx web/app/components/ProductShell.tsx web/app/planner/native/agent-preview/page.test.tsx
git commit -m "feat(planner): compose unified purple preview workspace"
```

### Task 5: R1 deterministic browser acceptance and continuation ledger

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`
- Modify: `docs/architecture/planner-surface-inventory.md`
- Create only if existing infrastructure requires it: a deterministic browser fixture test under `web/app/components/UnifiedPlannerWorkspace.browser.test.tsx`

**Interfaces:**
- Consumes: verified R0 inventory and R1 Preview route.
- Produces: evidence that the foundation is browser-reachable and an exact R2 manual-mutation next step.

- [ ] **Step 1: Verify ports 3001 and 3002 are free, then start exactly one API and one web Preview process**

Record PIDs, fixture, profile version, board version and snapshot. Use only deterministic local providers and `ENABLE_ACADEMIC_AGENT_PREVIEW=1`.

- [ ] **Step 2: Run browser acceptance**

Verify purple animated shell, no iframe, current board visible, Agent panel visible, repository search/details visible, keyboard switching, RTL, reduced motion, mobile layout, no duplicate Agent, and clean console/network except documented fixture calls. Do not call a paid provider.

- [ ] **Step 3: Stop both processes and verify ports are free**

Remove only ignored runtime data created by this acceptance run when its exact path is known.

- [ ] **Step 4: Run final R1 verification sequentially**

```powershell
npm test -- --runInBand
npm run typecheck
Push-Location web
npm test -- --runInBand
npm run typecheck
npm run build
Pop-Location
```

Also run the focused legacy embed and Agent API/Apply suites named in the inventory. Report exact counts and any pre-existing baseline honestly.

- [ ] **Step 5: Update the ledger and commit**

Record that public routing and Production remain unchanged, list all R1 evidence, and define R2 as server-validated manual add/remove/move on the same workspace state.

```powershell
git add AUTONOMOUS_PROGRESS.md docs/architecture/planner-surface-inventory.md
git commit -m "docs: verify unified planner foundation"
```

- [ ] **Step 6: Push verified R0/R1 commits only**

Before pushing, verify `main`, `stash@{0}`, catalog diff and staged paths. Then:

```powershell
git push origin ui/frontend-modernization
```

Expected: remote branch reaches the verified R1 commit; Production remains unchanged.

## Next plans after R1

Write and execute separate reviewed plans in this order:

1. R2 authoritative manual board mutation and React drag/move parity.
2. R3 shared-board human/Agent symbiosis and proposal staleness.
3. R4 route consolidation and legacy retirement.
4. R5 durable Production storage decision, Vercel Preview acceptance and exact-commit promotion.
5. Resume the preserved Electrical Engineering authoritative-data epic.

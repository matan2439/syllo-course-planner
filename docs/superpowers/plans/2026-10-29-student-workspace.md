# Student Workspace Implementation Plan

> **For agentic workers:** Implement the independent feature domains with superpowers:dispatching-parallel-agents, then integrate and review the whole change. Steps use checkbox syntax for tracking. The user explicitly authorized implementation on 29 October 2026; continue without another design approval.

**Goal:** Add personal saved alternatives, advanced course discovery, Hebrew/English controls, bidding allocation/results and consented historical contributions to the existing planner.

**Architecture:** Keep the existing board, proposal, auth and billing boundaries. Add one owner-scoped workspace document store with optimistic concurrency, a saved-plan restore operation that validates against current server context, and an isolated bidding observations store with aggregate-only history. React components extend the current workspace rather than replacing its layout or planner.

**Tech Stack:** Existing Next.js/React/TypeScript/Zod/Postgres.js, existing Supabase Auth; no new provider or runtime dependency.

**Spec:** docs/superpowers/specs/2026-10-29-student-planning-product-design.md, plus user's explicit request to collect users' bidding allocations over time and preserve the proven base.

## Global Constraints

- Existing manual edits and AI Apply remain authoritative and retain all current validation.
- Saved plans include semester placements and weekly group selections; completed-course facts stay shared.
- No automatic submissions to the university. Bidding preparation/exports are user reviewed.
- Community sharing is opt-in, signed-in, withdrawable and never exposes individual bids or identities; learning uses completed historical outcomes and minimum distinct-owner samples.
- Preserve existing dirty work. Feature branch: codex/student-planning-workspace, already in linked worktree.
- Hebrew/English must have meaningful content and direction changes; retain original course names when no official translation exists.
- New server tables use RLS, no browser role grants, account deletion cascade, parameterized queries and configured database isolation.
- Database extensions are additive. Missing new migration fails the new features clearly without changing the existing planner schema gate.

## Review Focus

1. Switching accounts/programs cannot expose or upload another owner's cached plans or weekly selections.
2. Restoring old placements cannot bypass prerequisites, mandatory bundles, ownership or board concurrency.
3. Missing grades/assessment stay unknown, and filter values agree with card/details data.
4. Sharing can be withdrawn; repeated reports from one owner do not inflate samples, and unfinished/live choices are not published as history.
5. Budget allocation and transfers never invent points, loop or silently alter saved registration results.

## Task 1: Advanced discovery (independent)

Files: web/lib/repository.ts; web/features/courses/components/UnifiedCourseRepository.tsx; new repository filter helpers/tests and catalog summary loader if needed; route adapters that supply enriched repository.

Interfaces: extend RepoCourseVM with optional, normalized assessment and grade summaries; keep existing consumers compatible. Preserve filterRepository(repo, query) or extend with optional filters. New filters support category, semester, assessment, grade range (range + accessible numeric fields), unknowns, sorting and favorites. Consume `useLocale()` from `web/features/locale/LocaleProvider.tsx` with `locale`, `dir`, `t(he,en)`.

- [x] Write tests for combined filters, unknown metrics, source/sample context and stable existing search; run RED.
- [x] Implement normalized catalog summary, meaningful UI controls and persisted favorites without loading every course detail separately.
- [x] Run focused web tests and typecheck. Record results and changed files.

## Task 2: Language settings (independent)

Files: new web/features/locale/LocaleProvider.tsx and LanguageSwitcher.tsx, web/app/layout.tsx, profile/shell/core planner surfaces with scoped translations, tests.

Interfaces: `useLocale(): { locale:'he'|'en'; dir:'rtl'|'ltr'; setLocale(locale):void; t(he:string,en:string):string }`, safe default Hebrew without provider for existing tests. Locale provider nests inside AuthProvider. Preferences transport: GET `/api/ai/student-workspace?scope=preferences` → `{ok:true,revision:number,data:{locale:'he'|'en'}}`; POST same endpoint `{scope:'preferences',expected_revision:number,data:{locale}}` → same shape. Failures must not falsely claim account sync. Local cache gives immediate direction; guard account-switch races.

- [x] Test stored choice, direction, switching and account-scoped hydration; run RED.
- [x] Implement profile and guest switcher; translate core shell, profile, planner headings/actions and expose t for new features. Original data titles remain original.
- [x] Run locale and affected component tests/typecheck.

## Task 3: Bidding domain and panel (independent)

Files: shared/planner/bidding.ts, new web/features/bidding components/helpers/tests.

Interfaces: export `biddingDraftSchema`, `BiddingDraft`, `BiddingHistory` (aggregate summaries only), default draft factory and deterministic validation/allocation/simulation helpers. `BiddingPanel` consumes `{programId,courseOptions:Array<{id:string,name:string}>,draft:BiddingDraft,onChange:(draft)=>void,loadHistory:(draft)=>Promise<BiddingHistory>,onShare:(draft,share:boolean)=>Promise<void>}`. All copy uses useLocale.

Required draft fields: academicYear (start-year), semester (1|2), round, budget, minimumBid, transferMode ('automatic'|'manual'), entries. Entry fields: id, label, kind ('course'|'bundle'), courseId (optional for bundle), group, points, priority, transferTo (nullable/optional), outcome ('pending'|'accepted'|'rejected'|'other_group'|'canceled'), rejectionReason (optional). Other fields can be chosen by implementer and documented.

- [x] Tests: nonnegative integer budget, min/zero alternatives, invalid transfer edges/cycles, no double counting, deterministic allocation within budget, historical data insufficiency, source/result statuses; run RED.
- [x] Implement editable draft, course/group/bundle entries, allocation suggestions, outcome updates, explicit what-if simulation, copy export, history display, opt-in sharing/withdraw controls. A proposal never silently overwrites user results or claimed university registration.
- [x] Historic recommendations require sufficient distinct users/outcomes; no numerical success probability. Show manual/priority heuristic when history is missing.
- [x] Run focused tests and hand parent exact types/UI signatures.

## Task 4: Durable personal workspace and history (root)

Files: shared/planner/student-workspace.ts; api/ai/student-workspace.ts; api/ai/student_workspace_store.ts; additive SQL migration and runner; tests/api/student_workspace*.test.ts; dev/Vercel route wiring.

Interfaces: preferences scope above; program scope GET with `program_id` returns `{ok:true,revision,data:{plans:SavedPlan[],bidding:BiddingDraft}}`. POST `{scope:'program',program_id,expected_revision,data}` uses compare-and-swap; conflict returns 409 and current revision, never overwrite. SavedPlan: id,name,notes,semesters,weeklySchedule,catalogVersion,createdAt,updatedAt. Auth owner is resolved server-side. Read anonymous cookie before auth resolution and adopt its new feature documents only into absent account scopes. Crowd contribution request validates draft, requires explicit consent and verified account, replaces the owner's report for that course/group/round, supports withdrawal.

- [x] Write owner isolation, revision conflict, malformed payload, unauthenticated sharing, withdraw/dedupe/history threshold tests; run RED.
- [x] Implement memory adapter for explicit local dev and Postgres adapter selected via existing isolated env resolution; production fails clearly if unavailable.
- [x] SQL tested in PGlite with mock auth.users and deny policies; account FK cascade; server handles owner hash and never emits raw contributor records.
- [x] Add restore action: server loads saved plan by id, validates exact semesters against current academic context via existing model/validator and mandatory/status checks, commits with board CAS/idempotency. Never trust submitted restore placements.

## Task 5: Integrate saved plans and bidding into existing workspace (root)

Files: saved-plans panel/client/hooks; UnifiedPlannerWorkspace; NativePlannerJourney minimal callback; WeeklyScheduleDrawer minimal controlled state/callback; schedule persistence boundary.

- [x] Test independent snapshots, comparison, restore failure leaves board/schedule unchanged, locale/owner/program transitions; run RED.
- [x] Add compact expandable controls for saved plans and bidding alongside the existing tabs, including create/rename/duplicate/delete, notes and comparison of course differences/load. Capture current committed board and weekly group selections. Weekly data is owner-scoped and stale selections excluded from export.
- [x] Restore the board through the new validated server action, remount/reload existing journey, then restore matching weekly selections. Keep context/completed facts shared.
- [x] Preserve current design tokens, manual/agent behavior, mobile and keyboard use.

## Task 6: Integration verification and handoff

- [x] Focused suites then root/web typechecks and web build; broader tests for concrete planner/auth/storage risk.
- [x] Browser exercise saving two alternatives, combined filters, language switching, bidding edit/export/results and manual planner parity using real local endpoints.
- [x] Fresh review of own files (existing dirty work is out of scope); fix actionable issues and rerun affected gates.
- [x] Record exact tests, migration/deployment requirements and limitations. Do not call data sparse recommendations trained prediction.

## Progress

- Plan created; existing local changes retained on feature branch. Independent implementation may proceed within the user's explicit authorization.
- Implemented Tasks 1–5. Existing manual/AI validators retained; no new dependency or Paddle changes.
- Fresh web full suite: 75 suites / 514 tests passed. Root/web TypeScript checks passed; production build and final API run recorded in release handoff when finished.
- Focused storage/endpoint regressions passed, plus three real-model restore tests covering prerequisites, completed/current courses, mandatory requirements and annual atomicity. PostgreSQL tests use PGlite, including RLS denial and account-delete cascade.
- Review fixes: atomic anonymous adoption, fixed historical cutoff, program-wide withdrawal, scoped weekly restore state, full restore identity, conflict recovery and latest academic-context synchronization before restore.
- Browser: two named alternatives saved through real local handlers and read after refresh; combined four-field filter returned one matching course from 144; locale changed document lang/dir and core controls. Invalid manual placement remained rejected by the existing validator.
- No external database mutation, commit, push or deployment. The additive migration and deploy prerequisites are in docs/student-workspace-release.md.
- Final verification: production build and root/web typechecks passed; combined API coverage 232 passing suites / 2,818 tests (one skipped), web 75 suites / 514 tests plus 48 affected integration tests. Bidding budget persistence was confirmed after a full browser reload against the local API.

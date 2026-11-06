# Student workspace — implementation handoff

Date: 2026-10-29. Branch: `codex/student-planning-workspace`.

## Follow-up: interaction repair and live release

The student requested and authorized publishing all changes to syllo.cc. The additive student workspace migration was applied to production through the connected Supabase integration; RLS and revoked browser access were verified. Deployment inputs exclude local documents, screenshots and test caches.

Replaced the plan library with numbered slots, inline names and active-slot autosave; explicit switches retain server legality checks and pause autosave until both board and weekly state match. Initial hydration preserves the authoritative committed board. Repaired unknown-offering drags, manual edits during AI previews, single-destination double confirmations, stale academic context and retry identity. Failed committed-board reads now fail visibly rather than silently replacing a saved board with catalog defaults. Course filters use collapsible ecommerce-style facets, counts and removable applied filters.

Verification: local production build and TypeScript checks passed. Initial full web run: 71 suites passed and six had failures; all six were subsequently corrected and passed in focused reruns. Final focused planner verification: 99 tests; saved-plan verification: 12 tests; repository verification: 23 tests. Workspace API: 19 tests; manual-edit API: 21 tests; runtime/storage selection: 10 tests. Browser checks verified named-slot persistence after reload, explicit switching, filter controls, and preservation of board DOM/course counts at widths 390/768/1280/1440.

Live smoke checks discovered invalid existing Vercel database credentials (Postgres 28P01), affecting both old and new planner storage. A pre-existing local connection to the same production database passed a read-only check. Only the production DATABASE_URL secret was updated from that verified connection, without password rotation or secret export. Planner database clients also now reuse existing TLS/PgBouncer connection options.

After that correction, the live board and workspace reads returned HTTP 200; a fresh isolated browser saved a named slot and read it after reload, with stable board DOM across phone/desktop resizing. A real repository drag (Thermodynamics 2 into year 3 semester B) returned HTTP 200. Auth initialization was additionally moved after mount so server HTML and initial browser HTML share one pending state, avoiding React hydration replacement before account restoration.

Final authentication/owner/workspace verification: 5 suites / 59 tests passed, including an actual SSR-to-hydration regression with zero recoverable errors, plus a fresh web TypeScript check.

Final release deployment: `dpl_EQDpVkTqLmVxdzXUfRxT9ar1ap1V` (`syllo-course-planner-kh9d4krj2-matanyaron-1633s-projects.vercel.app`), built READY and promoted to syllo.cc on 2026-10-29. The original handoff below describes the earlier implementation stage; its "not deployed" statements are superseded by this follow-up.

Final production smoke after promotion: named-plan edit persisted through full reload; workspace endpoint returned 200; fresh isolated browser recorded zero hydration errors and zero other uncaught page errors. Vercel alias lookup confirmed syllo.cc points to the final deployment above.

## Added

- Named alternatives with independent semester placements, weekly groups, notes and bidding drafts; duplicate, compare, update and delete. Restore reuses current server legality checks and existing board CAS/idempotency.
- Category/semester/assessment/grade-range discovery, sorting, scoped device favorites and course comparison. Batch grade snapshots carry source/sample context rather than per-card requests.
- Account/device language setting and core Hebrew/English planner, timetable and profile controls, RTL/LTR.
- Course/group/packet bidding budget, priorities, transfer what-if, explicit allocation proposals, results/final scores and manual-entry export.
- Opt-in account-linked reports, withdrawable for the entire program. Only historical aggregates with >=5 distinct contributors are returned; accepted score quantiles also require >=5 accepted contributors. Draft/live-year data cannot be exposed as historical by selecting a future target year. Self-reports are evidence, not verified official auction statistics.

## Deployment prerequisites

Apply `scripts/migrations/planner/002_student_workspace.sql` after existing Auth/planner migrations, first to the isolated Preview database. This is additive and does not advance the old planner schema version. RLS and revoked browser grants keep both new tables behind authenticated server ownership checks; account foreign keys cascade on deletion.

Use `npm run migrate:student-workspace` with the isolated Supabase `DATABASE_URL`. The workspace tables reference `auth.users` in that database. The `SYLLO_PLANNER_DATABASE_URL` override serves planner boards and proposals. Production additionally requires `-- --production` and `VERCEL_ENV=production`. The runner does not load or print secrets.

The endpoint is wired into `vercel.json` and the local dev API. Deploy the root project (including the handler and board data) with the frontend. Verify Preview save/reload, a second signed-in device, account switch, restore, sharing and withdrawal before production promotion. Missing tables disable new persistence clearly; the existing planner storage schema gate is unchanged.

The Vercel CLI is absent; `npm i -g vercel` enables normal env/deploy/log workflows. No external database migration, production publication, Paddle account change or live transaction was performed in this implementation session.

## Verification

Final results: Next.js production build passed; root/web TypeScript checks passed; all 75 web suites / 514 tests passed, followed by 48 affected integration tests after the final restore-context wiring. API full run: 230 suites passed, one real-database suite skipped, and two existing filesystem suites blocked by sandbox atomic-renaming permissions. Both blocked suites were rerun outside the sandbox and all their 50 tests passed (combined API coverage: 232 passing suites, 2,818 passing tests, one skipped test).

Focused domain and API tests include private ownership, CAS, anonymous adoption, account deletion, contribution deduplication/withdrawal, historical suppression, restore prerequisites/completion/mandatory/annual gates, combined filters, language races and independent snapshots. Full final command results are recorded in the implementation plan's Progress section.

Browser verification uses the real local API on port 3012 and Next.js on port 3011, with database/auth disabled in that local process. The local API's memory adapter is for development; deploy with the migrated Postgres database for durable account storage.

Final browser recheck confirmed that an edited bidding budget survives a full page reload through the local API. This verifies refresh persistence within the development server session; durable account and cross-device persistence still require the migrated database and authenticated Preview checks above.

## Current boundaries

Favorites are device scoped. Official course names and source documents retain their original language; generated assistant prose follows the existing agent behavior. There is no official registration submission or live seat feed. History-based allocation is a deterministic budgeting heuristic and falls back to priorities when history is insufficient. Broad catalog expansion, calendar/exam ingestion, document-result import and a calibrated predictive optimizer remain later roadmap work.

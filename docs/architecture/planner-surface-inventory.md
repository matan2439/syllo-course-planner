# Planner Surface and Migration Inventory

**Audited branch:** `ui/frontend-modernization`
**Audit baseline:** `50f117ffa0a79b06aca57930a65c938c6a99765e`
**Purpose:** R0 ownership and parity gate for the unified React planner

## Runtime map

| Surface | Current owner | Current behavior | Migration disposition |
|---|---|---|---|
| `/planner` | `web/app/planner/page.tsx` -> `LegacyPlannerFrame.tsx` -> `app/web/semester_board_viewer.html` | Public route embeds the legacy planner in an iframe | Keep public route unchanged through R1-R3; replace only after Preview parity |
| `/planner/legacy` | `web/app/planner/legacy/route.ts` | Raw diagnostic legacy document | Retain as reference until R4 deletion gate |
| `/planner/native` | `web/app/planner/native/page.tsx` | Native board and Generate journey, Agent flag off | Fold into unified component; stop treating it as a separate product |
| `/planner/native/agent-preview` | `web/app/planner/native/agent-preview/page.tsx` | Full Agent only when `ENABLE_ACADEMIC_AGENT_PREVIEW=1` | R1 host for the unified Preview workspace |
| `/ai-plan` | `web/app/ai-plan/page.tsx` | Redirects to `/planner` at HEAD | Preserve redirect; verify safe query propagation in R4 |
| `/plan` | `web/app/plan/page.tsx` | Separate planning hub/read-only summary | Redirect to unified planner in R4 |
| `/board` | `web/app/board/page.tsx` | Read-only native board | Reuse projections, then redirect or retain as read-only report by explicit R4 decision |
| `/repository` | `web/app/repository/page.tsx` -> `RepositoryExplorer.tsx` | Search, categories and details; no board mutation | Reuse inside unified workspace; later redirect standalone route in R4 |

## Capability parity matrix

| Capability | Legacy owner | React owner | Server/domain owner | Current test evidence | Migration disposition |
|---|---|---|---|---|---|
| Semester display | `renderBoard()` and semester zones in `semester_board_viewer.html` | `NativePlannerBoard.tsx`, `SemesterColumn.tsx` | `shared/planner/model.ts`, `web/lib/planner/board-vm.ts` | `NativePlannerBoard.test.tsx`, board VM tests | React projection exists; make it interactive in R2 |
| Repository categories/search | repository/sidebar code in legacy HTML | `RepositoryExplorer.tsx`, `RepositoryCourseCard.tsx` | `web/lib/repository.ts`, fuzzy matcher in `shared/search` | repository adapter and search tests | Compose into unified R1 surface |
| Course details | legacy modal | `CourseDetailsPanel.tsx` | `web/lib/course-details.ts` | `course_details_adapter.test.ts` | Reuse unchanged in R1 |
| Add course | legacy repository action and local board mutation | no committed-board React action | no dedicated manual mutation endpoint | legacy UI tests only | **No replacement:** R2 needs typed server-validated command |
| Remove course | `removeCourseFromBoard()` at legacy HTML line ~13135 | no React action | validator can assess resulting plans but no manual endpoint | legacy UI tests only | **No replacement:** R2 |
| Drag/move | document drag handlers and `moveCourse()` at legacy HTML lines ~10421-10517 and ~12908 | read-only React columns | offering/legality validators exist | `planner_shell_actions.test.js` plus legality suites | **No replacement:** R2 needs pointer + keyboard movement and server validation |
| Non-drag move alternative | legacy course action menu | none in native board | same future manual command boundary | legacy interaction tests | **No replacement:** mandatory R2 accessibility gate |
| Immediate legality feedback | local legacy helpers plus server Generate validation | proposal errors only | `planner_validate.ts`, legality gates, program requirements | hard-constraint/prerequisite/offering suites | Reuse authoritative rules; do not port local guesses |
| Completed-course input | legacy completed-state controls | `CompletedCoursesPanel.tsx` | academic status/progress and completed-elective modules | native completion and completed-elective suites | React owner exists; keep one typed source |
| Agent conversation | legacy AI panel and handler wiring | `NativePlannerJourney.tsx`, `PreferenceConversation.tsx` | `generate-plan.ts`, preference/clarification state machines | native journey and conversation suites | React is canonical future owner |
| Multiple alternatives | limited legacy proposal view | `PlanAlternatives.tsx` | `candidate_set.ts`, `plan_alternatives.ts` | alternatives contract and component tests | React owner complete |
| Impact-driven priority | absent/incomplete in legacy | `PreferenceConversation.tsx` | priority-impact and objective composition modules | priority handler/journey suites | React owner complete |
| Generate | legacy fetch path and native API client | `NativePlannerJourney.tsx` | `POST /api/ai/generate-plan` | full Generate and native journey suites | Retain contract; current board must become authoritative input in R3 |
| Draft staleness | legacy local invalidation and native typed reasons | `NativePlannerJourney.tsx` | proposal fingerprints/versions | stale response/status/priority tests | Extend to every accepted manual commit in R3 |
| Apply | legacy/client history plus native server call | flagged native journey uses `shared/planner/api-client.ts` | `POST /api/ai/apply-plan`, `BoardRepository`, proposal store | endpoint, authority, idempotency and native server-Apply tests | Retain server authority; never trust browser plan |
| Refresh persistence | legacy browser-local state | native reads committed board endpoint | file adapter local Preview; in-memory default | repository durability tests | **Production blocker:** no configured durable Production adapter |
| Session ownership | client quota token in older flows | browser cookie is implicit | `session_owner.ts` opaque HttpOnly/SameSite owner | cross-session repository/Apply tests | Private anonymous session only; no authentication/cross-device identity |
| RTL | legacy document and styles | ProductShell/components | presentation only | component and browser checks | Required on unified shell |
| Keyboard | partial legacy action menu | repository/details controls; board read-only | presentation only | accessibility component tests | **No replacement for manual board movement:** R2 |
| Mobile | legacy responsive CSS | ProductShell and native grids | presentation only | browser acceptance | R1 shell, R2 interaction, R5 live acceptance |
| Purple animated background | legacy has embedded-background suppression | `ShaderGradientBackground.tsx` through `ProductShell.tsx` | presentation only | shell/embed tests | Unified planner explicitly uses non-lightweight background |

## State and authority boundaries

- `GET /api/board` and `web/lib/planner/load-board.ts` provide the initial
  program board. The React board is currently read-only.
- `POST /api/ai/generate-plan` owns deterministic planning and stores proposal
  records for the server-owned anonymous session when the authoritative path is
  used.
- `POST /api/ai/apply-plan` resolves the candidate from the proposal store and
  compare-and-swap commits through `BoardRepository`.
- `api/ai/apply_runtime.ts` chooses an in-memory repository by default and the
  ignored file-backed adapter only when `SYLLO_BOARD_STATE_DIR` is configured.
  The proposal store remains process memory. This is a Production blocker.
- `NativePlannerJourney.tsx` still contains a stale header comment claiming
  Apply is client-only even though its flagged path now calls server Apply.
  Correct the comment when that file is first changed; do not treat comments as
  runtime authority.
- There is no server command boundary for manual add/remove/move. Creating that
  boundary is required before React manual changes can be called authoritative.

## Git ownership and cleanup classification

| Class | Paths | Policy |
|---|---|---|
| Active runtime | `api/`, `shared/`, `web/`, selected `app/` modules | Migrate through tested commits; no bulk moves |
| Legacy reference runtime | `app/web/semester_board_viewer.html`, `web/lib/embed-html.ts`, `LegacyPlannerFrame.tsx` | Retain through parity; delete together only in R4 |
| Authoritative frozen input | tracked `data/` and catalog/program files | Never rewrite during planner migration |
| Automated proof | `tests/api`, `tests/ui`, `web/**/*.test.*`, Python tests | Keep legacy tests until replacement behavior has proof |
| Local agent configuration | `.agents/`, `.codex/` | Protected, untracked, not cleanup targets |
| Runtime/audit scratch | `.tmp/` | Ignored/local; remove only exact session-owned paths |
| Preserved unfinished work | `tests/test_tau_curriculum_document.py` | Electrical RED; never stage in R0-R5 commits |
| Git stash | `stash@{0}` = `4ead6459520a7454ce624c566cbbb883eb7e35eb` | Unrelated and untouched |

Two remote Claude branches contain unique simulation/persistence commits but no
newer UI replacement. Their runtime value must be assessed by API ownership,
not merged wholesale. Current `ui/frontend-modernization` contains the newer
React Agent UI and legacy fixes.

## Deletion and promotion gates

The legacy planner cannot be deleted until all rows marked **No replacement**
have React and server owners plus automated and browser proof. Every legacy
deletion commit must name the replacement tests.

The unified planner cannot replace public `/planner` until:

1. manual search/add/remove/move and keyboard alternatives pass parity;
2. manual and Agent flows share one authoritative board/version;
3. manual changes stale every proposal and stale Apply is rejected server-side;
4. a durable Production persistence model is selected and configured;
5. the full Agent is no longer Preview-only;
6. full suites, build and Vercel Preview browser acceptance pass on one commit;
7. rollback deployment identity is recorded.

Electrical Engineering remains unresolved and must not appear as supported
while its current authoritative program model is incomplete.

## Reproducible audit commands

```powershell
rg -n "LegacyPlannerFrame|NativePlannerJourney|RepositoryExplorer|redirect\(|notFound\(" web/app web/lib
rg -n "dragstart|dragover|drop|moveCourse|removeCourseFromBoard" app/web/semester_board_viewer.html tests/ui web
rg -n "generate-plan|apply-plan|BoardRepository|ProposalStore|session" api shared web tests/api
Test-Path web/app/planner/page.tsx
Test-Path web/app/components/NativePlannerJourney.tsx
Test-Path app/web/semester_board_viewer.html
Test-Path api/ai/apply-plan.ts
Test-Path api/ai/board_repository.ts
```

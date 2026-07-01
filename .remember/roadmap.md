# Roadmap — not-yet-done work

_Live planning items only. Completed work lives in history.md. Design invariants live in architecture.md._

## Priority order (per 2026-07-01 architecture review)

_Item 0 (wire `overloadAccepted`/`overloadConfirmedAt` into `buildConstraintModel`) shipped `1dcbc41`/`03b3dac` — see history.md. Next recommended: item 1 below._

0. Institution/program identity in `ConstraintModel` — no `institution_id`/`program_id`/`catalog_year` anywhere; courses keyed by bare `course_id` globally. Cheapest to add before a second real program exists.
1. Load-cap constants from board data — `HARD_LOAD_CAP`/`DEFAULT_MAX_HOURS_PER_SEMESTER`/`SOFT_LOAD_MAX` are hardcoded, unlike `degreeRequiredHours` which correctly reads from board metadata.
2. `KnowledgeCapability.resolve()` return contract — currently returns `void`; no way to feed resolved facts back into `ConstraintModel` before search. Fix the interface and add a resumable-search seam in `BeamSearchStrategy.explore()` before building the real P2 syllabus-enrichment implementation on top.
3. Retire client JS shadow engine — `app/web/semester_board_viewer.html`'s ~20 `*Local` functions (scoring/validation/repair/degree-progress) independently reimplement server logic. Largest single "one canonical implementation" violation in the codebase. Prerequisite: streaming endpoint (below) stable.
4. Second synthetic program for genericity proof — `data/boards/test_program_2027.json` has identical semester ids/hour target/category shape to the TAU fixture; doesn't actually exercise cross-program generality. Build a structurally different program and run the reliability matrix (`docs/product-goal.md` §13) against it.
5. Delete dead trace actions — `VALIDATE`/`SCORE`/`REPAIR` in `PLANNER_ACTION_TYPES`, confirmed no producer/consumer. Free deletion, do opportunistically.
6. Track/specialization model — extend `CategoryReq` with `equivalentGroups`/`trackId`, `ConstraintModel` with `activeTrack`/`coRequisites`. Sequence last — don't build twice against a still-duplicated foundation (items above).

## Other open items (not yet prioritized against the above)

- **Skip per-step validation in rollouts** (`planner_lookahead.ts`) — may be unnecessary now that `buildValidationContext` is memoized; re-evaluate before implementing.
- **UI/observability (P3):** step-limit warning banner in AI tab; wire `planner-run.ts` streaming into the UI (prerequisite: Alembic migration applied to Supabase — needs approval); trace panel filter bar + REJECT_COURSE highlighting + degree-hours chart.
- **Dead preference fields** (`balance_load`, `avoid_multiple_labs`, `avoid_multiple_projects`, `preferred_categories`, `action_type`, `course_context`) — parsed, never used. Implement `extra_request_he` as LLM prompt prefix; remove the rest.
- **`rank_candidates` tool** returns unsorted list despite its name — sort by `scorePlan`. Reduces in importance once beam search fully replaces LLM step-selection.
- **`is_unwanted` not checked in scoring** — flag is set on `CourseProfile` but never read in `enumerateActions`/`scorePlan`. Add deprioritization + `g5b = -unwanted_placed` sub-dimension.

## Verification gates for open items

| Item | Gate |
|---|---|
| Track/specialization model (§4.2) | Equivalent group counted once |

Design invariants that any of the above must not violate: see `.remember/architecture.md`.

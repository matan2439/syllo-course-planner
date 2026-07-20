# Roadmap — not-yet-done work

_Live planning items only. Completed work lives in history.md. Design invariants live in architecture.md._

## CI/test reliability gaps (found 2026-07-20, partially fixed — see current.md)

CI was non-functional against `ui/frontend-modernization` (trigger branch fix + `requirements.txt`'s
impossible `alembic>=2.0.0` pin fixed 2026-07-20). Two items surfaced by that fix remain open, both
needing a decision/triage before `tests/ui` and the Python suite can be honest CI gates rather than
`continue-on-error`/known-red:

- **`tests/ui` fixture gap** — ~38 of 60 suites hard-depend on `supabase_board_backup_2027_pre_sync.json`,
  a real Supabase board export that's deliberately `.gitignore`d and so is absent from every fresh
  checkout/CI runner. Needs a product decision: commit a sanitized/synthetic replacement fixture (and
  update however many test files reference `PROD_BOARD`), or restructure these suites to not need a
  real board export at all. Do not commit real student/board data to close this without explicit sign-off.
- **39 failed + 4 errored pre-existing Python tests** (`pytest`, first real run 2026-07-20) — untriaged.
  At least one class is another missing-fixture gap (`test_seed_postgres.py`'s sqlite `courses` table);
  at least one (`test_viewer_structure.py::test_degree_progress_helper_exists_and_used_in_draft_and_modal`)
  looks like a genuine regression — `renderProposalCard()` no longer calls `renderDegreeProgressHtml(...)`.
  Needs a full triage pass (which failures are stale/fixture-dependent vs. real bugs) before deciding
  what to fix vs. update vs. formally accept as a known gap.

## AcademicDecisionAgent readiness roadmap (2026-07-01 audit)

_Production planner (`generate-plan`/`planner-run` default paths, UI, DB) is frozen. All items below are infrastructure-only — no production wiring — building toward `AcademicDecisionAgent → DecisionCapability → SimulationCapability → PlanningCapability (PlannerAgent) → SearchCapability`. Phase 0 (institution/program identity in `ConstraintModel`) shipped `232271a`/`0b45b98`/`e16ba9c`; Phase 1a (`enumerateActions` behind `PolicyProvider.generateActions`) shipped `959a4f5`; Phase 1b (load-cap thresholds behind `ConstraintModel`/model context) shipped `5b1dad9` — see history.md. `institutionId` remains intentionally `undefined` (no real source yet). Production website path unchanged throughout (verified each phase against the full API suite, including the frozen `PlannerWorker`'s own tests)._

**Next recommended — Phase 2:** define `ProgramProvider` interface + `TauProgramProvider`.
- `ProgramProvider` doesn't exist today — `board_json` schema parsing (Hebrew field names, `program_requirements_categories`, `KNOWN_SEMESTER_IDS`'s hardcoded 4-semester structure in `plan_validation.ts`) is fused directly into `course_profile.ts`/`planner_model.ts` with no interface boundary.
- `TauProgramProvider` should wrap the existing `queryBoardJson`/`board_loader`/`buildCourseProfiles`/`buildConstraintModel` pipeline behind the new interface, additive only, no call-site changes to `generate-plan.ts`/`planner-run.ts`.

**Later phases (dependency order):**
3. Extract a transport-agnostic orchestration function (new, additive module — do not touch `generate-plan.ts`) that both the existing HTTP handler and the future `AcademicDecisionAgent` can call.
4. `SimulationCapability` — interface + minimal impl running the Phase-3 orchestration over model deltas; needs a `cloneConstraintModel(model, overrides)` helper.
5. `ClarificationCapability` + `PersistenceCapability` — interfaces + no-op/in-memory implementations (same pattern as `PassThroughKnowledgeCapability`).
6. `DecisionCapability` — composes `ProgramProvider` + `SimulationCapability` + `ClarificationCapability`.
7. `AcademicDecisionAgent` — top-level orchestrator over `DecisionCapability`.

## Deprioritized (production-planner items — frozen, not being worked until AcademicDecisionAgent integration)

- `KnowledgeCapability.resolve()` return contract — currently returns `void`; no way to feed resolved facts back into `ConstraintModel` before search. Fix the interface and add a resumable-search seam in `BeamSearchStrategy.explore()` before building the real P2 syllabus-enrichment implementation on top.
- Retire client JS shadow engine — `app/web/semester_board_viewer.html`'s ~20 `*Local` functions (scoring/validation/repair/degree-progress) independently reimplement server logic. Confirmed still load-bearing (masks server-side proposal quality — see runtime-path audit); largest single "one canonical implementation" violation in the codebase.
- Second synthetic program for genericity proof — `data/boards/test_program_2027.json` has identical semester ids/hour target/category shape to the TAU fixture; doesn't actually exercise cross-program generality. Build a structurally different program and run the reliability matrix (`docs/product-goal.md` §13) against it.
- Delete dead trace actions — `VALIDATE`/`SCORE`/`REPAIR` in `PLANNER_ACTION_TYPES`, confirmed no producer/consumer. Free deletion, do opportunistically.
- Track/specialization model — extend `CategoryReq` with `equivalentGroups`/`trackId`, `ConstraintModel` with `activeTrack`/`coRequisites`. Sequence last — don't build twice against a still-duplicated foundation (items above).

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

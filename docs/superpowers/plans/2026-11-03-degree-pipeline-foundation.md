# Degree Pipeline Foundation (Plan 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mechanical-engineering-specific data pipeline with a registry-driven, degree-agnostic one (evidence → spec → checks → board), and prove it by rebuilding today's ME boards byte-for-byte through it.

**Architecture:** A degree registry (`data/config/programs.json`) names every degree and its official source ids. Per-university *adapters* (`app/degrees/adapters/`) fetch official sources live and emit `EvidenceItem`s. A per-degree `spec.json` holds the structured requirements plus a `coverage` map that accounts for every evidence item. Checks (`app/degrees/checks/`) gate publishing. The existing board builders (`app/analysis/semester_board.py`, `scripts/build_early_years_board.py`) are kept and driven through `spec_to_program()`, so the solver/UI contract (`syllo_board_v1`) is unchanged. One CLI, `scripts/degree.py`, replaces the ME-named scripts.

**Tech Stack:** Python 3 + pydantic v2 + pytest (pipeline); TypeScript + zod + jest (registry consumers in `shared/`, `web/`, `api/`).

**Spec:** `docs/superpowers/specs/2026-11-03-degree-onboarding-design.md`

**Later plans (not this one):** Plan 2 — `add-degree` skill + `degree.py publish` (new degrees go live via the existing `program_versions` sync once `check` passes). Plan 3 — versioned releases (`program_version_releases`), saved-plan pinning, impact analysis, in-site notice + keep/apply screen + email. Plan 4 — scheduled live re-check job (mechanical auto-publish, GitHub issue + email alert for unmapped items).

## Global Constraints

- Board format stays `syllo_board_v1`; no planner/solver logic changes.
- TAU year code = the starting calendar year: `shana=2026` means תשפ"ז (2026-2027). The "2027" in ids like `mechanical_engineering_2027` is the catalog id, built from `shana=2026` data.
- Program id convention `<base>_<year>`; a non-TAU program id is prefixed `<institution>:`.
- Checks always run on **live** fetches; cache is for offline/dev only (`--offline`).
- Empty legal-semester list means "unknown", never "nowhere"; a course not taught this year is excluded via `offered_in_year === false`.
- ME migration acceptance: rebuilt boards equal today's committed boards exactly, after normalizing only `metadata.board_data_version` and generated timestamps. Real TAU changes land later, not in this plan.
- Existing ids and saved user data must keep resolving unchanged (`mechanical_engineering_2027`, `mechanical_engineering_2025`, `mechanical_engineering_biomedical_track_2025`).
- Gate before every commit: `python -m pytest -q` and `npm test` both pass.
- Work on branch `feat/degree-pipeline` cut from `main` in a fresh worktree; the current checkout has unrelated uncommitted work from another session — do not commit it.

## Review Focus

1. **A TAU section with only rule text and no courses** (e.g. ramaid 23 "שנים ג'+ד' קורסי ליבה/בחירה" `hesber`, body `hesbernosaf` "זכאות לתואר") must still become an evidence item → test in Task 3 (`test_text_only_sections_emit_items`).
2. **Reworded rule text** must produce a *new* id (so it shows as unaccounted), while an unchanged text keeps its id → Task 3 (`test_rule_text_id_changes_when_text_changes`).
3. **Cancelled courses** (`mevutal == "1"`) must still be emitted (as `kind="course_listing"`, `cancelled=True`) so a cancellation is noticed rather than vanishing → Task 3 (`test_cancelled_course_still_emitted`).
4. **A stale cache passed off as live** — a check run where any item's `fetched_at` predates the run start must fail → Task 5 (`test_freshness_fails_on_cached_item`).
5. **A coverage entry pointing to a spec path that doesn't exist** (typo or deleted rule) must fail, not count as covered → Task 5 (`test_mapping_to_missing_spec_path_fails`).

---

### Task 0: Branch setup and carry over `--live`

**Files:**
- Modify: `scripts/refresh_course_data.py` (the `--live` flag already written in the old checkout)
- Test: `tests/test_refresh_live_flag.py`

- [ ] **Step 1:** Create worktree on `feat/degree-pipeline` from `main`; copy `data/database.sqlite` and `data/raw_html/` from the main checkout (they are gitignored; see memory "Worktree gitignored data").
- [ ] **Step 2:** Port the `--live` change from `C:\Users\matan\tau-course-planner-ui\scripts\refresh_course_data.py` (`live: bool = False` on `read_ims`/`read_program`/`read_timetable`/`official_facts`, `--live` arg, mutually exclusive with `--offline`).
- [ ] **Step 3: Write test** `test_live_forces_refresh(monkeypatch)`: monkeypatch `refresh_course_data.fetch_url` to record `force_refresh`; call `read_ims("0542-4120", 2026, offline=False, live=True)`; assert recorded `force_refresh is True`. Same for `fetch_program_data`/`fetch_schedule_data` via `read_program`/`read_timetable`.
- [ ] **Step 4:** `python -m pytest -q tests/test_refresh_live_flag.py tests/test_board_data_integrity.py` → PASS.
- [ ] **Step 5:** Commit `feat(data): --live re-downloads official sources instead of trusting cache`.

### Task 1: Degree registry

**Files:**
- Create: `data/config/programs.json`, `shared/programs.ts`, `app/degrees/__init__.py`, `app/degrees/registry.py`
- Modify: `data/config/institutions.json` (add `sources.adapters` and `catalogYearPolicy`), `shared/institutions.ts` (schema)
- Test: `tests/api/programs_registry.test.ts`, `tests/test_degree_registry.py`

**Interfaces:**
- Produces (TS, `shared/programs.ts`): `programSchema` (zod, `.strict()`), `type ProgramEntry`, `PROGRAM_REGISTRY: readonly ProgramEntry[]`, `getProgramEntry(id: string): ProgramEntry | null`, `livePrograms(): ProgramEntry[]`.
- Produces (Py, `app/degrees/registry.py`): `class ProgramEntry(BaseModel)` (same fields, snake_case), `load_registry(path: Path = DEFAULT) -> list[ProgramEntry]`, `get_program(program_id: str) -> ProgramEntry` (raises `KeyError`).
- `ProgramEntry` fields: `id`, `institution` (`"tau"`), `base` (`"mechanical_engineering"`), `year` (int, catalog year), `sourceYear` (int, TAU `shana`), `nameHe`, `nameEn`, `track` (string|null), `familyId`, `familyDescriptionHe`, `descriptionHe`, `yearLabelHe` (e.g. `"2027 (תשפ״ז)"`), `boardJsonFile` (legacy parsed_json name), `sourceIds` (record, TAU: `{ "tcid": "8715" }`), `status` (`"draft" | "live" | "archived"`), `isFamilyDefault` (bool), `capabilities` (string[]; ME: `["mechanical_design"]`), `catalogYearPolicy` (optional, `"start_year" | "may_opt_newer" | "always_latest"`).
- Institution additions: `sources.adapters: string[]` (TAU: `["tau_tochniot", "tau_timetable", "tau_ims"]`), `catalogYearPolicy` (TAU default: `"start_year"` — mark `"_needsVerification": true` in the JSON note; the skill researches it per degree).

- [ ] **Step 1: Write tests.** TS: registry parses; contains exactly the three ids above with `status: "live"`; `mechanical_engineering_2027` has `sourceYear: 2026`, `sourceIds.tcid: "8715"`, `isFamilyDefault: true`; every `institution` resolves via `getInstitution`. Py: `get_program("mechanical_engineering_2027").source_ids["tcid"] == "8715"`; unknown id raises `KeyError`; Py and TS read the same file (assert Py ids == ids parsed from the JSON).
- [ ] **Step 2:** Run both → FAIL (missing modules).
- [ ] **Step 3:** Write `programs.json` with the three entries, copying names/descriptions/`boardJsonFile` verbatim from `web/lib/programs.ts`; implement the TS and Py loaders.
- [ ] **Step 4:** `npm test -- programs_registry` and `python -m pytest -q tests/test_degree_registry.py` → PASS.
- [ ] **Step 5:** Commit `feat(degrees): single degree registry for TS and Python`.

### Task 2: UI and API read the registry

**Files:**
- Modify: `web/lib/programs.ts`, `api/ai/course_catalog.ts`, `api/ai/semantic_course_extraction.ts`
- Test: existing `web/lib/programs.test.ts`, `tests/api/course_catalog.test.ts` (must pass unchanged), plus new cases in `tests/api/course_catalog.test.ts`

**Interfaces:**
- Consumes: `PROGRAM_REGISTRY`, `getProgramEntry` (Task 1).
- Produces: `web/lib/programs.ts` keeps its exported API exactly (`ProgramVM`, `ProgramFamilyVM`, `DEFAULT_PROGRAM_ID`, `listProgramFamilies`, `getProgram`, `resolveProgram`, `programQuery`) but derives `PROGRAMS`/`FAMILIES` from the registry (live + archived; archived = family `archivePrograms`). `api/ai/course_catalog.ts` adds `loadProgramCatalog(programId: string): CatalogCourse[]`; `loadMechanicalEngineering2027Catalog` stays as a one-line alias. `capabilitiesFor(programId: string): readonly string[]` in `semantic_course_extraction.ts`; `CAPABILITY_ONTOLOGY` stays exported as ME's list.

- [ ] **Step 1:** New tests: `loadProgramCatalog('mechanical_engineering_2027')` deep-equals `loadMechanicalEngineering2027Catalog()`; `loadProgramCatalog('test_program_2027')` returns that board's courses; `capabilitiesFor('mechanical_engineering_2027')` equals `['mechanical_design']`; unknown program → `[]`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Remove the stale "retired single-file planner" comment in `web/lib/programs.ts`.
- [ ] **Step 4:** `npm test` (full) → PASS, including unchanged `web/lib/programs.test.ts`.
- [ ] **Step 5:** Commit `refactor(programs): UI list and AI catalog come from the registry`.

### Task 3: Evidence model and TAU adapters

**Files:**
- Create: `app/degrees/evidence.py`, `app/degrees/adapters/__init__.py`, `app/degrees/adapters/tau.py`
- Test: `tests/test_tau_adapters.py` (uses committed `tests/fixtures/tau_program_fixture.json`; add `tests/fixtures/tau_schedule_fixture.json`, a trimmed real `ydmaarechet` payload)

**Interfaces:**
- Produces:
  - `class EvidenceItem(BaseModel)`: `id: str`, `source_url: str`, `fetched_at: datetime` (UTC), `from_cache: bool`, `kind: Literal["program_text", "section", "rule_text", "course_listing", "course_fact", "policy_text"]`, `path: list[str]`, `raw_text: str`, `course_id: str | None = None`, `cancelled: bool = False`, `data: dict = {}`.
  - `text_id(text: str) -> str`: sha1 of whitespace-collapsed, HTML-stripped text, first 12 hex chars.
  - `ADAPTERS: dict[str, Callable[[ProgramEntry, bool, bool], list[EvidenceItem]]]` keyed by adapter name; signature `(program, live, offline)`.
  - `tau.tochniot_evidence(program, live, offline)`, `tau.timetable_evidence(...)`, `tau.ims_evidence(...)` (IMS: one `course_fact` per course id found in tochniot items; reuses `refresh_course_data.read_ims`).
  - `collect_evidence(program: ProgramEntry, live: bool, offline: bool) -> list[EvidenceItem]`: runs the institution's `sources.adapters` in order, returns items sorted by id; raises `ValueError` on duplicate ids.
- Id scheme (TAU, `T = f"tau:{tcid}:{shana}"`): body fields `f"{T}:body:{field}"` for `teurtochnit`, `teurtoar`, `teurshaot`, `disclaimerletoar`; body rule texts `f"{T}:body:hesbernosaf:{text_id}"`; each `terms`/`prev_newsletters` entry `f"{T}:body:terms:{text_id(title)}"`; each section `f"{T}:rama:{ramaid}"` (`kind="section"`, `raw_text` = `teurrama` + `shaot`); non-empty section `hesber` → `f"{T}:rama:{ramaid}:hesber:{text_id}"` (`rule_text`); each `kurs` → `f"{T}:rama:{ramaid}:kurs:{kursshow}"` (`course_listing`, `data` keeps `mishkal`, `shaotuni`, `drishotkedem`, `drishotmakbilot`, `shiyuch`, `misgeret`); timetable `f"{T}:timetable:{course_id}"` (`course_fact`, `data.semesters`); IMS `f"tau:ims:{shana}:{course_id}"`.

- [ ] **Step 1: Write tests** against the fixtures: `test_ids_are_stable_across_runs` (two runs, same ids); `test_every_section_and_course_emitted` (fixture's rama/kurs counts == section/course_listing item counts); `test_text_only_sections_emit_items`; `test_rule_text_id_changes_when_text_changes` (mutate one `hesber`, only that id changes); `test_cancelled_course_still_emitted`; `test_live_sets_from_cache_false` (monkeypatch fetchers; `live=True` → all `from_cache is False`); `test_duplicate_ids_raise`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; reuse `fetch_program_data`/`fetch_schedule_data` (`force_refresh=live`) and the unwrap `data → results → body` (string-encoded JSON possible).
- [ ] **Step 4:** `python -m pytest -q tests/test_tau_adapters.py` → PASS.
- [ ] **Step 5:** Commit `feat(degrees): evidence items + TAU tochniot/timetable/IMS adapters`.

### Task 4: Degree spec format and ME spec

**Files:**
- Create: `app/degrees/spec.py`, `scripts/migrate_program_to_spec.py` (one-off), `data/degrees/tau/mechanical_engineering/2027/spec.json`
- Test: `tests/test_degree_spec.py`

**Interfaces:**
- Produces:
  - `class DegreeSpec(BaseModel)`: `program_id`, `institution`, `source_year: int`, `total_required_credits: float`, `catalog_year_policy`, `mandatory_courses: list[MandatoryCourse]` (`course_id`, `year`, `semester: Literal["A","B","either"]`, `placement_rule`), `categories: list[Category]` (`category_id`, `name_he`, `min_courses: int | None`, `min_credits: float | None`, `course_ids: list[str]`, `group: str | None` e.g. `"core"`), `group_minimums: dict[str, int]` (ME: `{"core": 6}` from `core_courses_total_min`), `general_requirement: dict | None`, `double_counting: Literal["forbidden", "allowed_listed"] = "forbidden"`, `ui: dict`, `legacy: dict` (fields the builder needs that have no generic home yet, verbatim), `coverage: dict[str, CoverageEntry]` where `CoverageEntry = {"mapped_to": str} | {"not_planning_rule": str}`.
  - `load_spec(path: Path) -> DegreeSpec`, `spec_path(program: ProgramEntry) -> Path` (`data/degrees/<institution>/<base>/<year>/spec.json`).
  - `spec_to_program(spec: DegreeSpec) -> dict` — the exact dict shape `build_semester_board(program=...)` and `generate_2027_board` consume today.
  - `program_to_spec(program: dict, entry: ProgramEntry) -> DegreeSpec` (migration only).
  - `resolve_spec_path(spec: DegreeSpec, path: str) -> bool` — `path` syntax: `mandatory_courses[<course_id>]`, `categories[<category_id>]`, `categories[<category_id>].course_ids[<course_id>]`, `total_required_credits`, `general_requirement`, `group_minimums.<group>`, `catalog_year_policy`.

- [ ] **Step 1: Write tests:** `test_round_trip_me_program` — `spec_to_program(program_to_spec(p, entry)) == p` for `data/programs/mechanical_engineering_2027_enriched.json` (deep-equal, including `legacy` passthrough); `test_committed_me_spec_matches_migration` — the committed spec equals a fresh `program_to_spec` except `coverage`; `test_resolve_spec_path` (each path form true for an existing target, false for a missing one).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; run `python scripts/migrate_program_to_spec.py mechanical_engineering_2027` to write the spec with `coverage: {}`.
- [ ] **Step 4:** `python -m pytest -q tests/test_degree_spec.py` → PASS.
- [ ] **Step 5:** Commit `feat(degrees): structured degree spec; ME 2027 spec from enriched program`.

### Task 5: Coverage and freshness checks

**Files:**
- Create: `app/degrees/checks/__init__.py`, `app/degrees/checks/coverage.py`
- Test: `tests/test_degree_checks_coverage.py`

**Interfaces:**
- Consumes: `EvidenceItem` (Task 3), `DegreeSpec`, `resolve_spec_path` (Task 4).
- Produces: `class CheckResult(BaseModel)`: `name: str`, `passed: bool`, `problems: list[str]` (each problem names the evidence id + `source_url`). `check_coverage(items, spec) -> CheckResult` (fails on: item id not in `coverage`; `mapped_to` path that doesn't resolve; empty `not_planning_rule` reason). `check_freshness(items, run_started_at: datetime) -> CheckResult` (fails if any `from_cache` or `fetched_at < run_started_at`). Stale coverage keys (in spec, not in items) are reported as problems too — they mean TAU removed something.

- [ ] **Step 1: Write tests:** `test_all_mapped_passes`; `test_unaccounted_item_fails_and_names_it`; `test_mapping_to_missing_spec_path_fails`; `test_blank_reason_fails`; `test_stale_coverage_key_fails`; `test_freshness_fails_on_cached_item`; `test_freshness_passes_live`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(degrees): coverage + freshness checks`.

### Task 6: Consistency and plannability checks

**Files:**
- Create: `app/degrees/checks/consistency.py`
- Test: `tests/test_degree_checks_consistency.py` (small hand-built specs + facts)

**Interfaces:**
- Consumes: `DegreeSpec`, course facts dict `course_id -> {"credits", "weekly_hours", "offering": {"semesters": [...]}}` (the `tau_course_facts_<year>.json` shape), a built board dict.
- Produces: `check_totals(spec) -> CheckResult` (mandatory credits + category/group minimums with smallest-credit courses must not exceed `total_required_credits`, and a full selection must be able to reach it — report the arithmetic in the problem); `check_courses_known(spec, facts) -> CheckResult` (every referenced course has credits/hours; unknown offering is a warning in `problems` prefixed `warn:` and does not fail); `check_double_counting(spec) -> CheckResult` (a course in two categories fails unless `double_counting == "allowed_listed"`); `check_mandatory_offered(spec, facts) -> CheckResult`; `check_plannable(board) -> CheckResult` (wraps `app.analysis.board_audit.audit_board`: any `error` issue fails).

- [ ] **Step 1:** Write one passing and one failing test per function, plus `test_me_spec_passes_all` against the committed ME spec, `data/official/tau_course_facts_2026.json`, and `data/boards/mechanical_engineering_2027.json`. If ME genuinely fails a rule (e.g. a course listed in two categories on purpose), set the spec field that expresses it (`double_counting: "allowed_listed"` + list) — do not weaken the check.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(degrees): consistency + plannability checks`.

### Task 7: `scripts/degree.py` CLI + generalized builders (golden master)

**Files:**
- Create: `scripts/degree.py`, `tests/test_degree_build_golden.py`
- Modify: `app/pipeline/generate_2027_board.py`, `app/pipeline/enrich_mechanical_2027.py`, `scripts/build_early_years_board.py`, `scripts/refresh_course_data.py`, `scripts/course_planner_pipeline.py` — replace hard-coded ME paths/`PROGRAM_TCID`/`BOARDS` with parameters derived from a `ProgramEntry` (keep their current CLI defaults working = ME)

**Interfaces:**
- Consumes: everything above.
- Produces: `python scripts/degree.py <command> --program <id> [--live|--offline]` with commands:
  - `evidence` → writes `data/degrees/.../evidence.json` (items) and prints counts by kind;
  - `build` → `spec_to_program` → existing generate path → early-years board → writes `data/parsed_json/<boardJsonFile>`, `data/boards/<id>.json`, `data/boards/<base>_years_1_2_<year>.json`;
  - `check` → runs all Task 5/6 checks (requires `--live` unless `--offline` is given, in which case freshness is reported as skipped and the exit code is non-zero), prints a report, writes `data/import_reports/degree_check_<id>.md`, exit code 0 only if all pass;
  - `refresh` → `refresh_course_data` logic for this program (facts + mismatch report; `--apply` patches boards).
- `board_paths(program: ProgramEntry) -> dict[str, Path]` and `normalize_board(board: dict) -> dict` (drops `metadata.board_data_version` and generated timestamp fields only) live in `scripts/degree.py`.

- [ ] **Step 1: Write golden test** `test_offline_build_reproduces_committed_me_boards`: copy the three committed ME board files to tmp, run `degree.py build --program mechanical_engineering_2027 --offline` with output dir = tmp, assert `normalize_board(new) == normalize_board(committed)` for each.
- [ ] **Step 2:** Run → FAIL (no CLI).
- [ ] **Step 3:** Implement, parametrizing the legacy scripts. Any diff the golden test shows is fixed in the parametrization, never by editing the committed boards.
- [ ] **Step 4:** Run golden test + full `python -m pytest -q` → PASS.
- [ ] **Step 5:** Commit `feat(degrees): one CLI builds any registered degree; ME reproduced exactly`.

### Task 8: Full ME coverage (live)

**Files:**
- Modify: `data/degrees/tau/mechanical_engineering/2027/spec.json` (`coverage`)
- Create: `app/degrees/coverage_suggest.py`
- Test: `tests/test_coverage_suggest.py`, `tests/test_me_coverage_committed.py`

**Interfaces:**
- Produces: `suggest_coverage(items, spec) -> dict[str, CoverageEntry]` — auto-maps only the unambiguous cases: `course_listing` whose course id is a mandatory course → `mandatory_courses[<id>]`; in exactly one category → `categories[<cat>].course_ids[<id>]`; `course_fact`/IMS/timetable items for a course the spec references → the same path; section items whose `ramaid` is already named in `spec.legacy` → that category. Everything else is left out for a human/AI to decide.

- [ ] **Step 1: Write tests:** suggestion rules above on the fixture; `test_me_coverage_committed` — `check_coverage(load evidence.json, ME spec)` passes, and every `not_planning_rule` reason is ≥ 10 characters.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Run `degree.py evidence --program mechanical_engineering_2027 --live`, apply `suggest_coverage`, then read every remaining item (section texts, `hesbernosaf` eligibility text, terms, shaar ruach sections, cancelled/unknown courses) and map it or mark it `not_planning_rule` with a concrete reason. Any item that is a real planning rule the spec can't express → stop and report it (spec rule: the degree doesn't go live with an unenforced rule). Commit `evidence.json` alongside the spec.
- [ ] **Step 4:** `python scripts/degree.py check --program mechanical_engineering_2027 --live` → exit 0; full `python -m pytest -q` → PASS.
- [ ] **Step 5:** Commit `data(degrees): ME 2027 full coverage of every official item`.

### Task 9: Retire ME-named entry points

**Files:**
- Modify: `package.json` (`build:board`, `sync:board`, `verify:live` → `scripts/degree.py ... --program mechanical_engineering_2027`, add `degree:check`), `docs/board-pipeline.md`
- Delete: `app/pipeline/verify_mechanical_2027_data.py`, `scripts/normalize_courses_mechanical_2027.py`, `scripts/supabase_normalize_mechanical_2027.py` only if no test/import still needs them (grep first; otherwise reduce each to a thin wrapper that calls `degree.py`); rename `enrich_mechanical_2027.py`/`generate_2027_board.py` to `enrich_board_graphql.py`/`generate_board.py` with the old module names kept as one-line re-exports for one release.
- Test: full suites.

- [ ] **Step 1:** Grep for every importer of the files above; list them in the commit message.
- [ ] **Step 2:** Make the changes.
- [ ] **Step 3:** `python -m pytest -q` and `npm test` → PASS; `npm run build:board` reproduces the boards (git diff empty except `board_data_version`).
- [ ] **Step 4:** Update `docs/board-pipeline.md`: the four commands, the evidence → spec → check → build flow, where files live.
- [ ] **Step 5:** Commit `refactor(degrees): ME-named scripts replaced by degree.py`.

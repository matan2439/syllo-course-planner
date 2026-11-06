# Harden the add-degree Skill (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps the first real run (TAU Electrical Engineering, branch `feat/degree-ee-draft`) found: requirements that were silently dropped, mapping work the tools could have done, and facts that live only in free text.

**Architecture:** Small, independent changes to the spec format, checks, adapters and `todo`, plus skill text. No planner/solver changes (multi-home display, distinct-track enforcement and the Years 1-2 elective window belong to the planner-enforcement plan).

**Tech Stack:** Python 3 + pydantic v2 + pytest; skill Markdown.

**Spec:** `docs/superpowers/specs/2026-11-03-degree-onboarding-design.md`. Source of the backlog: the EE run report ("Should become pipeline fixes", items 1, 2, 4, 6, 7) and plan 3's PDF review (multi-rule sentences).

**Stacks on:** `feat/degree-unblock` (PR #138).

## Global Constraints

- ME's committed boards stay byte-identical (golden test); ME `todo` stays at 0 open; ME check stays red only on `rules_enforced`.
- Evidence ids never change for unchanged text.
- A requirement the board cannot carry must make `check` fail — never a silent drop.
- Tests hermetic (no network; `tests/conftest.py` guard).
- Gates: `python -m pytest -q`, `npm test`, `npm run build:board` diff empty.

## Review Focus

1. **A group minimum other than `core`** (EE: 12 track courses) → `check` fails naming it until the board carries it.
2. **A category with `min_courses: null`** → treated as 0 (no requirement), never silently "at least 1".
3. **One evidence item stating two rules** → a coverage entry can map it to both homes; each target must resolve.
4. **Reusing another degree's mappings** → only for ids present in both evidence sets with identical text; never overwrites.
5. **A course note "קורס ליבה במסלול X"** → a structured fact the mapper and suggestions can use; ids of existing items unchanged.

### Task 1: No silent drops (group minimums, min_courses default)

**Files:** `app/degrees/spec.py` (`spec_to_program`), `app/degrees/checks/consistency.py`, `app/analysis/program_requirements.py`, `app/analysis/course_plan_builder.py`; tests.

- [ ] Tests: a spec with `group_minimums={"core": 6, "track": 12}` → new check `check_board_carries_requirements(spec)` fails naming `group_minimums.track` (the legacy board only carries `core`); ME passes. A spec category with `min_courses=None` → the builder treats it as 0 (no "at least 1"); ME unchanged (all ME categories set min_courses explicitly — verify).
- [ ] Implement: `spec_to_program` emits every category's `min_courses` explicitly (None → 0); builder defaults `min_courses` to 0 where it read 1 (grep both call sites; confirm ME byte-identical); the new check lists every spec requirement `spec_to_program` cannot emit (non-core group minimums today). Wire into `degree.py check`.
- [ ] Commit `fix(degrees): requirements the board cannot carry fail the check`.

### Task 2: Multi-target coverage entries

**Files:** `app/degrees/spec.py` (`MappedTo.mapped_to: str | list[str]`), `app/degrees/checks/coverage.py` (`coverage_gaps`: every target must resolve; unread items: every target must be `known_gaps[...]`), `scripts/degree.py` (todo prints all targets), `app/degrees/coverage_suggest.py` (unchanged output type); tests.

- [ ] Tests: list with two resolving targets passes; one unresolved target fails naming it; empty list fails; string form unchanged (ME spec loads and round-trips byte-identical via write_spec).
- [ ] Commit `feat(degrees): one evidence item can map to several spec homes`.

### Task 3: Core-of-track facts from course notes

**Files:** `app/degrees/adapters/tau.py` (course-note rule_text items gain `data.core_of_track: "<track name>"` when the note matches "קורס ליבה במסלול <X>" — data only, ids unchanged), `app/degrees/coverage_suggest.py` (suggest `course_rules[<rule>]` for a core note when exactly one `distinct_categories` rule lists that course in `course_ids`); tests on fixture notes + EE-shaped real note text.

- [ ] ME evidence data may change only if ME has such notes (verify; regenerate ME evidence with live provenance kept, as plan 3 did, only if needed).
- [ ] Commit `feat(degrees): core-of-track notes become structured facts`.

### Task 4: Suggestions for multi-home courses + reuse another degree's mappings

**Files:** `app/degrees/coverage_suggest.py`, `scripts/degree.py` (`todo --reuse-from <program-id>`); tests.

- [ ] Multi-home: for a course listed in several spec places, a `course_listing` item is suggested to the category whose spec `name_he` matches the item's section path (the section it appears under); `course_fact` items (timetable/IMS) are suggested to the course's `mandatory_courses[...]` if mandatory, else to the list of all its category homes (Task 2's multi-target form). Never guesses when the path matches no category.
- [ ] `todo --reuse-from <other>`: copies the other degree's coverage entries for ids present in both evidence sets whose `raw_text` is identical, only into ids not yet covered, and only when every target resolves in THIS spec (else lists them as "needs review"); prints counts. Tests: identical id+text copied; differing text skipped; existing entries untouched; unresolvable targets reported, not written.
- [ ] Commit `feat(degrees): todo suggests multi-home courses and reuses another degree's mappings`.

### Task 5: Skill text + EE dry run

**Files:** `.claude/skills/add-degree/SKILL.md`, `reference.md`.

- [ ] Document Tasks 1-4 in the skill (when to use list targets; `--reuse-from`; the new check; core-of-track facts).
- [ ] Dry run on a throwaway worktree of `feat/degree-ee-draft` rebased onto this branch: `evidence --offline` (PDF cached), `todo --reuse-from mechanical_engineering_2027 --apply-suggestions`; report how many of EE's 364 PDF items and hand-mapped category entries the tools now cover, and what the new check reports for EE (12-track minimum). Do not commit EE data from the dry run.
- [ ] Commit `docs(skills): add-degree uses list targets, reuse and the board-carry check`.

## Not in this plan

Planner enforcement of course rules (distinct tracks, mutual exclusion, load limits, year/cohort restrictions, equivalences), multi-home courses on the board, the Years 1-2 elective offering window, technician (הנדסאי) cohort exemptions; Plan 5 safe updates; Plan 6 scheduled re-check.

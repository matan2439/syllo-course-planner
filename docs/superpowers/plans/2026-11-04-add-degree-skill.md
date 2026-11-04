# Add-Degree Skill (Plan 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command the owner can say — "add <degree> at <university>" or "refresh <degree>" — drives the Plan 1 pipeline from an empty registry entry to a checked, publishable degree, without editing ME-specific code.

**Architecture:** Three new `scripts/degree.py` commands do the mechanical work: `init` (resolve the program on the official index, write a `draft` registry entry and a skeleton spec, fetch evidence live), `todo` (the worklist of evidence items not yet accounted for, grouped and printed with their raw text), and `publish` (refuses unless `check --live` passes in full; flips `status` to `live` and prints the DB sync command for the owner). A project skill, `.claude/skills/add-degree/SKILL.md`, tells Claude how to read every worklist item, fill `spec.json`, iterate on `check`, and when to stop. The ME-only defaults that would break degree #2 are removed first.

**Tech Stack:** Python 3 + pydantic v2 + pytest; TypeScript + zod + jest (registry consumers); Claude Code project skill (Markdown).

**Spec:** `docs/superpowers/specs/2026-11-03-degree-onboarding-design.md` (§1, §3, §4, §7, §8). Plan 1: `docs/superpowers/plans/2026-11-03-degree-pipeline-foundation.md`.

## Global Constraints

- Board format stays `syllo_board_v1`; no planner/solver logic changes.
- A degree may be published only when `degree.py check --program <id> --live` exits 0 — no pinned exceptions. (ME stays live as-is; it is not re-published by this plan.)
- `draft` degrees never appear in the UI (`web/lib/programs.ts` already filters them) and are never served by `/api/board`.
- The skill never invents a coverage mapping: an item it can't place goes to `course_rules` (`enforced_by: "none"`), `known_gaps`, or stays unaccounted — all three keep `check` red.
- Production DB writes and prod deploys are run by the owner: `publish` prints the exact commands, it does not run them (project memory: auto mode blocks prod writes).
- TAU year code = the starting calendar year (`shana=2026` is תשפ"ז); program id `<base>_<catalog year>` where catalog year = shana + 1.
- Gate before every commit: `python -m pytest -q` and `npm test` pass; `npm run build:board` leaves `git diff` empty for ME.

## Review Focus

1. **Program name that matches zero or several index entries** → `init` fails with the candidates listed, never picks one → Task 2 (`test_init_refuses_ambiguous_program`).
2. **A degree whose page has courses shared with ME** (calculus, physics) → refreshing it leaves ME's facts and ME's build byte-identical → Task 1 (`test_second_program_refresh_keeps_me_build_identical`).
3. **`publish` on a degree with any failing or skipped check** → refuses, prints the failing checks → Task 4 (`test_publish_refuses_unless_live_check_passes`).
4. **A draft id requested through `/api/board`** → 404, not the board → Task 5 (`board.test.ts: draft program is not served`).
5. **Registry family with no `isFamilyDefault` entry, or two** → registry load fails loudly instead of the UI silently dropping the family → Task 1 (`programs_registry.test.ts: one default per family`).

---

### Task 1: Remove ME-only defaults that break degree #2

**Files:**
- Modify: `scripts/refresh_course_data.py` (module constants `DEFAULT_PROGRAM`, `ACADEMIC_YEAR`, `PROGRAM_TCID`, `BOARDS`, default `tcid=PROGRAM_TCID` args), `app/analysis/semester_board.py` (`BIDIT_FIELDS` / `bidit_schedule_2027`), `shared/programs.ts` (id regex accepts optional `<institution>:` prefix; one-default-per-family validation), `app/degrees/registry.py` (same validations in Python), `app/degrees/facts.py` + `scripts/refresh_course_data.py` (one `OFFICIAL_DIR`)
- Test: `tests/test_degree_registry.py`, `tests/api/programs_registry.test.ts`, `tests/test_refresh_facts_merge.py`

**Interfaces:**
- Produces: every reader takes a `ProgramEntry`; the ME default is resolved only in each script's `main()` (CLI default), never at import. `OFFICIAL_DIR` lives only in `app/degrees/facts.py`.

- [ ] **Step 1: Write tests:** `test_second_program_refresh_keeps_me_build_identical` (register a fake second TAU program sharing two ME courses in a tmp registry + tmp facts file, refresh it offline with monkeypatched fetchers, then ME offline build into a scratch dir == committed boards); registry tests for id prefix `foo:bar_2027` accepted, `Bar_2027` rejected, a family with 0 or 2 defaults rejected (TS + Py).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (grep `PROGRAM_TCID`, `ACADEMIC_YEAR`, `mechanical_engineering_2027`, `2026` across `scripts/`, `app/` and remove import-time ME resolution; leave ME as CLI default only).
- [ ] **Step 4:** Full gates + `npm run build:board` diff empty.
- [ ] **Step 5:** Commit `refactor(degrees): no ME defaults at import; registry validates families and ids`.

### Task 2: `degree.py init`

**Files:**
- Modify: `scripts/degree.py`, `app/degrees/registry.py` (`add_program(entry) -> None`, writes programs.json keeping order)
- Create: `app/degrees/scaffold.py`
- Test: `tests/test_degree_init.py` (fixture: `tests/fixtures/tau_program_index_fixture.json`, trimmed real index payload)

**Interfaces:**
- Consumes: `search_program_index`, `find_unique_program` (`app/scraping/tau_program_scraper.py`), `collect_evidence`, `write_spec`.
- Produces: `python scripts/degree.py init --institution tau --title-he "<official title>" --level <degree level> --school <school code> --shana <year> [--base <slug>] [--track-he <text>]` →
  - resolves the program via the index (fails listing candidates on 0 or >1 matches);
  - appends a registry entry `status: "draft"`, `id = <base>_<shana+1>`, `sourceYear = shana`, `sourceIds.tcid` from the index, names from the index, `familyId = base`, `isFamilyDefault: true`, `capabilities: []`, `boardJsonFile: "<base>_semester_board_<shana+1>.json"`;
  - writes `data/degrees/<inst>/<base>/<year>/spec.json` skeleton (`total_required_credits: 0`, empty lists, `coverage: {}`, `catalog_year_policy` from the institution default);
  - runs `evidence --live` and prints counts by kind.
  - `scaffold.new_spec(entry) -> DegreeSpec`, `scaffold.registry_entry(index_entry, shana, base, track_he) -> ProgramEntry`.

- [ ] **Step 1: Write tests:** `test_init_writes_draft_entry_and_skeleton` (fixture index, monkeypatched evidence), `test_init_refuses_ambiguous_program` (two matches → exit 2, both titles printed), `test_init_refuses_existing_id`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full gates.
- [ ] **Step 5:** Commit `feat(degrees): degree.py init scaffolds a draft degree from the official index`.

### Task 3: `degree.py todo` (the coverage worklist)

**Files:**
- Modify: `scripts/degree.py`, `app/degrees/coverage_suggest.py`
- Test: `tests/test_degree_todo.py`

**Interfaces:**
- Produces: `python scripts/degree.py todo --program <id> [--apply-suggestions]` → loads committed `evidence.json` + spec; with `--apply-suggestions` writes `suggest_coverage` results into the spec first; prints every still-unaccounted item grouped by `kind` then `path`, each with id, `source_url`, and stripped `raw_text` (Hebrew, untruncated); prints stale coverage keys; exit 0 when nothing is left. Also writes the same list to `data/degrees/.../todo.md` (gitignored) for the skill to read in one file.

- [ ] **Step 1: Write tests:** worklist lists exactly the unaccounted ids; `--apply-suggestions` is idempotent; exit codes.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full gates.
- [ ] **Step 5:** Commit `feat(degrees): degree.py todo prints the coverage worklist`.

### Task 4: `degree.py publish`

**Files:**
- Modify: `scripts/degree.py`, `app/degrees/registry.py` (`set_status(program_id, status)`)
- Test: `tests/test_degree_publish.py`

**Interfaces:**
- Produces: `python scripts/degree.py publish --program <id>` → runs `check --live` in-process; any failing or skipped check → exit 1 listing them; on pass: `build` into `data/`, set registry `status: "live"`, write the release note `data/degrees/.../RELEASE.md` (item counts, check summary, sources with fetch times), and print — not run — the owner's two commands: the DB board sync (`ENV_FILE=.env.local node scripts/update-board-json.mjs <base> <year> data/boards/<id>.json`) and "open a PR + deploy". Refuses for an already-`live` degree unless `--update` (that path is Plan 3's impact flow; until then `--update` exits 1 with "impact analysis not built yet").

- [ ] **Step 1: Write tests:** `test_publish_refuses_unless_live_check_passes` (monkeypatched check results incl. one SKIPPED), `test_publish_flips_status_and_prints_commands`, `test_publish_refuses_live_degree_update_until_plan_3`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full gates.
- [ ] **Step 5:** Commit `feat(degrees): degree.py publish gated on a full live check`.

### Task 5: Drafts are never served

**Files:**
- Modify: `api/ai/board_loader.ts` (or `api/board.ts` entry point — whichever resolves a program id first), `api/ai/course_catalog.ts`
- Test: `tests/api/board.test.ts`, `tests/api/course_catalog.test.ts`

**Interfaces:**
- Produces: board/catalog loads for a registry id with `status: "draft"` return the same not-found result as an unknown id; ids not in the registry (test boards under `data/boards/test_program_*`) keep working.

- [ ] **Step 1: Write tests:** draft id → not found; live id → served; unregistered test board → served.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full gates.
- [ ] **Step 5:** Commit `fix(api): draft degrees are not served`.

### Task 6: The `add-degree` skill

**Files:**
- Create: `.claude/skills/add-degree/SKILL.md`, `.claude/skills/add-degree/reference.md`

**Content (exact sections):**
- **When to use:** "add <degree> at <university>", "refresh <degree>", "is <degree> up to date".
- **Inputs to confirm with the owner first:** official degree title, institution, track (if any), academic year. Nothing else is asked; everything else comes from sources.
- **New university:** stop and say an adapter is needed (`app/degrees/adapters/<inst>.py` emitting `EvidenceItem`s + an institutions.json entry); that is a code PR, not a skill run.
- **Steps:** `init` → `todo --apply-suggestions` → read every worklist item's raw text and map it (`mapped_to` a spec path, or `not_planning_rule` with a reason that names what the text says, or a `course_rules` entry, or a `known_gaps` entry for any document not actually read) → `refresh` → `build` → `check --live` → repeat until green → `publish`.
- **Hard rules:** never mark something `not_planning_rule` because it wasn't read; never set `enforced_by: "board"` without citing the board field; never edit committed boards by hand; never run the DB sync or a prod deploy — print the commands; record every disagreement between sources in `source_conflicts`.
- **Report to the owner:** sources read with fetch times, item counts by kind, mapped / not-a-rule (with reasons grouped) / rules / gaps, check results, the commands to run.
- `reference.md`: id scheme, spec path syntax, TAU conventions (year code, timetable `semkvutza` digits, empty legal-semester list = unknown, list-shaped `hearakurs`/`idkunkurs`), where files live, and the ME run as a worked example (584 items: 330 suggested / 119 hand / 13 rules / 122 not-a-rule).

- [ ] **Step 1:** Write the two files.
- [ ] **Step 2: Dry run:** follow the skill end to end on a scratch copy against the cached ME data with a fake `draft` id cloned from ME (`--offline` where possible) and confirm every command it names exists with the flags it uses; fix the skill text where it doesn't.
- [ ] **Step 3:** Commit `docs(skills): add-degree skill`.

## Not in this plan

- Plan 3: versioned releases, saved-plan pinning, impact analysis, in-site notice + keep/apply + email (`publish --update` stays refused until then).
- Plan 4: scheduled live re-check, GitHub issue + email alerts.
- PDF adapter for regulation/ידיעון documents (today they become `known_gaps`).
- Planner support for the six unenforced ME rules.

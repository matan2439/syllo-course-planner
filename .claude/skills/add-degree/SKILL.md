---
name: add-degree
description: Adds and refreshes university degrees in Syllo's editable student planner using official sources and scripts/degree.py. Use when the owner asks to add a degree or university, refresh a degree, update a catalog year, or check whether a degree is up to date.
---

# add-degree

Uses `scripts/degree.py` to turn official evidence into a reviewed `spec.json` and generated
boards, then verifies the degree through the editable planner before publication.
Every requirement comes from a source you actually read. Reference material (id scheme, spec
path syntax, TAU conventions, file locations, the Mechanical Engineering worked example):
[reference.md](reference.md).

Run everything from the repo root. Read `python scripts/degree.py --help` once per session;
it is the source of truth for flags.

## When to use

- "add <degree> at <university>" -> **Add a degree** below.
- "refresh <degree>" / "update <degree>" -> **Refresh a degree** below.
- "is <degree> up to date" -> **Is it up to date** below.

## Carry the degree through to the requested outcome

The goal is full editable planner parity and, when authorized, release after all checks
pass. Continue through evidence collection, missing adapter or validator implementation,
generated boards, and deployed preview verification within the owner's scope. A draft is
an intermediate state while resolving gaps. If a gap requires unavailable evidence or an
owner decision, report the concrete blocker and continue independent work.

Read linked faculty regulations and map their evidence alongside the program text.
Unread sources remain `known_gaps`; unsupported rules remain `enforced_by: "none"`.
Resolve those gaps through source review and implementation. Preserve coverage,
freshness, rule enforcement and other release gates throughout. Follow existing
authorization for publication, commits and deployment without repeating permission
prompts. Ask when a necessary action exceeds that authorization or an unresolved choice
materially affects the degree. Preserve reviewable work when blocked.

## Resolve the degree identity

For a batch, keep an inventory of institution, official title, track, year and program id
for each requested degree. Resolve unambiguous identities from official sources and use
the owner's established defaults; ask only when several programs match or the year is
unclear. Process each degree through its own evidence, spec, build and check. Fetch shared
documents once per run and reuse their evidence without claiming a second fresh download.
Review copied rule interpretations for applicability to each degree. Keep a per-degree
result so one unresolved program does not hide successful or blocked siblings.

Resolve these four from the request, session context and official sources. Ask only for
information that remains ambiguous:

1. the official degree title (Hebrew, as the institution publishes it),
2. the institution,
3. the track, if any,
4. the academic year (e.g. 2026-2027 = תשפ"ז).

State the two derived names so the owner can correct them: `--name-en` (the program's
official English name, or a plain translation you say you chose) and `--base` (a snake_case
slug of the English name; it becomes the registry id
`<base>_<shana+1>` and every file path, so it is hard to change later).

Derive the rest yourself and state it in the report: TAU year code `--shana` = the year the
academic year starts (2026-2027 -> `2026`; the registry id ends in `shana + 1`, here `2027`);
`--level` from the degree (bachelor `1`, master `2`); `--school` and the `tcid` from the
official index (see step 1).

## Degree length: set `degree_years`

Degree length is data: `spec.json` `degree_years` (3..6, default 4). Set it from the program
page's year sections (שנה א' .. שנה ה': the last year section the program lists is N; a
section like "שנים ג'+ד'" covers both years). The boards follow it: the early window board is
always Years 1-2, the program board Years 3..N (N=3: Year 3 only; N=5: Years 3-5). Map the
year-section item(s) that set it to `{"mapped_to": "degree_years"}`.

Cross-check it with the regulations' duration sentence (e.g. "8 semesters"): map that sentence
to a `study_duration` course rule whose `params.semesters` / `params.years` state the length —
`check` fails `degree_length` when they disagree with `degree_years`. When the two official
sources really differ, keep `degree_years` from the program page, record a `source_conflicts`
entry naming both item ids (the rule's `source_ids` among them), and report the decision needed
from the owner. The disputed requirement keeps `degree_length` red until the owner rules which source
governs. The conflict entry does not turn the check green; the problem text names the rule and
the conflict so the owner sees the decision. Never edit the rule's params (or `degree_years`) to
make them agree. Example: the program page lists years א'-ד' but the regulations say 9 semesters
(4.5 years) for this program — `degree_years` is whole years, so 4.5 cannot be expressed yet
either; it stays red ("says 9 semesters (not whole years ...)") and goes to the owner.

`build` refuses (exit 2, "refusing to build ... outside the degree's years 1-N") and `check`
fails `degree_length` when a mandatory course's year is outside 1..N. A year with no mandatory
course (e.g. an electives-only final year) is fine. Never move courses to another year to get
past a refusal: fix the course's year or `degree_years` from the official page.

## New university

When adding a university requires pipeline support, implement its adapter within the
authorized task. Provide `app/degrees/adapters/<inst>.py` emitting `EvidenceItem`s, the
official program-index integration for `init`, and an `institutions.json` entry. Adapt
institution-specific identities, academic years, prerequisites, offerings and general
requirements from that university's sources. Verify the normal CLI and editable planner
paths. If the owner limited the task to data or documentation, report the specific code
work needed and complete the permitted work. A missing adapter is an implementation gap.

## Add a degree

1. **init** (needs the network; it is the only way to create a draft):

   ```bash
   python scripts/degree.py init --institution tau --title-he "<official title>" --level 1 \
     --school <betsefer> --shana <year> --name-en "<English name>" [--base <slug>] [--track-he "<track>"]
   ```

   If you do not know `--school`, run it once with your best guess: on zero or several matches it
   writes nothing and prints the title-matching candidates (tcid, title, level, school, year);
   rerun with the right values. It appends a `draft` registry entry `<base>_<shana+1>`, writes an
   empty `spec.json`, then collects evidence live. Resolve refusals through the supported
   path or implement missing support within scope:
   - the year is not the current catalog year (the index serves only the current year),
   - the family already exists (a new year of an existing degree: init cannot add it yet; see
     reference.md "New year of an existing degree"),
   - the id or spec already exists.

   Resume an existing matching degree instead of creating a duplicate. Preserve family
   and year invariants when extending init. Report unsupported catalog access or a
   required owner choice while continuing work that does not depend on it.

   Re-collect evidence later with `python scripts/degree.py evidence --program <id> --live`
   (`--offline` replays the cache).

2. **Write the structure from the evidence.** Run `python scripts/degree.py todo --program <id>`
   and read `todo.md` (beside `evidence.json`). From the `program_text`, `section`, `rule_text`
   and `course_listing` items, fill in `spec.json`: `total_required_credits`, `degree_years`
   (Degree length above), `mandatory_courses` (every year), `categories` (+ `group`, `min_courses`/`min_credits`),
   `group_minimums`, `general_requirement` (incl. `credits_required` when stated; where its
   `course_ids` come from: below). Leave `coverage` alone for now. Suggestions in step 3 only work once the courses have a home here:
   on the empty skeleton `--apply-suggestions` applies 0 entries.

   **`general_requirement`** (TAU: the שער רוח requirement, `data/config/institutions.json`
   `generalRequirement`). Only its rule comes from this program's evidence: whether it applies,
   `min_courses`, `credits_required`, any note. The course list is NOT in the program's sources
   (TAU publishes it on the שער רוח site); take `course_ids` from
   `data/general_courses_shaar_ruach.json` (`courses[].course_id`, in file order) — the same 88
   ids ME's spec carries (migrated from its legacy program; identical to that file). Use
   `category_id: "shaar_ruach"` and `name_he: "קורסי שער רוח"`. `refresh --apply` keeps that
   catalog in step with the official facts (offerings of every listed course) and `build`
   copies its BIDIT schedule onto the board; refresh fetches facts for the general pool too.
   If the program has no general requirement (the evidence states none, or an exemption),
   set `general_requirement` to `null` and map the item(s) that say so (or record a
   `known_gaps` entry if the answer is in a document you did not read) — never copy ME's.

3. **todo --reuse-from --apply-suggestions**:

   ```bash
   python scripts/degree.py todo --program <id> [--reuse-from <other-id>] --apply-suggestions
   ```

   Both write coverage entries into `spec.json` and never overwrite (rerunning applies 0). It
   exits 1 while anything is open, 0 when the worklist is empty.

   **`--reuse-from <other-id>`** (runs first) — when another degree already mapped a document
   this one shares. TAU engineering: the faculty regulations PDF Terms_BA.pdf
   (`pdf:b6a7c762f8db:*`, 364 items) is fully mapped in `mechanical_engineering_2027`, so pass
   `--reuse-from mechanical_engineering_2027`. It copies the other degree's entry for an evidence
   id both share with identical `raw_text`, into ids not yet covered here, only when every target
   resolves in THIS spec. It never copies course items of a course this spec places (suggestions
   own those). Two lists in `todo.md`, both yours to act on:
   - **"reused from <other> (verify)"** — every copied entry. Read each against its text and fix
     what does not hold here: reasons naming the other program (e.g. ME's "read as the
     `tau:8715:...` items" pointer) and program-specific sentences (the 9-semester exception
     names specific programs). Copied is not reviewed.
   - **"needs review"** — not written: a target is missing here (typically the other degree's
     `course_rules[...]`). Write this degree's own rule (or other entry) from the text; the
     other degree's entry is a hint, not the answer.

   Retire an `unread-regulations-pdf` known gap only once every item of that document is mapped.

   **`--apply-suggestions`** writes the unambiguous entries:
   - a course item (`course_listing`, timetable/IMS `course_fact`) of a course held in exactly
     one spec place -> that place;
   - a course held in several places: a listing -> the category whose `name_he` equals the
     section it is listed under (only the LAST path element, or a repeated section's `also_at`
     location, is compared; none or several match -> left for you, e.g. "מעבדה מתקדמת מסלול X"
     under "מעבדות מתקדמות"); a fact -> `mandatory_courses[...]` if mandatory, else the list of
     all its homes;
   - a "קורס ליבה (ב)מסלול X" course note (`data.core_of_track`, track names verbatim, typos
     kept) -> `course_rules[<rule>]` when exactly one `distinct_categories` rule lists the course.

   Sections are suggested only through the ME-only `legacy` block, so a new degree maps its
   sections by hand.

4. **Map every remaining worklist item by hand.** Read each item's `text` in `todo.md` (the raw
   official text) and add exactly one of these to `spec.json`:
   - `"<item id>": {"mapped_to": "<spec path>"}` — the spec already holds what the text says
     (path syntax in reference.md; it must resolve or todo reports "unresolved mapping").
     When one item states several rules (a PDF sentence with both the pass and the fail grade, a
     hesber with the total and the English rule), use a list:
     `{"mapped_to": ["total_required_credits", "course_rules[english-two-courses]"]}` — every
     target must resolve (todo prints the targets and names the unresolved ones);
   - a `course_rules` entry (rule_id, kind, course_ids, params, source_ids = the item ids,
     `enforced_by`, note) plus `{"mapped_to": "course_rules[<rule_id>]"}` — a course-level rule
     the generic fields cannot hold;
   - a `known_gaps` entry plus `{"mapped_to": "known_gaps[<gap_id>]"}` — the item points at a
     document you did not actually read (e.g. a regulations PDF);
   - `{"not_planning_rule": "<reason>"}` — the text is not a planning rule; the reason says
     what the text says (e.g. "Link to a previous year's booklet (archive)").

   A `pdf:<doc>:unread-page-<n>` item (`data.unread`: a page with no text layer) can only go to
   `known_gaps` (in a list, every target must be a `known_gaps[...]`): any other entry is
   reported as `(unread page not in known_gaps)` by `todo` and fails `coverage`.

   A regulations PDF already mapped in another degree: use `--reuse-from` (step 3), not a hand
   copy of its entries.

   Where two sources disagree (program page vs. timetable vs. IMS, or two sections), add a
   `source_conflicts` entry naming the item ids. Rerun `todo` until it prints
   `0 unaccounted ... 0 stale keys` and exits 0. The header count includes items flagged
   `(unresolved mapping)` (the path names nothing in the spec) and `(blank reason)`; keys under
   "stale coverage keys" name no evidence item — delete them.

5. **refresh** — official course facts for every course the spec references:

   ```bash
   python scripts/degree.py refresh --program <id> --live
   ```

   It writes `data/official/tau_course_facts_<shana>.json` and the mismatch report
   `data/import_reports/course_data_review_<shana>.md`; it never writes boards. It prints a JSON
   summary: `spec_courses_missing_facts` must be `[]` (else `courses_known`/`totals` fail);
   read the report for mismatch rows (0 before the first build: there are no boards yet).

   **Collect the prerequisite graph before claiming validation readiness.** Follow the
   actual IMS prerequisite links for every relevant course, group and term, including
   the early-year courses that satisfy later prerequisites. Preserve nested AND/OR
   expressions, concurrent requirements and source provenance. A flat list of ids or a
   stored link alone cannot establish prerequisite semantics. Distinguish an explicit
   official statement of no prerequisites from a source that has not been read. Verify
   that identified early-year completions are recognized in the later window without
   duplicate credit. See reference.md, "Prerequisite graph and completion recognition".

6. **build** — the boards, generated (the only way boards are written):

   ```bash
   python scripts/degree.py build --program <id>
   ```

   No mode flag = use the caches, fetch only what is missing (course pages, syllabi). `--offline`
   never touches the network (a rebuild of a fully cached degree); `--live` re-fetches every
   source and rewrites the facts snapshot first (publish does this itself). Writes
   `data/parsed_json/<boardJsonFile>`, `data/boards/<id>.json`,
   `data/boards/<base>_years_1_2_<year>.json` and `data/config/early_year_courses.json`.

   If the degree has a `curation.json` overlay, the build fails closed with
   `StaleCurationError ... diverged: written against X, the build now produces Y` when official
   data moved under an entry: review the new value, then update the entry's `built` or retire
   the entry — never mask the new value silently.

7. **check --live**:

   ```bash
   python scripts/degree.py check --program <id> --live
   ```

   Report: `data/import_reports/degree_check_<id>.md`; exit 0 only when every check passes.
   `--offline` is fine for iterating but always fails (freshness SKIPPED). Fix the spec for each
   FAIL and go back to the step it points at (coverage -> 4, courses_known/totals/
   mandatory_offered -> 2 or 5). `plannable` = board-audit errors in the built board (e.g.
   `annual_not_represented`, `hours_mismatch`): fix the spec, or add a durable `curation.json`
   entry (`retire: null`, a reason citing the source; format in reference.md), then rebuild —
   never edit the board. `rules_enforced`, `board_carries_requirements` and `known_gaps`
   cannot be fixed by editing them away. Implement missing support within scope and
   report evidence or decision blockers (see Hard rules).
   Generic group minima such as EE's `track: 12` are supported; verify the emitted minimum
   and exact candidate identities. `board_carries_requirements` still fails for dropped
   requirements, a category `min_credits` without enforcement, and a
   `general_requirement.credits_required` that is not
   `min_courses` x the institution's `creditsPerCourse` (causes in reference.md).

8. **Repeat 4-7 until check --live is green.**

9. **publish** (when check --live and the editable preview verification below passed,
   and publication is authorized):

   ```bash
   python scripts/degree.py publish --program <id>
   ```

   It refuses anything not `draft`. It builds live into `data/`, then rebuilds every OTHER
   live degree `--offline` into a scratch dir and refuses (exit 1, registry unchanged, listing
   degree, files and courses) if any of their committed boards would change — the refreshed
   official facts are course-wide; report that to the owner, never commit the other degree's
   diff alongside. The fix: `python scripts/degree.py refresh --program <other> --live --apply`,
   review and commit that degree's diff on its own, then run publish again. Expect this often
   until ME is refreshed against current TAU data.
   Then a full live check: any FAIL or SKIPPED refuses (registry unchanged).
   On success it writes `RELEASE.md` beside `spec.json`, sets the registry status to `live`,
   rewrites the early-year index (now including the degree), and PRINTS the owner steps (DB
   board sync — 0 rows = not seeded yet; the board is served from the committed file after
   deploy — and "commit, open a PR, deploy"). Execute the authorized remaining release
   steps after preview verification and passing checks. Report any steps outside the
   owner's authorization.

## Refresh a degree

For a degree already in the registry:

```bash
python scripts/degree.py evidence --program <id> --live
python scripts/degree.py todo     --program <id> --apply-suggestions   # map new items (step 4)
python scripts/degree.py refresh  --program <id> --live --apply        # facts, then build into data/
python scripts/degree.py check    --program <id> --live
```

New or changed official text shows up as unaccounted items and stale keys in `todo`; map them
as in step 4 and delete the stale keys. A shared document another degree already mapped:
`todo --reuse-from <other-id>` (step 3), then verify every copied entry.

`refresh --apply` is the board write path (curation
overlay, byte-stable writer); `refresh --apply --syllabi` is accepted for compatibility (build
always rebuilds stale syllabus summaries). Review `git diff data/`. A `draft` degree then goes through
`publish`; a `live` degree cannot be republished yet (`publish` refuses; `--update` is not
built) — hand the owner the diff and the commands to run.

## Is it up to date

```bash
python scripts/degree.py check --program <id> --live
```

It changes nothing but the report file. Answer with the check summary: coverage problems or
stale keys mean the official program text changed (offer **Refresh a degree**); freshness
must pass. Course-fact drift (semesters, credits, hours) shows in
`python scripts/degree.py refresh --program <id> --live` (no `--apply`: it rewrites only the
facts snapshot and the mismatch report; show `git diff data/official/` and the mismatch rows).

## Hard rules

- Never mark an item `not_planning_rule` because you did not read it (or its linked
  document). Unread = a `known_gaps` entry.
- Never set `enforced_by: "board"` unless the note cites the board field that encodes the rule
  (e.g. `is_annual=true, spans_semesters=[...]` in `data/boards/<id>.json`) and you checked that
  field in THIS degree's built board and its applicable validator paths. Verify that a
  release check catches loss or widening of required generated data; otherwise `"none"`.
  (ME's annual rule is encoded only via
  its `curation.json`; a copy of its spec without that overlay is not.)
- Never edit committed boards (`data/boards/`, `data/parsed_json/`,
  `data/config/early_year_courses.json`) by hand: change the spec / `curation.json` and rebuild.
- Run database sync and deployment only when the owner explicitly authorizes publication
  (including standing authorization in this chat), all release checks pass, and the
  target project is verified. Otherwise print the commands. Deploy a preview first,
  verify the degree and saved-copy workflow, then release the tested revision and
  verify the live domain. Academic publication requires a passing live check. An owner
  may explicitly authorize a public editable draft, as with the initial EE release.
  In that case use the registry's `publicPlanner` flag, retain draft status and display
  the validation notice. Never use this exception as the default for a new degree.
- Record every disagreement between sources in `source_conflicts`; never resolve it silently.
- Never delete a `known_gaps` or `course_rules` entry to make check pass, and never delete or
  weaken a requirement (a group minimum, a category, `min_credits`, `credits_required`) to pass
  `board_carries_requirements`. Implement the missing enforcement within scope or report
  the concrete blocker.
- Entries copied by `--reuse-from` are unreviewed until you read each one against its text.
- `degree_years` comes from the program page's year sections; a different length in the
  regulations is a `source_conflicts` entry plus a report to the owner (`degree_length`
  stays red until they rule), never a silent override or bent rule params. Never
  re-year courses to fit.
- A red run stays on a separate branch unless the owner explicitly authorizes the public
  editable draft exception above.

## Verify the student experience before release

Use the same rule definitions, exact course identities and reported student facts in the
UI, backend validator, AI candidate gate and proposal application. Test valid, invalid and
missing-evidence cases through those entry points. Conditional facts include intake,
grades, prior study and university decisions. Record decisions as student-reported,
rule-specific approval or refusal with a cited reference; Syllo does not grant faculty
approval. Missing or conflicting evidence requires targeted review when the rule applies.
See reference.md, "Conditional student facts and EE rule lessons".

Preserve the owner's accepted literal `05124506` self-reference. Require clarification
when that course is selected and allow the rule to pass when absent. Preserve its source
conflict and verify the exact definition in both board windows. Never infer `0512-4507`.
For advanced labs, the conditional third lab's exclusion from theoretical-course credit
still requires verified allocation across every credit and completion path. Keep that
case unresolved until the accounting is implemented and tested.

Adding a degree is complete only after a deployed preview has been checked with the
degree's real data IN THE EXISTING EDITABLE STUDENT PLANNER. A standalone course catalog,
rules page, explorer or read-only semester layout does not satisfy this outcome. The
degree must open through the ordinary program picker into the same workspace used by
Mechanical Engineering. Check both year windows, course names and hours, every track's
course membership, core markings, requirements progress, and weekly group choices.
Use the live TAU Electrical Engineering planner as the reference for this experience.
Assign a distinct accent to each track and use it consistently in the repository, course
cards, progress indicators, and legend. Derive legend labels and membership from the
selected degree's catalog. Open the legend in both year windows and the whole-degree
view. Verify it also updates when switching degrees, with no inherited ME track labels.
Show the same `כללי התואר` panel for every degree, including ME, with the selected
degree's hours, course minima, and any additional checks.
Add, move and remove courses, mark completed studies, and verify AI proposals and their
application use this degree's catalog and rules. Never substitute another degree's data.
Save two different course copies, switch both ways, reload, and verify that each copy
retains its courses and weekly choices. An unfinished draft must remain accessible:
academic warnings must not become a gate on restoring the student's own saved copy.
Owner authorization, version conflicts and malformed content remain blocking checks.

Run the save and reload check against the deployed preview using a fresh test session.
Open both windows from the normal picker. Create two alternatives with distinct course
placements and weekly choices, switch from the first to the second and back, then reload
and reopen both. Also open the Mechanical Engineering workspace in the same session and
verify that neither degree's test copies appear under the other program. Inspect failed
save or restore responses and check the preview database schema when a response reports
a storage error. Local tests with an in-memory store cannot verify deployed persistence.
Check that saved workspaces use the accounts database (`DATABASE_URL`, where the
workspace tables reference `auth.users`). Planner board storage may use its separate
override. Verify both routes in the isolated environment before testing saved plans.
Treat any failed preview step as a release blocker.

Use `python scripts/smoke_editable_degree.py --help` for the deployed API smoke test.
Run it for each new board with two different course and weekly group choices and a
third course that can be added, moved and removed. The helper checks the exact Vercel
deployment is a ready preview and creates a fresh anonymous session. Verify the
program picker and planner controls in the browser as well.

When publication checks are red, keep the degree draft. An explicitly enabled editable
integration preview may exercise the ordinary planner and APIs with its own program id,
while explaining unresolved validation rules. On an isolated preview deployment, set
`NEXT_PUBLIC_EDITABLE_DEGREE_PREVIEWS` to the comma-separated registry ids to test in
both the build and runtime environment. Use the same path for one degree or a batch.
Keep the release gate and unsupported-rule
report intact. A read-only explorer can help inspect sources, but is not a delivered degree.
Record the actual planner URL and the interactions tested.

Before releasing without the validation notice, audit every rule in the current catalog
against the generated boards and the planner's actual validator. Test one valid and one
invalid case for each implemented rule, plus missing or conflicting evidence where it
can affect the result. Check manual edits, generated candidates and application of those
candidates. Ensure incomplete academic drafts can still be restored safely. A rule shown
in the panel or encoded in a board field only counts if its applicable validation paths
use it. Keep uncertain course identities, missing cohort or grade data, and university
approvals explicit. Remove the notice through normal publication after the live checks pass.

## Report to the owner

End every run with:

- **Sources read** with fetch times (from `RELEASE.md`, or the evidence `fetched_at` /
  `from_cache` per source URL).
- **Evidence item counts by kind** (as `evidence`/`init` print them).
- **Coverage**: mapped (auto-suggested vs. hand), not-a-rule with the reasons grouped (reason
  -> count), course rules (id, kind, enforced_by), known gaps, source conflicts.
- **Check results**: each check PASS/FAIL/SKIPPED with the failing problems.
- **Values you derived** (shana, level, school, tcid, name_en, base).
- **Release steps completed and pending**, including the tested preview revision, any
  concrete blockers and commands requiring further authorization.

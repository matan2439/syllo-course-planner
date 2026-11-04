---
name: add-degree
description: Drives Syllo's degree pipeline (scripts/degree.py) from official sources to a published board. Use when the owner says "add <degree> at <university>", "add a degree", "add a university", "refresh <degree>", "update <degree> for the new year", or asks "is <degree> up to date".
---

# add-degree

Turns an official degree into a Syllo board through `scripts/degree.py`: evidence from the
official sources -> a reviewed `spec.json` -> generated boards -> a live check -> publish.
Every requirement comes from a source you actually read. Reference material (id scheme, spec
path syntax, TAU conventions, file locations, the Mechanical Engineering worked example):
[reference.md](reference.md).

Run everything from the repo root. Read `python scripts/degree.py --help` once per session;
it is the source of truth for flags.

## When to use

- "add <degree> at <university>" -> **Add a degree** below.
- "refresh <degree>" / "update <degree>" -> **Refresh a degree** below.
- "is <degree> up to date" -> **Is it up to date** below.

## Tell the owner up front: expect a parked draft

Before step 1, say plainly: an honest run will most likely end **red**, as a parked draft,
not a published degree. The program page links the faculty regulations PDF; the `tau_pdf`
adapter reads it, so its sentences become `pdf:*` evidence items you map one by one like any
other item (hundreds of them: budget for it). A page or document that was not read (fetch
failed, a scanned page with no text layer, a document the adapter does not follow) is still a
known gap: a `known_gaps` entry, and `known_gaps` fails until it is read. Course rules the
board cannot encode (`enforced_by: "none"`) fail `rules_enforced`. Neither is fixed by editing
entries away (Hard rules). A green check is the exception until the board enforces those rules.

What to do with a parked draft — ask the owner, recommending the default:

- **Default (recommended): commit it on a separate branch / draft PR, and do not merge it to
  `main` until it is publishable.** The branch keeps the spec, coverage map, evidence and
  built boards reviewable and resumable. Even if it reached `main`, a draft is never served:
  its boards — the `<base>_years_1_2_<year>` window board included — return 404, and it is
  kept out of `data/config/early_year_courses.json` (the frontend bundle).
- Or don't commit it: leave the files untracked (or discard them) and rerun later.

## Inputs to confirm with the owner first

Confirm exactly these four, then ask nothing else (everything else comes from the sources):

1. the official degree title (Hebrew, as the institution publishes it),
2. the institution,
3. the track, if any,
4. the academic year (e.g. 2026-2027 = תשפ"ז).

In the same message, propose the two names the sources cannot give and let the owner correct
them: `--name-en` (the program's official English name, or a plain translation you say you
chose) and `--base` (a snake_case slug of the English name; it becomes the registry id
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
entry naming both item ids (the rule's `source_ids` among them), and **stop and report it to the
owner**: the degree is a parked draft with `degree_length` red until the owner rules which source
governs. The conflict entry does not turn the check green; the problem text names the rule and
the conflict so the owner sees the decision. Never edit the rule's params (or `degree_years`) to
make them agree. Example: the program page lists years א'-ד' but the regulations say 9 semesters
(4.5 years) for this program — `degree_years` is whole years, so 4.5 cannot be expressed yet
either; it stays red ("says 9 semesters (not whole years ...)") and goes to the owner.

`build` refuses (exit 2, "refusing to build ... outside the degree's years 1-N") and `check`
fails `degree_length` when a mandatory course's year is outside 1..N. A year with no mandatory
course (e.g. an electives-only final year) is fine. Never move courses to another year to get
past a refusal: fix the course's year or `degree_years` from the official page.

## New university: stop

If the institution has no entry in `data/config/institutions.json` (today only `tau`), stop and
tell the owner: an adapter is needed first — `app/degrees/adapters/<inst>.py` emitting
`EvidenceItem`s (and a program index for `init`) plus an `institutions.json` entry. That is a
code PR, not a skill run. `init --institution <other>` refuses with the same message.

## Add a degree

1. **init** (needs the network; it is the only way to create a draft):

   ```bash
   python scripts/degree.py init --institution tau --title-he "<official title>" --level 1 \
     --school <betsefer> --shana <year> --name-en "<English name>" [--base <slug>] [--track-he "<track>"]
   ```

   If you do not know `--school`, run it once with your best guess: on zero or several matches it
   writes nothing and prints the title-matching candidates (tcid, title, level, school, year);
   rerun with the right values. It appends a `draft` registry entry `<base>_<shana+1>`, writes an
   empty `spec.json`, then collects evidence live. Stop and tell the owner (do not work around it)
   when init refuses because:
   - the year is not the current catalog year (the index serves only the current year),
   - the family already exists (a new year of an existing degree: init cannot add it yet; see
     reference.md "New year of an existing degree"),
   - the id or spec already exists.

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

3. **todo --apply-suggestions**:

   ```bash
   python scripts/degree.py todo --program <id> --apply-suggestions
   ```

   It writes the unambiguous coverage entries and never overwrites (rerunning applies 0). In
   practice that is the course items (`course_listing`, timetable/IMS `course_fact`) of a course
   held in exactly one spec place; sections are suggested only through the ME-only `legacy`
   block, so a new degree maps its sections by hand. It exits 1 while anything is open, 0 when
   the worklist is empty.

4. **Map every remaining worklist item by hand.** Read each item's `text` in `todo.md` (the raw
   official text) and add exactly one of these to `spec.json`:
   - `"<item id>": {"mapped_to": "<spec path>"}` — the spec already holds what the text says
     (path syntax in reference.md; it must resolve or todo reports "unresolved mapping");
   - a `course_rules` entry (rule_id, kind, course_ids, params, source_ids = the item ids,
     `enforced_by`, note) plus `{"mapped_to": "course_rules[<rule_id>]"}` — a course-level rule
     the generic fields cannot hold;
   - a `known_gaps` entry plus `{"mapped_to": "known_gaps[<gap_id>]"}` — the item points at a
     document you did not actually read (e.g. a regulations PDF);
   - `{"not_planning_rule": "<reason>"}` — the text is not a planning rule; the reason says
     what the text says (e.g. "Link to a previous year's booklet (archive)").

   A `pdf:<doc>:unread-page-<n>` item (`data.unread`: a page with no text layer) can only go to
   `known_gaps`: any other entry is reported as `(unread page not in known_gaps)` by `todo` and
   fails `coverage`.

   A regulations PDF already mapped in another degree (same `pdf:<doc>:*` ids, e.g. ME's
   Terms_BA.pdf `b6a7c762f8db`): copy its coverage entries as a starting point, then review
   program-specific sentences (e.g. the 9-semester exception list names specific programs);
   retire an `unread-regulations-pdf` known gap only once every item of that document is
   mapped.

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
   never edit the board. `rules_enforced` and `known_gaps` cannot be fixed by editing them
   away: report them to the owner (see Hard rules).

8. **Repeat 4-7 until check --live is green.**

9. **publish** (only when check --live passed):

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
   deploy — and "commit, open a PR, deploy"). Do not run them; copy them into the report.

## Refresh a degree

For a degree already in the registry:

```bash
python scripts/degree.py evidence --program <id> --live
python scripts/degree.py todo     --program <id> --apply-suggestions   # map new items (step 4)
python scripts/degree.py refresh  --program <id> --live --apply        # facts, then build into data/
python scripts/degree.py check    --program <id> --live
```

New or changed official text shows up as unaccounted items and stale keys in `todo`; map them
as in step 4 and delete the stale keys.

A regulations PDF already mapped in another degree (same `pdf:<doc>:*` ids, e.g. ME's
Terms_BA.pdf `b6a7c762f8db`): copy its coverage entries as a starting point, then review
program-specific sentences (e.g. the 9-semester exception list names specific programs); retire
an `unread-regulations-pdf` known gap only once every item of that document is mapped.

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
  field in THIS degree's built board; otherwise `"none"`. (ME's annual rule is encoded only via
  its `curation.json`; a copy of its spec without that overlay is not.)
- Never edit committed boards (`data/boards/`, `data/parsed_json/`,
  `data/config/early_year_courses.json`) by hand: change the spec / `curation.json` and rebuild.
- Never run the DB sync, a deploy, or any `vercel`/prod command: print them for the owner.
- Record every disagreement between sources in `source_conflicts`; never resolve it silently.
- Never delete a `known_gaps` or `course_rules` entry to make check pass.
- `degree_years` comes from the program page's year sections; a different length in the
  regulations is a `source_conflicts` entry plus a report to the owner (the draft stays parked,
  `degree_length` red, until they rule), never a silent override or bent rule params. Never
  re-year courses to fit.
- A red run is a parked draft: commit it on a separate branch (default) or not at all; never
  merge a draft to `main` to "save" it.

## Report to the owner

End every run with:

- **Sources read** with fetch times (from `RELEASE.md`, or the evidence `fetched_at` /
  `from_cache` per source URL).
- **Evidence item counts by kind** (as `evidence`/`init` print them).
- **Coverage**: mapped (auto-suggested vs. hand), not-a-rule with the reasons grouped (reason
  -> count), course rules (id, kind, enforced_by), known gaps, source conflicts.
- **Check results**: each check PASS/FAIL/SKIPPED with the failing problems.
- **Values you derived** (shana, level, school, tcid, name_en, base).
- **The commands for the owner to run** (publish's printed steps, or commit/PR/sync/deploy).

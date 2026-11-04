# Degree & university onboarding — design

Date: 2026-11-03 · Status: draft for approval

## Intent

Today Syllo supports one degree: TAU Mechanical Engineering (תשפ"ז). The owner will repeatedly name a
new degree (and sometimes a new university) to add. Each addition must be fast, must not break the
existing site, and the data must stay as current as the university's published sites — forever, not
just on the day it was added.

Two things get built:

1. **A generic degree pipeline + registry** in the repo, so a degree is *data* (plus, for a new
   university, source adapters), never a copy of mechanical-engineering scripts.
2. **A Claude Code skill** (`.claude/skills/add-degree/`) that drives that pipeline when the owner
   says "add degree X at university Y": research every official source, fill the structured format,
   run the checks, publish.

## Goals

- Adding a TAU degree = run the skill; no planner/UI code changes.
- Adding a new university = one registry entry + its source adapters; everything downstream is shared.
- **Provable completeness:** every published official fact about a degree is either mapped to a
  structured rule or explicitly marked "seen, not a planning rule" with a reason. Unaccounted items
  fail the check. (Owner: "verify that *all* the requirement and degree facts were viewed and considered".)
- **Auto go-live:** when all checks pass, the degree (or an update to it) is published with no human
  review step.
- **Stays current:** live degrees are re-checked against the official sources on a schedule; course-fact
  changes flow through the same checks and publish automatically, rule changes alert the owner (see
  "Scheduled re-check").
- **Students are never harmed silently:** an update never changes a student's saved plan or saved
  structure without their consent, and affected students are told — in the site and by email.
- Mechanical Engineering is migrated onto the same pipeline and becomes its first customer.

## Non-goals

- Bulk-adding many degrees at once, or scraping universities nobody asked for.
- A UI for the owner to hand-edit requirements (fixes go through the pipeline/skill).
- Changing planner/solver logic. It already consumes `board_json` generically.
- Supporting a new board format beyond `syllo_board_v1` until a university actually needs one.

## Anti-goals (failure even if it "works")

- A degree goes live with a requirement silently missing because a page section wasn't read.
- A student opens their plan and finds courses moved/removed with no explanation.
- Adding degree N+1 requires editing mechanical-specific files, or a new degree breaks ME.
- "Up to date" checks that actually compare against stale cached pages (this happened: until
  2026-11-03 `refresh_course_data.py` never re-downloaded anything; `--live` was added).

## Current state (recon, 2026-11-03)

Already generic — build on these, don't replace:
- `data/config/institutions.json` + `shared/institutions.ts`: institution registry (credit unit,
  semester shape, general requirement such as שער רוח, source URLs, `programIdPattern`, `boardFormat`).
- `api/ai/program_provider.ts`: `ProgramProvider` per board format; DB first, `data/boards/<id>.json` fallback.
- Postgres `programs` / `program_versions` (keyed `program_id` + `academic_year`, holds `board_json`)
  / `course_categories` / `program_courses`; `board_json.metadata.board_data_version` hash.
- Saved student state is keyed by `owner + program_id` (`planner_boards`, `student_workspace_documents`, …).
- Program id convention `<base>_<year>`; `<institution>:` prefix already parsed for non-TAU.

Hard-wired to ME — to be generalized:
- Pipeline scripts named/pathed for ME 2027: `app/pipeline/generate_2027_board.py`,
  `enrich_mechanical_2027.py`, `verify_mechanical_2027_data.py`, `scripts/normalize_courses_mechanical_2027.py`,
  `scripts/supabase_normalize_mechanical_2027.py`, `scripts/refresh_course_data.py` (`PROGRAM_TCID`, `BOARDS` paths).
- Requirements source `data/programs/mechanical_engineering_2027_enriched.json` has ad-hoc ME-shaped keys.
- `web/lib/programs.ts`: hand-maintained program list (stale comment, separate from registry/DB).
- `api/ai/course_catalog.ts`: `loadMechanicalEngineering2027Catalog` — AI course catalog is ME-only.
- AI interest/capability ontology has only `mechanical_design` plus ME-flavored keyword lists.
- No application email sending exists (Resend SMTP is wired only for Supabase Auth emails).

## The design

### 1. Registry

- Institution entry (existing file) gains a `sources` block that names its **adapters** and a
  `catalogYearPolicy` default (see §6).
- New **degree registry** (`data/config/programs.json`, validated by zod like institutions): per degree —
  id, institution, names (he/en), track, available years, source identifiers (e.g. TAU `tcid`), status
  (`draft` / `live` / `archived`). This replaces `web/lib/programs.ts` as the single source; the UI
  reads it (or the DB mirror) instead of a hand-typed list.

### 2. Source adapters (per university)

An adapter fetches one kind of official source **live** (cache is only for offline/dev; checks always
run live) and emits **evidence items** in one shared format:

```
{ id, source_url, fetched_at, kind: section|rule_text|course_listing|course_fact|policy_text,
  path (e.g. program tree path), raw_text, structured_hint? }
```

TAU adapters (first): tochniot program tree (`ydtochnit`), program timetable (`ydmaarechet`),
IMS course search, course-detail/syllabus pages, PDF ידיעון when present, שער רוח source.
Other universities add their own adapters emitting the same items. Stable `id`s (section ids, course
codes, hash of normalized rule text) are required so diffs between runs are meaningful.

### 3. Structured degree spec (one format for every degree)

`data/degrees/<institution>/<degree>/<year>/spec.json`: total credits, categories (min/max credits,
course lists or list rules), mandatory courses, prerequisites, general requirement, track rules,
double-counting rules, catalog-year policy, plus **`coverage`**: a map from every evidence item id to
either `{mapped_to: <spec path>}` or `{not_planning_rule: <reason>}`. The board JSON
(`syllo_board_v1`) is *generated* from spec + course facts by one generic builder (the ME
`build_semester_board` path, generalized), never hand-edited.

### 4. Checks (all must pass to publish)

1. **Coverage:** every evidence item from this run appears in `coverage`. Any unaccounted item → fail,
   listing the items.
2. **Freshness:** evidence was fetched live in this run (fetched_at within the run), not from cache.
3. **Consistency:** category minimums reconcile with the published total; every referenced course
   exists with hours/credits/semesters; no double counting unless a rule allows it; mandatory courses
   are offered somewhere in the program span.
4. **Plannability:** the existing planner produces a valid full-degree plan on the generated board.
5. **Non-regression:** the full existing test suite still passes; other degrees' boards are byte-unchanged.
6. **Student impact** (updates only, §5): impact analysis ran successfully for every saved plan.

### 5. Publishing and updates

- A degree-year version is **immutable once live**. Any change creates a new version
  (`board_data_version` hash) — never an in-place edit.
- Every saved student plan records the version it was built on.
- When a new version passes checks, an **impact analysis** runs per saved plan on that degree-year:
  removed/renamed course, offering semester changed, credits/hours changed, category membership changed,
  requirement totals changed.
  - No impact → the plan moves to the new version silently.
  - Impact → the plan **stays pinned to its old version**; the student gets an in-site notice and an
    email ("TAU updated X; here is how it affects your plan") with *apply update* / *keep my plan*.
    Applying shows the concrete diff before it changes anything.
- If impact analysis cannot run, the version does not publish.
- **Scheduled re-check** of every live degree (my call: weekly, plus daily in the 4 weeks around
  semester registration/bidding), via a scheduled CI job running the adapters live.

### 6. Catalog-year policy

Which year's requirements bind a student "depends" (owner). So it is researched per degree and stored
in the spec (`catalogYearPolicy`: e.g. bound to start year / may opt into newer / always latest), with
the institution default as fallback. The site lets a student choose their requirements year when the
policy allows a choice. A new academic year's version is a new degree-year, not an update of the old one.

### 7. The skill (`add-degree`)

Invocation: "add <degree> at <university>" (and "refresh <degree>"). Steps it drives:
1. Resolve or create the institution entry; if the university is new, write its adapters (code PR).
2. Run adapters live → evidence items.
3. Draft/extend `spec.json` and its `coverage` map (AI reads every evidence item; the checker, not the
   AI, decides completeness).
4. Build board, run all checks; iterate until they pass or report what blocks.
5. Publish (§8). Write a short report: sources read, item counts, rules mapped, items marked
   not-a-rule with reasons, check results.

The skill also documents the conventions (ids, file layout, TAU year code = starting calendar year,
empty legal-semester list means "unknown") so each run doesn't rediscover them.

### 8. How "go live" happens (my call; scheduled-job path per owner decision below)

Data-only changes (new version of an existing degree, or a new TAU degree that needs no new code)
publish by writing the version to Postgres `program_versions` + committing the spec/board files —
no code deploy needed, because the API reads the DB first. Changes that need code (a new university's
adapters, schema changes) go through a normal PR + deploy.

## Migration of Mechanical Engineering

ME 2027 is re-expressed as the first `spec.json` with full coverage, generated through the generic
builder. Acceptance: the generated board is equivalent to today's `data/boards/mechanical_engineering_2027.json`
(differences are explained or are real TAU changes), and all existing tests pass. Then the ME-named
scripts are retired, `web/lib/programs.ts` and `course_catalog.ts` read from the registry, and the
capability ontology is made per-degree (ME keeps `mechanical_design`).

## Calls made by the designer (not owner decisions — owner may override)

- **Versioning storage:** `program_versions` stays `UNIQUE (program_id, academic_year)` as the
  *current* pointer; a new append-only `program_version_releases` table holds every published board
  by `board_data_version`. Saved plans reference a release id; the API can serve a pinned release.
- **Guests** (no email) get the in-site notice only. Update emails are transactional (about the
  student's own saved plan) but still carry an unsubscribe link and respect it.
- **Unexpressible rule:** if a published rule can't be represented in `syllo_board_v1`/the planner,
  the degree **does not go live**; the skill reports it as a format/planner extension task. Never
  "live with the rule not enforced" — that is the silent-miss anti-goal.
- **First build scope, in order:** (1) generic pipeline + registry + adapters + checks, (2) ME
  migration, (3) skill, (4) versioned releases + impact analysis + in-site notice + keep/apply screen +
  email. Auto-publishing of *updates to live degrees* stays off until (4) ships; new degrees can go
  live after (3).
- **ME migration acceptance:** the generic builder must reproduce today's ME board exactly (modulo
  key order / generated timestamps). Real TAU changes found along the way land afterwards as a
  normal update through the impact flow.
- **AI per degree:** code accepts a per-degree catalog and capability ontology; the skill drafts the
  ontology for each new degree from its courses. It is not a publish gate.

## Scheduled re-check: who handles changes (owner decision, 2026-11-03)

- **Course-fact changes** (hours, credits, offered semesters, names, syllabus links for courses already
  mapped) are applied mechanically by the scheduled job and publish automatically once all checks pass.
  No LLM runs in CI.
- **Anything needing interpretation** (a new/removed/reworded rule or section, a new course listing,
  any evidence item without an existing mapping) → the job does **not** publish; it alerts the owner
  (designer's call: a GitHub issue listing the unmapped items with source links, plus an email), and
  the owner runs the skill ("refresh <degree>") locally.
- Production publish credentials in CI are therefore needed only for the mechanical path; a bad publish
  is undone by re-pointing `program_versions` to the previous release.

## Left to the builder

File/module layout inside these boundaries, adapter internals, diff algorithm, notice/email copy and
templates, the email provider wiring (Resend is already the domain's SMTP provider), how many PRs to
split this into, and test strategy.

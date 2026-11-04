# Unblock New Degrees (Plan 3 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two things that keep every new degree a parked draft: unread regulations PDFs (`known_gaps`) and the fixed 4-year board windows.

**Architecture:** A PDF evidence adapter turns each linked regulations/ידיעון document into `rule_text` evidence items (one per paragraph, under its heading), so the skill maps them like any other official text and the `known_gaps` entry for "unread PDF" goes away. Degree length becomes data: `DegreeSpec.degree_years` (from the program page's year sections; regulations text cross-checked), and the builder emits the early window (Years 1-2) plus a late window spanning Years 3..N instead of always 3-4.

**Tech Stack:** Python 3 + pydantic v2 + pytest; `pypdf` (new, pure-Python dependency — nothing installed reads PDFs; the local `pdftotext` binary is not available in CI/Vercel); TypeScript only if window ids change.

**Spec:** `docs/superpowers/specs/2026-11-03-degree-onboarding-design.md` (§2 "PDF ידיעון when present", §4 checks). Previous plans: `2026-11-03-degree-pipeline-foundation.md`, `2026-11-04-add-degree-skill.md`.

**Renumbering:** this becomes Plan 3. Safe updates (versioned releases, saved-plan impact, notice + email) → Plan 4; scheduled re-check → Plan 5.

## Facts found while drafting (2026-11-04)

- ME's regulations PDF (`Terms_BA.pdf`, 769 KB, ~730 text lines) states: BSc = 8 semesters, **except mechanical engineering (and two others): 9 semesters (4.5 years)**; "digital sciences for hi-tech" ≈ 3 years. So ME's own boards (Years 3-4 window) already disagree with its regulations — record as a `source_conflict` when the PDF is read; do not re-year ME in this plan.
- PDF text comes out as visual-order RTL; `app/parsing/tau_curriculum_document.py:restore_rtl_pdf_line` already restores it.
- UI supports degree years up to `MAX_DEGREE_YEAR = 6` (`shared/planner/window_board.ts`) and fits tabs to the board's real length (`web/lib/planner/semester-window.ts: scheduleSlotsForBoard`).

## Global Constraints

- ME's committed boards stay byte-identical (golden test) unless a task explicitly says otherwise.
- Board format stays `syllo_board_v1`; window board id convention `<base>_years_1_2_<year>` unchanged.
- Evidence ids stable for unchanged text; reworded text → new id (same rule as the HTML adapters).
- A document the adapter cannot extract text from stays a `known_gaps` entry — never a silent pass.
- Gates: `python -m pytest -q`, `npm test`, `npm run build:board` diff empty.

## Review Focus

1. **Scanned PDF with no text layer** → zero paragraphs → the item stays unread (known gap), check stays red.
2. **Same document linked from two programs** (faculty-wide regulations) → identical ids for identical text in both evidence sets, so one reading is reusable.
3. **3-year degree** (e.g. "תוכנית דו-חוגית במדעים דיגיטליים להיי-טק") → late window = Year 3 only; no empty Year 4 semesters on the board.
4. **ME** → still Years 1-2 + 3-4 boards byte-identical; the 9-semester regulations statement surfaces as a source conflict, not a board change.
5. **PDF download fails live** → raises like the other adapters (no degraded evidence).

### Task 1: PDF evidence adapter

**Files:** Create `app/degrees/adapters/pdf.py`; modify `app/degrees/adapters/__init__.py`, `data/config/institutions.json` (add `"tau_pdf"` to TAU adapters), `requirements.txt` (`pypdf>=4`); tests `tests/test_pdf_adapter.py` with a small committed text-layer fixture PDF (generate one in the test from text, or commit a 1-2 page trimmed copy — no full regulations PDF in git).

**Interfaces:** `pdf_evidence(program, live, offline) -> list[EvidenceItem]`: for every `policy_text` link in the program's tochniot evidence whose URL ends `.pdf` and is the current regulations/ידיעון (not a previous-year archive), download (cache `data/raw_html/pdf/<sha1(url)[:12]>.pdf`, `force_refresh=live`), extract text per page, restore RTL lines, split into paragraphs under headings; emit `rule_text` items id `pdf:<sha1(url)[:12]>:<text_id(paragraph)>`, `path=[document title, heading]`, `source_url=<pdf url>`, `data={"page": n}`. No text layer → no items + a warning; the tochniot link item then still needs a `known_gaps` entry.

- [ ] Tests first: ids stable; reworded paragraph → one id changes; RTL restored (Hebrew words in logical order); no-text PDF → []; live download failure raises `EvidenceFetchError`; previous-year archive links skipped.
- [ ] Implement; run against the cached `Terms_BA.pdf` offline and report item count.
- [ ] Commit `feat(degrees): regulations PDFs become evidence`.

### Task 2: Map ME's regulations; retire its known gap

**Files:** `data/degrees/tau/mechanical_engineering/2027/{evidence,spec}.json`.

- [ ] `evidence --live`, `todo`, map every new PDF item (skill step 4); the 9-semester statement → `source_conflicts` (program page shows 4 years); remove `known_gaps["unread-regulations-pdf"]` only once every item of that document is mapped (the gap is retired by reading, not deleted).
- [ ] `check --live`: known_gaps passes; rules_enforced still lists only genuinely unenforced rules (new regulations rules may add some).
- [ ] Commit `data(degrees): ME regulations read and mapped`.

### Task 3: Degree length as data

**Files:** `app/degrees/spec.py` (`degree_years: int = 4`, validated 3..6), `app/degrees/checks/consistency.py` (`check_degree_length` uses it), `scripts/degree.py` (windows from `degree_years`: early = 1-2, late = 3..N; build refuses only years outside 1..N), `app/analysis/semester_board.py` (`_make_semesters(start_year, years)`), `scripts/build_early_years_board.py`; tests.

- [ ] Tests: `degree_years=3` builds a late board with Year 3 only and `audit_board` clean; `degree_years=5` builds Years 3-5; ME (4) byte-identical; mandatory course in year > N fails check and build.
- [ ] Skill: replace "Not a 4-year degree: stop" with "set `degree_years` from the program page's year sections; record a conflict if the regulations say otherwise".
- [ ] Commit `feat(degrees): degree length is data`.

### Task 4: UI check for non-4-year boards

**Files:** `web/lib/planner/semester-window.ts` (only if needed), tests in `web/`.

- [ ] Test the late window with a 1-year and a 3-year board fixture: tabs fit the board, add-semester still works, no crash. Fix only what breaks.
- [ ] Commit `fix(planner): late window fits 3- and 5-year degrees` (or nothing if no change needed — say so).

## Not in this plan

Planner enforcement of `course_rules` (distinct-track rules, cohort/year restrictions, equivalences) — next after this, since EE adds two `distinct_categories` rules. Safe updates (Plan 4), scheduled re-check (Plan 5).

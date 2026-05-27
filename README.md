# TAU Course Planner

A course planning tool for Tel Aviv University students, built with FastAPI, SQLite, and vanilla HTML/CSS/JS.

## Semester Board Viewer

An interactive drag-and-drop course planning board with Hebrew-first RTL UI.

### How to open

```bash
python -m http.server 8080
```

Then navigate to: `http://localhost:8080/app/web/semester_board_viewer.html`

### Features

- **Program selection screen** — choose your degree program (currently: Mechanical Engineering 2025)
- **Hebrew RTL layout** — full right-to-left interface with Hebrew labels and semester names
- **Course repository sidebar** — courses grouped by category (mandatory / available electives / blocked electives / missing data), with collapsible accordion sections
- **Drag-and-drop planning board** — move courses between semesters; state persists across sessions via `localStorage`
- **Expandable course cards** — click any card to reveal prerequisites, warnings, and source information
- **Workload progress bars** — per-semester hour totals color-coded: green (0–10h), amber (10–16h), red (16+h)
- **Mandatory course locking** — program-mandated courses show a lock badge; click to temporarily unlock for repositioning
- **Dark mode** — toggle with the moon/sun button in the header
- **Blocked course drag toggle** — enable dragging of prerequisite-blocked courses to plan ahead

### Data sources

| File | Purpose |
|------|---------|
| `data/parsed_json/mechanical_semester_board.json` | Auto-generated semester plan (required) |
| `data/parsed_json/mechanical_electives_profile_audit.json` | Electives audit with block/eligibility info (optional) |
| `data/programs/mechanical_engineering_2025.json` | Program structure with mandatory courses per semester |

### Generating the semester board

```bash
python -m app.analysis.semester_board \
  --plan data/parsed_json/mechanical_electives_profile_audit.json \
  --program-json data/programs/mechanical_engineering_2025.json \
  --output data/parsed_json/mechanical_semester_board.json
```

## Current limitations

- **AI assistant panel is a mock** — the chat panel in the sidebar accepts input but does not connect to any model. AI responses must be grounded in local DB/JSON data only; hallucinated course recommendations are not safe for academic planning.
- **Single program** — only Mechanical Engineering 2025 is wired up. The UI is built to support multiple programs (see `PROGRAMS` registry in the HTML); adding a new program requires a board JSON and an entry in `PROGRAMS`.
- **No real program categories** — course categories (mandatory/elective) come from the program JSON and the semester board generator. Future plan: scrape TAU study-program pages to populate `data/programs/*.json` automatically.

## Project structure

```
app/
  analysis/
    semester_board.py     # Board generation logic + CLI
  web/
    semester_board_viewer.html  # Interactive planning UI
data/
  programs/               # Program structure JSONs (mandatory courses)
  parsed_json/            # Generated board and audit JSONs
  raw/                    # Raw scraped data
tests/
  test_semester_board.py  # 76 tests for board generation logic
```

## Running tests

```bash
python -m pytest tests/ -q
```

---

## Data ingestion architecture (long-term design)

The TAU website structure, degree requirement pages, and course organization change over time. The ingestion layer must therefore be designed as a resilient search-and-indexing pipeline — not as a brittle one-off scraper tied to the current page layout.

### Guiding principle

```
fetch → normalize → validate → diff against previous version → store → flag changes → expose to planner
```

### 1. Multi-source ingestion

The system must accept data from multiple independent sources so that any single source going stale or changing format does not break the whole pipeline:

| Source | Description |
|--------|-------------|
| TAU course search pages | Primary structured course catalog |
| Syllabus pages | Per-course details, prerequisites, grading |
| Study program / degree requirement pages | Mandatory and elective course lists per track |
| Uploaded PDFs or handbooks | Faculty-issued syllabi or requirement booklets |
| Manually curated override files | Corrections for data the scraper cannot extract reliably |

### 2. Adapter-based scrapers

Each source has its own adapter that returns a normalized data model. No adapter may leak page-specific structure into the rest of the system.

```
CourseSearchAdapter    → NormalizedCourse
SyllabusAdapter        → NormalizedCourse (enriched)
StudyProgramAdapter    → NormalizedProgramRequirements
GradeStatsAdapter      → NormalizedGradeStats
ManualOverrideAdapter  → any of the above (takes precedence)
```

Adapters return typed Pydantic models. Raw HTML/JSON structures never cross the adapter boundary.

### 3. Fallback extraction strategies

Each adapter must implement a cascade of extraction methods. The first method that succeeds with sufficient confidence is used; the result always records which method was used.

```
1. Structured HTML selectors (fastest, most brittle)
2. Label-based parsing (find field by adjacent label text)
3. Text-pattern extraction (regex / heuristics)
4. Link classification (infer course type from URL patterns)
5. Cached snapshot (use last known-good content if fresh fetch fails)
6. Manual override data (always wins if present)
7. LLM-assisted extraction (last resort; output must be validated against schema and scored)
```

LLM extraction is never the sole source of truth. Any LLM-derived field must carry `extraction_confidence < 0.7` and a `needs_review` flag until a human or structured source confirms it.

### 4. Change detection

Every import run stores a provenance record alongside the data:

```python
class ImportRecord(BaseModel):
    source_url:             str
    fetched_at:             datetime
    content_hash:           str        # SHA-256 of raw response body
    parser_version:         str        # semver of the adapter that produced this record
    extraction_confidence:  float      # 0.0–1.0
    warnings:               list[str]
```

If `content_hash` differs from the previous import, or if `extraction_confidence` drops below a threshold, the record is flagged `needs_review = True` and surfaced to the human review layer.

### 5. Data quality scoring

Every normalized course and program record carries quality metadata:

```python
class DataQuality(BaseModel):
    completeness_score:     float      # fraction of expected fields present
    missing_fields:         list[str]  # field names that are null or defaulted
    extraction_confidence:  float      # lowest confidence across all extracted fields
    stale_data_warning:     bool       # True if last_verified_at > staleness threshold
    last_verified_at:       datetime
```

The planner UI already surfaces `missing_fields` and `extraction_confidence` on course cards. This model formalises those signals.

### 6. Versioned academic years

Academic-year data is never overwritten. Each record is keyed by `(course_id, academic_year)`:

```python
class CourseRecord(BaseModel):
    course_id:      str
    academic_year:  str   # e.g. "2025-2026"
    semester:       str   # "A", "B", or "both"
    source_url:     str
    last_updated:   datetime
    # ... normalized course fields
```

Old year records remain queryable. The planner defaults to the latest year unless the user selects a specific cohort.

### 7. Versioned program requirements

Degree requirements change by year and sometimes mid-year. Each version is stored separately:

```python
class ProgramRequirements(BaseModel):
    program_id:           str
    academic_year:        str
    requirement_version:  str          # incremented when requirements change within a year
    category_structure:   list[dict]   # ordered list of requirement categories
    mandatory_courses:    list[str]    # course_ids
    elective_groups:      list[dict]   # group name + pool of eligible course_ids
    specialization_rules: list[dict]   # track-specific overrides
```

The planner loads the version that matches the student's enrollment year.

### 8. Human review layer

When confidence is low or a change is detected, the UI must surface this explicitly — not silently drop or hide the data. Possible flags shown on course cards or in an admin review panel:

- `needs_review` — extraction confidence below threshold
- `source_changed` — content hash differs from last verified import
- `missing_prerequisite_data` — prerequisite field present in program requirements but not resolved to a course record
- `low_confidence_extraction` — a specific field was extracted by a fallback method

### 9. AI integration rule

AI may assist in interpreting messy or unstructured text (handbooks, free-text syllabi), but it must never be the only source of truth for any field that affects planning decisions.

AI output must always be:
- grounded in a specific source URL and raw extracted text
- validated against the normalized schema before storage
- stored with `extraction_method = "llm"` and a confidence score
- flagged `needs_review = True` until confirmed by a structured source or human

### 10. Summary: target pipeline

```
┌─────────────────────┐
│   Source adapters   │  CourseSearch / Syllabus / StudyProgram / PDF / Manual
└────────┬────────────┘
         │ NormalizedCourse | NormalizedProgramRequirements
         ▼
┌─────────────────────┐
│  Validation layer   │  Schema check · completeness score · confidence threshold
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Diff / versioning │  content_hash comparison · academic year keying
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   SQLite store      │  course_records · program_requirements · import_log
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Review flags      │  needs_review · source_changed · low_confidence
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Planner / UI      │  semester_board · course cards · data quality indicators
└─────────────────────┘
```

# Stage 2: LLM-Based Semantic Enrichment Proposal

**Date:** 2026-11-19 (updated — pricing and corpus verified against live data)
**Status:** Draft — pending cost authorization before execution  
**Branch:** `claude/pensive-bohr-dveqf4`

---

## What the Current Pipeline Does (Stage 1)

The deterministic pipeline (`scripts/enrich_pipeline.py`) uses keyword pattern matching to assign
`derived` (0.6) or `estimated` (0.3) evidence to course profiles. It is:

- Zero-cost (no AI inference)
- Fully reproducible
- Covering 134 EE + 117 ME = 251 courses with any syllabus content in the board
- Pipeline-snapshot T1 (courses where `buildSyllabusSnapshot` produces non-empty content): 111 EE + 102 ME = 213 courses

The limitation is clear: it cannot identify a primary topic without a verbatim keyword match, it
cannot assess depth (introductory vs. advanced), and it cannot extract explicit learning outcomes
stated in natural language. Single-sentence syllabi in Hebrew are particularly hard for the
pattern matcher.

A known false-positive example: `0542-2500` (Fluid Mechanics) scores 0.3 for `mechanical_design`
because the word `תיכון` (design) appears incidentally in an enrollment-context sentence. The LLM
would read the full syllabus and correctly reject this.

---

## What LLM Extraction Would Add

| Feature | Stage 1 (Deterministic) | Stage 2 (LLM) |
|---|---|---|
| Evidence level | derived (0.6) or estimated (0.3) | explicit (0.9) for stated outcomes |
| Topic identification | keyword match only | primary + secondary topic extraction |
| Depth assessment | none | introductory / intermediate / advanced |
| Learning outcomes | none | verbatim extraction from syllabus |
| False-positive rejection | weak (single-word overlap) | model can reason about context |
| Cross-lingual matching | Hebrew keywords only | handles mixed He/En |

---

## Schema the LLM Would Produce

```typescript
interface LLMExtractedProfile {
  courseId: string;
  primaryCapabilities: Array<{
    capability: AcademicFocusArea;
    depthLevel: 'introductory' | 'intermediate' | 'advanced';
    inferenceLevel: 'explicit' | 'derived';
    learningOutcomes: string[];     // verbatim from syllabus
    extractedEvidence: string;      // verbatim excerpt, max 200 chars
    confidence: number;
  }>;
  secondaryCapabilities: Array<{
    capability: AcademicFocusArea;
    inferenceLevel: 'derived' | 'estimated';
    extractedEvidence: string;
    confidence: number;
  }>;
  needsHumanReview: boolean;        // true when confidence < 0.6 or evidence span is thin
  reviewReason?: string;
}
```

---

## Verified Model & Pricing

**Model:** `claude-haiku-5-5`  
**Availability confirmed:** 2026-11-19 (via Anthropic API)  
**Pricing (confirmed, not from training data):**

| Token type | Rate |
|---|---|
| Input (uncached) | **$0.10 / MTok** |
| Output | **$0.50 / MTok** |
| Cache write | ~$0.025 / MTok |
| Cache read | ~$0.01 / MTok |

> Note: A previous draft of this proposal had incorrect rates of $0.80/$4.00 (8× too high).
> The figures above were verified directly from the API on the date shown.

---

## Measured Token Estimates

Corpus measured 2026-11-19 from the committed board files. Content fields:
`syllabus_summary_he`, `syllabus_topics_he`, `syllabus_prerequisites_he`,
`syllabus_assessment_he`, `syllabus_structure_he`, `syllabus_ai_topics`, `assessment_text_raw`.

**Corpus size:** 134 EE + 117 ME = **251 courses with content**

**Syllabus text token distribution:**

| Percentile | Tokens (Hebrew chars ÷ 2) |
|---|---|
| P10 | 214 |
| P50 (median) | 347 |
| Mean | 379 |
| P90 | 536 |

**Per-call token breakdown:**

| Component | Tokens |
|---|---|
| System prompt (role + 24 cap defs + JSON schema) | ~760 (cached after first call) |
| Per-course syllabus content (mean) | ~379 |
| Per-course overhead (header, instruction, schema reminder) | ~70 |
| **Total input (first call)** | **~1,209** |
| **Total input (subsequent, with cache)** | **~449** |
| Output per course (caps + evidence + outcomes + flags) | ~400 |

---

## Cost Estimate

**Single pass (251 courses, with prompt caching):**

```
Cache write (1st call, 760 tokens):     $0.000019
Cache reads (250 × 760 tokens):         $0.00190
Uncached input (251 × 449 tokens):      $0.01127
Output (251 × 400 tokens):              $0.05020
─────────────────────────────────────────────────
1× pass total:                         ~$0.063
```

**Maximum budget (2× retry worst case + validation round):**

```
2× retry (all 251 calls fail once):   ~$0.126
Validation round (verify evidence spans,
251 × ~500 input + ~100 output):       ~$0.023
─────────────────────────────────────────────────
Maximum budget:                        ~$0.15
```

**50-course pilot:**

```
Single pass:  ~$0.013
Max (2× + validation):  ~$0.030
```

> To authorize: reply with **"approve stage 2 at $0.15 max"** (full corpus) or
> **"approve stage 2 pilot at $0.03 max"** (50 courses).

---

## Validation Approach

Each LLM-extracted claim goes through the existing deterministic validator
(`api/ai/semantic_extraction_validator.ts`) before being accepted:

1. The extractor returns a `CandidateExtraction` with verbatim evidence spans.
2. `validateExtraction` checks:
   - `snapshotHash` matches the authoritative snapshot
   - `extractedEvidence` is a verbatim substring of `normalizedContent`
   - Capability is in `CAPABILITY_ONTOLOGY`
   - Confidence is re-bounded deterministically by inference level cap
3. Only `accepted` claims are written to the enriched profile.
4. Existing `captured-review-v1` profiles are never overwritten.
5. Claims with `needsHumanReview: true` are written to a separate review queue;
   they are NOT automatically merged into the cache.

Extractor name: `llm-haiku-v1`, extractor kind: `llm`.

---

## Resumability & Human-Review Flags

The extraction script (`scripts/stage2_semantic_enrichment.py`) checkpoints each
course by ID before proceeding. A run interrupted at course N resumes from N+1
without reprocessing or re-billing the already-completed courses.

A claim is flagged `needsHumanReview: true` when any of:
- Overall confidence < 0.6
- `extractedEvidence` span is < 20 chars (too short to verify grounding)
- Evidence text is not a verbatim substring of the input syllabus
- LLM response contains hedging language ("likely", "possibly", "unclear")
- Capability score differs by > 0.3 from the Stage 1 deterministic estimate

Flagged claims are written to `data/enriched_profiles/stage2_review_queue.json`
and excluded from the automatic merge.

---

## Expected Improvement

| Metric | Stage 1 (now) | Stage 2 (projected) |
|---|---|---|
| EE explicit (0.9) evidence items | 0 (auto) | ~100–150 |
| ME explicit (0.9) evidence items | 0 (auto) | ~40–70 |
| Known false positives eliminated | 0 | most estimated-0.3 false positives |
| Depth metadata | absent | present |
| Hebrew learning outcomes | absent | verbatim extraction |

---

## Recommended Execution Plan

1. **Authorize cost** per the figures above
2. Run pilot on 50 EE courses with highest T1 content length
3. Review a sample of 10 extracted profiles for quality
4. If quality is acceptable: run full 251-course batch
5. All new profiles use `extractorName: 'llm-haiku-v1'`, `extractorKind: 'llm'`
6. Human-review queue processed before merge (not automated)
7. Re-run `npx jest` to verify no regressions
8. Commit and open PR

---

## What Requires Explicit Approval Before Running

Per project security constraints:

- Running billable live-model inference requires explicit authorization
- Stage 2 must NOT use Production data
- All extraction uses sandbox/development boards only
- No changes to billing, database, or Production environment variables
- Merge of Stage 2 profiles requires a separate PR review

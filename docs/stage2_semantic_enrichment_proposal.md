# Stage 2: LLM-Based Semantic Enrichment Proposal

**Date:** 2026-11-18  
**Status:** Draft — pending cost authorization before execution  
**Branch:** `claude/pensive-bohr-dveqf4`

---

## What the Current Pipeline Does (Stage 1)

The deterministic pipeline (`scripts/enrich_pipeline.py`) uses keyword pattern matching to assign
`derived` (0.6) or `estimated` (0.3) evidence to course profiles. It is:

- Zero-cost (no AI inference)
- Fully reproducible
- Covering 125/194 EE and 107/156 ME courses
- Producing Tier-2 (derived) profiles for only 9 EE + 2 ME courses

The limitation is clear: it cannot identify a primary topic without a verbatim keyword match, it
cannot assess depth (introductory vs. advanced), and it cannot extract explicit learning outcomes
stated in natural language. Single-sentence syllabi in Hebrew are particularly hard for the
pattern matcher.

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
  summaryHe?: string;               // LLM-generated one-line Hebrew summary
}
```

---

## Cost Estimate

**Corpus:** EE 194 + ME 156 = 350 courses  
**Courses with content (Tier 1):** 124 EE + 107 ME = 231 courses  
**Recommended batch:** 50 courses per run (to allow review between batches)

**Token estimate per course:**

| Component | Tokens |
|---|---|
| System prompt (instruction + schema) | ~500 |
| Syllabus content (avg 400 chars) | ~100 |
| **Total input** | **~600** |
| JSON output per course | ~400 |

**Cost at claude-haiku-5-5 rates ($0.80/MTok input, $4.00/MTok output):**

```
Input:  231 courses × 600 tokens = 138,600 tokens = 0.1386 MTok → $0.111
Output: 231 courses × 400 tokens = 92,400 tokens = 0.0924 MTok  → $0.370
─────────────────────────────────────────────────────────────────────────
Total estimated cost: ~$0.48 for the full 231-course corpus
```

For a 50-course pilot: ~$0.10.

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

Extractor name: `llm-haiku-v1`, extractor kind: `llm`.

---

## Expected Improvement

| Metric | Stage 1 (now) | Stage 2 (projected) |
|---|---|---|
| EE Tier-2 profiles (derived ≥0.6) | 9 | ~80–100 |
| ME Tier-2 profiles (derived ≥0.6) | 2 | ~40–60 |
| Explicit (0.9) evidence items | 0 (auto) | ~100–150 |
| False positives (philosophy→SP) | present (est. 0.3) | eliminated |
| Depth metadata | absent | present |

---

## Recommended Execution Plan

1. **Authorize cost** (~$0.48 for full corpus, ~$0.10 for pilot of 50 courses)
2. Run pilot on 50 EE courses with highest Tier-1 content length
3. Review sample of 10 extracted profiles for quality
4. If quality is acceptable: run full 231-course batch
5. All new profiles use `extractorName: 'llm-haiku-v1'`, `extractorKind: 'llm'`
6. Re-run `npx jest` to verify no regressions
7. Commit and open PR

**To authorize:** Reply with "approve stage 2 at $0.48 max" or "approve stage 2 pilot at $0.10 max".

---

## What Requires Explicit Approval Before Running

Per project security constraints:

- Running billable live-model tests requires explicit authorization
- Stage 2 must NOT use Production data
- All extraction uses sandbox/development boards only
- No changes to billing, database, or Production environment variables

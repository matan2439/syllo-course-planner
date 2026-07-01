# TAU Course Planner — Canonical Project State
_Last updated: 2026-07-01_

## Overall status

P0 complete. P1 complete (all 8 phases). Implementation halted — no remaining safe in-scope work.

`npm test`: **564/564 green**. `tsc --noEmit`: **clean**.

---

## Commit log (P1)

| Phase | Commit | Description |
|---|---|---|
| P0 | `e645004` | Six correctness fixes (memoize, priorHours, dynamic semesters, STOP trace, null-hours guard, DB-less path) |
| P0 cleanup | `0431ea4` | Remove dead planContextToBoard/buildModelFromPlanContext; export+test priorHoursFromContext |
| Ph 1 | `cd18929` | SearchStrategy interface + types (planner_search_types.ts) |
| Ph 1.1 | `a1e8dfe` | Tighten SearchStrategy interfaces before BeamSearch |
| Ph 2 | `064e87b` | BeamSearchStrategy (planner_search_beam.ts) |
| Ph 3 | `48be405` | Capability interfaces + detectGaps (planner_capabilities.ts) |
| Ph 4 | `0c4d11a` | PlannerAgent with capability dispatch and trace building |
| Ph 5 | `9f9e8cb` | Wire PlannerAgent into generate-plan; Option B toProposal |
| Ph 6 | `19f3045` | REPLACE_COURSE enumeration + g2/g4 scoring fixes |
| Ph 7 | `b440b05` | is_unwanted exclusion + unwanted_avoidance score dimension |
| Ph 8 | `2fdb0d3` | rank_candidates now sorted by plan score descending |

---

## Score vector — 8D (as of Ph 6–7)

```
[g1, g2a, g2b, g3, g4, g5, g5b, g6]
```

| Index | Name | Formula |
|---|---|---|
| g1 | `degree_completion` | `min(priorHours + placedHours, degreeRequiredHours)` |
| g2a | `requirements_mandatory` | `mandatoryPlaced / requiredMandatoryCount` (1 if none) |
| g2b | `requirements_category` | `categoriesSatisfied / categoryCount` (1 if none) |
| g3 | `legality` | `-(overHard*10 + overUser)` |
| g4 | `balance` | `-spread(non-empty semester loads)` |
| g5 | `preferences` | `wantedCourseIds placed count` |
| g5b | `unwanted_avoidance` | `-unwanted courses placed count` |
| g6 | `difficulty_comfort` | `-totalDifficulty` |

GOAL_STACK is 8 entries. `compareScore` is lexicographic, higher is better at every position.

---

## Architecture snapshot

```
generate-plan.ts
  ├─ PlannerAgent path (PRIMARY, Phase 5+)
  │    PlannerAgent → BeamSearchStrategy (width=6)
  │                 → ValidationCapability
  │                 → KnowledgeCapability (no-op pass-through, P1)
  │                 → ExplanationCapability → LlmExplainer (post-search)
  │    toProposal() — Option B, pure fn, no live PlannerWorker
  │
  └─ Greedy fallback (on PlannerAgent error)
       PlannerWorker + GreedyOrchestrator (unchanged)

planner-run.ts streaming endpoint — still uses greedy path (intentional, P3 scope)
```

**Design invariants in force (must not be violated):**
- SearchStrategy never imports ConstraintModel
- LLM invoked only post-search (explanation only, never step selection)
- KnowledgeCapability.resolve() is a no-op in P1
- toProposal Option B: no live PlannerWorker passed
- PlannerWorker / GreedyOrchestrator / LlmOrchestrator untouched in P1

---

## enumerateActions groups (current)

| Group | What | Notes |
|---|---|---|
| 1 | Required mandatory (all legal semesters) | |
| 2 | Category candidates for unsatisfied categories | Includes is_unwanted if it's the only option |
| 3 | Wanted courses | |
| 4 | Degree-fill electives | Excludes null-hours, zero-hours, is_unwanted (Ph 7) |
| 5 | Balance moves | |
| 6 | REPLACE_COURSE swaps | Top-3 worst placed → top-3 better replacements (Ph 6) |

---

## Blocked / deferred items

| Item | Reason blocked |
|---|---|
| Section 4.2 Multiple Tracks | Architecture change — extends ConstraintModel + validatePlanProposal significantly; needs design session |
| Section 4.3 Annual Dedup | count_hours_once alone is insufficient; needs root_course_id/annual_group field to identify pairs; data model decision required |
| Section 5.2 Skip validation in rollouts | Roadmap says "may be unnecessary after P0 memoization"; skip unless benchmarks show need |
| Section 7.1 Dead preference fields | Removing parsed fields = potential API/DB contract change; needs audit first |
| Section 7.2 Dead PlannerAction types | Removing from schema = API contract change |
| Section 7.4 generateCandidates retirement | Superseded by beam search; safe to delete but is a separate cleanup PR |
| Section 7.5 Client JS engine retirement | Requires streaming endpoint (P3 Section 6.2) first; separate PR |
| Section 6.x UI work | Hard boundary — do not touch without explicit approval |
| Alembic migration | Hard boundary — do not apply without explicit approval |
| Any deploy | Hard boundary — do not deploy without explicit approval |

---

## Recommended next work (in order)

1. **Decide annual course model** — does the board_json carry a `root_course_id` or `annual_group_id` for paired courses? If yes, implement Section 4.3. If no, add the field to the board schema first.
2. **Retire `generateCandidates`** — it is dead code post-beam-search; straightforward cleanup PR.
3. **Plan multiple-track requirement architecture** (Section 4.2) — requires design session; extends CategoryReq with `equivalentGroups` and ConstraintModel with `activeTrack`/`coRequisites`.
4. **UI + client-engine cleanup** (Sections 6.2, 7.5) — wire streaming endpoint into UI, retire client-side JS mirrors; prerequisite: streaming endpoint stable.
5. **Real KnowledgeCapability** (P2+) — LLM/syllabus enrichment via extract_syllabus_facts; not in scope until core planning is proven stable.

---

## Security invariants (carry forward)

- Do not apply Alembic migration `d4e5f6a7b8c9_add_planner_runs_table.py` without explicit user approval.
- Do not merge or deploy without explicit user approval.
- `.claude/settings.local.json` and `.claude/skills/` never committed.
- No API keys or credentials committed.

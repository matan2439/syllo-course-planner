# Conversational planning evaluation

Scope and honesty: everything below is **deterministic** — it exercises rules encoded in code (the conversation state machine, impact-gated elicitation, and the agent session's intake gates). It is **not** proof of real-model conversational quality: wording, the choice of follow-up, tone and whether the model actually follows its instructions are only observable with a live model (proposal at the end — not run, no billable call was made).

Evidence: `tests/api/conversation_behavior_scenarios.test.ts` (new, 10 scenarios) and the existing `tests/api/copilot_agent.test.ts` intake tests (lines ~760–820).

## Checklist from the brief

| Behaviour | Deterministic evidence | Verdict |
|---|---|---|
| Asks useful follow-ups before a broad request | New student with no context is asked the highest-impact question first (workload); agent `build_plan` is refused on a new session until intake is complete | Enforced in code |
| Identifies missing specialization preference | Agent gate requires **direction OR workload**, not both | **Weak** — see W1 |
| Asks about preferred and avoided courses | Agent gate requires both known (asked at most twice for avoided, then "none") | Enforced in code |
| Uses saved answers / no repetition | Answered topics never re-asked; ten-turn loop never repeats a question id; agent instructions forbid re-asking | Enforced |
| Handles changing preferences | `reviseAnswer` replaces (no duplicates), marks the proposal stale, does not auto-generate; removal makes a question askable again | Enforced |
| Vague answers | Free text on a consequential question stays *uncertain/inert* until confirmed | Enforced |
| Contradictions | Same-knob conflicts are surfaced, not silently resolved | Enforced |
| No generic questionnaire | Topic question appears only when topics separate ≥2 legal candidates | Enforced |
| Lets the student proceed immediately | `intake_skip` unlocks `build_plan` (copilot_agent tests) | Enforced |
| Respects committed courses | Covered by committed-lock tests (PR #147) — not re-tested here | Existing |
| Explains trade-offs before decisions; refines drafts instead of restarting | Prompt-level only | **Unverifiable offline** |

## Remaining behavioural weaknesses

- **W1 — specialization can be skipped.** `intakeComplete = preferred ∧ avoided ∧ (direction ∨ workload)`. A student who only states a workload cap gets a first plan with no specialization question at all, although the product goal is interest-driven planning. Recommended: require direction **or an explicit "no preference"** in addition to workload for new sessions (small change in `session.ts`; needs your approval as it changes first-plan behaviour).
- **W2 — flags are model-asserted.** `intake_direction_answered`, `intake_workload_answered` and `intake_skip` are set by the model's tool call; the server cannot check the student said it. A misbehaving model can unlock planning. Recommended: log the student utterance that justified each flag and sample it in the live evaluation.
- **W3 — the agent cannot explain missing foundations.** With the (flagged, off) prerequisite-readiness ranking, a *biomechanics* request yields **zero** focus courses for the evaluated student because every candidate needs background the student lacks (see planner-evaluation.md). Today the agent would simply propose such courses (baseline) with prerequisite warnings, or none (readiness) with no explanation. Recommended: surface `specialization_pathway` foundations ("to take X you first need Y") through the existing `course_pathway` tool.
- **W4 — clarification questions are English-keyed.** The class-based clarification module (`academic_clarification.ts`) generates English question text and title-cased option labels (e.g. "Strength Analysis"). It is used for the model's `missing_critical_inputs`, so students see model-written Hebrew, but any UI that renders these items directly would be English. Not exercised in production flows I could verify.
- **W5 — direction vocabulary is Mechanical-only.** `ACADEMIC_FOCUS_AREAS` (robotics, fluids, …) and the topic profiles exist for Mechanical Engineering 2027 only; Electrical Engineering students cannot express or receive interest-based planning.

## Proposed live-model evaluation (NOT run — needs your explicit approval)

- **Scenarios (12):** the eight intents in `scripts/evaluate_planner_quality.ts`, plus: "just build it", workload-only opening, changing direction mid-conversation, contradictory wants (a course whose prerequisite the student avoids).
- **Protocol:** scripted student turns, ~6 agent turns each, run through the real `runPlannerAgent` on `PlanningSession`; rubric scored by two reviewers on: asked a useful question before planning, did not re-ask, stated trade-offs, kept committed courses, flagged unmet prerequisites honestly. `scripts/agent_cost_benchmark.ts` is a previous, separately approved, one-shot billing benchmark and is **not** reused; a new harness would copy its budget guard (`scripts/lib/bounded_openai_cost.ts`).
- **Cost (assumption, not measurement):** ≈ 72 agent turns × roughly 8–15k input and ~1k output tokens ≈ 0.6–1.1M input and ~70k output tokens. Dollar cost depends on the configured model's current price, which I have not looked up; I would ask you to approve a **hard cap** (e.g. the same $5 used for the earlier benchmark) enforced by the budget guard, with a stop on first overrun.
- **Expected benefit:** the only way to confirm W1–W3 and the unverifiable rows above.

# What-if simulation

`api/ai/what_if_simulation.ts` provides `WhatIfSimulationCapability` and its
deterministic implementation. It evaluates ordered add/remove/move requests using
the existing `PlannerMutation` application semantics. Annual additions accept
the same `alsoSemesterIds` spans as the worker. Automatic rebalancing and candidate
ranking remain outside this operation.

The caller injects a `ValidationCapability` bound to the same program, user
status, policy and pinned-course snapshot as the baseline. Validation is required;
there is no permissive default. Its legacy single reason is preserved under
`VALIDATION_REJECTED`, without inventing a more specific rule identifier. `valid`
means what that validator checks; it does not independently prove degree completion.
Validator exceptions propagate, rather than being presented as academic rejection.

`simulated` contains isolated baseline/candidate snapshots, requested changes and
validation evidence, including invalid hypothetical plans. A validator may return
structured `violations` and `evidence`; the capability preserves them without
deriving new rules. For the conversation tool, the existing `CandidateReport` is
adapted directly: it exposes legality/completeness, checked constraints, degree
hours, and missing mandatory/category/excluded/pinned facts alongside every
validator error. The legacy single-reason validator remains supported as one
`VALIDATION_REJECTED` finding. `rejected` means an edit was structurally
impossible and contains its zero-based index, with no partial candidate. The
operation never commits a plan. Empty changes validate a copy of the baseline.
Results are plain JSON-compatible data.

Dependencies: what-if simulation -> existing mutation helpers + plan types;
validation is injected. There are no UI, HTTP, database or LLM dependencies.
The existing local-search simulation and AcademicDecisionAgent pipeline retain
their signatures. `planner_tools.ts` registers `simulate_changes` for the website's
conversation agent, with bounded Zod arguments and `validateCandidate` bound to
the current worker model and pinned placements. Thus this tool's validation
includes degree completeness and exclusions as well as legality. Tool status
crosses the conversation wire and has a Hebrew label in the conversation UI.

The model receives the structured result to explain in its conversation response.
The tool cannot Apply a plan. Dedicated evidence cards and durable evidence storage
remain future work.
Structured multi-finding validation and explanation can extend this boundary
without adding scoring or academic rules to simulation.

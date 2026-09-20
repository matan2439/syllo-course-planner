# Candidate decision receipt

`api/ai/candidate_decision.ts` owns the final selection receipt for alternatives
that the existing deterministic planner has already generated, validated and
ranked. It does not calculate scores, alter a plan, invoke simulation, or run a
second planner.

## Contract

`CandidateDecisionCapability.decide` receives the ordered candidate ids and the
existing `recommended` marker. It returns a discriminated result:

- `selected`: chosen id, every evaluated id, alternatives that were not selected,
  and `existing_deterministic_ranking` as the basis;
- `infeasible`: no eligible candidate reached this boundary.

The capability honors the upstream recommendation. The first candidate is only
a defensive fallback for an incomplete adapter input; normal planner output
always marks the already-ranked recommendation.

## Integration and dependency direction

`CandidateSet` / validation gate → conversation adapter →
`CandidateDecisionCapability` → strict conversation response → audit UI.

The conversation adapter maps its already materialized alternatives to the
small input contract. The public response is under
`academic_decision.decision`, and the UI only states the number of legal
alternatives and the established deterministic basis. Candidate ids remain in
the proposal contract for Apply and auditability; the log does not render them
as opaque user-facing text.

Future scoring or simulation work belongs upstream, in the candidate generator
or a dedicated simulation capability. This receipt must continue to consume
their structured results rather than duplicating either concern.

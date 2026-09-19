# Proposal explanation

`api/ai/proposal_explanation.ts` is the deterministic explanation capability
for a conversation proposal. It projects the existing `CandidateReport` into a
small user-visible receipt; it does not run planning, validation, simulation or
ranking again.

## Contract and ownership

`ProposalExplanationCapability.explain` accepts only validation evidence:

- whether the candidate is valid;
- the constraint identifiers the validator checked;
- degree hours already calculated by the validator; and
- validator errors and warnings.

It returns a `ProposalExplanationResult` with four Hebrew fields: a summary,
verified facts, risks, and next actions. Unknown constraint identifiers are not
turned into prose. Errors and warnings are copied as validator evidence (up to
16 unique entries), not reinterpreted as a fresh academic diagnosis.

The HTTP response exposes the result under
`academic_decision.explanation` in
`shared/planner/conversation-wire.ts`. That schema is strict and has no field
for private reasoning, prompts, or raw tool payloads. The conversation UI
renders it inside the agent audit receipt only after a current, available
response.

## Dependency direction

`CandidateReport` (validation) → `ProposalExplanationCapability` →
conversation response contract → conversation UI.

The capability has no dependency on React, HTTP handlers, persistence, a model
provider, or the planner worker. The conversation handler is an adapter: it
passes the completed validation report through unchanged and serializes the
returned explanation.

## Future work

Simulation and decision implementations can supply their own structured
evidence to a sibling capability without changing this projection. Any richer
explanation must keep the same rule: consume named facts, validation findings,
and decision criteria that have already been produced; do not recompute hidden
reasoning or expose chain-of-thought.

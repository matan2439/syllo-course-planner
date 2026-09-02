# Conversational Academic Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Planner Agent a genuine Hebrew LLM conversation that invokes the developed deterministic planner tools over the current authoritative board.

**Architecture:** A typed chat endpoint resolves the session-owned board and academic context, then gives the configured LLM a bounded tool surface. The LLM may orchestrate and explain, while `PlannerWorker`, validators, proposal persistence and Apply retain all authority. The React panel renders transcript, clarifications, tool progress and alternatives without exposing raw tool payloads.

**Tech Stack:** Vercel Functions, TypeScript, AI SDK, Zod, React 19, Jest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-02-semester-table-conversational-agent-production-design.md`

## Global Constraints

- No automated test or fixture invokes a real or paid model.
- No assistant text may mutate a committed board or create academic facts.
- Tool calls act on isolated worker/draft state; only authoritative Apply commits.
- Missing model configuration returns a typed unavailable result, never a fake assistant reply.
- Do not change provider secrets or Production environment variables implicitly.
- Preserve all manual editing, proposal staleness, idempotency and version checks.

---

### Task 1: Typed conversation wire contract

**Files:**
- Create: `shared/planner/conversation-wire.ts`
- Create: `tests/api/conversation_wire.test.ts`

**Interfaces:**
- Produces Zod schemas/types for `ConversationRequest`, `ConversationTurn`,
  `ConversationEvent`, `ConversationResponse`, and typed `assistant_unavailable`.
- Request includes `program_id`, transcript, current board version, status digest,
  preference digest and anonymous session token.

- [ ] Write schema tests that reject role spoofing, oversized transcripts, raw board replacements and missing UUID session tokens.
- [ ] Run `npm test -- --runInBand tests/api/conversation_wire.test.ts`; confirm RED because the module is absent.
- [ ] Implement strict schemas with bounded message count/text length and no client-authored tool result.
- [ ] Re-run the focused test; expect PASS.
- [ ] Commit with `git commit -m "feat(agent): add typed conversation contract"`.

### Task 2: Bounded LLM tool orchestrator

**Files:**
- Create: `api/ai/conversational_agent.ts`
- Create: `tests/api/conversational_agent.test.ts`
- Modify: `api/ai/planner_tools.ts`

**Interfaces:**
- `runConversationalAgent(input, deps)` accepts injected `generate` and model.
- Reuses `get_state`, `rank_candidates`, `add_course`, `remove_course`,
  `move_course`, `replace_course`, and `finalize_plan` wrappers over one isolated
  `PlannerWorker`.
- Returns user-safe assistant text plus proposal-ready worker result and a
  redacted event summary.

- [ ] Write RED tests proving tool use, invalid tool arguments cannot mutate worker state, and free-form text cannot produce a committed board.
- [ ] Implement an injected AI-SDK `generateText` loop with the existing tool definitions and a Hebrew grounding system prompt.
- [ ] Ensure deterministic final validation/repair runs after the LLM loop and provider exceptions return a typed failure with unchanged state.
- [ ] Run `npm test -- --runInBand tests/api/conversational_agent.test.ts tests/api/planner_tools.test.ts tests/api/planner_worker.test.ts`.
- [ ] Commit with `git commit -m "feat(agent): orchestrate planner tools through conversation"`.

### Task 3: Session-authoritative chat endpoint

**Files:**
- Create: `api/ai/conversation.ts`
- Create: `tests/api/conversation_endpoint.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- `POST /api/ai/conversation` resolves owner/session, board, academic context,
  program model and configured runtime model server-side.
- Returns 503 `ASSISTANT_UNAVAILABLE` when `resolveModel()` is null.
- Persists proposal authority through the existing proposal store; never accepts a client plan as authoritative.

- [ ] Write RED tests for method/schema/session errors, unavailable model, stale board version, successful injected-model response and redacted errors.
- [ ] Implement the endpoint by composing existing owner, board, context, model and proposal boundaries.
- [ ] Add only the required route mapping in `vercel.json`.
- [ ] Run endpoint plus proposal/apply/storage failure suites.
- [ ] Commit with `git commit -m "feat(agent): expose authoritative conversation endpoint"`.

### Task 4: Transcript-style Agent panel

**Files:**
- Create: `web/app/components/AcademicAgentConversation.tsx`
- Create: `web/app/components/AcademicAgentConversation.test.tsx`
- Modify: `shared/planner/api-client.ts`
- Modify: `tests/api/planner_contracts.test.ts`

**Interfaces:**
- `sendConversation()` validates the wire response.
- Panel renders user/assistant turns, pending state, clarification controls,
  grounded tool activity labels and an explicit “בנה חלופות” action.

- [ ] Write RED tests for Hebrew transcript submission, Enter/Shift+Enter, pending/failed/unavailable states, no automatic Generate and hidden raw tool JSON.
- [ ] Implement the API client and accessible transcript/composer.
- [ ] Render structured clarification options and the existing typed preference summary as part of the conversation, not as a competing form.
- [ ] Run component and contract tests.
- [ ] Commit with `git commit -m "feat(agent): add Hebrew conversational interface"`.

### Task 5: One board, proposals and Apply

**Files:**
- Modify: `web/app/components/NativePlannerJourney.tsx`
- Modify: `web/app/components/UnifiedPlannerWorkspace.tsx`
- Modify: `web/app/components/NativePlannerJourney.agent.test.tsx`
- Modify: `web/app/components/NativePlannerJourney.serverapply.test.tsx`

**Interfaces:**
- Conversation always receives current committed board/version and typed status/preferences.
- Returned candidates feed existing `PlanAlternatives`; Apply remains existing server authority.

- [ ] Write RED journey tests proving a manual edit is visible to the next turn, manual edit stales all candidates, selecting a candidate is draft-local, and Apply commits only the server response.
- [ ] Replace the misleading deterministic-only Agent surface with `AcademicAgentConversation`, while retaining the deterministic elicitation state as structured clarification support.
- [ ] Show a truthful unavailable state when no runtime model exists.
- [ ] Run all Agent, alternatives, priority, topic, completion and server-Apply journey suites.
- [ ] Commit with `git commit -m "feat(agent): unify LLM conversation with durable board"`.

### Task 6: Agent verification gate

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`

- [ ] Run all root API tests with injected/fake model drivers only.
- [ ] Run all web tests, web/root typecheck and production build.
- [ ] Verify searches show no provider call in test/browser fixtures and no raw tool payload in rendered UI.
- [ ] Update `AUTONOMOUS_PROGRESS.md` with exact counts and commit `docs: record conversational agent verification`.


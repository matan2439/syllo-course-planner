/**
 * AcademicDecisionAgent epic — tests for api/ai/academic_decision_types.ts.
 *
 * Covers the four north-star capability slots not yet implemented:
 *   - ClarificationCapability + NoOpClarificationCapability
 *   - SimulationCapability + NoOpSimulationCapability
 *   - DecisionCapability + PassThroughDecisionCapability
 *   - PersistenceCapability + NoOpPersistenceCapability
 *
 * Purely additive — no existing capability (planner_capabilities.ts) is
 * touched or reimplemented here.
 */

import type { AgentResult } from '../../api/ai/planner_agent';
import {
  NoOpClarificationCapability,
  NoOpSimulationCapability,
  PassThroughDecisionCapability,
  NoOpPersistenceCapability,
  type ClarificationCapability,
  type ClarificationRequest,
  type SimulationCapability,
  type DecisionCapability,
  type PersistenceCapability,
} from '../../api/ai/academic_decision_types';

const AGENT_RESULT: AgentResult = {
  finalState: { semesters: {} },
  trace: [],
  gaps: [],
};

describe('ClarificationCapability', () => {
  test('accepts a matching object literal', async () => {
    const cap: ClarificationCapability = {
      clarify: async (_req: ClarificationRequest) => { /* no-op */ },
    };
    await expect(cap.clarify({ gaps: [] })).resolves.toBeUndefined();
  });

  test('NoOpClarificationCapability satisfies the interface and resolves void', async () => {
    const cap: ClarificationCapability = new NoOpClarificationCapability();
    await expect(cap.clarify({ gaps: [{ courseId: 'c1', gapType: 'null_hours' }] })).resolves.toBeUndefined();
  });
});

describe('SimulationCapability', () => {
  test('accepts a matching object literal', async () => {
    const cap: SimulationCapability = { simulate: async (r: AgentResult) => r };
    await expect(cap.simulate(AGENT_RESULT)).resolves.toBe(AGENT_RESULT);
  });

  test('NoOpSimulationCapability returns the same AgentResult unchanged (identity)', async () => {
    const cap: SimulationCapability = new NoOpSimulationCapability();
    await expect(cap.simulate(AGENT_RESULT)).resolves.toBe(AGENT_RESULT);
  });
});

describe('DecisionCapability', () => {
  test('accepts a matching object literal', async () => {
    const cap: DecisionCapability = { decide: async (candidates: AgentResult[]) => candidates[0] };
    await expect(cap.decide([AGENT_RESULT])).resolves.toBe(AGENT_RESULT);
  });

  test('PassThroughDecisionCapability returns the first candidate unchanged', async () => {
    const other: AgentResult = { finalState: { semesters: {} }, trace: [], gaps: [] };
    const cap: DecisionCapability = new PassThroughDecisionCapability();
    await expect(cap.decide([AGENT_RESULT, other])).resolves.toBe(AGENT_RESULT);
  });
});

describe('PersistenceCapability', () => {
  test('accepts a matching object literal', async () => {
    const cap: PersistenceCapability = { persist: async (_r: AgentResult) => { /* no-op */ } };
    await expect(cap.persist(AGENT_RESULT)).resolves.toBeUndefined();
  });

  test('NoOpPersistenceCapability resolves void and performs no I/O', async () => {
    const cap: PersistenceCapability = new NoOpPersistenceCapability();
    await expect(cap.persist(AGENT_RESULT)).resolves.toBeUndefined();
  });
});

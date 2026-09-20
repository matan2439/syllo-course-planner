/**
 * Phase 4 — PlannerAgent.
 *
 * Owns: SearchDeps closures, detectGaps dispatch, trace-from-meta (primary)
 * and diffToTrace (fallback). Goal/scoring/validation judgment is NOT owned
 * here — it's delegated to a PolicyProvider (default: TauPolicyProvider),
 * so this file contains no institution-specific degree-rule arithmetic.
 *
 * Design invariants (roadmap-v2.md §2.1):
 *   - SearchStrategy never receives ConstraintModel directly.
 *   - LLM is never the planner; ExplanationCapability runs post-search only.
 *   - KnowledgeCapability.resolve only called when gaps exist.
 *   - diffToTrace is fallback only (when SearchResult.meta is absent).
 */

import { applyMutation as applyMutationFn } from './planner_goals';
import { buildValidationContext } from './planner_validate';
import {
  detectGaps,
  type SearchCapability,
  type KnowledgeCapability,
  type ValidationCapability,
  type ExplanationCapability,
  type GapRecord,
} from './planner_capabilities';
import { type PolicyProvider, TauPolicyProvider } from './planner_policy';
import type { SearchDeps, BeamSearchMeta } from './planner_search_types';
import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  placedCourseIds,
} from './planner_types';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AgentResult {
  finalState: PlanState;
  /** Mutations extracted from meta.chosenPath, or diffToTrace fallback. */
  trace: PlannerMutation[];
  gaps: GapRecord[];
  /** Present when SearchCapability returned BeamSearchMeta. */
  meta?: BeamSearchMeta;
  /** Hebrew rationale from ExplanationCapability; absent when cap absent or throws. */
  rationale_he?: string;
}

/**
 * Defined here (not in planner_capabilities.ts) because it references
 * AgentResult, which lives in this file — putting it in planner_capabilities.ts
 * would create a circular import back into planner_agent.ts.
 */
export interface PlanningCapability {
  run(): Promise<AgentResult>;
}

export interface PlannerAgentOptions {
  model: ConstraintModel;
  initialState: PlanState;
  pinnedHome?: Record<string, string>;
  search: SearchCapability<PlanState, PlannerMutation>;
  knowledge?: KnowledgeCapability;
  validation?: ValidationCapability;
  explanation?: ExplanationCapability;
  /** Goal/scoring/validation rules. Defaults to TauPolicyProvider. */
  policy?: PolicyProvider;
  maxSteps?: number;
  beamWidth?: number;
}

// ── diffToTrace — fallback when meta is absent ────────────────────────────────

function diffToTrace(initial: PlanState, final: PlanState): PlannerMutation[] {
  const initialIds = new Set(placedCourseIds(initial));
  const finalIds = new Set(placedCourseIds(final));
  const mutations: PlannerMutation[] = [];

  for (const [semId, courses] of Object.entries(final.semesters)) {
    for (const id of courses) {
      if (!initialIds.has(id)) {
        mutations.push({ type: 'ADD_COURSE', courseId: id, semesterId: semId });
      }
    }
  }
  for (const id of initialIds) {
    if (!finalIds.has(id)) {
      mutations.push({ type: 'REMOVE_COURSE', courseId: id });
    }
  }
  return mutations;
}

// ── PlannerAgent ──────────────────────────────────────────────────────────────

export class PlannerAgent implements PlanningCapability {
  constructor(private opts: PlannerAgentOptions) {}

  async run(): Promise<AgentResult> {
    const {
      model,
      initialState,
      pinnedHome = {},
      search,
      knowledge,
      validation,
      explanation,
      policy = new TauPolicyProvider(),
      maxSteps = 150,
      beamWidth,
    } = this.opts;

    // Build validation context once per run
    const validationCtx = buildValidationContext(model, pinnedHome);

    // SearchDeps closures — ConstraintModel never passed to SearchStrategy directly
    const deps: SearchDeps<PlanState, PlannerMutation> = {
      generateActions: (s) => policy.generateActions(s, model),
      // ponytail: applyMutationFn returns null for structurally impossible actions;
      // enumerateActions should never produce those, so ?? s is a safe defensive fallback
      applyMutation: (s, a) => applyMutationFn(s, a) ?? s,
      validate: (s) => {
        if (validation) return validation.validateState(s);
        return policy.validate(s, model, pinnedHome, validationCtx);
      },
      score: (s) => policy.score(s, model),
      compareScore: (a, b) => policy.compareScore(a, b),
      isGoal: (s) => policy.isGoal(s, model),
    };

    // Detect gaps before search
    const gaps = detectGaps(model);

    // Knowledge enrichment (only when gaps exist and capability is wired)
    if (knowledge && gaps.length > 0) {
      await knowledge.resolve(gaps);
    }

    // Search
    const searchResult = search.search(initialState, deps, { maxSteps, width: beamWidth });

    // Trace: primary = chosenPath, fallback = set-diff
    const trace: PlannerMutation[] = searchResult.meta
      ? searchResult.meta.chosenPath.map(step => step.action as PlannerMutation)
      : diffToTrace(initialState, searchResult.finalState);

    // Post-search explanation (never before/during search)
    let rationale_he: string | undefined;
    if (explanation) {
      try {
        rationale_he = await explanation.explain(trace);
      } catch (err) {
        console.warn('[PlannerAgent] ExplanationCapability.explain failed:', err instanceof Error ? err.message : String(err));
        // rationale_he stays undefined; caller provides deterministic fallback
      }
    }

    return {
      finalState: searchResult.finalState,
      trace,
      gaps,
      meta: searchResult.meta,
      rationale_he,
    };
  }
}

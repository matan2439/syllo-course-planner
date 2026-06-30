/**
 * Phase 4 — PlannerAgent.
 *
 * Owns: ConstraintModel, SearchDeps closures, detectGaps dispatch,
 * trace-from-meta (primary) and diffToTrace (fallback).
 *
 * Design invariants (roadmap-v2.md §2.1):
 *   - SearchStrategy never receives ConstraintModel directly.
 *   - LLM is never the planner; ExplanationCapability runs post-search only.
 *   - KnowledgeCapability.resolve only called when gaps exist.
 *   - diffToTrace is fallback only (when SearchResult.meta is absent).
 */

import {
  scorePlan,
  compareScore,
  applyMutation as applyMutationFn,
  degreeHours,
} from './planner_goals';
import { enumerateActions } from './planner_actions';
import { validatePlanState, buildValidationContext } from './planner_validate';
import {
  detectGaps,
  type SearchCapability,
  type KnowledgeCapability,
  type ValidationCapability,
  type ExplanationCapability,
  type GapRecord,
} from './planner_capabilities';
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
}

export interface PlannerAgentOptions {
  model: ConstraintModel;
  initialState: PlanState;
  pinnedHome?: Record<string, string>;
  search: SearchCapability<PlanState, PlannerMutation>;
  knowledge?: KnowledgeCapability;
  validation?: ValidationCapability;
  explanation?: ExplanationCapability;
  maxSteps?: number;
  beamWidth?: number;
}

// ── Goal check (mirrors PlannerWorker.isGoalReached, standalone) ──────────────

function isGoalState(state: PlanState, model: ConstraintModel): boolean {
  const placed = new Set(placedCourseIds(state));
  const loads = Object.values(state.semesters).map(
    list => list.reduce((s, id) => s + (model.profiles.get(id)?.hours ?? 0), 0),
  );
  if (loads.some(h => h > model.hardCap)) return false;
  if (degreeHours(state, model) < model.degreeRequiredHours) return false;
  if (!model.requiredMandatoryCourseIds.every(id => placed.has(id))) return false;
  return model.categories.every(
    cat => cat.candidateIds.filter(id => placed.has(id)).length >= cat.required,
  );
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

export class PlannerAgent {
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
      maxSteps = 150,
      beamWidth,
    } = this.opts;

    // Build validation context once per run
    const validationCtx = buildValidationContext(model, pinnedHome);

    // SearchDeps closures — ConstraintModel never passed to SearchStrategy directly
    const deps: SearchDeps<PlanState, PlannerMutation> = {
      generateActions: (s) => enumerateActions(s, model),
      // ponytail: applyMutationFn returns null for structurally impossible actions;
      // enumerateActions should never produce those, so ?? s is a safe defensive fallback
      applyMutation: (s, a) => applyMutationFn(s, a) ?? s,
      validate: (s) => {
        if (validation) return validation.validateState(s);
        const r = validatePlanState(s, model, pinnedHome, validationCtx);
        return { valid: r.valid, reason: r.errors[0] };
      },
      score: (s) => scorePlan(s, model),
      compareScore,
      isGoal: (s) => isGoalState(s, model),
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
    if (explanation) {
      await explanation.explain(trace);
    }

    return {
      finalState: searchResult.finalState,
      trace,
      gaps,
      meta: searchResult.meta,
    };
  }
}

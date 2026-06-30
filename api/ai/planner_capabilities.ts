/**
 * Phase 3 — Capability interfaces + detectGaps pure scan.
 *
 * Capabilities are the PlannerAgent's named invocation points. Each wraps a
 * concern the agent orchestrates: search, knowledge enrichment, validation,
 * and explanation. The agent is the ONLY caller; nothing below the agent layer
 * may invoke capabilities directly.
 *
 * Phase 3 scope (roadmap-v2.md §2.4):
 *   - GapRecord / GapType types
 *   - detectGaps: pure scan of ConstraintModel.profiles — no I/O, no mutations
 *   - SearchCapability, KnowledgeCapability, ValidationCapability,
 *     ExplanationCapability interfaces
 *   - PassThroughKnowledgeCapability: no-op P1 implementation
 *     (real LLM/syllabus enrichment ships in P2)
 */

import type { ConstraintModel } from './planner_types';
import type { SearchDeps, SearchResult } from './planner_search_types';

// ── Gap taxonomy ──────────────────────────────────────────────────────────────

export type GapType =
  | 'null_hours'
  | 'unresolved_category'
  | 'missing_prerequisite'
  | 'missing_allowed_semesters';

export interface GapRecord {
  courseId: string;
  gapType: GapType;
  /** Extra context: the unknown category_id, the missing prerequisite id, etc. */
  detail?: string;
}

// ── detectGaps ────────────────────────────────────────────────────────────────

/**
 * Pure scan of model.profiles for incomplete or ambiguous CourseProfile fields.
 * No I/O, no LLM calls, no mutations. Runs before search so PlannerAgent can
 * decide whether to invoke KnowledgeCapability before committing to a search.
 *
 * Detects:
 *   - null_hours:                hours == null
 *   - unresolved_category:       category_id set but absent from model.categories
 *   - missing_prerequisite:      a prerequisite course_id not in model.profiles
 *   - missing_allowed_semesters: all four semester-source fields are null
 */
export function detectGaps(model: ConstraintModel): GapRecord[] {
  const gaps: GapRecord[] = [];
  const knownCategoryIds = new Set(model.categories.map(c => c.id));
  const knownCourseIds = new Set(model.profiles.keys());

  for (const [courseId, profile] of model.profiles) {
    if (profile.hours == null) {
      gaps.push({ courseId, gapType: 'null_hours' });
    }

    if (profile.category_id !== null && !knownCategoryIds.has(profile.category_id)) {
      gaps.push({ courseId, gapType: 'unresolved_category', detail: profile.category_id });
    }

    for (const prereqId of profile.prerequisites) {
      if (!knownCourseIds.has(prereqId)) {
        gaps.push({ courseId, gapType: 'missing_prerequisite', detail: prereqId });
      }
    }

    if (
      profile.effective_allowed_semesters == null &&
      profile.offered_semesters == null &&
      profile.allowed_semesters == null &&
      profile.program_allowed_semesters == null
    ) {
      gaps.push({ courseId, gapType: 'missing_allowed_semesters' });
    }
  }

  return gaps;
}

// ── Capability interfaces ─────────────────────────────────────────────────────

/**
 * Wraps a SearchStrategy. PlannerAgent invokes this to run the core search;
 * the concrete strategy (BeamSearch, CP-SAT, …) is injected at construction.
 */
export interface SearchCapability<S, A> {
  search(
    initialState: S,
    deps: SearchDeps<S, A>,
    opts: { maxSteps: number; width?: number },
  ): SearchResult<S>;
}

/**
 * Wraps gap resolution (knowledge enrichment). PlannerAgent may invoke this
 * before or during search when detectGaps reveals missing data.
 * resolve() is intentionally async — real implementations call LLMs or read
 * syllabi; the P1 pass-through is synchronously void.
 */
export interface KnowledgeCapability {
  resolve(gaps: GapRecord[]): Promise<void>;
}

/**
 * Wraps state/candidate validation. PlannerAgent uses this to build the
 * validateState closure injected into SearchDeps, and to run the full
 * CandidateReport gate on terminal beam states.
 */
export interface ValidationCapability {
  validateState(state: unknown): { valid: boolean; reason?: string };
}

/**
 * Wraps post-search explanation generation. PlannerAgent invokes this after
 * search produces a final trace; the implementation calls LlmExplainer to
 * produce Hebrew prose. Never called before or during search.
 */
export interface ExplanationCapability {
  explain(trace: unknown[]): Promise<string>;
}

// ── PassThroughKnowledgeCapability — no-op P1 implementation ─────────────────

/** ponytail: no-op until P2 ships real LLM/syllabus enrichment */
export class PassThroughKnowledgeCapability implements KnowledgeCapability {
  async resolve(_gaps: GapRecord[]): Promise<void> {
    // intentional no-op for P1
  }
}

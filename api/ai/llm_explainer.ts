/**
 * LlmExplainer — post-search ExplanationCapability.
 *
 * Invoked by PlannerAgent AFTER search to generate a Hebrew rationale from the
 * plan trace. NEVER called during step selection — the LLM is not the planner.
 *
 * ponytail: real LLM call via AI SDK ships when syllabus KnowledgeCapability
 * ships (Phase 6). Phase 5 uses a deterministic trace summary so the full
 * agent pipeline can be wired and tested without a live model.
 */

import type { LanguageModel } from 'ai';
import type { ExplanationCapability } from './planner_capabilities';
import type { PlannerMutation } from './planner_types';

export class LlmExplainer implements ExplanationCapability {
  constructor(private model: LanguageModel) {}

  async explain(trace: unknown[]): Promise<string> {
    const mutations = trace as PlannerMutation[];
    const added   = mutations.filter(m => m.type === 'ADD_COURSE').length;
    const removed  = mutations.filter(m => m.type === 'REMOVE_COURSE').length;
    const moved    = mutations.filter(m => m.type === 'MOVE_COURSE').length;
    const replaced = mutations.filter(m => m.type === 'REPLACE_COURSE').length;

    if (mutations.length === 0) {
      return 'תוכנית אוטומטית — אין שינויים מהתוכנית הנוכחית.';
    }
    const parts: string[] = [];
    if (added   > 0) parts.push(`שובצו ${added} קורסים`);
    if (removed > 0) parts.push(`הוסרו ${removed} קורסים`);
    if (moved   > 0) parts.push(`הוזזו ${moved} קורסים`);
    if (replaced > 0) parts.push(`הוחלפו ${replaced} קורסים`);
    return `תוכנית אוטומטית — ${parts.join(', ')}.`;
  }
}

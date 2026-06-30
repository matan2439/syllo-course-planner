/**
 * Orchestrators — pluggable strategies that decide WHICH of the worker's
 * deterministic tools to call next. The PlannerWorker owns the planning process;
 * an Orchestrator only drives it. The LLM is the current orchestration backend,
 * not the owner of planning — it is injected and interchangeable with the
 * deterministic GreedyOrchestrator against the same worker tool API.
 */

import { generateText, type LanguageModel } from 'ai';
import type { PlannerWorker } from './planner_worker';
import { buildPlannerTools, type PlannerTools } from './planner_tools';

export interface Orchestrator {
  run(worker: PlannerWorker): Promise<void>;
}

/** Deterministic backend + test oracle: drives the worker's own greedy loop. */
export class GreedyOrchestrator implements Orchestrator {
  async run(worker: PlannerWorker): Promise<void> {
    worker.run(500, 'greedy');
  }
}

/** Signature of the generateText-like driver, injectable for testing. */
export type GenerateFn = (args: {
  model: LanguageModel;
  system?: string;
  prompt?: string;
  tools: PlannerTools;
  maxSteps?: number;
}) => Promise<unknown>;

export interface LlmOrchestratorOptions {
  /** Injectable driver (defaults to the real AI-SDK generateText). */
  generate?: GenerateFn;
  maxSteps?: number;
  system?: string;
  prompt?: string;
}

const DEFAULT_SYSTEM =
  'אתה מתכנן מערכת לימודים. השתמש בכלים כדי לבנות תוכנית מלאה וחוקית: שבץ תחילה ' +
  'קורסי חובה, מלא דרישות קטגוריה, השלם את שעות התואר, ואזן את העומס. אל תקבע עובדות ' +
  'בעצמך — כל שיבוץ נבדק על ידי המערכת. סיים בקריאה ל-finalize_plan.';

/**
 * LLM backend: the model reasons step-by-step and calls the worker's tools in a
 * generateText/tool-calling loop. The worker validates every call, so an invalid
 * tool call cannot corrupt the plan. Whatever the model does (or if it errors),
 * a deterministic finishing pass guarantees a valid, complete plan.
 */
export class LlmOrchestrator implements Orchestrator {
  constructor(private model: LanguageModel, private opts: LlmOrchestratorOptions = {}) {}

  async run(worker: PlannerWorker): Promise<void> {
    const tools = buildPlannerTools(worker);
    const generate = this.opts.generate ?? (generateText as unknown as GenerateFn);
    try {
      await generate({
        model: this.model,
        system: this.opts.system ?? DEFAULT_SYSTEM,
        prompt: this.opts.prompt ?? 'בנה תוכנית לימודים מלאה וחוקית באמצעות הכלים.',
        tools,
        maxSteps: this.opts.maxSteps ?? 24,
      });
    } catch (err) {
      // Model/transport failure — fall through to the deterministic completion.
      console.error('[planner] LlmOrchestrator generate failed, falling back to greedy:',
        err instanceof Error ? err.message : String(err));
    }

    // Guarantee a valid, complete plan regardless of what the model did: the
    // deterministic worker loop finishes/repairs whatever the LLM left.
    if (!worker.validateCandidate().valid) {
      worker.run(500, 'greedy');
    }
  }
}

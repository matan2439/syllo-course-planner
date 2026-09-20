/**
 * PRODUCTION SEMANTIC PROVIDER — a real language-model extractor built on the repo's
 * existing AI SDK abstraction (resolveModel + `ai` generateObject with a strict zod
 * schema). It turns an authoritative syllabus snapshot into UNTRUSTED candidate
 * capability claims; the deterministic validator (semantic_extraction_validator.ts)
 * re-grounds and bounds everything before any claim can affect the planner.
 *
 * Guarantees:
 *  - the SYLLABUS SNAPSHOT is the only authority in the prompt (title excluded; no
 *    course ids, expected classifications, or planner choices are ever injected);
 *  - structured output is validated by a strict schema (bounded enums/ranges);
 *  - bounded input size, timeout, and retries; provider/timeout/parse/schema failures
 *    are classified and thrown (never silently swallowed);
 *  - the model returns verbatim excerpts only — offsets are computed by US against the
 *    snapshot (buildCapturedExtraction), so a wrong offset cannot smuggle a claim past
 *    grounding;
 *  - raw model output never reaches the user; credentials and full prompts are never logged;
 *  - injectable `generate`/`model` for deterministic tests; NEVER called by Generate.
 */
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { resolveModel, PROVIDER_KEY_ENV } from './course-planner';
import {
  buildCapturedExtraction,
  EXTRACTION_INFERENCE_LEVELS,
  type CandidateExtraction,
  type CapturedClaimSpec,
  type SemanticExtractionProvider,
} from './semantic_course_extraction';
import type { SyllabusSnapshot } from './syllabus_snapshot';

export type SemanticProviderFailureKind = 'no_model' | 'timeout' | 'provider' | 'parse' | 'schema';
export class SemanticProviderError extends Error {
  /** Set when a bounded schema-repair generation was attempted before this final failure. */
  public repairAttempted?: boolean;
  constructor(public readonly kind: SemanticProviderFailureKind, message: string) {
    super(message);
    this.name = 'SemanticProviderError';
  }
}

// Strict structured-output schema. The model proposes; the validator disposes.
const claimSchema = z.object({
  capability: z.string().max(64),
  relationship: z.string().max(32),
  inferenceLevel: z.enum(EXTRACTION_INFERENCE_LEVELS),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  // Verbatim substrings of the supplied syllabus text; offsets are recomputed by us.
  evidenceExcerpts: z.array(z.string().max(400)).max(6),
  rationale: z.string().max(600),
  unsupportedOrAmbiguous: z.boolean(),
});
export const llmExtractionSchema = z.object({ claims: z.array(claimSchema).max(16) });
export type LlmExtractionObject = z.infer<typeof llmExtractionSchema>;

/** Injectable generateObject-shaped driver (defaults to the real AI SDK). */
export type GenerateObjectFn = (args: {
  model: LanguageModel;
  schema: typeof llmExtractionSchema;
  prompt: string;
  abortSignal?: AbortSignal;
  maxRetries?: number;
}) => Promise<{ object: LlmExtractionObject }>;

export interface LlmSemanticProviderOptions {
  model?: LanguageModel;
  modelName?: string;
  generate?: GenerateObjectFn;
  timeoutMs?: number;
  maxRetries?: number;
  maxInputChars?: number;
  /**
   * Bounded schema-repair generations after a first attempt fails with kind 'schema'
   * (the AI SDK's maxRetries covers transport/API only, never a schema-invalid
   * generation). Default 1; a repair attempt can never itself trigger another repair.
   */
  repairMaxAttempts?: number;
}

/** Neutral, generic gloss of each ontology capability (NOT per-course answers). */
const CAPABILITY_GLOSS: Record<string, string> = {
  mechanical_design:
    'mechanical/engineering design — design methods or a design process, designing a product/part/mechanism/device, prototyping, or CAD/analysis tooling used as part of a design activity (Hebrew: תכן/עיצוב הנדסי, שיטות/תהליך תכן, אב טיפוס).',
};

function buildPrompt(snapshot: SyllabusSnapshot, capabilities: readonly string[], maxInputChars: number): string {
  const content = snapshot.normalizedContent.slice(0, maxInputChars);
  const caps = capabilities.map((c) => `- ${c}: ${CAPABILITY_GLOSS[c] ?? c}`).join('\n');
  return [
    'You extract capability evidence from ONE official university course syllabus.',
    'The SYLLABUS TEXT below is the ONLY authority. Use no outside knowledge and no course title.',
    'For each capability, decide inferenceLevel: "explicit" (directly stated), "derived"',
    '(reasonably inferred from the text), "estimated" (weak/indirect), or "missing" (not supported).',
    'For explicit/derived/estimated, provide evidenceExcerpts copied VERBATIM (exact substrings)',
    'from the SYLLABUS TEXT — never paraphrased, never from a title. For "missing", use no excerpts.',
    'Do not invent content that is not in the text. Return only the requested JSON.',
    '',
    `CAPABILITIES:\n${caps}`,
    '',
    `SYLLABUS TEXT (language=${snapshot.language}):`,
    content,
  ].join('\n');
}

/**
 * STRUCTURE-ONLY repair prompt: reuses the exact classification instructions (criteria
 * unchanged) and appends a purely-structural correction restating the output schema. It
 * deliberately does NOT suggest that an empty result is preferred and does NOT mention any
 * course id/title/institution/program or expected answer — so it cannot bias a subtle
 * derived relationship toward a false "missing"/empty result.
 */
function buildRepairPrompt(snapshot: SyllabusSnapshot, capabilities: readonly string[], maxInputChars: number): string {
  return [
    buildPrompt(snapshot, capabilities, maxInputChars),
    '',
    'NOTE: your previous reply was not a valid JSON object matching the required schema.',
    'Reply again with ONLY a single JSON object of exactly this shape and nothing else:',
    '{ "claims": [ { "capability": string, "relationship": string,',
    '  "inferenceLevel": "explicit"|"derived"|"estimated"|"missing", "strength": number (0..1),',
    '  "confidence": number (0..1), "evidenceExcerpts": string[], "rationale": string,',
    '  "unsupportedOrAmbiguous": boolean } ] }',
    'Keep the SAME assessment you would otherwise give — do not add, drop, weaken, or change',
    'any capability judgement in order to make the JSON valid; only fix the JSON structure.',
  ].join('\n');
}

function classifyError(err: unknown): SemanticProviderError {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'AbortError' || /abort|timeout/i.test(msg)) return new SemanticProviderError('timeout', 'semantic provider timed out');
  if (/NoObjectGenerated|TypeValidation|schema/i.test(name + msg)) return new SemanticProviderError('schema', 'model output failed schema validation');
  if (/JSONParse|parse/i.test(name + msg)) return new SemanticProviderError('parse', 'model output could not be parsed');
  return new SemanticProviderError('provider', `semantic provider error: ${msg.slice(0, 200)}`);
}

export class LlmSemanticExtractionProvider implements SemanticExtractionProvider {
  public readonly name: string;
  private readonly model: LanguageModel;
  private readonly generate: GenerateObjectFn;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxInputChars: number;
  private readonly repairMaxAttempts: number;

  constructor(opts: LlmSemanticProviderOptions = {}) {
    let model = opts.model;
    let modelName = opts.modelName;
    if (!model) {
      const resolved = resolveModel();
      if (!resolved) {
        const need = Object.values(PROVIDER_KEY_ENV).join(' or ');
        throw new SemanticProviderError('no_model', `no model provider configured — set one of: ${need} (and optionally AI_PROVIDER)`);
      }
      model = resolved.model;
      modelName = resolved.name;
    }
    this.model = model;
    this.name = `llm:${modelName ?? 'unknown'}`;
    this.generate = opts.generate ?? (generateObject as unknown as GenerateObjectFn);
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxInputChars = opts.maxInputChars ?? 8000;
    this.repairMaxAttempts = opts.repairMaxAttempts ?? 1;
  }

  /** One structured generation, timeout-raced and error-classified (never swallowed). */
  private async generateOnce(prompt: string): Promise<LlmExtractionObject> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Race an owned timeout so the call rejects even if the driver ignores the signal.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SemanticProviderError('timeout', `semantic provider timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
    try {
      const call = this.generate({ model: this.model, schema: llmExtractionSchema, prompt, abortSignal: controller.signal, maxRetries: this.maxRetries });
      const { object } = await Promise.race([call, timeout]);
      return object;
    } catch (err) {
      throw err instanceof SemanticProviderError ? err : classifyError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Map untrusted model claims → captured-spec shape → GROUNDED candidate extraction.
   * Offsets are computed against the snapshot; excerpts not present verbatim are dropped
   * here and any resulting empty positive claim is rejected downstream by the validator.
   */
  private toExtraction(snapshot: SyllabusSnapshot, object: LlmExtractionObject, attempts: { normal: number; schemaRepair: number }): CandidateExtraction {
    const specs: CapturedClaimSpec[] = (object.claims ?? []).map((c) => ({
      capability: c.capability,
      relationship: c.relationship,
      inferenceLevel: c.inferenceLevel,
      strength: c.strength,
      confidence: c.confidence,
      rationale: c.rationale,
      excerpts: c.evidenceExcerpts ?? [],
      unsupportedOrAmbiguous: c.unsupportedOrAmbiguous,
    }));
    const extraction = buildCapturedExtraction(snapshot, specs);
    extraction.attempts = attempts;
    return extraction;
  }

  async extract(snapshot: SyllabusSnapshot, capabilities: readonly string[]): Promise<CandidateExtraction> {
    if (!snapshot.normalizedContent) return { courseId: snapshot.courseId, snapshotHash: snapshot.contentHash, claims: [], attempts: { normal: 1, schemaRepair: 0 } };

    let firstErr: SemanticProviderError;
    try {
      const object = await this.generateOnce(buildPrompt(snapshot, capabilities, this.maxInputChars));
      return this.toExtraction(snapshot, object, { normal: 1, schemaRepair: 0 });
    } catch (err) {
      firstErr = err instanceof SemanticProviderError ? err : classifyError(err);
    }

    // Exactly one bounded, structure-only repair — ONLY for a schema failure, never for
    // provider/timeout/parse, and a repair can never itself trigger a further repair.
    if (firstErr.kind !== 'schema' || this.repairMaxAttempts < 1) throw firstErr;
    try {
      const object = await this.generateOnce(buildRepairPrompt(snapshot, capabilities, this.maxInputChars));
      return this.toExtraction(snapshot, object, { normal: 1, schemaRepair: 1 });
    } catch (err) {
      const e = err instanceof SemanticProviderError ? err : classifyError(err);
      e.repairAttempted = true;
      throw e;
    }
  }
}

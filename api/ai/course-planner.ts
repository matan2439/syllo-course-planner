/**
 * POST /api/ai/course-planner
 *
 * Per-course chat ("ask about this course"). Streams a plain-text answer from
 * the co-pilot engine in course mode (api/ai/agent/course_advisor.ts): the
 * planner's read-only tools plus live grades and the official syllabus, with the
 * panel's conversation history and the student's real plan context.
 *
 * Runtime: Node.js (quota check requires TCP connection to Postgres).
 *
 * ── HANDLER PATTERN ───────────────────────────────────────────────────────────
 * Uses Vercel Node.js handler pattern: (req: VercelRequest, res: VercelResponse).
 * Returning a Web API Response object from a Node.js Vercel function is silently
 * ignored — the runtime logs "WARN: default export return..." and the response
 * is never sent, causing a 504 timeout.
 *
 * All responses must use:
 *   res.status(n).json(...)    for JSON errors
 *   res.write(...) / res.end() for streaming
 *
 * ── STREAMING ─────────────────────────────────────────────────────────────────
 * The advisor's text stream has exactly ONE reader (pipeTextStream), which
 * peeks the first chunk so provider failures still return a JSON error.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { streamCourseAdvisor } from './agent/course_advisor';
import { agentModelName } from './agent/planner_agent';
import { openMeteredOperation, sendMeterRefusal, type MeteredOperation } from './metering';
import type { OperationUsage } from './credits';

// ── Input schema ──────────────────────────────────────────────────────────────

// Note: several fields use .nullish() (not .optional()) because the JavaScript
// frontend sends null for missing course properties, not undefined.
// z.string().optional() = string | undefined — rejects null.
// z.string().nullish()  = string | null | undefined — accepts both.
const courseInPlanSchema = z.object({
  course_id:              z.string(),
  name_he:                z.string().nullish(),   // c.name_he can be null (stub courses)
  hours:                  z.number().nullish(),   // c.weekly_hours is null for many courses
  difficulty_level:       z.string().nullish(),   // can be null before difficulty is computed
  difficulty_score:       z.number().nullish(),   // same
  course_type:            z.string().optional(),  // always set to 'elective' if missing
  placement_policy:       z.string().nullish(),   // 'fixed' | 'flexible' | 'elective' — movability for load balance
  effective_allowed_semesters: z.array(z.string()).nullish(),
  category:               z.string().nullish(),   // null when both category fields are absent
  missing_prerequisites:  z.array(z.string()).optional(),
  // Difficulty sub-scores — null/missing if not yet computed
  workload_score:              z.number().nullish(),
  conceptual_complexity_score: z.number().nullish(),
  prerequisite_depth_score:    z.number().nullish(),
  assessment_intensity_score:  z.number().nullish(),
  difficulty_confidence:       z.number().nullish(),
  assessment_type:             z.string().nullish(),
  has_syllabus:                z.boolean().optional(),
  has_syllabus_summary:        z.boolean().optional(),
});

// The planner board sends only ids (label/total_hours are optional).
const semesterPlanSchema = z.object({
  id: z.string(),
  label: z.string().nullish(),
  courses: z.array(courseInPlanSchema),
  total_hours: z.number().nullish(),
});

const planContextSchema = z.object({
  program_name: z.string().nullish(),
  semesters:    z.array(semesterPlanSchema),
  mandatory_unplaced: z
    .array(z.object({
      course_id: z.string(),
      name_he:   z.string().nullish(),   // c.name_he can be null
      hours:     z.number().nullish(),   // c.weekly_hours can be null
    }))
    .optional(),
  requirements_progress: z
    .object({
      completed_hours: z.number(),
      required_hours:  z.number(),
      categories:      z.array(z.object({ name: z.string(), required: z.number(), placed: z.number() })),
    })
    .optional(),
  prerequisite_issues: z
    .array(z.object({
      course_id: z.string(),
      name_he:   z.string().nullish(),   // c.name_he can be null
      missing:   z.array(z.string()),
    }))
    .optional(),
  personal_status: z
    .object({
      completed:        z.array(z.object({ course_id: z.string(), name_he: z.string().nullish(), semester_label: z.string().nullish() })).optional(),
      currently_taking: z.array(z.object({ course_id: z.string(), name_he: z.string().nullish(), semester_label: z.string().nullish() })).optional(),
      planned:          z.array(z.object({ course_id: z.string(), name_he: z.string().nullish(), semester_label: z.string().nullish() })).optional(),
    })
    .passthrough()
    .optional(),
  personal_prerequisite_issues: z
    .array(z.object({
      course_id: z.string(),
      name_he:   z.string().nullish(),
      issues:    z.array(z.string()),
    }))
    .optional(),
  grade_signals: z
    .record(z.object({
      average_grade:      z.number().optional(),
      median_grade:       z.number().nullish(),
      pass_rate:          z.number().nullish(),
      num_students_total: z.number().optional(),
    }))
    .optional(),
  // PART F — user preferences carried over from the plan-generation UI, for chat context.
  preferences: z
    .object({
      wanted_course_ids:   z.array(z.string()).optional(),
      unwanted_course_ids: z.array(z.string()).optional(),
      extra_request_he:    z.string().max(1000).optional(),
    })
    .optional(),
})
  // The planner's own context keys (total_hours_progress, completed_category_counts, …)
  // reach the co-pilot engine unchanged.
  .passthrough();

const requestSchema = z.object({
  message:        z.string().min(1, 'message is required').max(2000, 'message too long'),
  program_id:     z.string().min(1, 'program_id is required'),
  plan_context:   planContextSchema,
  course_context: z.string().max(4000).optional(),
  /** The course the panel shows; the engine starts its lookups there. */
  course_id:      z.string().max(64).optional(),
  /** Earlier turns of this panel conversation, oldest first. */
  history:        z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).max(20).optional(),
  /** Stored planner preferences, so answers respect the student's choices. */
  preferences:    z.record(z.unknown()).optional(),
  session_token:  z.string().uuid('session_token must be a valid UUID'),
});

// ── Model selection ───────────────────────────────────────────────────────────

export type AiProvider = 'anthropic' | 'openai' | 'google';

export interface ModelConfig { model: LanguageModel; name: string; provider: AiProvider }

/** Low-cost default model per provider. */
const PROVIDER_MODEL: Record<AiProvider, string> = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google:    'gemini-1.5-flash',
};

export const PROVIDER_KEY_ENV: Record<AiProvider, string> = {
  openai:    'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GOOGLE_GENERATIVE_AI_API_KEY',
};

function buildModel(p: AiProvider): ModelConfig | null {
  const apiKey = process.env[PROVIDER_KEY_ENV[p]];
  if (!apiKey) return null;
  const modelName = PROVIDER_MODEL[p];
  switch (p) {
    case 'openai':
      return { model: createOpenAI({ apiKey })(modelName), name: modelName, provider: p };
    case 'anthropic':
      return { model: createAnthropic({ apiKey })(modelName), name: modelName, provider: p };
    case 'google':
      return { model: createGoogleGenerativeAI({ apiKey })(modelName), name: modelName, provider: p };
  }
}

/**
 * Resolve which AI provider/model to use.
 *
 * AI_PROVIDER=anthropic|openai|google selects a provider explicitly — if its
 * API key is missing, resolution fails (no fallback to other providers).
 *
 * If AI_PROVIDER is unset, falls back through OpenAI → Anthropic → Google,
 * picking the first provider with an API key configured. OpenAI's
 * gpt-4o-mini is the recommended default: low cost and good Hebrew quality.
 */
export function resolveModel(): ModelConfig | null {
  const requested = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (requested) {
    if (requested !== 'anthropic' && requested !== 'openai' && requested !== 'google') {
      console.error(`[ai] unknown AI_PROVIDER "${requested}" — ignoring`);
    } else {
      return buildModel(requested);
    }
  }
  return buildModel('openai') ?? buildModel('anthropic') ?? buildModel('google');
}

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  google:    'Google',
};

// ── Dev mode ──────────────────────────────────────────────────────────────────

export function isDevMode(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.AI_DEV_MODE === 'true';
}

export function isBypassQuota(): boolean {
  return isDevMode() && process.env.AI_DEV_BYPASS_QUOTA === 'true';
}

/**
 * Legacy anonymous-quota override, read ONLY by the dev-only endpoints
 * generate-plan / planner-run (no production route, see vercel.json).
 * It never bypasses Syllo Credits metering (metering.ts).
 */
export function isTestModeBypass(): boolean {
  return process.env.AI_TEST_MODE === 'true';
}

// ── Response helpers ──────────────────────────────────────────────────────────

export function sendError(
  res: VercelResponse,
  status: number,
  message: string,
  code?: string,
  details?: unknown,
): void {
  const body: Record<string, unknown> = { error: message };
  if (code)    body.code    = code;
  if (details) body.details = details;
  res.status(status).json(body);
}

/** Write mock text directly to the response (dev mode, no real model call). */
async function sendMockStream(res: VercelResponse): Promise<void> {
  const text =
    '[מצב פיתוח] תשובת AI לדוגמה — אין קריאה לספק מודל אמיתי.\n' +
    'ניתן לבדוק את זרימת ה-UI, ניהול מכסה וטיפול בשגיאות ללא עלויות API.';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-AI-Dev-Mode', 'true');
  res.status(200);
  res.write(text);
  res.end();
}

/**
 * Classify a provider-level error and send an appropriate JSON response.
 * Called when the stream errors or returns no chunks before any response is committed.
 */
function classifyAndSendProviderError(res: VercelResponse, err: unknown, provider: AiProvider): void {
  const msg    = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? 0;
  const label  = PROVIDER_LABEL[provider];
  const keyEnv = PROVIDER_KEY_ENV[provider];
  console.error('[ai] provider error — status:', status, '— message:', msg);

  if (status === 401 || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('invalid api key')) {
    console.error('[ai] CLASSIFICATION: AI_AUTH_ERROR');
    sendError(res, 503, `שגיאת אימות ב-API של ${label} — בדוק את ${keyEnv}.`, 'AI_AUTH_ERROR');
  } else if (
    status === 402 || status === 403 ||
    msg.toLowerCase().includes('billing') || msg.toLowerCase().includes('credit') ||
    msg.toLowerCase().includes('quota')   || msg.toLowerCase().includes('permission')
  ) {
    console.error('[ai] CLASSIFICATION: AI_BILLING_ERROR');
    sendError(res, 503, `לא ניתן לבצע קריאה ל-${label} — בדוק חיוב/קרדיטים בקונסולה.`, 'AI_BILLING_ERROR');
  } else if (status === 429 || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('rate_limit')) {
    console.error('[ai] CLASSIFICATION: AI_RATE_LIMIT');
    sendError(res, 429, `הגעת למגבלת קריאות ${label} — נסה שוב עוד כמה שניות.`, 'AI_RATE_LIMIT');
  } else {
    console.error('[ai] CLASSIFICATION: AI_PROVIDER_ERROR');
    sendError(res, 503, 'שגיאה בספק ה-AI — נסה שוב.', 'AI_PROVIDER_ERROR', { detail: msg });
  }
}

/**
 * Pipe result.textStream (ReadableStream<string>) to a Node.js VercelResponse.
 *
 * Reads the FIRST chunk before committing the 200 response.  If the provider
 * silently closes the stream with no chunks (e.g. Anthropic billing/auth error
 * handled inside the SDK), we can still return a proper JSON error instead of
 * a 200 with an empty body that the browser shows as "תשובה ריקה".
 */
/** Returns true once content was delivered (a 200 stream was committed). */
async function pipeTextStream(
  res: VercelResponse,
  textStream: ReadableStream<string>,
  provider: AiProvider,
): Promise<boolean> {
  const reader = textStream.getReader();

  // ── Peek at the first chunk ──────────────────────────────────────────────
  let first: ReadableStreamReadResult<string>;
  try {
    first = await reader.read();
  } catch (err) {
    // Provider threw on first read — classify and return JSON error
    classifyAndSendProviderError(res, err, provider);
    return false;
  }

  if (first.done) {
    // Stream ended immediately with zero chunks and no exception.
    // This is how the Vercel AI SDK signals a silenced provider error
    // (billing, auth, quota).  Log and return a proper JSON error.
    console.error('[ai] stream empty — provider returned no chunks (likely billing/auth issue)');
    sendError(
      res, 503,
      `שירות ה-AI לא החזיר תוכן. בדוק חיוב/קרדיטים בקונסולה של ${PROVIDER_LABEL[provider]}.`,
      'AI_EMPTY_RESPONSE',
    );
    return false;
  }

  // ── First chunk received — commit the streaming response ─────────────────
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200);
  res.write(first.value);

  // ── Stream remaining chunks ───────────────────────────────────────────────
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    console.error('[ai] mid-stream error:', err instanceof Error ? err.message : String(err));
  } finally {
    res.end();
  }
  return true;
}

// ── Metering ──────────────────────────────────────────────────────────────────

/** Admit one metered answer, or write the refusal (401/402/503) and return null. */
async function openMeter(req: VercelRequest, res: VercelResponse, model: string): Promise<MeteredOperation | null> {
  const meter = await openMeteredOperation(req, res, { endpoint: 'course-planner', model });
  if ('refused' in meter) {
    sendMeterRefusal(res, meter.refused);
    return null;
  }
  return meter;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS on every response
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  // req.body is auto-parsed by Vercel Node runtime for application/json requests
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    // Include safe Zod issue paths/messages — no user data, no secrets
    const issues = parsed.error.issues.map(i => ({
      path:    i.path.join('.'),
      message: i.message,
    }));
    console.error('[ai] validation failed:', JSON.stringify(issues));
    sendError(res, 400, 'Invalid request', 'INVALID_REQUEST', { issues });
    return;
  }

  const { message, program_id, plan_context, course_context, course_id, history, preferences, session_token } = parsed.data;

  console.log('[ai] request started — program_id:', program_id,
    '— session_token present:', !!session_token);

  // ── Dev mode fast path ────────────────────────────────────────────────────
  if (isDevMode()) {
    console.log('[ai] dev mode active — bypass_quota:', isBypassQuota());

    if (isBypassQuota()) {
      await sendMockStream(res);
      return;
    }

    const meter = await openMeter(req, res, 'dev-mock');
    if (!meter) return;
    await meter.deliver({ model: 'dev-mock' });

    await sendMockStream(res);
    return;
  }

  // ── Production / real AI path ─────────────────────────────────────────────
  // The course chat runs the read-only course advisor (OpenAI Agents SDK).

  if (!(process.env.OPENAI_API_KEY ?? '').trim()) {
    console.log('[ai] no OpenAI API key configured');
    sendError(res, 503,
      'לא הוגדר מפתח AI עבור OpenAI. בסביבת Vercel — הוסף OPENAI_API_KEY בלוח הבקרה. מקומית — הגדר בקובץ .env.local.',
      'NO_API_KEY');
    return;
  }
  const modelName = agentModelName();
  console.log('[ai] course advisor model:', modelName);

  const meter = await openMeter(req, res, modelName);
  if (!meter) return;

  let delivered = false;
  let usage: (() => OperationUsage | undefined) | undefined;
  try {
    const advisor = await streamCourseAdvisor({
      message,
      programId: program_id,
      planContext: plan_context as Record<string, unknown>,
      courseContext: course_context,
      courseId: course_id,
      history,
      preferences,
    }).catch((err) => {
      classifyAndSendProviderError(res, err, 'openai');
      return null;
    });
    if (!advisor) return;
    usage = advisor.usage;
    // Settle the run's promise so a late failure is logged, never unhandled.
    const completed = advisor.completed.catch((err) => {
      console.error('[ai] course advisor run failed:', err instanceof Error ? err.message : String(err));
    });
    console.log('[ai] stream started');
    delivered = await pipeTextStream(res, advisor.textStream, 'openai');
    await completed;
  } finally {
    // One credit per answer that reached the student (they keep what they saw);
    // an empty or failed run returns the reserved credit.
    if (delivered) await meter.deliver(usage?.());
    else await meter.release('no_reply');
  }
}

/**
 * POST /api/ai/course-planner
 *
 * Streaming AI endpoint for TAU course-planner assistant.
 * Supports Anthropic (preferred) and OpenAI via Vercel AI SDK.
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
 * Uses result.textStream (ReadableStream<string>) instead of
 * result.toTextStreamResponse() so there is exactly ONE stream reader and no
 * dual-reader conflict that caused the previous hang.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt, type PlanContext } from './_context';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';

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
  category:               z.string().nullish(),   // null when both category fields are absent
  missing_prerequisites:  z.array(z.string()).optional(),
});

const semesterPlanSchema = z.object({
  id: z.string(),
  label: z.string(),
  courses: z.array(courseInPlanSchema),
  total_hours: z.number(),
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
  grade_signals: z
    .record(z.object({ average_grade: z.number().optional(), num_students_total: z.number().optional() }))
    .optional(),
});

const requestSchema = z.object({
  message:        z.string().min(1, 'message is required').max(2000, 'message too long'),
  program_id:     z.string().min(1, 'program_id is required'),
  plan_context:   planContextSchema,
  course_context: z.string().max(4000).optional(),
  session_token:  z.string().uuid('session_token must be a valid UUID'),
});

// ── Model selection ───────────────────────────────────────────────────────────

interface ModelConfig { model: LanguageModel; name: string }

function resolveModel(): ModelConfig | null {
  if (process.env.ANTHROPIC_API_KEY) {
    const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return { model: provider('claude-3-5-sonnet-20241022'), name: 'claude-3-5-sonnet-20241022' };
  }
  if (process.env.OPENAI_API_KEY) {
    const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return { model: provider('gpt-4o-mini'), name: 'gpt-4o-mini' };
  }
  return null;
}

// ── Dev mode ──────────────────────────────────────────────────────────────────

function isDevMode(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.AI_DEV_MODE === 'true';
}

function isBypassQuota(): boolean {
  return isDevMode() && process.env.AI_DEV_BYPASS_QUOTA === 'true';
}

// ── Response helpers ──────────────────────────────────────────────────────────

function sendError(
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
function classifyAndSendProviderError(res: VercelResponse, err: unknown): void {
  const msg    = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? 0;
  console.error('[ai] provider error — status:', status, '— message:', msg);

  if (status === 401 || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('invalid api key')) {
    console.error('[ai] CLASSIFICATION: AI_AUTH_ERROR');
    sendError(res, 503, 'שגיאת אימות ב-API של Anthropic — בדוק את ANTHROPIC_API_KEY.', 'AI_AUTH_ERROR');
  } else if (
    status === 402 || status === 403 ||
    msg.toLowerCase().includes('billing') || msg.toLowerCase().includes('credit') ||
    msg.toLowerCase().includes('quota')   || msg.toLowerCase().includes('permission')
  ) {
    console.error('[ai] CLASSIFICATION: AI_BILLING_ERROR');
    sendError(res, 503, 'לא ניתן לבצע קריאה ל-Anthropic — בדוק חיוב/קרדיטים בקונסולה.', 'AI_BILLING_ERROR');
  } else if (status === 429 || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('rate_limit')) {
    console.error('[ai] CLASSIFICATION: AI_RATE_LIMIT');
    sendError(res, 429, 'הגעת למגבלת קריאות Anthropic — נסה שוב עוד כמה שניות.', 'AI_RATE_LIMIT');
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
async function pipeTextStream(
  res: VercelResponse,
  textStream: ReadableStream<string>,
): Promise<void> {
  const reader = textStream.getReader();

  // ── Peek at the first chunk ──────────────────────────────────────────────
  let first: ReadableStreamReadResult<string>;
  try {
    first = await reader.read();
  } catch (err) {
    // Provider threw on first read — classify and return JSON error
    classifyAndSendProviderError(res, err);
    return;
  }

  if (first.done) {
    // Stream ended immediately with zero chunks and no exception.
    // This is how the Vercel AI SDK signals a silenced provider error
    // (billing, auth, quota).  Log and return a proper JSON error.
    console.error('[ai] stream empty — provider returned no chunks (likely billing/auth issue)');
    sendError(
      res, 503,
      'שירות ה-AI לא החזיר תוכן. בדוק חיוב/קרדיטים ב-Anthropic Console.',
      'AI_EMPTY_RESPONSE',
    );
    return;
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
}

// ── Quota helper ──────────────────────────────────────────────────────────────

/**
 * Check quota in Supabase.
 * Returns true if the request is allowed; returns false and writes an error
 * response if quota is exceeded or the DB is unreachable.
 */
async function runQuotaCheck(
  session_token: string,
  dbUrl: string,
  res: VercelResponse,
): Promise<boolean> {
  let quota;
  try {
    quota = await checkAndEnsureSession(session_token, dbUrl);
  } catch (err) {
    // Include the error CLASS name so future log searches can narrow the cause:
    //   search "PostgresError" → DB query failed
    //   search "TypeError"     → rows[0] was undefined (UPSERT_NO_ROWS)
    //   search "Error"         → generic / connection error
    const errClass  = (err as any)?.constructor?.name ?? 'UnknownError';
    const errMsg    = err instanceof Error ? err.message : String(err);
    const sqlState  = (err as any)?.code; // postgres.js sets `code` to the Postgres SQLSTATE
    console.error(`[ai] quota DB error [${errClass}] sqlState=${sqlState ?? 'n/a'}:`, errMsg);
    sendError(res, 503, 'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.',
      'DB_ERROR', {
        phase: 'quota_check',
        errorClass: errClass,
        safeMessage: errMsg,
        ...(sqlState ? { sqlState } : {}),
      });
    return false;
  }

  console.log('[ai] quota check passed — credits_used:', quota.credits_used, 'remaining:', quota.remaining);

  if (!quota.allowed) {
    sendError(res, 429, 'מכסת שאלות ה-AI החינמית נוצלה.', 'QUOTA_EXCEEDED', {
      credits_used: quota.credits_used,
      free_limit:   quota.free_limit,
      credits_paid:  quota.credits_paid,
      remaining:     0,
    });
    return false;
  }
  return true;
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

  const { message, program_id, plan_context, course_context, session_token } = parsed.data;

  console.log('[ai] request started — program_id:', program_id,
    '— session_token present:', !!session_token);

  // ── Dev mode fast path ────────────────────────────────────────────────────
  if (isDevMode()) {
    console.log('[ai] dev mode active — bypass_quota:', isBypassQuota());

    if (isBypassQuota()) {
      await sendMockStream(res);
      return;
    }

    const dbUrl = (process.env.DATABASE_URL ?? '').trim();
    if (!dbUrl) {
      sendError(res, 503,
        'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.',
        'NO_DATABASE_URL');
      return;
    }

    const allowed = await runQuotaCheck(session_token, dbUrl, res);
    if (!allowed) return;

    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, 'dev-mock', dbUrl),
    ]);

    await sendMockStream(res);
    return;
  }

  // ── Production / real AI path ─────────────────────────────────────────────

  const modelConfig = resolveModel();
  if (!modelConfig) {
    console.log('[ai] no API key configured');
    sendError(res, 503,
      'לא הוגדר מפתח AI. בסביבת Vercel — הוסף ANTHROPIC_API_KEY בלוח הבקרה. מקומית — הגדר בקובץ .env.',
      'NO_API_KEY');
    return;
  }

  console.log('[ai] model selected:', modelConfig.name);

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!dbUrl) {
    sendError(res, 503,
      'Database not configured. Set DATABASE_URL to enable AI quota tracking.',
      'NO_DATABASE_URL');
    return;
  }

  const allowed = await runQuotaCheck(session_token, dbUrl, res);
  if (!allowed) return;

  const systemPrompt = buildSystemPrompt({
    program_id,
    plan_context: plan_context as PlanContext,
    course_context,
  });

  let result;
  try {
    result = streamText({
      model: modelConfig.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      maxTokens: 1024,
      onFinish: async ({ usage }) => {
        console.log('[ai] stream completed — tokens:', usage?.totalTokens ?? '?');
        await Promise.allSettled([
          incrementCreditsUsed(session_token, dbUrl),
          logUsageEvent(session_token, modelConfig.name, dbUrl),
        ]);
      },
    });
  } catch (err) {
    console.error('[ai] streamText() threw:', err instanceof Error ? err.message : String(err));
    sendError(res, 503, 'לא ניתן ליצור חיבור לספק ה-AI. נסה שוב.',
      'AI_PROVIDER_ERROR', { detail: err instanceof Error ? err.message : String(err) });
    return;
  }

  console.log('[ai] stream started');
  await pipeTextStream(res, result.textStream);
}

/**
 * POST /api/ai/course-planner
 *
 * Streaming AI endpoint for TAU course-planner assistant.
 * Supports Anthropic (preferred) and OpenAI via Vercel AI SDK.
 *
 * Dev mode (AI_DEV_MODE=true):
 *   Returns a deterministic mock streaming response without calling any
 *   model provider.  Ignored in production (VERCEL_ENV=production).
 *
 * Quota bypass (AI_DEV_BYPASS_QUOTA=true):
 *   Only active when AI_DEV_MODE=true AND not in production.
 *   Skips all Supabase quota operations so you can develop locally
 *   without a database connection.
 *
 * Runtime: Node.js (quota check requires TCP connection to Postgres).
 *
 * ── HANG FIX ─────────────────────────────────────────────────────────────────
 * Previous versions used result.text.then() to detect stream completion.
 * result.text and result.toTextStreamResponse() BOTH consume the same internal
 * ReadableStream.  A stream can only have one reader → result.text "steals"
 * all the tokens and the response body delivers nothing to the browser.
 *
 * Fix: use the onFinish callback in streamText() which is invoked by the SDK
 * internally after generation completes, without needing a second stream reader.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt, type PlanContext } from './_context';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';

// ── Input schema ──────────────────────────────────────────────────────────────

const courseInPlanSchema = z.object({
  course_id: z.string(),
  name_he: z.string().optional(),
  hours: z.number().optional(),
  difficulty_level: z.string().optional(),
  difficulty_score: z.number().optional(),
  course_type: z.string().optional(),
  category: z.string().optional(),
  missing_prerequisites: z.array(z.string()).optional(),
});

const semesterPlanSchema = z.object({
  id: z.string(),
  label: z.string(),
  courses: z.array(courseInPlanSchema),
  total_hours: z.number(),
});

const planContextSchema = z.object({
  program_name: z.string().optional(),
  semesters: z.array(semesterPlanSchema),
  mandatory_unplaced: z
    .array(z.object({ course_id: z.string(), name_he: z.string().optional(), hours: z.number().optional() }))
    .optional(),
  requirements_progress: z
    .object({
      completed_hours: z.number(),
      required_hours: z.number(),
      categories: z.array(z.object({ name: z.string(), required: z.number(), placed: z.number() })),
    })
    .optional(),
  prerequisite_issues: z
    .array(z.object({ course_id: z.string(), name_he: z.string().optional(), missing: z.array(z.string()) }))
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

// ── Dev mode helpers ──────────────────────────────────────────────────────────

function isDevMode(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.AI_DEV_MODE === 'true';
}

function isBypassQuota(): boolean {
  return isDevMode() && process.env.AI_DEV_BYPASS_QUOTA === 'true';
}

function mockStreamResponse(): Response {
  const text =
    '[מצב פיתוח] תשובת AI לדוגמה — אין קריאה לספק מודל אמיתי.\n' +
    'ניתן לבדוק את זרימת ה-UI, ניהול מכסה וטיפול בשגיאות ללא עלויות API.';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-AI-Dev-Mode': 'true',
    },
  });
}

// ── Quota helpers ─────────────────────────────────────────────────────────────

async function runQuotaCheck(
  session_token: string,
  dbUrl: string,
): Promise<Response | null> {
  // Returns a JSON error Response if quota is exceeded or DB fails,
  // returns null if the request is allowed to proceed.
  let quota;
  try {
    quota = await checkAndEnsureSession(session_token, dbUrl);
  } catch (err) {
    console.error('[ai] quota DB error:', err instanceof Error ? err.message : String(err));
    return jsonError(
      503,
      'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.',
      { detail: err instanceof Error ? err.message : String(err) },
      'DB_ERROR',
    );
  }

  console.log('[ai] quota check passed — credits_used:', quota.credits_used, 'remaining:', quota.remaining);

  if (!quota.allowed) {
    return jsonError(
      429,
      'מכסת שאלות ה-AI החינמית נוצלה.',
      { credits_used: quota.credits_used, free_limit: quota.free_limit,
        credits_paid: quota.credits_paid, remaining: 0 },
      'QUOTA_EXCEEDED',
    );
  }
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request', parsed.error.flatten().fieldErrors);
  }

  const { message, program_id, plan_context, course_context, session_token } = parsed.data;

  console.log('[ai] request started — program_id:', program_id,
    '— session_token present:', !!session_token);

  // ── Dev mode fast path ────────────────────────────────────────────────────
  if (isDevMode()) {
    console.log('[ai] dev mode active — bypass_quota:', isBypassQuota());

    if (isBypassQuota()) {
      return mockStreamResponse();
    }

    const dbUrl = process.env.DATABASE_URL ?? '';
    if (!dbUrl) {
      return jsonError(503,
        'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.',
        undefined, 'NO_DATABASE_URL');
    }

    const quotaErr = await runQuotaCheck(session_token, dbUrl);
    if (quotaErr) return quotaErr;

    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, 'dev-mock', dbUrl),
    ]);

    return mockStreamResponse();
  }

  // ── Production / real AI path ─────────────────────────────────────────────

  const modelConfig = resolveModel();
  if (!modelConfig) {
    console.log('[ai] no API key configured');
    return jsonError(503,
      'לא הוגדר מפתח AI. בסביבת Vercel — הוסף ANTHROPIC_API_KEY בלוח הבקרה. מקומית — הגדר בקובץ .env.',
      undefined, 'NO_API_KEY');
  }

  console.log('[ai] model selected:', modelConfig.name);

  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) {
    return jsonError(503,
      'Database not configured. Set DATABASE_URL to enable AI quota tracking.',
      undefined, 'NO_DATABASE_URL');
  }

  const quotaErr = await runQuotaCheck(session_token, dbUrl);
  if (quotaErr) return quotaErr;

  const systemPrompt = buildSystemPrompt({
    program_id,
    plan_context: plan_context as PlanContext,
    course_context,
  });

  // ── Stream ────────────────────────────────────────────────────────────────
  //
  // IMPORTANT: do NOT access result.text after calling result.toTextStreamResponse().
  // Both would compete for the same ReadableStream reader, causing the response
  // body to deliver no bytes → the browser hangs forever at "מחשב תשובה…".
  //
  // Use the onFinish callback instead — it is called by the SDK internally
  // after the generation completes, without needing a second stream reader.

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
    return jsonError(503,
      'לא ניתן ליצור חיבור לספק ה-AI. נסה שוב.',
      { detail: err instanceof Error ? err.message : String(err) },
      'AI_PROVIDER_ERROR');
  }

  console.log('[ai] stream started');

  try {
    return result.toTextStreamResponse({
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (err) {
    console.error('[ai] toTextStreamResponse() threw:', err instanceof Error ? err.message : String(err));
    return jsonError(503,
      'שגיאה בהפעלת שידור ה-AI.',
      { detail: err instanceof Error ? err.message : String(err) },
      'STREAM_ERROR');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(
  status: number,
  message: string,
  details?: unknown,
  code?: string,
): Response {
  const body: Record<string, unknown> = { error: message };
  if (code)    body.code    = code;
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

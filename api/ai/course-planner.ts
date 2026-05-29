/**
 * POST /api/ai/course-planner
 *
 * Streaming AI endpoint for TAU course-planner assistant.
 * Supports both Anthropic (preferred) and OpenAI via Vercel AI SDK.
 * Deployed as a Vercel Edge Function.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt, type PlanContext } from './_context';

// ── Input schema (validated with Zod) ────────────────────────────────────────

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
      categories: z.array(
        z.object({ name: z.string(), required: z.number(), placed: z.number() }),
      ),
    })
    .optional(),
  prerequisite_issues: z
    .array(
      z.object({ course_id: z.string(), name_he: z.string().optional(), missing: z.array(z.string()) }),
    )
    .optional(),
  grade_signals: z
    .record(z.object({ average_grade: z.number().optional(), num_students_total: z.number().optional() }))
    .optional(),
});

const requestSchema = z.object({
  message: z.string().min(1, 'message is required').max(2000, 'message too long'),
  program_id: z.string().min(1, 'program_id is required'),
  plan_context: planContextSchema,
  course_context: z.string().max(4000).optional(),
});

// ── Model selection (no API key → null) ──────────────────────────────────────

function resolveModel(): LanguageModel | null {
  if (process.env.ANTHROPIC_API_KEY) {
    const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return provider('claude-3-5-sonnet-20241022');
  }
  if (process.env.OPENAI_API_KEY) {
    const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return provider('gpt-4o-mini');
  }
  return null;
}

// ── Edge Function handler ─────────────────────────────────────────────────────

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  // Validate body
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

  const { message, program_id, plan_context, course_context } = parsed.data;

  // Resolve model — return a clear error (not a crash) if unconfigured
  const model = resolveModel();
  if (!model) {
    return jsonError(
      503,
      'לא הוגדר מפתח AI. הגדר ANTHROPIC_API_KEY או OPENAI_API_KEY בקובץ .env',
      undefined,
      'NO_API_KEY',
    );
  }

  const systemPrompt = buildSystemPrompt({
    program_id,
    plan_context: plan_context as PlanContext,
    course_context,
  });

  // Stream the response using Vercel AI SDK
  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
    maxTokens: 1024,
  });

  return result.toTextStreamResponse({
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(
  status: number,
  message: string,
  details?: unknown,
  code?: string,
): Response {
  const body: Record<string, unknown> = { error: message };
  if (code) body.code = code;
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

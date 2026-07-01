/**
 * POST /api/ai/planner-run
 *
 * Runs the agentic Planner Worker and STREAMS its progress as NDJSON
 * (application/x-ndjson), one PlannerAction per line, ending with a single
 * terminal event. The full trace, candidates, selected plan, validation report
 * and explanation are persisted to the planner_runs table.
 *
 * The ConstraintModel (the single source of truth) is built server-side from the
 * program board_json (loaded via queryBoardJson) + the user's context, so the
 * worker plans over the full eligible universe.
 *
 * This endpoint is additive — it does not touch /api/ai/generate-plan or the UI.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { parseProgramVersionId, queryBoardJson } from '../board';
import { buildConstraintModel } from './planner_model';
import { PlannerWorker } from './planner_worker';
import { LlmOrchestrator } from './planner_orchestrator';
import { createRun, markRunFinal, type PlannerRunStatus } from './_planner_runs';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import {
  resolveModel, isDevMode, isBypassQuota, isTestModeBypass, sendError,
} from './course-planner';
import type { ConstraintModel, PlanState } from './planner_types';
import { placedCourseIds } from './planner_types';

const requestSchema = z.object({
  program_id: z.string().min(1, 'program_id is required'),
  session_token: z.string().uuid('session_token must be a valid UUID'),
  orchestrator: z.enum(['llm', 'greedy']).optional(),
  completed_course_ids: z.array(z.string()).optional(),
  prior_hours: z.number().optional(),
  preferences: z.object({
    max_weekly_hours: z.number().nullish(),
    wanted_course_ids: z.array(z.string()).optional(),
    unwanted_course_ids: z.array(z.string()).optional(),
    disallowed_course_ids: z.array(z.string()).optional(),
    pinned_course_ids: z.array(z.string()).optional(),
    overload_accepted: z.boolean().optional(),
    overload_confirmed_at: z.number().nullish(),
  }).optional(),
  /** Dev-only: supply the board when there is no DATABASE_URL (dev bypass). */
  board_json: z.any().optional(),
});

/** Convert a PlanState to the PlanProposal-shaped selected_plan. */
function toSelectedPlan(state: PlanState, knownSemesterIds: string[]) {
  return {
    semesters: knownSemesterIds
      .filter(id => (state.semesters[id] ?? []).length > 0)
      .map(id => ({ semester_id: id, course_ids: state.semesters[id] })),
  };
}

export function buildModelFromRequest(boardJson: any, body: z.infer<typeof requestSchema>): ConstraintModel {
  const prefs = body.preferences ?? {};
  return buildConstraintModel(boardJson, {
    completedCourseIds: body.completed_course_ids,
    wantedCourseIds: prefs.wanted_course_ids,
    unwantedCourseIds: prefs.unwanted_course_ids,
    disallowedCourseIds: prefs.disallowed_course_ids,
    pinnedCourseIds: prefs.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours: body.prior_hours,
    overloadAccepted: prefs.overload_accepted,
    overloadConfirmedAt: prefs.overload_confirmed_at,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { sendError(res, 405, 'Method not allowed'); return; }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid request', 'INVALID_REQUEST', {
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const body = parsed.data;

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  const persist = !!dbUrl;

  // Persistence/quota use the DB; without it, only proceed under an explicit dev
  // bypass (and then in no-persistence mode), otherwise 503.
  if (!dbUrl && !isBypassQuota()) {
    sendError(res, 503, 'Database not configured. Set DATABASE_URL (or AI_DEV_BYPASS_QUOTA=true for local dev).', 'NO_DATABASE_URL');
    return;
  }

  // Quota gate (only when a DB is present).
  if (persist) {
    let quota;
    try {
      quota = await checkAndEnsureSession(body.session_token, dbUrl);
    } catch (err) {
      sendError(res, 503, 'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.', 'DB_ERROR');
      return;
    }
    if (!quota.allowed && !isTestModeBypass()) {
      sendError(res, 429, 'מכסת שאלות ה-AI החינמית נוצלה.', 'QUOTA_EXCEEDED', { remaining: 0 });
      return;
    }
  }

  // Load the program board (single source of truth for the universe).
  let boardJson: any = null;
  if (persist) {
    const pv = parseProgramVersionId(body.program_id);
    if (!pv) { sendError(res, 400, `Invalid program_id: ${body.program_id}`, 'INVALID_PROGRAM_ID'); return; }
    try {
      boardJson = await queryBoardJson(dbUrl, pv.base, pv.year);
    } catch {
      sendError(res, 503, 'Database query failed.', 'DB_ERROR'); return;
    }
    if (!boardJson) { sendError(res, 404, `Program "${body.program_id}" not found.`, 'NOT_FOUND'); return; }
  } else {
    // Dev/no-persistence: the board must be supplied in the request.
    boardJson = body.board_json;
    if (!boardJson) { sendError(res, 503, 'Board unavailable (dev mode requires board_json or DATABASE_URL).', 'NO_BOARD'); return; }
  }

  const model = buildModelFromRequest(boardJson, body);
  const useLlm = body.orchestrator === 'llm' && !!resolveModel();

  // ── begin streaming ─────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.status(200);
  const emit = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

  const run_id = persist
    ? await createRun(dbUrl, { session_token: body.session_token, program_id: body.program_id, orchestrator: useLlm ? 'llm' : 'greedy' })
    : `dev-${randomUUID()}`;

  emit({ type: 'run_started', run_id, program_id: body.program_id, ts: Date.now() });

  const worker = new PlannerWorker(model, undefined, { topN: 6, rolloutSteps: 80 });
  let status: PlannerRunStatus = 'running';

  try {
    if (useLlm) {
      // LLM drives the worker via tools; replay the resulting trace as events.
      await new LlmOrchestrator(resolveModel()!.model, { maxSteps: 24 }).run(worker);
      for (const a of worker.getTrace()) emit({ type: 'action', action: a });
    } else {
      // Greedy: drive the worker step-by-step, streaming each action live.
      for (;;) {
        const a = worker.step('greedy');
        if (!a) break;
        emit({ type: 'action', action: a });
        if (a.action === 'STOP') break;
      }
    }

    const report = worker.validateCandidate();
    const explanation = worker.explain();
    const selected_plan = toSelectedPlan(worker.getPlan(), model.knownSemesterIds);
    status = worker.isGoalReached() ? 'done' : 'blocked';

    if (persist) {
      await markRunFinal(dbUrl, run_id, {
        status,
        trace: worker.getTrace(),
        candidates: [{ ...selected_plan, score: 'selected' }],
        selectedPlan: selected_plan,
        validationReport: report,
        explanation,
      });
      await Promise.allSettled([
        incrementCreditsUsed(body.session_token, dbUrl),
        logUsageEvent(body.session_token, useLlm ? (resolveModel()?.name ?? 'llm') : 'greedy', dbUrl),
      ]);
    }

    emit({
      type: 'done', run_id, status,
      selected_plan,
      validation_report: report,
      explanation,
      candidate_count: 1,
    });
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planner-run] run failed:', message);
    if (persist) {
      await markRunFinal(dbUrl, run_id, { status: 'failed', trace: worker.getTrace(), error: message }).catch(() => {});
    }
    emit({ type: 'error', run_id, status: 'failed', message });
    res.end();
  }
}

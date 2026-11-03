import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { z } from 'zod';
import { completedStudiesSchema, preferencesSchema, programIdSchema, programWorkspaceSchema, restorePlanSchema, shareBidsSchema, workspaceWriteSchema } from '../../shared/planner/student-workspace';
import { validateBiddingDraft, biddingBundleSignature } from '../../shared/planner/bidding';
import { resolveRequestOwner } from './auth_session';
import { readAnonymousOwner, appendSetCookie, serializeSessionCookie, isWellFormedOwnerId } from './session_owner';
import { getStudentWorkspaceStore } from './student_workspace_store';
import { aggregateBiddingHistory, type ObservationInput } from './student_bidding_history';
import { ensurePlannerStorageReady, getAcademicContextStore, getBoardRepository } from './apply_runtime';
import { loadLocalBoardJson } from './board_loader';
import { committedBoardView } from './committed_board_view';
import { validateSavedPlan } from './student_plan_restore';
import { loadBoardWithAddedSemesters } from './student_semesters';
import { courseNoteSchema, moderateNoteSchema, publishNoteSchema, reportNoteSchema, withdrawNoteSchema } from '../../shared/planner/course-notes';

const queryYear = z.coerce.number().int().min(2000).max(2200);
const querySemester = z.coerce.number().int().min(1).max(2);
const queryRound = z.coerce.number().int().min(1).max(20);
const error = (res: VercelResponse, status: number, code: string, details?: string[]) => {
  res.status(status).json({ ok: false, code, ...(details ? { details } : {}) });
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET' && req.method !== 'POST') { error(res, 405, 'METHOD_NOT_ALLOWED'); return; }
  // Reject cross-site mutations; same-origin cookies are the authorization credential.
  const origin = req.headers.origin;
  const forwardedHost = (process.env.VERCEL === '1' || process.env.AI_DEV_MODE === 'true') ? req.headers['x-forwarded-host'] : undefined;
  const host = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : req.headers.host;
  if (req.method === 'POST' && typeof origin === 'string' && host) {
    try { if (new URL(origin).host !== host) { error(res, 403, 'ORIGIN_MISMATCH'); return; } }
    catch { error(res, 403, 'ORIGIN_MISMATCH'); return; }
  }
  if (req.method === 'POST' && JSON.stringify(req.body ?? '').length > 650000) { error(res, 413, 'REQUEST_TOO_LARGE'); return; }
  try {
    const store = getStudentWorkspaceStore();
    // A separate HttpOnly bridge survives the older planner's first-login adoption.
    const cookies = String(req.headers.cookie ?? '');
    const bridgeValue = /(?:^|;\s*)syllo_workspace_guest=([^;]*)/.exec(cookies)?.[1];
    const bridge = bridgeValue && isWellFormedOwnerId(bridgeValue) ? bridgeValue : undefined;
    const guest = bridge ?? readAnonymousOwner(req as any);
    const { ownerId } = await resolveRequestOwner(req as any, res);
    if (guest && ownerId.startsWith('auth:')) {
      await store.adopt(guest, ownerId);
      appendSetCookie(res, 'syllo_workspace_guest=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    } else if (!ownerId.startsWith('auth:')) {
      appendSetCookie(res, serializeSessionCookie(ownerId, { secure: process.env.VERCEL === '1' }).replace(/^syllo_owner=/, 'syllo_workspace_guest='));
    }

    if (req.method === 'GET') {
      const scope = req.query?.scope;
      if (scope === 'preferences') {
        const record = await store.load(ownerId, 'preferences');
        const data = preferencesSchema.safeParse(record?.data ?? { locale: 'he' });
        if (!data.success) { error(res, 503, 'WORKSPACE_SCHEMA_MISMATCH'); return; }
        res.status(200).json({ ok: true, revision: record?.revision ?? 0, data: data.data }); return;
      }
      if (scope === 'community_notes') {
        const course = courseNoteSchema.shape.courseId.safeParse(req.query?.course_id);
        if (!course.success) { error(res, 400, 'INVALID_REQUEST'); return; }
        res.status(200).json({ ok: true, notes: await store.communityNotes(ownerId, course.data) }); return;
      }
      if (scope === 'moderation') {
        if (!await store.isDeveloper(ownerId)) { error(res, 403, 'FORBIDDEN'); return; }
        res.status(200).json({ ok: true, notes: await store.hiddenNotes() }); return;
      }
      const program = programIdSchema.safeParse(req.query?.program_id);
      if (!program.success) { error(res, 400, 'INVALID_REQUEST'); return; }
      if (scope === 'history') {
        const year = queryYear.safeParse(req.query?.academic_year), semester = querySemester.safeParse(req.query?.semester), round = queryRound.safeParse(req.query?.round);
        if (!year.success || !semester.success || !round.success) { error(res, 400, 'INVALID_REQUEST'); return; }
        const now = new Date();
        const academicStartYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        const beforeYear = Math.min(year.data, academicStartYear);
        const rows = await store.observations(program.data, beforeYear, semester.data as 1 | 2, round.data);
        res.status(200).json({ ok: true, history: aggregateBiddingHistory(rows, beforeYear) }); return;
      }
      if (scope === 'studies') {
        const record = await store.load(ownerId, `studies:${program.data}`);
        const data = record ? completedStudiesSchema.safeParse(record.data) : null;
        if (data && !data.success) { error(res, 503, 'WORKSPACE_SCHEMA_MISMATCH'); return; }
        res.status(200).json({ ok: true, revision: record?.revision ?? 0, data: data?.data ?? null }); return;
      }
      if (scope !== 'program') { error(res, 400, 'INVALID_REQUEST'); return; }
      const record = await store.load(ownerId, `program:${program.data}`);
      const data = programWorkspaceSchema.safeParse(record?.data ?? {});
      if (!data.success) { error(res, 503, 'WORKSPACE_SCHEMA_MISMATCH'); return; }
      res.status(200).json({ ok: true, revision: record?.revision ?? 0, data: data.data }); return;
    }

    if (req.body?.action === 'restore') {
      const request = restorePlanSchema.safeParse(req.body);
      if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
      const { program_id, plan_id, expected_board_version, idempotency_key } = request.data;
      const record = await store.load(ownerId, `program:${program_id}`);
      const workspace = programWorkspaceSchema.safeParse(record?.data);
      const plan = workspace.success ? workspace.data.plans.find((p) => p.id === plan_id) : null;
      if (!plan) { error(res, 404, 'PLAN_NOT_FOUND'); return; }
      await ensurePlannerStorageReady();
      const context = await getAcademicContextStore().load(ownerId, program_id);
      const catalog = loadLocalBoardJson(program_id);
      if (!context || !catalog) { error(res, 404, 'ACADEMIC_CONTEXT_NOT_FOUND'); return; }
      const repo = getBoardRepository();
      const current = await loadBoardWithAddedSemesters(repo, ownerId, program_id);
      const identity = createHash('sha256').update(JSON.stringify({ semesters: plan.semesters, weeklySchedule: plan.weeklySchedule, bidding: plan.bidding, biddingRounds: plan.biddingRounds })).digest('hex');
      const commitInput = { ownerId, programId: program_id, expectedVersion: expected_board_version,
        semesters: plan.semesters, proposalId: `saved-plan:${plan.id}`, candidateId: identity, idempotencyKey: idempotency_key };
      if ((current?.version ?? null) !== expected_board_version) {
        // Existing repository replay detection is the only safe bypass of stale CAS.
        const replay = await repo.commit({ ...commitInput, semesters: current?.semesters ?? [] });
        if (replay.ok && replay.replayed && replay.board.version === current?.version) { res.status(200).json({ ok: true, board: committedBoardView(replay.board, context.planContext), weeklySchedule: plan.weeklySchedule, bidding: plan.bidding, biddingRounds: plan.biddingRounds }); return; }
        error(res, 409, replay.ok ? 'BOARD_VERSION_CONFLICT' : replay.reason); return;
      }
      const checked = validateSavedPlan(plan, catalog, context, program_id, current);
      if (!checked.valid) { error(res, 422, 'PLAN_INVALID', checked.errors); return; }
      const result = await repo.commit({ ...commitInput, semesters: checked.semesters });
      if (!result.ok) { error(res, 409, result.reason); return; }
      res.status(200).json({ ok: true, board: committedBoardView(result.board, context.planContext), weeklySchedule: plan.weeklySchedule, bidding: plan.bidding, biddingRounds: plan.biddingRounds, warnings: checked.warnings }); return;
    }

    if (req.body?.action === 'share') {
      const request = shareBidsSchema.safeParse(req.body);
      if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
      if (!ownerId.startsWith('auth:')) { error(res, 401, 'SIGN_IN_REQUIRED'); return; }
      const { draft, consent, program_id } = request.data;
      if (!consent) {
        await store.withdrawObservations(ownerId, program_id);
        res.status(200).json({ ok: true, shared: false, observations: 0 }); return;
      }
      if (!validateBiddingDraft(draft).valid || draft.academicYear > new Date().getFullYear()) { error(res, 422, 'INVALID_BIDDING_DRAFT'); return; }
      const board: any = loadLocalBoardJson(program_id);
      if (!board) { error(res, 404, 'PROGRAM_NOT_FOUND'); return; }
      const known = new Set<string>([...(board.semesters ?? []).flatMap((s: any) => (s.courses ?? []).map((c: any) => c.course_id)), ...(board.metadata?.program_repository_courses ?? []).map((c: any) => c.course_id)]);
      if (draft.entries.some((e) => e.kind === 'course' ? !known.has(e.courseId ?? '') : e.members.some((m) => !known.has(m.courseId)))) { error(res, 422, 'UNKNOWN_COURSE'); return; }
      const ordered = [...draft.entries].sort((a, b) => a.priority - b.priority);
      const incoming = new Set<string>();
      ordered.forEach((e, i) => {
        const target = draft.transferMode === 'manual' ? e.transferTo : ordered[i + 1]?.id;
        if (target) incoming.add(target);
      });
      const observations: ObservationInput[] = ordered.filter((e) => e.outcome !== 'pending')
        .map((e) => ({ kind: e.kind, courseId: e.courseId, group: e.group.trim(),
          ...(e.kind === 'bundle' ? { bundleSignature: biddingBundleSignature(e.members) } : {}),
          points: e.effectivePoints ?? (incoming.has(e.id) ? null : e.points), initialPoints: e.points,
          outcome: e.outcome, rejectionReason: e.rejectionReason ?? '' }));
      await store.replaceObservations(ownerId, program_id, draft.academicYear, draft.semester, draft.round, observations);
      res.status(200).json({ ok: true, shared: true, observations: observations.length }); return;
    }

    // Shared course notes: anonymous to readers, signed-in authors and reporters only.
    const noteAction = req.body?.action;
    if (noteAction === 'publish_note' || noteAction === 'withdraw_note' || noteAction === 'report_note' || noteAction === 'moderate_note') {
      if (!ownerId.startsWith('auth:')) { error(res, 401, 'SIGN_IN_REQUIRED'); return; }
      if (noteAction === 'publish_note') {
        const request = publishNoteSchema.safeParse(req.body);
        if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
        await store.publishNote(ownerId, request.data.note);
        res.status(200).json({ ok: true }); return;
      }
      if (noteAction === 'withdraw_note') {
        const request = withdrawNoteSchema.safeParse(req.body);
        if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
        await store.withdrawNote(ownerId, request.data.note_id);
        res.status(200).json({ ok: true }); return;
      }
      if (noteAction === 'report_note') {
        const request = reportNoteSchema.safeParse(req.body);
        if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
        const result = await store.reportNote(ownerId, request.data.public_id);
        if (result === 'not_found') { error(res, 404, 'NOTE_NOT_FOUND'); return; }
        if (result === 'own_note') { error(res, 422, 'OWN_NOTE'); return; }
        res.status(200).json({ ok: true }); return;
      }
      const request = moderateNoteSchema.safeParse(req.body);
      if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
      if (!await store.isDeveloper(ownerId)) { error(res, 403, 'FORBIDDEN'); return; }
      if (!await store.moderateNote(request.data.public_id, request.data.decision)) { error(res, 404, 'NOTE_NOT_FOUND'); return; }
      res.status(200).json({ ok: true }); return;
    }

    const request = workspaceWriteSchema.safeParse(req.body);
    if (!request.success) { error(res, 400, 'INVALID_REQUEST'); return; }
    const body = request.data;
    const scope = body.scope === 'preferences' ? 'preferences' : `${body.scope}:${body.program_id}`;
    const result = await store.save(ownerId, scope, body.expected_revision, body.data);
    if (!result.ok) { res.status(409).json({ ok: false, code: 'WORKSPACE_VERSION_CONFLICT', revision: result.revision }); return; }
    res.status(200).json(result);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== '42P01' && code !== '42703') console.error('[student-workspace] storage operation failed', typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'UNKNOWN');
    error(res, 503, code === '42P01' || code === '42703' ? 'WORKSPACE_SCHEMA_MISMATCH' : 'WORKSPACE_UNAVAILABLE');
  }
}

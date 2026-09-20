/** POST /api/ai/planning-context — bind user academic claims to a server session. */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { planningContextRequestSchema } from '../../shared/planner/wire';
import {
  academicStatusDigest,
  ensurePlannerStorageReady,
  getAcademicContextStore,
  plannerStorageErrorCode,
  preferenceDigest,
} from './apply_runtime';
import { resolveOwner } from './session_owner';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message_he: 'שיטה לא נתמכת.' });
    return;
  }
  const parsed = req.method === 'POST' ? planningContextRequestSchema.safeParse(req.body) : null;
  if (parsed && !parsed.success) {
    res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message_he: 'בקשת ההקשר אינה תקינה.' });
    return;
  }

  try {
    await ensurePlannerStorageReady();
    const owner = resolveOwner(req as any, res);
    if (req.method === 'GET') {
      const rawProgramId = req.query?.program_id;
      const programId = typeof rawProgramId === 'string' ? rawProgramId.trim() : '';
      if (!programId) {
        res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message_he: 'בקשת ההקשר אינה תקינה.' });
        return;
      }
      const stored = await getAcademicContextStore().load(owner.ownerId, programId);
      res.status(200).json({
        ok: true,
        context: stored ? {
          academic_status_digest: stored.digest,
          preference_digest: preferenceDigest(stored.preferences),
          personal_status: stored.personalStatus,
          preferences: stored.preferences,
        } : null,
      });
      return;
    }
    if (!parsed || !parsed.success) return;
    const { program_id, plan_context, preferences } = parsed.data;
    const digest = academicStatusDigest(plan_context.personal_status);
    await getAcademicContextStore().put({
      ownerId: owner.ownerId,
      programId: program_id,
      digest,
      personalStatus: plan_context.personal_status,
      planContext: plan_context,
      preferences,
    });
    res.status(200).json({ ok: true, academic_status_digest: digest });
  } catch (error) {
    const code = plannerStorageErrorCode(error);
    if (code) {
      res.status(503).json({
        ok: false, code, message_he: 'אחסון התכנון אינו זמין כרגע. נא לנסות שוב מאוחר יותר.',
      });
      return;
    }
    console.error('[ai/planning-context] unexpected error');
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message_he: 'אירעה שגיאה פנימית.' });
  }
}

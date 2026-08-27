/** POST /api/ai/planning-context — bind user academic claims to a server session. */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { planningContextRequestSchema } from '../../shared/planner/wire';
import { academicStatusDigest, getAcademicContextStore } from './apply_runtime';
import { resolveOwner } from './session_owner';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message_he: 'שיטה לא נתמכת.' });
    return;
  }
  const parsed = planningContextRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message_he: 'בקשת ההקשר אינה תקינה.' });
    return;
  }

  const owner = resolveOwner(req as any, res);
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
}

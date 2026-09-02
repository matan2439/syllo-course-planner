import type { VercelRequest, VercelResponse } from '@vercel/node';
import { conversationRequestSchema } from '../../shared/planner/conversation-wire';
import { resolveModel as defaultResolveModel, type ModelConfig } from './course-planner';
import {
  getAcademicContextStore,
  getBoardRepository,
  plannerStorageErrorCode,
  preferenceDigest,
} from './apply_runtime';
import { resolveOwner } from './session_owner';
import type { CommittedBoard } from './board_repository';
import type { AcademicContextRecord } from './academic_context_store';

type ConversationEndpointDeps = {
  resolveModel?: () => ModelConfig | null;
  loadBoard?: (ownerId: string, programId: string) => Promise<CommittedBoard | null>;
  loadAcademicContext?: (ownerId: string, programId: string) => Promise<AcademicContextRecord | null>;
};

const unavailable = () => ({
  outcome: 'assistant_unavailable' as const,
  message_he: 'העוזר האקדמי אינו זמין כרגע.',
  events: [{ type: 'assistant_unavailable' as const, message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
  code: 'ASSISTANT_UNAVAILABLE' as const,
});

export function createConversationHandler(deps: ConversationEndpointDeps = {}) {
  const resolveModel = deps.resolveModel ?? defaultResolveModel;
  const loadBoard = deps.loadBoard ?? ((ownerId, programId) => getBoardRepository().load(ownerId, programId));
  const loadAcademicContext = deps.loadAcademicContext
    ?? ((ownerId, programId) => getAcademicContextStore().load(ownerId, programId));
  return async function conversationHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message_he: 'שיטה לא נתמכת.' });
      return;
    }

    const parsed = conversationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message_he: 'בקשת השיחה אינה תקינה.' });
      return;
    }

    const model = resolveModel();
    if (!model) {
      res.status(503).json(unavailable());
      return;
    }

    try {
      const owner = resolveOwner(req as unknown as { headers?: Record<string, string | string[] | undefined> }, res);
      const board = await loadBoard(owner.ownerId, parsed.data.program_id);
      const currentBoardVersion = board?.version ?? null;
      if ((parsed.data.board_version ?? null) !== currentBoardVersion) {
        res.status(409).json({
          ok: false,
          code: 'BOARD_VERSION_CONFLICT',
          message_he: 'הלוח השתנה מאז תחילת השיחה.',
          currentBoardVersion,
        });
        return;
      }
      const academicContext = await loadAcademicContext(owner.ownerId, parsed.data.program_id);
      if (!academicContext || academicContext.digest !== parsed.data.academic_status_digest) {
        res.status(409).json({
          ok: false,
          code: academicContext ? 'ACADEMIC_CONTEXT_CONFLICT' : 'ACADEMIC_CONTEXT_MISSING',
          message_he: 'הסטטוס האקדמי השתנה או אינו זמין. יש לרענן אותו לפני המשך השיחה.',
        });
        return;
      }
      if (preferenceDigest(academicContext.preferences) !== parsed.data.preference_digest) {
        res.status(409).json({
          ok: false,
          code: 'PREFERENCE_CONTEXT_CONFLICT',
          message_he: 'העדפות התכנון השתנו. יש לרענן אותן לפני המשך השיחה.',
        });
        return;
      }

      // Until proposal persistence is composed below this boundary, fail
      // closed rather than invoke a model without an applyable server record.
      res.status(503).json(unavailable());
    } catch (error) {
      const code = plannerStorageErrorCode(error);
      if (code) {
        res.status(503).json({
          ok: false,
          code,
          message_he: 'אחסון התכנון אינו זמין כרגע. נא לנסות שוב מאוחר יותר.',
        });
        return;
      }
      console.error('[ai/conversation] unexpected error');
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message_he: 'אירעה שגיאה פנימית.' });
    }
  };
}

export default createConversationHandler();

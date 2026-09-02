import type { VercelRequest, VercelResponse } from '@vercel/node';
import { conversationRequestSchema } from '../../shared/planner/conversation-wire';
import { resolveModel as defaultResolveModel, type ModelConfig } from './course-planner';

type ConversationEndpointDeps = {
  resolveModel?: () => ModelConfig | null;
};

const unavailable = () => ({
  outcome: 'assistant_unavailable' as const,
  message_he: 'העוזר האקדמי אינו זמין כרגע.',
  events: [{ type: 'assistant_unavailable' as const, message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
  code: 'ASSISTANT_UNAVAILABLE' as const,
});

export function createConversationHandler(deps: ConversationEndpointDeps = {}) {
  const resolveModel = deps.resolveModel ?? defaultResolveModel;
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

    if (!resolveModel()) {
      res.status(503).json(unavailable());
      return;
    }

    // Until the session-authoritative board/context composition below this
    // boundary is available, fail closed rather than invoke a model without
    // grounded state or fabricate a conversational answer.
    res.status(503).json(unavailable());
  };
}

export default createConversationHandler();


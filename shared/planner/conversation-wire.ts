import { z } from 'zod'

const boundedText = z.string().trim().min(1).max(4_000)
const digest = z.string().trim().min(1).max(256)

export const conversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: boundedText,
}).strict()

export const conversationRequestSchema = z.object({
  program_id: z.string().trim().min(1).max(128),
  session_token: z.string().uuid(),
  board_version: z.string().trim().min(1).max(256).nullable(),
  academic_status_digest: digest,
  preference_digest: digest,
  transcript: z.array(conversationTurnSchema).min(1).max(40),
}).strict()

const assistantMessageEventSchema = z.object({
  type: z.literal('assistant_message'),
  text_he: boundedText,
}).strict()

const toolStatusEventSchema = z.object({
  type: z.literal('tool_status'),
  tool: z.enum([
    'get_state',
    'rank_candidates',
    'add_course',
    'remove_course',
    'move_course',
    'replace_course',
    'finalize_plan',
  ]),
  status: z.enum(['started', 'completed', 'rejected']),
}).strict()

const clarificationEventSchema = z.object({
  type: z.literal('clarification'),
  question_he: boundedText,
  options_he: z.array(boundedText).min(2).max(8).optional(),
}).strict()

const alternativesReadyEventSchema = z.object({
  type: z.literal('alternatives_ready'),
  proposal_id: z.string().trim().min(1).max(256),
  candidate_ids: z.array(z.string().trim().min(1).max(256)).min(1).max(12),
}).strict()

export const assistantUnavailableEventSchema = z.object({
  type: z.literal('assistant_unavailable'),
  message_he: boundedText,
}).strict()

export const conversationEventSchema = z.discriminatedUnion('type', [
  assistantMessageEventSchema,
  toolStatusEventSchema,
  clarificationEventSchema,
  alternativesReadyEventSchema,
  assistantUnavailableEventSchema,
])

const availableResponseSchema = z.object({
  outcome: z.enum(['conversation', 'clarification_required', 'proposal']),
  message_he: boundedText,
  events: z.array(conversationEventSchema).max(64),
  proposal_id: z.string().trim().min(1).max(256).optional(),
}).strict()

const unavailableResponseSchema = z.object({
  outcome: z.literal('assistant_unavailable'),
  message_he: boundedText,
  events: z.array(assistantUnavailableEventSchema).min(1).max(1),
}).strict()

export const conversationResponseSchema = z.discriminatedUnion('outcome', [
  availableResponseSchema,
  unavailableResponseSchema,
])

export type ConversationTurn = z.infer<typeof conversationTurnSchema>
export type ConversationRequest = z.infer<typeof conversationRequestSchema>
export type ConversationEvent = z.infer<typeof conversationEventSchema>
export type ConversationResponse = z.infer<typeof conversationResponseSchema>


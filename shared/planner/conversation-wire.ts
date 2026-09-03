import { z } from 'zod'
import type { PreferenceProfile } from '../../api/ai/preference_model'

const boundedText = z.string().trim().min(1).max(4_000)
const digest = z.string().trim().min(1).max(256)

const preferenceProfileSchema = z.object({
  version: z.number().int().nonnegative(),
  preferences: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    category: z.string().trim().min(1).max(128),
    originalWording: z.string().max(1_000).optional(),
    normalized: z.string().trim().min(1).max(256),
    value: z.unknown(),
    classification: z.enum(['hard_constraint', 'soft_preference', 'goal', 'indifferent', 'uncertain']),
    confidence: z.number().min(0).max(1),
    source: z.enum(['explicit_answer', 'confirmed_interpretation', 'existing_profile', 'safe_default']),
    confirmationStatus: z.enum(['unconfirmed', 'pending', 'confirmed', 'rejected']),
    affects: z.string().trim().min(1).max(256),
    scope: z.string().max(128).optional(),
    expiry: z.string().max(128).optional(),
    mayAffectPlanningBeforeConfirmation: z.boolean(),
  }).strict()).max(32),
}).strict()

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
  /** The typed answers from the unified agent intake, not a UI-only shadow. */
  preference_profile: preferenceProfileSchema.optional(),
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
    'ask_clarification',
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

const conversationAlternativeSchema = z.object({
  candidate_id: z.string().trim().min(1).max(256),
  normalized_identity: z.string().trim().min(1).max(4_000),
  recommended: z.boolean(),
  applyable: z.boolean(),
  semesters: z.array(z.object({
    semester_id: z.string().trim().min(1).max(256),
    course_ids: z.array(z.string().trim().min(1).max(256)).max(256),
  }).strict()).max(64),
  constraint_fingerprint: z.string().trim().min(1).max(256),
  profile_version: z.number().int().nonnegative(),
  snapshot_id: z.string().trim().min(1).max(256),
  non_dominated: z.boolean(),
  composed_utility: z.number(),
  objective_scores: z.array(z.object({
    objective_id: z.string().trim().min(1).max(256),
    normalized: z.number(),
  }).strict()).max(32),
  label_he: boundedText,
  differences_he: z.array(boundedText).max(32),
  workload: z.object({
    peak_hours: z.number().nonnegative(),
    total_hours: z.number().nonnegative(),
    active_periods: z.number().int().nonnegative(),
  }).strict(),
}).strict()

const conversationProposalSchema = z.object({
  proposal_id: z.string().trim().min(1).max(256),
  candidate_ids: z.array(z.string().trim().min(1).max(256)).min(1).max(12),
  recommended_candidate_id: z.string().trim().min(1).max(256).nullable(),
  base_board_version: z.string().trim().min(1).max(256).nullable(),
  profile_version: z.number().int().nonnegative(),
  academic_status_digest: digest,
  expires_at: z.number().int().nonnegative(),
  /** Read-only server materialization for the draft UI; Apply still names ids. */
  alternatives: z.array(conversationAlternativeSchema).min(1).max(12),
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
  /** The agent, not the client, decides whether to ask or offer planning. */
  next_action: z.enum(['ask', 'offer_build']).optional(),
  proposal_id: z.string().trim().min(1).max(256).optional(),
  proposal: conversationProposalSchema.optional(),
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

/**
 * A conversation is pinned to the board, academic status, and preferences
 * captured when it starts. These are normal server refusals, not malformed
 * assistant responses, so the client can explain the stale context and offer
 * a clean restart.
 */
export const conversationContextConflictResponseSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    'BOARD_VERSION_CONFLICT',
    'ACADEMIC_CONTEXT_CONFLICT',
    'ACADEMIC_CONTEXT_MISSING',
    'PREFERENCE_CONTEXT_CONFLICT',
  ]),
  message_he: boundedText,
  currentBoardVersion: z.string().trim().min(1).max(256).nullable().optional(),
}).strict()

export type ConversationTurn = z.infer<typeof conversationTurnSchema>
export type ConversationRequest = z.infer<typeof conversationRequestSchema>
export type ConversationPreferenceProfile = PreferenceProfile
export type ConversationEvent = z.infer<typeof conversationEventSchema>
export type ConversationProposal = z.infer<typeof conversationProposalSchema>
export type ConversationResponse = z.infer<typeof conversationResponseSchema>
export type ConversationContextConflictResponse = z.infer<typeof conversationContextConflictResponseSchema>

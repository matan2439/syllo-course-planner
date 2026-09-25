/**
 * The planning co-pilot: one OpenAI Agents SDK agent over deterministic planner
 * tools. The run ends when the agent asks the student something (ask_student),
 * submits a validated proposal (submit_proposal), or answers in plain text.
 */
import {
  Agent,
  Runner,
  assistant,
  extractAllTextOutput,
  system,
  user,
  type AgentInputItem,
  type Model,
} from '@openai/agents';
import type { ConversationEvent, ConversationTurn } from '../../../shared/planner/conversation-wire';
import type { PreferenceProfile } from '../preference_model';
import type { PlanningSession } from './session';
import type { PlannerWorker } from '../planner_worker';
import { buildAgentTools } from './tools';
import { PLANNER_AGENT_INSTRUCTIONS } from './instructions';

export const DEFAULT_AGENT_MODEL = 'gpt-5-mini';
const MAX_TURNS = 20;

export type PlannerAgentResult =
  | {
      outcome: 'proposal';
      messageHe: string;
      events: ConversationEvent[];
      draftPlan: ReturnType<PlannerWorker['getPlan']>;
      validation: ReturnType<PlannerWorker['validateCandidate']>;
    }
  | {
      outcome: 'conversation';
      /** 'ask' when the agent asked the student a question. */
      nextAction?: 'ask';
      messageHe: string;
      events: ConversationEvent[];
    }
  | {
      outcome: 'assistant_unavailable';
      messageHe: string;
      events: ConversationEvent[];
    };

export interface PlannerAgentInput {
  transcript: readonly ConversationTurn[];
  session: PlanningSession;
  preferenceProfile?: PreferenceProfile;
}

export interface PlannerAgentDeps {
  /** Model name (OpenAI) or a custom SDK Model — tests inject a scripted one. */
  model?: string | Model;
}

export function agentModelName(): string {
  return (process.env.AI_AGENT_MODEL ?? '').trim() || DEFAULT_AGENT_MODEL;
}

function createPlannerAgent(model: string | Model) {
  return new Agent<PlanningSession>({
    name: 'TAU planning co-pilot',
    instructions: PLANNER_AGENT_INSTRUCTIONS,
    model,
    tools: buildAgentTools(),
    // Stop as soon as the agent asked something or a proposal passed validation;
    // a rejected submit_proposal returns its errors and the loop continues.
    toolUseBehavior: (context) => {
      const session = context.context as PlanningSession;
      if (session.question || session.submission) {
        return {
          isFinalOutput: true,
          isInterrupted: undefined,
          finalOutput: session.question?.questionHe ?? session.submission?.summaryHe ?? '',
        };
      }
      return { isFinalOutput: false, isInterrupted: undefined };
    },
  });
}

function toInputItems(transcript: readonly ConversationTurn[], profile?: PreferenceProfile): AgentInputItem[] {
  const items: AgentInputItem[] = transcript.map((turn) =>
    turn.role === 'user' ? user(turn.text) : assistant(turn.text));
  if (profile?.preferences.length) {
    items.unshift(system(`Preferences the student confirmed in the intake panel (version ${profile.version}): ${JSON.stringify(profile.preferences)}. Record the ones that affect planning with update_preferences before build_plan.`));
  }
  return items;
}

export async function runPlannerAgent(input: PlannerAgentInput, deps: PlannerAgentDeps = {}): Promise<PlannerAgentResult> {
  const { session } = input;
  const runner = new Runner({
    // Tracing would send student data to OpenAI's trace store; opt-in only.
    tracingDisabled: process.env.AI_AGENT_TRACING !== 'true',
    traceIncludeSensitiveData: false,
  });
  try {
    const result = await runner.run(
      createPlannerAgent(deps.model ?? agentModelName()),
      toInputItems(input.transcript, input.preferenceProfile),
      { context: session, maxTurns: MAX_TURNS },
    );
    const spoken = extractAllTextOutput(result.newItems).trim();
    const events = [...session.events];

    if (session.question) {
      const messageHe = spoken || session.question.questionHe;
      events.push({ type: 'assistant_message', text_he: messageHe.slice(0, 4_000) });
      const questionId = session.question.questionId;
      events.push({
        type: 'clarification',
        question_he: session.question.questionHe,
        ...(questionId ? {
          question_id: questionId,
          answer_type: questionId === 'max_weekly_hours' ? 'number' as const
            : questionId === 'track_or_focus' ? 'text' as const : 'course_id_list' as const,
        } : {}),
        ...(session.question.optionsHe.length >= 2 ? { options_he: session.question.optionsHe } : {}),
      });
      return { outcome: 'conversation', nextAction: 'ask', messageHe, events };
    }

    if (session.submission) {
      const { summaryHe, tradeoffsHe } = session.submission;
      const messageHe = tradeoffsHe.length
        ? `${summaryHe}\n\nמה לא הצלחתי לכבד במלואו:\n${tradeoffsHe.map((line) => `• ${line}`).join('\n')}`
        : summaryHe;
      events.push({ type: 'assistant_message', text_he: messageHe.slice(0, 4_000) });
      return {
        outcome: 'proposal',
        messageHe,
        events,
        draftPlan: session.worker.getPlan(),
        validation: session.worker.validateCandidate(),
      };
    }

    const messageHe = (typeof result.finalOutput === 'string' && result.finalOutput.trim()) || spoken
      || 'לא הצלחתי לנסח תשובה. אפשר לנסות לנסח את הבקשה אחרת?';
    events.push({ type: 'assistant_message', text_he: messageHe.slice(0, 4_000) });
    return { outcome: 'conversation', messageHe, events };
  } catch (error) {
    console.error('[ai/planner-agent] run failed:', (error as Error)?.constructor?.name, (error as Error)?.message);
    const messageHe = 'העוזר האקדמי אינו זמין כרגע. הלוח שלך לא השתנה.';
    return {
      outcome: 'assistant_unavailable',
      messageHe,
      events: [{ type: 'assistant_unavailable', message_he: messageHe }],
    };
  }
}

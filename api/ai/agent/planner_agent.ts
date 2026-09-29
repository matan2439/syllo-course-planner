/**
 * The planning co-pilot: one OpenAI Agents SDK agent over deterministic planner
 * tools. The run ends when the agent asks the student something (ask_student),
 * submits a validated proposal (submit_proposal), or answers in plain text.
 */
import {
  Agent,
  MaxTurnsExceededError,
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
import { buildAgentTools, READ_ONLY_AGENT_TOOLS, type AgentToolName } from './tools';
import { COURSE_FOCUS_INSTRUCTIONS, PLANNER_AGENT_INSTRUCTIONS } from './instructions';

// GPT-6 Sol: OpenAI's model for agentic, multi-step tool workflows ($2/$10 per MTok).
// Astra is 5x the price; Luna is tuned for simple high-volume work, not planning.
export const DEFAULT_AGENT_MODEL = 'gpt-6-sol';
// A difficulty-balance request reads grades, builds, checks and adjusts; 20 ran out.
const MAX_TURNS = 30;
// The function is killed at 300s, which cuts the stream before its result line
// (the student sees a generic failure). Stop the agent early enough to still answer,
// validate a proposal and persist.
const AGENT_DEADLINE_MS = 240_000;

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
  /** Receives the assistant's text as the model streams it. */
  onTextDelta?: (text: string) => void;
  /** Wall-clock budget for the agent run; tests shorten it. */
  deadlineMs?: number;
}

export function agentModelName(): string {
  return (process.env.AI_AGENT_MODEL ?? '').trim() || DEFAULT_AGENT_MODEL;
}

export type CopilotMode = 'plan' | 'course';

/**
 * The one co-pilot engine. 'plan' is the planning co-pilot (every tool, proposal
 * workflow); 'course' is the same engine focused on one course in the course
 * panel: the same model and tool implementations, restricted to read-only tools.
 */
export function createCopilotAgent(mode: CopilotMode, model: string | Model): Agent<PlanningSession> {
  if (mode === 'course') {
    return new Agent<PlanningSession>({
      name: 'TAU course co-pilot',
      instructions: COURSE_FOCUS_INSTRUCTIONS,
      model,
      // Low reasoning: a panel answer is a few lookups, and the student is waiting on it.
      modelSettings: { reasoning: { effort: 'low' } },
      tools: buildAgentTools().filter((tool) => READ_ONLY_AGENT_TOOLS.includes(tool.name as AgentToolName)),
    });
  }
  return new Agent<PlanningSession>({
    name: 'TAU planning co-pilot',
    instructions: PLANNER_AGENT_INSTRUCTIONS,
    model,
    // Medium reasoning: enough to weigh degree rules against preferences without
    // blowing the 300s function budget across ~10 tool round-trips.
    modelSettings: { reasoning: { effort: 'medium' } },
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

export function toInputItems(transcript: readonly ConversationTurn[], profile?: PreferenceProfile): AgentInputItem[] {
  const items: AgentInputItem[] = transcript.map((turn) =>
    turn.role === 'user' ? user(turn.text) : assistant(turn.text));
  if (profile?.preferences.length) {
    items.unshift(system(`Preferences the student confirmed in the intake panel (version ${profile.version}): ${JSON.stringify(profile.preferences)}. Record the ones that affect planning with update_preferences before build_plan.`));
  }
  return items;
}

/** Tracing would send student data to OpenAI's trace store; opt-in only. */
export function createAgentRunner(): Runner {
  return new Runner({
    tracingDisabled: process.env.AI_AGENT_TRACING !== 'true',
    traceIncludeSensitiveData: false,
  });
}

export async function runPlannerAgent(input: PlannerAgentInput, deps: PlannerAgentDeps = {}): Promise<PlannerAgentResult> {
  const { session } = input;
  const runner = createAgentRunner();
  let streamed = '';
  const deadline = AbortSignal.timeout(deps.deadlineMs ?? AGENT_DEADLINE_MS);
  // Out of steps or time is not an outage: keep what was said and let the student narrow it.
  const stoppedEarly = (): PlannerAgentResult => {
    const note = 'עצרתי לפני שסיימתי — הבקשה דרשה יותר מדי בדיקות. נסו לצמצם אותה (למשל סמסטר אחד או כמה קורסים מסוימים). הלוח שלך לא השתנה.';
    const messageHe = streamed.trim() ? `${streamed.trim()}\n\n${note}` : note;
    const events = [...session.events, { type: 'assistant_message' as const, text_he: messageHe.slice(0, 4_000) }];
    return { outcome: 'conversation', messageHe, events };
  };
  try {
    const result = await runner.run(
      createCopilotAgent('plan', deps.model ?? agentModelName()),
      toInputItems(input.transcript, input.preferenceProfile),
      { context: session, maxTurns: MAX_TURNS, stream: true, signal: deadline },
    );
    for await (const event of result) {
      if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
        streamed += event.data.delta;
        deps.onTextDelta?.(event.data.delta);
      }
    }
    await result.completed;
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
          answer_type: questionId === 'max_weekly_hours' || questionId === 'degree_year' ? 'number' as const
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

    if (deadline.aborted) {
      console.warn('[ai/planner-agent] deadline reached');
      return stoppedEarly();
    }
    const messageHe = (typeof result.finalOutput === 'string' && result.finalOutput.trim()) || spoken
      || 'לא הצלחתי לנסח תשובה. אפשר לנסות לנסח את הבקשה אחרת?';
    events.push({ type: 'assistant_message', text_he: messageHe.slice(0, 4_000) });
    return { outcome: 'conversation', messageHe, events };
  } catch (error) {
    if (error instanceof MaxTurnsExceededError || deadline.aborted) {
      console.warn(`[ai/planner-agent] ${deadline.aborted ? 'deadline' : 'max turns'} reached`);
      return stoppedEarly();
    }
    console.error('[ai/planner-agent] run failed:', (error as Error)?.constructor?.name, (error as Error)?.message);
    const messageHe = 'העוזר האקדמי אינו זמין כרגע. הלוח שלך לא השתנה.';
    return {
      outcome: 'assistant_unavailable',
      messageHe,
      events: [{ type: 'assistant_unavailable', message_he: messageHe }],
    };
  }
}

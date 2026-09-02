import { generateText, type LanguageModel } from 'ai';
import type { ConversationEvent, ConversationTurn } from '../../shared/planner/conversation-wire';
import { buildPlannerTools, type PlannerTools } from './planner_tools';
import type { PlannerWorker } from './planner_worker';

type GenerateResult = { text?: string };
export type ConversationGenerateFn = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
  tools: PlannerTools;
  maxSteps: number;
}) => Promise<GenerateResult>;

export type ConversationalAgentResult =
  | {
      outcome: 'proposal';
      messageHe: string;
      events: ConversationEvent[];
      draftPlan: ReturnType<PlannerWorker['getPlan']>;
      validation: ReturnType<PlannerWorker['validateCandidate']>;
    }
  | {
      outcome: 'assistant_unavailable';
      messageHe: string;
      events: ConversationEvent[];
    };

const SYSTEM_PROMPT = `אתה עוזר אקדמי לתכנון תואר באוניברסיטת תל אביב.
נהל שיחה טבעית בעברית והשתמש רק בכלים שסופקו כדי לבדוק או לשנות טיוטה.
אל תמציא עובדות אקדמיות, אל תבטיח ששינוי נשמר ואל תציג טיוטה כלוח מחויב.
סיים ב-finalize_plan והסבר בקצרה את החלופה שנבנתה.`;

function transcriptPrompt(transcript: readonly ConversationTurn[]): string {
  return transcript.map((turn) => `${turn.role === 'user' ? 'סטודנט' : 'עוזר'}: ${turn.text}`).join('\n');
}

export async function runConversationalAgent(
  input: { transcript: readonly ConversationTurn[]; createWorker: () => PlannerWorker },
  deps: { model: LanguageModel; generate?: ConversationGenerateFn; maxSteps?: number },
): Promise<ConversationalAgentResult> {
  const worker = input.createWorker();
  const events: ConversationEvent[] = [];
  const tools = buildPlannerTools(worker, ({ tool, status }) => {
    events.push({ type: 'tool_status', tool, status });
  });
  const generate = deps.generate ?? (generateText as unknown as ConversationGenerateFn);

  try {
    const result = await generate({
      model: deps.model,
      system: SYSTEM_PROMPT,
      prompt: transcriptPrompt(input.transcript),
      tools,
      maxSteps: deps.maxSteps ?? 16,
    });
    const validation = worker.repair();
    const messageHe = result.text?.trim() || 'הכנתי טיוטה שנבדקה לפי כללי התוכנית.';
    events.push({ type: 'assistant_message', text_he: messageHe });
    return { outcome: 'proposal', messageHe, events, draftPlan: worker.getPlan(), validation };
  } catch {
    const messageHe = 'העוזר האקדמי אינו זמין כרגע. הלוח שלך לא השתנה.';
    return {
      outcome: 'assistant_unavailable',
      messageHe,
      events: [{ type: 'assistant_unavailable', message_he: messageHe }],
    };
  }
}


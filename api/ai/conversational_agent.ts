import { generateText, type LanguageModel } from 'ai';
import type { ConversationEvent, ConversationTurn } from '../../shared/planner/conversation-wire';
import { buildPlannerTools, type PlannerTools } from './planner_tools';
import type { PreferenceProfile } from './preference_model';
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
      nextAction?: 'offer_build';
      messageHe: string;
      events: ConversationEvent[];
      draftPlan: ReturnType<PlannerWorker['getPlan']>;
      validation: ReturnType<PlannerWorker['validateCandidate']>;
    }
  | {
      outcome: 'conversation';
      nextAction: 'ask' | 'offer_build';
      messageHe: string;
      events: ConversationEvent[];
    }
  | {
      outcome: 'assistant_unavailable';
      messageHe: string;
      events: ConversationEvent[];
    };

const SYSTEM_PROMPT = `אתה עוזר אקדמי לתכנון תואר באוניברסיטת תל אביב.
נהל שיחה טבעית בעברית והשתמש רק בכלים שסופקו כדי לבדוק או לשנות טיוטה.
אל תמציא עובדות אקדמיות, אל תבטיח ששינוי נשמר ואל תציג טיוטה כלוח מחויב.
בדוק את מצב הלוח והכללים לפני הצעה. אם חסר מידע אישי מהותי (למשל אילוצים,
קורסים שהושלמו, קורסים שיש להימנע מהם או מטרת התכנון), שאל שאלה אחת ממוקדת
באמצעות ask_clarification עם אפשרויות בעברית, ואל תפעיל finalize_plan באותו תור.
רק אחרי שיש לך מספיק מידע מהסטודנט, הפעל finalize_plan והסבר בקצרה את
החלופה שנבדקה. אל תציע בנייה על סמך שאלה יחידה על עומס בלבד.`;

const FALLBACK_CLARIFICATION = {
  questionHe: 'כדי לבנות חלופות שבאמת מתאימות לך, איזה מידע חשוב שניקח בחשבון קודם?',
  optionsHe: [
    'אילו קורסים כבר השלמתי או אני לומד/ת עכשיו',
    'אילו מגבלות עומס או ימים חשובים לי',
    'אילו תחומי קורסים מעניינים אותי במיוחד',
  ],
};

function hasEnoughUserContext(
  transcript: readonly ConversationTurn[],
  preferenceProfile?: PreferenceProfile,
): boolean {
  const preferences = preferenceProfile?.preferences ?? [];
  const unresolved = preferences.some((preference) =>
    preference.classification === 'uncertain'
    || preference.confirmationStatus === 'pending'
    || preference.confirmationStatus === 'rejected'
    || (preference.classification === 'hard_constraint' && preference.confirmationStatus !== 'confirmed'));
  if (unresolved) return false;

  const usablePreferences = preferences.filter((preference) =>
    preference.classification !== 'indifferent'
    && preference.mayAffectPlanningBeforeConfirmation,
  );
  if (usablePreferences.length >= 2) return true;

  // A free-form conversation can also supply the context. Do not count a
  // one-line build command as personal information; require two substantive
  // user turns before the LLM is allowed to offer generation.
  const substantiveTurns = transcript.filter((turn) => {
    if (turn.role !== 'user') return false;
    const text = turn.text.trim().replace(/\s+/g, ' ');
    if (text.length < 8) return false;
    return !/^(בנה|תבנה|תציע|צור|build|create|plan)\b/i.test(text);
  });
  return substantiveTurns.length >= 2;
}

function transcriptPrompt(
  transcript: readonly ConversationTurn[],
  preferenceProfile?: PreferenceProfile,
): string {
  const turns = transcript.map((turn) => `${turn.role === 'user' ? 'סטודנט' : 'עוזר'}: ${turn.text}`).join('\n');
  if (!preferenceProfile) return turns;
  return `${turns}\n\nפרופיל העדפות מובנה שנמסר ואושר על ידי הסטודנט (גרסה ${preferenceProfile.version}):\n${JSON.stringify(preferenceProfile)}`;
}

export async function runConversationalAgent(
  input: { transcript: readonly ConversationTurn[]; createWorker: () => PlannerWorker; preferenceProfile?: PreferenceProfile },
  deps: { model: LanguageModel; generate?: ConversationGenerateFn; maxSteps?: number },
): Promise<ConversationalAgentResult> {
  const worker = input.createWorker();
  const events: ConversationEvent[] = [];
  const clarifications: Array<{ questionHe: string; optionsHe: string[] }> = [];
  const tools = buildPlannerTools(worker, ({ tool, status }) => {
    events.push({ type: 'tool_status', tool, status });
  }, (clarification) => {
    clarifications.push(clarification);
  });
  const generate = deps.generate ?? (generateText as unknown as ConversationGenerateFn);

  try {
    const result = await generate({
      model: deps.model,
      system: SYSTEM_PROMPT,
      prompt: transcriptPrompt(input.transcript, input.preferenceProfile),
      tools,
      maxSteps: deps.maxSteps ?? 16,
    });
    const validation = worker.repair();
    const messageHe = result.text?.trim() || 'הכנתי טיוטה שנבדקה לפי כללי התוכנית.';
    events.push({ type: 'assistant_message', text_he: messageHe });
    if (clarifications.length > 0) {
      const clarification = clarifications[0];
      events.push({
        type: 'clarification',
        question_he: clarification.questionHe,
        options_he: clarification.optionsHe,
      });
      return {
        outcome: 'conversation',
        nextAction: 'ask',
        messageHe,
        events,
      };
    }
    if (!hasEnoughUserContext(input.transcript, input.preferenceProfile)) {
      events.push({
        type: 'clarification',
        question_he: FALLBACK_CLARIFICATION.questionHe,
        options_he: FALLBACK_CLARIFICATION.optionsHe,
      });
      return {
        outcome: 'conversation',
        nextAction: 'ask',
        messageHe,
        events,
      };
    }
    const finalized = events.some((event) =>
      event.type === 'tool_status' && event.tool === 'finalize_plan' && event.status === 'completed');
    if (!finalized) {
      return {
        outcome: 'conversation',
        nextAction: 'offer_build',
        messageHe,
        events,
      };
    }
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

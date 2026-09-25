/**
 * Real-model smoke run of the planning co-pilot (OpenAI Agents SDK) on the
 * mechanical_engineering_2027 board. Plays three student turns, carrying the
 * agent's recorded preferences between turns like /api/ai/conversation does.
 *
 *   OPENAI_API_KEY=sk-... npx tsx scripts/agent_smoke.ts
 */
import { loadLocalBoardJson } from '../api/ai/board_loader';
import { clarifyForAcademicDecision, extractClarificationContext } from '../api/ai/academic_decision_runtime';
import { PlanningSession } from '../api/ai/agent/session';
import { runPlannerAgent } from '../api/ai/agent/planner_agent';
import type { ConversationTurn } from '../shared/planner/conversation-wire';

const PROGRAM_ID = 'mechanical_engineering_2027';

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY');
  const board = loadLocalBoardJson(PROGRAM_ID);
  // The board holds years 3–4 only; years 1–2 arrive as prior credit (~90h), like the UI sends.
  const planContext = {
    semesters: [],
    total_hours_progress: { known_completed_hours: 90 },
    personal_status: { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
  };

  const studentTurns = [
    'סיימתי את שנים א׳ ו-ב׳ של התואר.',
    'אני רוצה עד 20 שעות שבועיות, אני אוהב מערכות בקרה, ולא יותר ממעבדה אחת בסמסטר.',
    'תבנה לי תוכנית.',
  ];
  const transcript: ConversationTurn[] = [];
  let preferences: Record<string, unknown> = {};

  for (const text of studentTurns) {
    transcript.push({ role: 'user', text });
    const clarification = await clarifyForAcademicDecision(extractClarificationContext(planContext, preferences, undefined));
    const session = new PlanningSession({
      programId: PROGRAM_ID, programBoard: board, planContext, committedContext: planContext, preferences, clarification,
    });
    const started = Date.now();
    const result = await runPlannerAgent({ transcript, session });
    preferences = session.preferences;

    console.log(`\n=== student: ${text}`);
    console.log('tools:', result.events.filter((event) => event.type === 'tool_status' && event.status !== 'started')
      .map((event) => event.type === 'tool_status' ? `${event.tool}:${event.status}` : '').join(', '));
    console.log(`outcome: ${result.outcome} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log('assistant:', result.messageHe);
    console.log('preferences:', JSON.stringify(preferences));
    if (result.outcome === 'proposal') {
      console.log('valid:', result.validation.valid, 'degree hours:', result.validation.degreeHours);
      for (const [semester, ids] of Object.entries(result.draftPlan.semesters)) console.log(`  ${semester}: ${ids.join(', ')}`);
    }
    transcript.push({ role: 'assistant', text: result.messageHe.slice(0, 4_000) });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

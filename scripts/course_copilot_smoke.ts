/**
 * Real-model smoke run of the course-knowledge upgrade: the course panel's
 * co-pilot (course mode, two turns with history) and the planning co-pilot
 * answering an interest question from syllabus + grades. Live grade and
 * syllabus sources are used as configured.
 *
 *   npm run agent:course-smoke     (reads OPENAI_API_KEY from .env.local)
 */
import { loadLocalBoardJson } from '../api/ai/board_loader';
import { clarifyForAcademicDecision, extractClarificationContext } from '../api/ai/academic_decision_runtime';
import { PlanningSession } from '../api/ai/agent/session';
import { runPlannerAgent } from '../api/ai/agent/planner_agent';
import { streamCourseAdvisor, type CourseChatTurn } from '../api/ai/agent/course_advisor';

const PROGRAM_ID = 'mechanical_engineering_2027';
const COURSE_ID = process.argv[2] ?? '0542-4010';

try { process.loadEnvFile('.env.local') } catch { /* rely on the shell env */ }

const planContext = {
  semesters: [],
  total_hours_progress: { known_completed_hours: 90 },
  personal_status: { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
};

async function askCourse(message: string, history: CourseChatTurn[]): Promise<string> {
  const started = Date.now();
  const advisor = await streamCourseAdvisor({ message, programId: PROGRAM_ID, planContext, courseId: COURSE_ID, history });
  let text = '';
  const reader = advisor.textStream.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += chunk.value;
  await advisor.completed;
  console.log(`\n=== course ${COURSE_ID} — student: ${message} (${((Date.now() - started) / 1000).toFixed(1)}s)\n${text}`);
  return text;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in .env.local (repo root)');

  const history: CourseChatTurn[] = [];
  for (const question of ['מה רמת הקושי של הקורס לפי הציונים, ומה לומדים בו?', 'ואיך נקבע הציון?']) {
    const answer = await askCourse(question, history);
    history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
  }

  const transcript = [{ role: 'user' as const, text: 'סיימתי שנים א׳-ב׳. אני אוהב רובוטיקה ובקרה — אילו קורסי בחירה מתאימים לי ולמה? אל תבנה תוכנית עדיין.' }];
  const clarification = await clarifyForAcademicDecision(extractClarificationContext(planContext, {}, undefined));
  const session = new PlanningSession({
    programId: PROGRAM_ID, programBoard: loadLocalBoardJson(PROGRAM_ID), planContext, committedContext: planContext, preferences: {}, clarification,
  });
  const started = Date.now();
  const result = await runPlannerAgent({ transcript, session });
  console.log(`\n=== planning co-pilot — student: ${transcript[0].text} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log('tools:', result.events.filter((event) => event.type === 'tool_status' && event.status !== 'started')
    .map((event) => event.type === 'tool_status' ? `${event.tool}:${event.status}` : '').join(', '));
  console.log(result.messageHe);
}

main().catch((error) => { console.error(error); process.exit(1); });

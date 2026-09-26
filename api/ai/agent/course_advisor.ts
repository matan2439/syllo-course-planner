/**
 * The per-course chat ("ask about this course"): a read-only Agents SDK agent
 * that answers from the program's authoritative course data and streams text.
 * It never edits a plan; planning belongs to the co-pilot (planner_agent.ts).
 */
import { Agent, user, system, type Model } from '@openai/agents';
import { loadLocalBoardJson } from '../board_loader';
import { PlanningSession } from './session';
import { buildAgentTools, type AgentToolName } from './tools';
import { agentModelName, createAgentRunner } from './planner_agent';

const READ_ONLY_TOOLS: readonly AgentToolName[] = [
  'search_courses', 'get_course_details', 'explain_constraint', 'get_requirements_gap',
];

const COURSE_ADVISOR_INSTRUCTIONS = `You answer a student's question about ONE course in a Tel Aviv University degree program.
Answer in concise, natural Hebrew (at most ~150 words).
- Verify facts with the tools (prerequisites, offering semesters, category, hours, what else the degree still needs). Never state an academic fact no tool or the course card returned; if something is unknown, say so.
- The course card the student is looking at is given below; the syllabus link, if any, is the source for course content.
- You cannot change the student's plan. If they want to build or change a plan, point them to the planning assistant (העוזר לתכנון) in the planner.`;

export interface CourseAdvisorInput {
  message: string;
  programId: string;
  planContext: Record<string, unknown>;
  courseContext?: string;
}

export interface CourseAdvisorStream {
  textStream: ReadableStream<string>;
  /** Resolves when the run finished (rejects if it failed). */
  completed: Promise<void>;
}

export async function streamCourseAdvisor(
  input: CourseAdvisorInput,
  deps: { model?: string | Model } = {},
): Promise<CourseAdvisorStream> {
  const board = loadLocalBoardJson(input.programId);
  const session = board
    ? new PlanningSession({
        programId: input.programId,
        programBoard: board,
        planContext: input.planContext,
        committedContext: input.planContext,
        preferences: {},
        clarification: { needsClarification: false, missingInputs: [], questions: [] },
      })
    : undefined;
  const agent = new Agent<PlanningSession>({
    name: 'TAU course advisor',
    instructions: COURSE_ADVISOR_INSTRUCTIONS,
    model: deps.model ?? agentModelName(),
    modelSettings: { reasoning: { effort: 'low' } },
    // No program data → answer from the course card alone.
    tools: session ? buildAgentTools().filter((tool) => READ_ONLY_TOOLS.includes(tool.name as AgentToolName)) : [],
  });
  const result = await createAgentRunner().run(
    agent,
    [
      ...(input.courseContext ? [system(`Course card:\n${input.courseContext}`)] : []),
      user(input.message),
    ],
    { stream: true, context: session, maxTurns: 8 },
  );
  // The SDK's shim types its web stream separately from lib.dom's; same object at runtime.
  return { textStream: result.toTextStream() as unknown as ReadableStream<string>, completed: result.completed };
}

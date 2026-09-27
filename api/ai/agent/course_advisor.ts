/**
 * The per-course chat ("ask about this course"): the co-pilot engine in course
 * mode (planner_agent.ts createCopilotAgent) — same model and tool
 * implementations, read-only tools only — streaming its text. It never edits a
 * plan; planning belongs to the planning co-pilot.
 */
import { assistant, user, system, type AgentInputItem, type Model } from '@openai/agents';
import { loadLocalBoardJson } from '../board_loader';
import { PlanningSession } from './session';
import { agentModelName, createAgentRunner, createCopilotAgent } from './planner_agent';
import type { CourseInsightsProvider } from '../course_insights';

export interface CourseChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CourseAdvisorInput {
  message: string;
  programId: string;
  planContext: Record<string, unknown>;
  /** The course the panel is showing. */
  courseId?: string;
  courseContext?: string;
  /** Earlier turns of this panel conversation, oldest first. */
  history?: readonly CourseChatTurn[];
  /** Stored planner preferences, so answers respect the student's choices. */
  preferences?: Record<string, unknown>;
}

export interface CourseAdvisorStream {
  textStream: ReadableStream<string>;
  /** Resolves when the run finished (rejects if it failed). */
  completed: Promise<void>;
}

export function courseAdvisorInputItems(input: CourseAdvisorInput): AgentInputItem[] {
  const focus = [
    input.courseId ? `Course in focus: ${input.courseId}.` : '',
    input.courseContext ? `Course card the student is looking at:\n${input.courseContext}` : '',
  ].filter(Boolean).join('\n');
  return [
    ...(focus ? [system(focus)] : []),
    ...(input.history ?? []).map((turn) => (turn.role === 'user' ? user(turn.content) : assistant(turn.content))),
    user(input.message),
  ];
}

export async function streamCourseAdvisor(
  input: CourseAdvisorInput,
  deps: { model?: string | Model; insights?: CourseInsightsProvider } = {},
): Promise<CourseAdvisorStream> {
  const board = loadLocalBoardJson(input.programId);
  const model = deps.model ?? agentModelName();
  const session = board
    ? new PlanningSession({
        programId: input.programId,
        programBoard: board,
        planContext: input.planContext,
        committedContext: input.planContext,
        preferences: input.preferences ?? {},
        clarification: { needsClarification: false, missingInputs: [], questions: [] },
        ...(deps.insights ? { insights: deps.insights } : {}),
      })
    : undefined;
  // No program data → no tools; answer from the course card alone.
  const agent = session ? createCopilotAgent('course', model) : createCopilotAgent('course', model).clone({ tools: [] });
  const result = await createAgentRunner().run(
    agent,
    courseAdvisorInputItems(input),
    { stream: true, context: session, maxTurns: 10 },
  );
  // The SDK's shim types its web stream separately from lib.dom's; same object at runtime.
  return { textStream: result.toTextStream() as unknown as ReadableStream<string>, completed: result.completed };
}

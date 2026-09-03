/**
 * AI-SDK tool wrappers over the PlannerWorker's deterministic operations. These
 * are the only way the LlmOrchestrator can touch the plan: the model chooses
 * which tool to call, the worker executes and VALIDATES every call, and a compact
 * result is returned for the model to observe. The model never mutates state
 * directly and never decides any hard fact (hours, legality, completion).
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { PlannerWorker, MutationResult } from './planner_worker';

export type PlannerToolName = 'get_state' | 'rank_candidates' | 'add_course' | 'remove_course' |
  'move_course' | 'replace_course' | 'finalize_plan' | 'ask_clarification';
export type PlannerToolStatus = 'started' | 'completed' | 'rejected';
export type PlannerToolObserver = (event: { tool: PlannerToolName; status: PlannerToolStatus }) => void;
export type PlannerClarificationObserver = (event: { questionHe: string; optionsHe: string[] }) => void;

/** Compact, model-readable snapshot after an action. */
function snapshot(worker: PlannerWorker) {
  const st = worker.getState();
  return {
    phase: st.phase,
    degree_hours: st.degreeHours,
    semester_loads: st.semesterLoads,
    mandatory_placed: st.mandatoryPlaced,
    categories_satisfied: st.categoriesSatisfied,
    errors_he: st.errors,
  };
}

function mutationResult(worker: PlannerWorker, r: MutationResult) {
  return {
    accepted: r.accepted,
    reason: r.action.reason,
    blocked_by: r.errorsIntroduced,
    ...snapshot(worker),
  };
}

function safeMutation(worker: PlannerWorker, mutate: () => MutationResult) {
  try {
    return mutationResult(worker, mutate());
  } catch {
    return {
      accepted: false,
      reason: 'הפעולה נדחתה כי אינה מוכרת או אינה חוקית.',
      blocked_by: ['פעולה לא חוקית'],
      ...snapshot(worker),
    };
  }
}

export function buildPlannerTools(
  worker: PlannerWorker,
  observe?: PlannerToolObserver,
  onClarification?: PlannerClarificationObserver,
) {
  const run = async <T>(name: PlannerToolName, action: () => T | Promise<T>): Promise<T> => {
    observe?.({ tool: name, status: 'started' });
    const result = await action();
    const accepted = typeof result === 'object' && result !== null && 'accepted' in result
      ? Boolean((result as { accepted: unknown }).accepted)
      : true;
    observe?.({ tool: name, status: accepted ? 'completed' : 'rejected' });
    return result;
  };
  return {
    get_state: tool({
      description: 'קבל את מצב התוכנית הנוכחי: שלב, שעות תואר, עומס לכל סמסטר, דרישות שמולאו, ושגיאות.',
      parameters: z.object({}),
      execute: async () => run('get_state', () => snapshot(worker)),
    }),

    rank_candidates: tool({
      description: 'קבל את הפעולות החוקיות האפשריות הבאות (קורסים מועמדים לשיבוץ/הזזה), מדורגות לפי תרומה למטרות.',
      parameters: z.object({}),
      execute: async () => run('rank_candidates', () => ({
        actions: worker.rankActions(),
        ...snapshot(worker),
      })),
    }),

    ask_clarification: tool({
      description: 'שאל את הסטודנט שאלה ממוקדת כאשר חסר מידע אישי לבחירת תוכנית. שאל שאלה אחת עם שתי אפשרויות או יותר, ואל תסיים תוכנית באותו תור.',
      parameters: z.object({
        questionHe: z.string().trim().min(1).max(400),
        optionsHe: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
      }),
      execute: async ({ questionHe, optionsHe }) => {
        onClarification?.({ questionHe, optionsHe });
        return run('ask_clarification', () => ({
          asked: true,
          question_he: questionHe,
          options_he: optionsHe,
        }));
      },
    }),

    add_course: tool({
      description: 'שבץ קורס לסמסטר. אם לא צוין סמסטר, ייבחר הסמסטר החוקי המאוזן ביותר. הפעולה תיבדק ותידחה אם אינה חוקית.',
      parameters: z.object({
        courseId: z.string(),
        semesterId: z.string().optional(),
      }),
      execute: async ({ courseId, semesterId }) => run('add_course', () =>
        safeMutation(worker, () => worker.addCourse(courseId, semesterId, 'llm'))),
    }),

    remove_course: tool({
      description: 'הסר קורס מהתוכנית.',
      parameters: z.object({ courseId: z.string() }),
      execute: async ({ courseId }) => run('remove_course', () =>
        safeMutation(worker, () => worker.removeCourse(courseId, 'llm'))),
    }),

    move_course: tool({
      description: 'העבר קורס לסמסטר אחר (לאיזון עומס). הפעולה תיבדק ותידחה אם אינה חוקית.',
      parameters: z.object({ courseId: z.string(), toSemester: z.string() }),
      execute: async ({ courseId, toSemester }) => run('move_course', () =>
        safeMutation(worker, () => worker.moveCourse(courseId, toSemester, 'llm'))),
    }),

    replace_course: tool({
      description: 'החלף קורס משובץ בקורס אחר (חלופה חוקית).',
      parameters: z.object({ outId: z.string(), inId: z.string(), semesterId: z.string().optional() }),
      execute: async ({ outId, inId, semesterId }) => run('replace_course', () =>
        safeMutation(worker, () => worker.replaceCourse(outId, inId, semesterId, 'llm'))),
    }),

    finalize_plan: tool({
      description: 'סיים: הרץ תיקון דטרמיניסטי להשלמת הדרישות ואיזון העומס, והחזר את דוח התקינות הסופי.',
      parameters: z.object({}),
      execute: async () => run('finalize_plan', () => {
        const report = worker.repair();
        return {
          valid: report.valid,
          complete: report.complete,
          legal: report.legal,
          degree_hours: report.degreeHours,
          errors_he: report.errors,
        };
      }),
    }),
  };
}

export type PlannerTools = ReturnType<typeof buildPlannerTools>;

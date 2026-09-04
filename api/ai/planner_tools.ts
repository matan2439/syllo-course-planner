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
import { cloneState, placedCourseIds, semesterOf } from './planner_types';

export type PlannerToolName = 'get_state' | 'rank_candidates' | 'add_course' | 'remove_course' |
  'move_course' | 'replace_course' | 'finalize_plan' | 'ask_clarification' |
  'get_academic_status' | 'get_requirements_gap' | 'get_course_details' | 'get_offerings' |
  'check_prerequisites' | 'simulate_move' | 'compare_candidates' | 'explain_constraint';
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

type FactMeta = {
  source: string;
  freshness: 'request_snapshot';
  confidence: number;
  source_url?: string | null;
};

function fact(source = 'planner_model', confidence = 1, sourceUrl?: string | null): FactMeta {
  return {
    source,
    freshness: 'request_snapshot',
    confidence,
    ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
  };
}

function grounded<T>(data: T, meta: FactMeta = fact()) {
  return { data, fact: meta };
}

function profileFor(worker: PlannerWorker, courseId: string) {
  return worker.getModel().profiles.get(courseId);
}

function allowedSemesters(profile: NonNullable<ReturnType<typeof profileFor>>): string[] | null {
  return profile.effective_allowed_semesters
    ?? profile.offered_semesters
    ?? profile.allowed_semesters
    ?? profile.program_allowed_semesters;
}

function semesterIndex(worker: PlannerWorker, semesterId: string): number {
  return worker.getModel().knownSemesterIds.indexOf(semesterId);
}

function prerequisiteStatus(worker: PlannerWorker, courseId: string, targetSemester?: string) {
  const profile = profileFor(worker, courseId);
  if (!profile) return { course_id: courseId, known: false, missing_course_ids: [] as string[] };
  const model = worker.getModel();
  const plan = worker.getPlan();
  const completed = model.completedCourseIds;
  const current = model.currentlyPlannedCourseIds ?? new Set<string>();
  const targetIndex = targetSemester ? semesterIndex(worker, targetSemester) : null;
  const missing = profile.prerequisites.filter((id) => {
    if (completed.has(id) || current.has(id)) return false;
    const placedAt = semesterOf(plan, id);
    if (placedAt && targetIndex !== null) return semesterIndex(worker, placedAt) >= targetIndex;
    return !placedAt;
  });
  return {
    course_id: courseId,
    known: true,
    target_semester: targetSemester ?? null,
    prerequisite_course_ids: [...profile.prerequisites],
    missing_course_ids: missing,
    legal: missing.length === 0,
  };
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

    get_academic_status: tool({
      description: 'קרא את הסטטוס האקדמי הידוע בבקשה הנוכחית ואת הקורסים שכבר נמצאים בטיוטה. החזר רק נתונים ממודל התכנון הסמכותי.',
      parameters: z.object({}),
      execute: async () => run('get_academic_status', () => grounded({
        completed_course_ids: [...worker.getModel().completedCourseIds],
        currently_taking_course_ids: [...(worker.getModel().currentlyPlannedCourseIds ?? new Set<string>())],
        planned_course_ids: [...new Set(placedCourseIds(worker.getPlan()))],
      })),
    }),

    get_requirements_gap: tool({
      description: 'קרא את פערי השעות, החובה והקטגוריות של התוכנית ללא שינוי בטיוטה.',
      parameters: z.object({}),
      execute: async () => run('get_requirements_gap', () => {
        const model = worker.getModel();
        const state = worker.getState();
        const placed = new Set(placedCourseIds(worker.getPlan()));
        const mandatoryRemaining = model.requiredMandatoryCourseIds.filter((id) =>
          !placed.has(id) && !model.completedCourseIds.has(id));
        return grounded({
          degree_hours_required: model.degreeRequiredHours,
          degree_hours_current: state.degreeHours,
          degree_hours_remaining: Math.max(0, model.degreeRequiredHours - state.degreeHours),
          mandatory_required: model.requiredMandatoryCourseIds.length,
          mandatory_placed: state.mandatoryPlaced,
          mandatory_remaining: mandatoryRemaining.length,
          category_count: model.categories.length,
          categories_satisfied: state.categoriesSatisfied,
          categories_remaining: Math.max(0, model.categories.length - state.categoriesSatisfied),
        });
      }),
    }),

    get_course_details: tool({
      description: 'קרא פרטי קורס מתוך פרופיל הקורס הסמכותי, כולל מקור וודאות. קורס לא מוכר מוחזר כלא ידוע.',
      parameters: z.object({ courseId: z.string().trim().min(1).max(128) }),
      execute: async ({ courseId }) => run('get_course_details', () => {
        const profile = profileFor(worker, courseId);
        if (!profile) return grounded({ course_id: courseId, known: false }, fact('planner_model', 0));
        return grounded({
          course_id: profile.course_id,
          known: true,
          name_he: profile.name_he,
          hours: profile.hours,
          category_id: profile.category_id,
          category_name_he: profile.category_name_he,
          is_mandatory: profile.is_mandatory,
          course_type: profile.course_type,
          prerequisites: [...profile.prerequisites],
          corequisites: [...profile.corequisites],
          syllabus_available: profile.syllabus_available,
          syllabus_summary_he: profile.syllabus_summary_he,
          workload_score: profile.workload_score,
          difficulty_score: profile.difficulty_score,
          excluded: profile.excluded,
        }, fact('planner_model', profile.data_confidence, profile.provenance.name_source));
      }),
    }),

    get_offerings: tool({
      description: 'קרא את הסמסטרים המותרים לקורס רק כאשר קיימת עובדת היצע/הקצאה סמכותית; מידע חסר נשאר לא ידוע.',
      parameters: z.object({ courseId: z.string().trim().min(1).max(128) }),
      execute: async ({ courseId }) => run('get_offerings', () => {
        const profile = profileFor(worker, courseId);
        if (!profile) return grounded({ course_id: courseId, known: false, allowed_semesters: null }, fact('planner_model', 0));
        const allowed = allowedSemesters(profile);
        return grounded({
          course_id: courseId,
          known: allowed !== null,
          allowed_semesters: allowed,
          recommended_semester: profile.recommended_semester,
        }, fact('planner_model', allowed === null ? 0 : profile.data_confidence, profile.provenance.offering_source_url));
      }),
    }),

    check_prerequisites: tool({
      description: 'בדוק תנאי קדם של קורס מול קורסים שהושלמו, נלמדים או שובצו בטיוטה. פעולה לקריאה בלבד.',
      parameters: z.object({
        courseId: z.string().trim().min(1).max(128),
        targetSemester: z.string().trim().min(1).max(128).optional(),
      }),
      execute: async ({ courseId, targetSemester }) => run('check_prerequisites', () => grounded(
        prerequisiteStatus(worker, courseId, targetSemester),
      )),
    }),

    simulate_move: tool({
      description: 'סמלץ העברת קורס לסמסטר בלי לשנות את הטיוטה האמיתית. כללי החוקיות נבדקים על עותק מבודד.',
      parameters: z.object({
        courseId: z.string().trim().min(1).max(128),
        toSemester: z.string().trim().min(1).max(128),
      }),
      execute: async ({ courseId, toSemester }) => run('simulate_move', () => {
        const before = cloneState(worker.getPlan());
        const simulated = new (worker.constructor as typeof PlannerWorker)(worker.getModel(), before);
        const result = safeMutation(simulated, () => simulated.moveCourse(courseId, toSemester, 'llm'));
        return grounded({
          course_id: courseId,
          to_semester: toSemester,
          accepted: result.accepted,
          reason_he: result.reason,
          errors_he: result.blocked_by,
          before,
          after: cloneState(simulated.getPlan()),
        });
      }),
    }),

    compare_candidates: tool({
      description: 'השווה מועמדי קורסים חוקיים שנמצאים במודל, בלי להחיל אף אחד מהם על הטיוטה.',
      parameters: z.object({ courseIds: z.array(z.string().trim().min(1).max(128)).min(1).max(12) }),
      execute: async ({ courseIds }) => run('compare_candidates', () => {
        const ranked = worker.rankActions(64);
        const candidates = courseIds.map((courseId) => {
          const profile = profileFor(worker, courseId);
          const action = ranked.find((item) => item.type === 'ADD_COURSE' && item.courseId === courseId);
          return {
            course_id: courseId,
            name_he: profile?.name_he ?? null,
            known: Boolean(profile),
            action: action ?? null,
            score: action?.score ?? null,
            data_confidence: profile?.data_confidence ?? 0,
          };
        });
        return grounded({ candidates });
      }),
    }),

    explain_constraint: tool({
      description: 'הסבר את העובדה הסמכותית שמאחורי אילוץ קורס מסוים; נתון חסר מוחזר כלא ידוע.',
      parameters: z.object({
        courseId: z.string().trim().min(1).max(128),
        constraint: z.enum(['offering', 'prerequisites', 'load', 'completion', 'disallowed']),
      }),
      execute: async ({ courseId, constraint }) => run('explain_constraint', () => {
        const profile = profileFor(worker, courseId);
        if (!profile) return grounded({ course_id: courseId, constraint, known: false }, fact('planner_model', 0));
        const model = worker.getModel();
        const data = constraint === 'offering'
          ? { course_id: courseId, constraint, allowed_semesters: allowedSemesters(profile), recommended_semester: profile.recommended_semester }
          : constraint === 'prerequisites'
            ? { ...prerequisiteStatus(worker, courseId), constraint }
            : constraint === 'completion'
              ? { course_id: courseId, constraint, completed: model.completedCourseIds.has(courseId), currently_taking: model.currentlyPlannedCourseIds?.has(courseId) ?? false }
              : constraint === 'disallowed'
                ? { course_id: courseId, constraint, disallowed: model.disallowedCourseIds.has(courseId) || profile.excluded, exclusion_reason: profile.exclusion_reason }
                : { course_id: courseId, constraint, course_hours: profile.hours, semester_loads: worker.getState().semesterLoads, max_hours: model.maxHoursPerSemester, hard_cap: model.hardCap };
        return grounded(data, fact('planner_model', profile.data_confidence, constraint === 'offering' ? profile.provenance.offering_source_url : profile.provenance.source));
      }),
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

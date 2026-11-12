/**
 * OpenAI Agents SDK tools for the planning co-pilot. Every academic fact comes
 * from the deterministic model/worker; the LLM only chooses which tool to call.
 * Parameters use `.nullable()` (not `.optional()`): the SDK sends strict JSON
 * schemas, where every property must be required.
 */
import { tool, type RunContext } from '@openai/agents';
import { z } from 'zod';
import { degreeYearOf, PREFERRED_ANSWERED_KEY, type ClarificationQuestionId, type PlanningSession } from './session';
import { HIGHLIGHT_TARGET_PATTERN, UI_HIGHLIGHT_TARGETS } from '../../../shared/planner/ui-highlight';
import {
  allowedSemesters,
  fact,
  grounded,
  prerequisiteStatus,
  profileFor,
  safeMutation,
  simulationValidationFromCandidateReport,
  snapshot,
} from '../planner_tools';
import { cloneState, placedCourseIds, semesterOf } from '../planner_types';
import { validateCandidate } from '../planner_validate';
import { DeterministicWhatIfSimulationCapability } from '../what_if_simulation';
import { generateCandidateSet, selectCandidate } from '../candidate_set';
import { PlannerWorker } from '../planner_worker';
import { planContextToState } from '../planner_model';
import { analyzeHardConstraints } from '../hard_constraints';
import { normalizeHebrew } from '../planning_intent';
import { ACADEMIC_FOCUS_AREAS } from '../academic_interest_profile';
import { INTERNAL_DISTRIBUTION_POLICY } from '../planner_policy_context';
import { currentSemesterId, defaultTermMapping } from '../../../shared/planner/schedule';
import { checkTimetable, WEEK_DAYS } from '../../../shared/planner/timetable';
import { fetchScheduleFromBidit } from './session';
import { earlyYearCoursesFor } from '../../../shared/planner/early_year_courses';
import { completedCreditHours } from '../conversation_clarification';
import type { CourseProfile } from '../course_profile';

export const AGENT_TOOL_NAMES = [
  'get_student_context', 'record_completed_courses', 'get_requirements_gap', 'search_courses', 'get_course_details',
  'get_course_syllabus', 'get_course_grades', 'explain_constraint', 'update_preferences', 'build_plan', 'add_course', 'remove_course',
  'move_course', 'replace_course', 'simulate_changes', 'validate_plan', 'check_timetable',
  'ask_student', 'submit_proposal', 'highlight_element', 'unlock_courses',
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** Tools that never change the student's data or the draft — the course-panel engine uses only these. */
export const READ_ONLY_AGENT_TOOLS: readonly AgentToolName[] = [
  'get_student_context', 'get_requirements_gap', 'search_courses', 'get_course_details', 'get_course_syllabus',
  'get_course_grades', 'explain_constraint', 'simulate_changes', 'validate_plan', 'check_timetable',
];

const courseId = z.string().trim().min(1).max(128);
type Ctx = RunContext<PlanningSession>;
const sessionOf = (context?: Ctx): PlanningSession => {
  if (!context?.context) throw new Error('planner agent tool called without a PlanningSession');
  return context.context;
};

/** Wrap a tool body so the UI audit log gets started/completed/rejected events. */
function observed<A>(name: AgentToolName, body: (session: PlanningSession, args: A) => unknown) {
  return async (args: A, context?: Ctx) => {
    const session = sessionOf(context);
    session.emit({ type: 'tool_status', tool: name, status: 'started' });
    // Let a streamed "started" line flush before a long synchronous step (build_plan
    // blocks the event loop for tens of seconds), so the student sees what is running.
    await new Promise((resolve) => setImmediate(resolve));
    const result = await body(session, args);
    const rejected = typeof result === 'object' && result !== null && 'accepted' in result
      && (result as { accepted: unknown }).accepted === false;
    session.emit({ type: 'tool_status', tool: name, status: rejected ? 'rejected' : 'completed' });
    return result;
  };
}

/** Hebrew name of where allowed_semesters came from, so the model cites it instead of the syllabus. */
export function offeringSourceHe(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('study-program') && url.includes('tab=schedule')) return 'מערכת השעות הרשמית של התוכנית';
  if (url.includes('search_l.aspx')) return 'חיפוש הקורסים של אוניברסיטת תל אביב';
  return null;
}

const SYLLABUS_SEMESTER_NOTE =
  'Not a source for semesters, days or hours. For which semester the course runs use get_course_details.allowed_semesters and cite its offering_source_he / offering_source_url.';

/** Which degree years the board plans, e.g. "years_1_2". */
function planningWindow(semesterIds: readonly string[]): string | null {
  const years = [...new Set(semesterIds.map(degreeYearOf).filter(Boolean))].sort();
  return years.length ? `years_${years.join('_')}` : null;
}

const nameOf = (session: PlanningSession, id: string) => session.model.profiles.get(id)?.name_he ?? null;

function semesterLoads(session: PlanningSession) {
  const { model } = session;
  const loads = session.worker.getState().semesterLoads;
  return Object.entries(loads).map(([semester_id, hours]) => ({
    semester_id,
    hours,
    over_student_cap: hours > model.maxHoursPerSemester,
    over_hard_cap: hours > model.hardCap,
  }));
}

function planSummary(session: PlanningSession) {
  const plan = session.worker.getPlan();
  return Object.entries(plan.semesters).map(([semester_id, ids]) => ({
    semester_id,
    courses: ids.map((id) => ({ course_id: id, name_he: nameOf(session, id), hours: session.model.profiles.get(id)?.hours ?? null })),
  }));
}

function validationSummary(session: PlanningSession) {
  const report = session.worker.validateCandidate();
  return {
    valid: report.valid,
    legal: report.legal,
    complete: report.complete,
    degree_hours: report.degreeHours,
    degree_hours_required: session.model.degreeRequiredHours,
    errors_he: report.errors,
    warnings_he: report.warnings,
    missing_mandatory_course_ids: report.missingMandatory,
    unsatisfied_category_ids: report.unsatisfiedCategories,
    missing_wanted_course_ids: report.missingMustInclude,
    semester_loads: semesterLoads(session),
  };
}

function courseStatus(session: PlanningSession, id: string) {
  const { model } = session;
  if (model.completedCourseIds.has(id)) return 'completed';
  if (model.currentlyPlannedCourseIds?.has(id)) return 'currently_taking';
  if (model.disallowedCourseIds.has(id)) return 'avoided';
  const placed = semesterOf(session.worker.getPlan(), id);
  return placed ? `planned:${placed}` : 'available';
}

const lockConflictRows = (session: PlanningSession) => session.lockConflicts.map((conflict) => ({
  code: conflict.code,
  course_ids: conflict.courseIds,
  ...(conflict.semesterId ? { semester_id: conflict.semesterId } : {}),
  message_he: conflict.messageHe,
  resolutions_he: conflict.resolutionsHe,
}));

const LOCK_CONFLICT_NOTE = 'Locked courses collide with a rule or a request. Nothing was changed. Explain each conflict to the student (message_he), offer its resolutions_he, and ask which they choose with ask_student. Only after they answer, call unlock_courses for the courses they released.';

/** A draft change to a locked course is refused until the student releases it. */
function lockedRejection(session: PlanningSession, id: string, action: string) {
  if (!session.isLocked(id)) return null;
  return {
    accepted: false,
    locked: true,
    reason: `"${nameOf(session, id) ?? id}" is on the student's committed board and is locked: you may not ${action} it. If a change seems needed, explain why and ask the student with ask_student; only after they explicitly agree, call unlock_courses and then retry.`,
  };
}

const listOrNull = (schema: z.ZodTypeAny) => z.array(schema).max(40).nullable();

interface SearchField { text: string; weight: number; quotable: boolean }

/** What search_courses matches, strongest evidence first. */
function searchableFields(profile: CourseProfile): SearchField[] {
  const details = profile.syllabus_details;
  const field = (text: string | null | undefined, weight: number, quotable = false): SearchField[] =>
    text ? [{ text, weight, quotable }] : [];
  return [
    ...field(profile.course_id, 3),
    ...field(profile.name_he, 3),
    ...field(profile.category_name_he, 1),
    ...(details?.topics_he ?? profile.syllabus_topics_he).flatMap((topic) => field(topic, 2, true)),
    ...field(details ? details.summary_he : profile.syllabus_summary_he, 1, true),
    ...field(details?.assessment_he, 1, true),
    ...field(details?.structure_he, 1, true),
    ...(details?.complexity_notes_he ?? []).flatMap((note) => field(note, 1, true)),
  ];
}

/** Per matched term, the weight of its strongest field; plus a snippet around the first syllabus match. */
function scoreFields(fields: SearchField[], terms: string[]): { score: number; snippet: string | null } {
  let score = 0;
  let snippet: string | null = null;
  const normalized = fields.map((field) => ({ ...field, norm: normalizeHebrew(field.text).toLowerCase() }));
  for (const term of terms) {
    const hits = normalized.filter((field) => field.norm.includes(term));
    score += hits.length ? Math.max(...hits.map((field) => field.weight)) : 0;
    const quote = hits.find((field) => field.quotable);
    if (!snippet && quote) {
      const at = Math.max(0, quote.norm.indexOf(term) - 60);
      snippet = `${at > 0 ? '…' : ''}${quote.norm.slice(at, at + 160).trim()}${at + 160 < quote.norm.length ? '…' : ''}`;
    }
  }
  return { score, snippet };
}

export function buildAgentTools() {
  return [
    tool({
      name: 'get_student_context',
      description: 'Read what is known about the student: completed and current courses, stored preferences, remaining semesters, load caps, and critical inputs still missing. Call this first.',
      parameters: z.object({}),
      execute: observed('get_student_context', (session) => {
        const { model } = session;
        return grounded({
          program_id: session.input.programId,
          semester_ids: model.knownSemesterIds,
          // The student's year in the degree (their profile); null = unknown → ask (question_id degree_year).
          current_degree_year: session.input.currentDegreeYear ?? null,
          current_semester_id: currentSemesterId(session.input.currentDegreeYear, new Date()),
          planning_window: planningWindow(model.knownSemesterIds),
          completed_course_ids: [...model.completedCourseIds],
          currently_taking_course_ids: [...(model.currentlyPlannedCourseIds ?? [])],
          committed_plan: planSummary(session),
          // Every committed course is locked: plan around it; never move, remove or replace it.
          locked_course_ids: [...session.lockedPlacements().keys()],
          ...(session.lockConflicts.length ? { lock_conflicts: lockConflictRows(session), lock_conflicts_note: LOCK_CONFLICT_NOTE } : {}),
          preferences: {
            max_weekly_hours: model.maxHoursPerSemester,
            hard_cap_hours: model.hardCap,
            wanted_course_ids: [...(model.mustIncludeCourseIds ?? [])],
            avoided_course_ids: [...model.disallowedCourseIds],
            semester_distribution: model.distributionPolicy ?? 'neutral',
            focus_areas: session.preferences.focus_areas ?? [],
            free_days: session.preferences.free_days ?? [],
          },
          missing_critical_inputs: session.missingCriticalInputs()
            .map((input) => ({ field: input.field, message: input.message })),
          excluded_courses_asked_count: session.excludedCoursesAsked(),
          // build_plan refuses until both are true.
          preferred_courses_known: session.preferredCoursesKnown(),
          avoided_courses_known: session.excludedCoursesKnown(),
        });
      }),
    }),

    tool({
      name: 'record_completed_courses',
      description: 'Record the courses the student says they completed, so they are never planned again and count toward degree hours. include_years adds every official mandatory course of those degree years ([1] = "I finished year 1", [1, 2] = "I finished years 1–2"). Resolve other names with search_courses first. Tell the student what was recorded so they can correct it. Calling it with nothing to add records that the student has completed nothing yet (a first-semester student).',
      parameters: z.object({
        include_years: z.array(z.number().int().min(1).max(2)).max(2).nullable().describe('Degree years whose official mandatory courses were all completed'),
        add_course_ids: listOrNull(courseId),
        remove_course_ids: listOrNull(courseId).describe('e.g. a Years 1–2 course the student has NOT completed yet'),
      }),
      execute: observed('record_completed_courses', (session, args: {
        include_years: number[] | null; add_course_ids: string[] | null; remove_course_ids: string[] | null;
      }) => {
        const early = earlyYearCoursesFor(session.input.programId);
        const known = (id: string) => session.model.profiles.has(id) || early.some((course) => course.courseId === id);
        const unknown = [...(args.add_course_ids ?? []), ...(args.remove_course_ids ?? [])].filter((id) => !known(id));
        if (unknown.length) {
          return { accepted: false, reason: 'Unknown course ids — resolve them with search_courses first.', unknown_course_ids: unknown };
        }
        const ids = new Set(session.completedCourseIds());
        const years = new Set(args.include_years ?? []);
        for (const course of early) if (years.has(degreeYearOf(course.semesterId))) ids.add(course.courseId);
        for (const id of args.add_course_ids ?? []) ids.add(id);
        for (const id of args.remove_course_ids ?? []) ids.delete(id);
        session.setCompletedCourses([...ids]);
        const nameOfAny = (id: string) => early.find((course) => course.courseId === id)?.nameHe ?? nameOf(session, id) ?? id;
        return {
          accepted: true,
          completed_count: ids.size,
          completed_credit_hours: completedCreditHours(session.input.programId, session.input.programBoard, [...ids]),
          degree_hours_counted: session.worker.getState().degreeHours,
          removed: (args.remove_course_ids ?? []).map(nameOfAny),
          added: (args.add_course_ids ?? []).map(nameOfAny),
          note: 'Draft was reset to the committed board. Call build_plan to plan with this.',
        };
      }),
    }),

    tool({
      name: 'get_requirements_gap',
      description: 'List exactly what the current draft still lacks for the degree: missing mandatory courses, per-category remaining course counts with eligible candidates, and degree hours left.',
      parameters: z.object({}),
      execute: observed('get_requirements_gap', (session) => {
        const { model } = session;
        const plan = session.worker.getPlan();
        const placed = new Set(placedCourseIds(plan));
        const done = (id: string) => placed.has(id) || model.completedCourseIds.has(id)
          || (model.currentlyPlannedCourseIds?.has(id) ?? false);
        const state = session.worker.getState();
        return grounded({
          degree_hours_required: model.degreeRequiredHours,
          degree_hours_current: state.degreeHours,
          degree_hours_remaining: Math.max(0, model.degreeRequiredHours - state.degreeHours),
          missing_mandatory: model.requiredMandatoryCourseIds.filter((id) => !done(id))
            .map((id) => ({ course_id: id, name_he: nameOf(session, id) })),
          categories: model.categories.map((category) => {
            const counted = category.candidateIds.filter(done).length;
            return {
              category_id: category.id,
              name_he: category.name,
              required_courses: category.required,
              counted_courses: counted,
              remaining_courses: Math.max(0, category.required - counted),
              eligible_candidates: category.candidateIds
                .filter((id) => !done(id) && !model.disallowedCourseIds.has(id))
                .slice(0, 15)
                .map((id) => ({ course_id: id, name_he: nameOf(session, id) })),
            };
          }).filter((category) => category.remaining_courses > 0),
        });
      }),
    }),

    tool({
      name: 'search_courses',
      description: 'Search the program catalog by Hebrew name, course id, category or syllabus content (topics, description, assessment, structure). Name matches rank first, then syllabus matches; matched_in_syllabus_he quotes the syllabus text that matched. Use it to turn anything the student names — a course or an interest — into real course ids.',
      parameters: z.object({
        query: z.string().trim().max(200).describe('Hebrew/English words or a course id; empty string lists by filters only'),
        category_id: z.string().max(128).nullable(),
        semester_id: z.string().max(128).nullable().describe('Only courses offered in this semester'),
        limit: z.number().int().min(1).max(25).nullable(),
      }),
      execute: observed('search_courses', (session, args: { query: string; category_id: string | null; semester_id: string | null; limit: number | null }) => {
        const terms = normalizeHebrew(args.query).toLowerCase().split(' ').filter(Boolean);
        const rawQuery = args.query.trim();
        const results: Array<{ score: number; row: Record<string, unknown> }> = [];
        for (const profile of session.model.profiles.values()) {
          if (args.category_id && profile.category_id !== args.category_id) continue;
          const allowed = allowedSemesters(profile);
          if (args.semester_id && allowed && !allowed.includes(args.semester_id)) continue;
          const { score, snippet } = rawQuery === profile.course_id
            ? { score: 100, snippet: null }
            : scoreFields(searchableFields(profile), terms);
          if (terms.length && score === 0) continue;
          results.push({
            score,
            row: {
              course_id: profile.course_id,
              name_he: profile.name_he,
              hours: profile.hours,
              category_id: profile.category_id,
              category_name_he: profile.category_name_he,
              is_mandatory: profile.is_mandatory,
              course_type: profile.course_type,
              allowed_semesters: allowed,
              prerequisites: profile.prerequisites,
              topics_he: (profile.syllabus_details?.topics_he ?? profile.syllabus_topics_he).slice(0, 6),
              matched_in_syllabus_he: snippet,
              status: courseStatus(session, profile.course_id),
            },
          });
        }
        results.sort((a, b) => b.score - a.score);
        return grounded({ total_matches: results.length, courses: results.slice(0, args.limit ?? 12).map((r) => r.row) });
      }),
    }),

    tool({
      name: 'get_course_details',
      description: 'Full authoritative details of one course: hours, category, offering semesters, prerequisites and whether they are met, syllabus summary, workload.',
      parameters: z.object({ course_id: courseId, target_semester: z.string().max(128).nullable() }),
      execute: observed('get_course_details', (session, { course_id, target_semester }: { course_id: string; target_semester: string | null }) => {
        const profile = profileFor(session.worker, course_id);
        if (!profile) return grounded({ course_id, known: false }, fact('planner_model', 0));
        return grounded({
          course_id,
          known: true,
          name_he: profile.name_he,
          hours: profile.hours,
          category_id: profile.category_id,
          category_name_he: profile.category_name_he,
          is_mandatory: profile.is_mandatory,
          course_type: profile.course_type,
          allowed_semesters: allowedSemesters(profile),
          offering_source_url: profile.provenance.offering_source_url,
          offering_source_he: offeringSourceHe(profile.provenance.offering_source_url),
          recommended_semester: profile.recommended_semester,
          prerequisites: prerequisiteStatus(session.worker, course_id, target_semester ?? undefined),
          corequisites: profile.corequisites,
          syllabus_summary_he: profile.syllabus_details?.summary_he ?? null,
          syllabus_assessment_he: profile.syllabus_details?.assessment_he ?? null,
          syllabus_structure_he: profile.syllabus_details?.structure_he ?? null,
          syllabus_url: profile.syllabus_url,
          board_grade_average: profile.grade_average,
          note: 'For the full syllabus call get_course_syllabus; for historical grades call get_course_grades.',
          workload_score: profile.workload_score,
          difficulty_score: profile.difficulty_score,
          status: courseStatus(session, course_id),
        }, fact('planner_model', profile.data_confidence, profile.provenance.name_source));
      }),
    }),

    tool({
      name: 'get_course_syllabus',
      description: 'The course syllabus: what the program board carries plus the official syllabus page itself (content and aims, detailed syllabus, lecturers, teaching method, assignments). If the current year is not published yet, the latest published year comes back with from_earlier_year=true — say so. NOT a source for which semester the course runs: use get_course_details. Read-only.',
      parameters: z.object({ course_id: courseId }),
      execute: observed('get_course_syllabus', async (session, { course_id }: { course_id: string }) => {
        const profile = profileFor(session.worker, course_id);
        if (!profile?.syllabus_details) return { course_id, known: false };
        const syllabus = await session.insights.syllabus(course_id, profile.syllabus_details);
        return { name_he: profile.name_he, ...syllabus, semester_note: SYLLABUS_SEMESTER_NOTE };
      }),
    }),

    tool({
      name: 'get_course_grades',
      description: 'Historical grade statistics of one or more courses from community grade sources: overall and recent mean/median/pass rate, trend, per-lecturer means and per-semester rows. Years are as the sources label them. Use it for difficulty, grade or lecturer questions and name the sources. Pass ALL the courses you need in one call. Read-only.',
      parameters: z.object({
        course_ids: z.array(courseId).min(1).max(12),
        max_terms: z.number().int().min(1).max(30).nullable().describe('Semester rows per course, newest first (default 8)'),
      }),
      execute: observed('get_course_grades', async (session, { course_ids, max_terms }: { course_ids: string[]; max_terms: number | null }) => ({
        // One call per question, not per course: a difficulty comparison used to burn the turn budget.
        courses: await Promise.all([...new Set(course_ids)].map(async (course_id) => {
          const summary = await session.insights.grades(course_id);
          return {
            course_id,
            name_he: nameOf(session, course_id),
            ...summary,
            // Distributions feed the panel's chart; the agent needs the headline numbers.
            terms: summary.terms.slice(0, max_terms ?? 8).map(({ bins: _bins, ...term }) => term),
          };
        })),
      })),
    }),

    tool({
      name: 'explain_constraint',
      description: 'Explain the authoritative fact behind a constraint on a course (offering, prerequisites, load, completion, avoided).',
      parameters: z.object({
        course_id: courseId,
        constraint: z.enum(['offering', 'prerequisites', 'load', 'completion', 'disallowed']),
      }),
      execute: observed('explain_constraint', (session, { course_id, constraint }: { course_id: string; constraint: 'offering' | 'prerequisites' | 'load' | 'completion' | 'disallowed' }) => {
        const profile = profileFor(session.worker, course_id);
        if (!profile) return grounded({ course_id, constraint, known: false }, fact('planner_model', 0));
        const { model } = session;
        const data = constraint === 'offering'
          ? { allowed_semesters: allowedSemesters(profile), recommended_semester: profile.recommended_semester }
          : constraint === 'prerequisites'
            ? prerequisiteStatus(session.worker, course_id)
            : constraint === 'completion'
              ? { completed: model.completedCourseIds.has(course_id), currently_taking: model.currentlyPlannedCourseIds?.has(course_id) ?? false }
              : constraint === 'disallowed'
                ? { avoided: model.disallowedCourseIds.has(course_id) || profile.excluded, exclusion_reason: profile.exclusion_reason }
                : { course_hours: profile.hours, semester_loads: semesterLoads(session), max_hours: model.maxHoursPerSemester, hard_cap: model.hardCap };
        return grounded({ course_id, constraint, ...data }, fact('planner_model', profile.data_confidence, profile.provenance.source));
      }),
    }),

    tool({
      name: 'update_preferences',
      description: 'Record preferences the student stated, as binding planner constraints. wanted = must be in the plan; avoided = must never be in the plan (only when the student clearly refuses a course). Rebuilds the planner and RESETS the draft to the committed board, so call build_plan afterwards. Returns conflicts the planner detected.',
      parameters: z.object({
        max_weekly_hours: z.number().min(6).max(30).nullable(),
        add_wanted_course_ids: listOrNull(courseId),
        remove_wanted_course_ids: listOrNull(courseId),
        add_avoided_course_ids: listOrNull(courseId),
        remove_avoided_course_ids: listOrNull(courseId),
        semester_distribution: z.enum(['balanced', 'compact', 'neutral']).nullable()
          .describe('balanced = spread load evenly; compact = fewer active semesters'),
        focus_areas: z.array(z.enum(ACADEMIC_FOCUS_AREAS)).max(5).nullable()
          .describe('Academic interests used to prefer matching electives (replaces the stored list)'),
        free_days: z.array(z.enum(WEEK_DAYS)).max(5).nullable()
          .describe('Weekdays the student wants free of classes (א=Sunday … ו=Friday); checked with check_timetable'),
        excluded_courses_answered: z.boolean().nullable()
          .describe('true when the student answered the courses-to-leave-out question, including "none"'),
        preferred_courses_answered: z.boolean().nullable()
          .describe('true when the student answered which courses they would like included, including "none"'),
      }),
      execute: observed('update_preferences', (session, args: {
        preferred_courses_answered?: boolean | null;
        max_weekly_hours: number | null;
        add_wanted_course_ids: string[] | null; remove_wanted_course_ids: string[] | null;
        add_avoided_course_ids: string[] | null; remove_avoided_course_ids: string[] | null;
        semester_distribution: 'balanced' | 'compact' | 'neutral' | null;
        focus_areas: string[] | null;
        free_days: string[] | null;
        excluded_courses_answered: boolean | null;
      }) => {
        const known = (id: string) => session.model.profiles.has(id);
        const all = [...(args.add_wanted_course_ids ?? []), ...(args.add_avoided_course_ids ?? [])];
        const unknown = all.filter((id) => !known(id));
        if (unknown.length) {
          return { accepted: false, reason: 'Unknown course ids — resolve them with search_courses first.', unknown_course_ids: unknown };
        }
        const prefs = session.preferences;
        const setOf = (key: string) => new Set(Array.isArray(prefs[key]) ? prefs[key] as string[] : []);
        const wanted = setOf('wanted_course_ids');
        const avoided = setOf('disallowed_course_ids');
        for (const id of args.remove_wanted_course_ids ?? []) wanted.delete(id);
        for (const id of args.remove_avoided_course_ids ?? []) avoided.delete(id);
        for (const id of args.add_wanted_course_ids ?? []) { wanted.add(id); avoided.delete(id); }
        // A course the degree requires cannot be left out: it stays in the plan and the student is told so.
        const requiredKept = (args.add_avoided_course_ids ?? []).filter((id) => session.model.profiles.get(id)?.is_mandatory);
        for (const id of args.add_avoided_course_ids ?? []) {
          if (requiredKept.includes(id)) continue;
          avoided.add(id); wanted.delete(id);
        }

        // Only changed lists are written (a move between lists changes both): an
        // untouched, unanswered leave-out list must stay unknown, not become "none".
        const changed = (key: string, next: Set<string>) =>
          JSON.stringify([...setOf(key)].sort()) !== JSON.stringify([...next].sort());
        const patch: Record<string, unknown> = {};
        if (changed('wanted_course_ids', wanted)) patch.wanted_course_ids = [...wanted];
        if (changed('disallowed_course_ids', avoided) || args.excluded_courses_answered) {
          patch.disallowed_course_ids = [...avoided];
        }
        if (args.preferred_courses_answered) patch[PREFERRED_ANSWERED_KEY] = true;
        if (args.max_weekly_hours !== null) patch.max_weekly_hours = args.max_weekly_hours;
        if (args.focus_areas !== null) patch.focus_areas = args.focus_areas;
        if (args.free_days !== null) patch.free_days = args.free_days;
        if (args.semester_distribution !== null) {
          patch[INTERNAL_DISTRIBUTION_POLICY] = args.semester_distribution === 'neutral' ? undefined : args.semester_distribution;
        }
        session.updatePreferences(patch);
        const hard = analyzeHardConstraints(session.model);
        return {
          accepted: true,
          stored_preferences: {
            max_weekly_hours: session.model.maxHoursPerSemester,
            wanted_course_ids: [...wanted],
            avoided_course_ids: [...avoided],
            semester_distribution: session.model.distributionPolicy ?? 'neutral',
            focus_areas: session.preferences.focus_areas ?? [],
            free_days: session.preferences.free_days ?? [],
          },
          feasible: hard.outcome === 'feasible',
          ...(requiredKept.length ? {
            required_courses_kept: requiredKept.map((id) => ({ course_id: id, name_he: nameOf(session, id) })),
            required_courses_note: 'These courses are required for the degree, so they were NOT marked as avoided and stay in the plan. Tell the student this explicitly, by course name.',
          } : {}),
          conflicts: hard.reasons.map((reason) => ({ code: reason.code, course_ids: reason.courseIds, message_he: reason.messageHe })),
          note: 'Draft was reset to the committed board. Call build_plan next.',
        };
      }),
    }),

    tool({
      name: 'build_plan',
      description: 'Run the deterministic degree planner with the current preferences, starting from the committed board, and make its best valid plan the working draft. Returns the plan, per-semester loads and validation. Refused until the student was asked which courses they prefer and which to avoid. only_years limits the plan to the degree years the student asked for.',
      parameters: z.object({
        only_years: z.array(z.number().int().min(1).max(8)).max(8).nullable()
          .describe('Degree years the student asked to plan, e.g. [4] for "year 4 only" / "רק שנה ד". null = the whole board. New courses are placed ONLY in these years; courses already placed in other years are not touched.'),
      }),
      execute: observed('build_plan', (session, args: { only_years?: number[] | null }) => {
        const missing = [
          ...(session.preferredCoursesKnown() ? [] : ['preferred_courses']),
          ...(session.excludedCoursesKnown() ? [] : ['avoided_courses']),
        ];
        if (missing.length) {
          return {
            accepted: false,
            missing,
            reason: 'Before building, ask the student ONE short question with ask_student covering what is missing: which courses they would like included (asks_preferred_courses true) and which to leave out (question_id excluded_courses). When they answer, record it with update_preferences (preferred_courses_answered / excluded_courses_answered true, also for "none"), then call build_plan.',
          };
        }
        const unknownYears = (args.only_years ?? []).filter((year) => !session.model.knownSemesterIds.some((id) => degreeYearOf(id) === year));
        if (unknownYears.length) {
          return { accepted: false, reason: `This board has no semesters for degree year(s) ${unknownYears.join(', ')}. Known semesters: ${session.model.knownSemesterIds.join(', ')}.` };
        }
        session.setScope(args.only_years ?? null);
        const { model } = session;
        const initialState = planContextToState(session.input.committedContext, model);
        const pinnedHome = Object.fromEntries([...session.lockedPlacements()].map(([id, homes]) => [id, homes[0]]));
        const set = generateCandidateSet({
          buildModel: () => model,
          policy: model.distributionPolicy ?? 'neutral',
          initialState,
          pinnedHome,
          profileVersion: 0,
          // ponytail: under half the default search budget (best plan + two alternatives):
          // a chat turn must stay responsive and inside Vercel's 300s limit even if the
          // agent builds twice. Raise it when the planner gets faster.
          maxRuns: 3,
        });
        const selected = selectCandidate(set);
        session.candidateSet = set;
        session.worker = new PlannerWorker(model, cloneState(selected?.state ?? set.legacyState), { topN: 6, rolloutSteps: 80 });
        const outOfScope = session.outOfScopePlacements();
        return {
          accepted: Boolean(selected),
          ...(session.scopeYears ? {
            scope_years: session.scopeYears,
            scope_note: selected
              ? 'Only these degree years were planned; every course already placed in other years is unchanged.'
              : 'The degree requirements cannot all be met inside the requested years. Do NOT place courses in other years: tell the student which requirements remain (get_requirements_gap) and ask whether to widen the scope.',
            ...(outOfScope.length ? { out_of_scope_placements: outOfScope } : {}),
          } : {}),
          ...(selected ? {} : { reason: 'The planner found no plan satisfying every rule and constraint; the draft below is its best attempt.' }),
          planner_rationale_he: selected?.rationaleHe ?? null,
          ...(session.lockConflicts.length ? { lock_conflicts: lockConflictRows(session), lock_conflicts_note: LOCK_CONFLICT_NOTE } : {}),
          plan: planSummary(session),
          validation: validationSummary(session),
        };
      }),
    }),

    tool({
      name: 'add_course',
      description: 'Place a course in the draft. Omit semester_id (null) to let the planner pick the best legal semester. Rejected with reasons if illegal.',
      parameters: z.object({ course_id: courseId, semester_id: z.string().max(128).nullable() }),
      execute: observed('add_course', (session, { course_id, semester_id }: { course_id: string; semester_id: string | null }) =>
        safeMutation(session.worker, () => session.worker.addCourse(course_id, semester_id ?? undefined, 'llm'))),
    }),
    tool({
      name: 'remove_course',
      description: 'Remove a course from the draft.',
      parameters: z.object({ course_id: courseId }),
      execute: observed('remove_course', (session, { course_id }: { course_id: string }) =>
        lockedRejection(session, course_id, 'remove')
        ?? safeMutation(session.worker, () => session.worker.removeCourse(course_id, 'llm'))),
    }),
    tool({
      name: 'move_course',
      description: 'Move a placed course to another semester. Rejected with reasons if illegal.',
      parameters: z.object({ course_id: courseId, to_semester_id: z.string().max(128) }),
      execute: observed('move_course', (session, { course_id, to_semester_id }: { course_id: string; to_semester_id: string }) =>
        lockedRejection(session, course_id, 'move')
        ?? safeMutation(session.worker, () => session.worker.moveCourse(course_id, to_semester_id, 'llm'))),
    }),
    tool({
      name: 'replace_course',
      description: 'Swap a placed course for another one (e.g. an elective the student prefers).',
      parameters: z.object({ out_course_id: courseId, in_course_id: courseId, semester_id: z.string().max(128).nullable() }),
      execute: observed('replace_course', (session, { out_course_id, in_course_id, semester_id }: { out_course_id: string; in_course_id: string; semester_id: string | null }) =>
        lockedRejection(session, out_course_id, 'replace')
        ?? safeMutation(session.worker, () => session.worker.replaceCourse(out_course_id, in_course_id, semester_id ?? undefined, 'llm'))),
    }),

    tool({
      name: 'unlock_courses',
      description: 'Release committed (locked) courses so the draft may move, remove or replace them. Call it ONLY after the student explicitly said, in this conversation, that these specific courses may be changed — quote their words. Never call it on your own judgment. The draft is kept; the committed board itself changes only when the student applies a proposal.',
      parameters: z.object({
        course_ids: z.array(courseId).min(1).max(20),
        student_words_he: z.string().trim().min(1).max(300).describe("The student's own sentence that authorizes changing these courses"),
      }),
      execute: observed('unlock_courses', (session, { course_ids }: { course_ids: string[]; student_words_he: string }) => {
        const notOnBoard = course_ids.filter((id) => !session.committedPlacements().has(id));
        if (notOnBoard.length) return { accepted: false, reason: 'These courses are not on the committed board, so there is nothing to unlock.', course_ids: notOnBoard };
        session.unlock(course_ids);
        return {
          accepted: true,
          unlocked: course_ids.map((id) => ({ course_id: id, name_he: nameOf(session, id) })),
          note: 'Only these courses may now be moved, removed or replaced in the draft. Every other committed course stays locked.',
          ...(session.lockConflicts.length ? { lock_conflicts: lockConflictRows(session) } : {}),
        };
      }),
    }),

    tool({
      name: 'simulate_changes',
      description: 'Answer "what if" questions: apply hypothetical add/remove/move changes to a copy of the draft and return the validation. Never changes the draft.',
      parameters: z.object({
        changes: z.array(z.object({
          kind: z.enum(['add_course', 'remove_course', 'move_course']),
          course_id: courseId,
          semester_id: z.string().max(128).nullable().describe('Target semester for add_course / move_course'),
        })).min(1).max(20),
      }),
      execute: observed('simulate_changes', async (session, { changes }: { changes: Array<{ kind: 'add_course' | 'remove_course' | 'move_course'; course_id: string; semester_id: string | null }> }) => {
        const baseline = cloneState(session.worker.getPlan());
        const { model } = session;
        const pinnedHome = Object.fromEntries([...model.pinnedCourseIds].flatMap((id) => {
          const semester = semesterOf(baseline, id);
          return semester ? [[id, semester]] : [];
        }));
        const simulation = new DeterministicWhatIfSimulationCapability({
          validateState: (state) => simulationValidationFromCandidateReport(
            validateCandidate(state as typeof baseline, model, pinnedHome), model.degreeRequiredHours),
        });
        const mapped = changes.map((change) => change.kind === 'remove_course'
          ? { kind: 'remove_course' as const, courseId: change.course_id }
          : change.kind === 'move_course'
            ? { kind: 'move_course' as const, courseId: change.course_id, toSemester: change.semester_id ?? '' }
            : { kind: 'add_course' as const, courseId: change.course_id, semesterId: change.semester_id ?? '' });
        return grounded(await simulation.simulate({ baseline, changes: mapped }));
      }),
    }),

    tool({
      name: 'validate_plan',
      description: 'Validate the current draft against every degree rule and the student caps. Read-only.',
      parameters: z.object({}),
      execute: observed('validate_plan', (session) => ({ ...validationSummary(session), ...snapshot(session.worker) })),
    }),

    tool({
      name: 'check_timetable',
      description: 'Check the weekly timetable of one draft semester (use it for the upcoming semester): can one group per lecture/recitation/lab be chosen for every course with no overlap and nothing on the free days? Source: bid-it (unofficial, only currently published timetables). Read-only.',
      parameters: z.object({
        semester_id: z.string().max(128),
        free_days: z.array(z.enum(WEEK_DAYS)).max(5).nullable().describe('Override; null = the stored free_days preference'),
      }),
      execute: observed('check_timetable', async (session, args: { semester_id: string; free_days: string[] | null }) => {
        const courseIds = session.worker.getPlan().semesters[args.semester_id];
        if (!courseIds) return { accepted: false, reason: `Unknown semester_id. Known: ${session.model.knownSemesterIds.join(', ')}` };
        const term = defaultTermMapping(session.model.knownSemesterIds, new Date(), session.input.currentDegreeYear)[args.semester_id];
        const freeDays = args.free_days ?? (Array.isArray(session.preferences.free_days) ? session.preferences.free_days as string[] : []);
        let courses;
        try {
          courses = courseIds.length ? await (session.input.fetchSchedule ?? fetchScheduleFromBidit)(courseIds, term.semester) : [];
        } catch {
          return { accepted: false, reason: 'The timetable source (bid-it) is unavailable right now; say the timetable could not be checked.' };
        }
        const result = checkTimetable(courses, freeDays);
        const label = (id: string) => `${nameOf(session, id) ?? id} (${id})`;
        return {
          semester_id: args.semester_id,
          term,
          source: 'bid-it (unofficial; currently published timetables only)',
          free_days_requested: freeDays,
          feasible: result.feasible,
          days_used: result.daysUsed,
          free_days_kept: result.feasible ? WEEK_DAYS.filter((day) => !result.daysUsed.includes(day)) : [],
          selection: result.selection.map((item) => ({
            course: label(item.courseId), kind: item.kind, mode: item.mode, group: item.groupId, group_label: item.groupLabel,
            meetings: item.slots.map((slot) => `${slot.day} ${slot.start}-${slot.end}`),
          })),
          courses_without_timetable_data: result.unknownCourseIds.map(label),
          conflicting_course_pairs: result.conflictingCoursePairs.map(([a, b]) => [label(a), label(b)]),
          courses_blocking_free_days: result.coursesBlockingFreeDays.map(label),
        };
      }),
    }),

    tool({
      name: 'ask_student',
      description: 'Ask the student ONE focused question and end your turn. Use question_id when asking for one of the standard facts so the UI shows the right input.',
      parameters: z.object({
        question_he: z.string().trim().min(1).max(400),
        options_he: z.array(z.string().trim().min(1).max(160)).max(5).describe('2-5 suggested answers, or empty for free text'),
        question_id: z.enum(['completed_courses', 'current_courses', 'excluded_courses', 'max_weekly_hours', 'track_or_focus', 'degree_year']).nullable(),
        asks_preferred_courses: z.boolean().nullable()
          .describe('true when the question (also) asks which courses the student would like included in the plan'),
      }),
      execute: observed('ask_student', (session, args: { question_he: string; options_he: string[]; question_id: ClarificationQuestionId | null; asks_preferred_courses?: boolean | null }) => {
        const preferredKnown = session.preferredCoursesKnown();
        if (args.question_id === 'excluded_courses' && session.excludedCoursesKnown()) {
          return { accepted: false, reason: `Courses to leave out are already known (recorded, or taken as none after two unanswered asks). Do not ask again.${preferredKnown ? '' : ' Ask only which courses to include (question_id null, asks_preferred_courses true).'}` };
        }
        if (args.asks_preferred_courses && preferredKnown && args.question_id !== 'excluded_courses') {
          return { accepted: false, reason: 'The student already answered which courses they would like included in this conversation. Do not ask again.' };
        }
        if (args.asks_preferred_courses && !preferredKnown) session.recordPreferredAsked();
        session.recordAsked(args.question_id ?? undefined);
        session.question = {
          questionHe: args.question_he,
          optionsHe: args.options_he,
          ...(args.question_id ? { questionId: args.question_id } : {}),
        };
        return { asked: true };
      }),
    }),

    tool({
      name: 'highlight_element',
      description: `Point at something on the student's screen while you explain: the page scrolls to it and it glows for a few seconds. target is "course:<course_id>" (a course card on the board), "catalog-course:<course_id>" (the course in the catalog list), or one of: ${UI_HIGHLIGHT_TARGETS.join(', ')}. Use it for the one or two elements your explanation is about, not for everything you mention.`,
      parameters: z.object({
        target: z.string().trim().regex(HIGHLIGHT_TARGET_PATTERN).max(160),
        label_he: z.string().trim().min(1).max(80).describe('Short Hebrew name of the element, shown on its "show me" chip'),
      }),
      execute: observed('highlight_element', (session, { target, label_he }: { target: string; label_he: string }) => {
        const courseId = /^(?:catalog-)?course:(.+)$/.exec(target)?.[1];
        if (courseId && !session.model.profiles.has(courseId)) {
          return { accepted: false, reason: 'Unknown course id — resolve it with search_courses first.' };
        }
        if (!courseId && !(UI_HIGHLIGHT_TARGETS as readonly string[]).includes(target)) {
          return { accepted: false, reason: `Unknown target. Use course:<course_id>, catalog-course:<course_id> or one of: ${UI_HIGHLIGHT_TARGETS.join(', ')}.` };
        }
        if (target.startsWith('course:') && !semesterOf(session.worker.getPlan(), courseId!) && !session.committedPlacements().has(courseId!)) {
          return { accepted: false, reason: 'That course is not on the board. Use catalog-course:<course_id> to point at it in the catalog.' };
        }
        session.emit({ type: 'ui_highlight', target, label_he });
        return { accepted: true, note: 'The element is highlighted when your reply arrives. Refer to it by its name in the text.' };
      }),
    }),

    tool({
      name: 'submit_proposal',
      description: 'Submit the current draft to the student as a proposal. It is validated first: if invalid you get the errors back and must fix the draft; if valid this ends your turn and the student sees it on their board.',
      parameters: z.object({
        summary_he: z.string().trim().min(1).max(1500).describe('Short Hebrew explanation of the plan and how it answers the student'),
        tradeoffs_he: z.array(z.string().trim().min(1).max(300)).max(8).describe('Requests that could not be fully honored, and why'),
        extra_hours_reason_he: z.string().trim().max(300).nullable().describe('Why the plan needs more weekly hours than the degree requires (null when it does not exceed)'),
      }),
      execute: observed('submit_proposal', (session, { summary_he, tradeoffs_he, extra_hours_reason_he }: {
        summary_he: string; tradeoffs_he: string[]; extra_hours_reason_he: string | null }) => {
        // A partial request ("year 4 only") is a hard limit: nothing new lands outside it. Checked on
        // the final draft, whatever built it, before the student can see or apply it.
        const outOfScope = session.outOfScopePlacements();
        if (outOfScope.length > 0) {
          return { accepted: false,
            reason: `The student asked to plan only degree year(s) ${session.scopeYears!.join(', ')}, but the draft places courses in other years. Remove them or move them into the requested years; if a requirement cannot be met inside the scope, say so to the student instead of placing it elsewhere.`,
            out_of_scope_placements: outOfScope.map((item) => ({ ...item, name_he: nameOf(session, item.course_id) })) };
        }
        // …and nothing the student placed in the other years may be taken out, even when asked to remove.
        const outOfScopeRemoved = session.outOfScopeRemovals();
        if (outOfScopeRemoved.length > 0) {
          return { accepted: false,
            reason: `The student asked to plan only degree year(s) ${session.scopeYears!.join(', ')}; courses already placed in other years must stay exactly where they are. Put these back (add_course with their semester_id).`,
            out_of_scope_removals: outOfScopeRemoved.map((item) => ({ ...item, name_he: nameOf(session, item.course_id) })) };
        }
        const validation = validationSummary(session);
        if (!validation.valid) {
          return { accepted: false, reason: 'The draft is not valid yet. Fix these issues (or explain to the student why they cannot be fixed).', validation };
        }
        // Locked placements are immutable: every committed course the student has not released must be
        // exactly where they put it. Checked on the final draft, whatever built it.
        const violated = session.lockViolations();
        if (violated.length > 0) {
          return { accepted: false,
            reason: 'The draft moves or drops courses that are locked on the student\'s committed board. Put each one back in its semester (add_course / move_course with semester_id). If a change is really needed, ask the student with ask_student and call unlock_courses only after they agree.',
            locked_courses_changed: violated.map((item) => ({ ...item, name_he: nameOf(session, item.course_id) })) };
        }
        const required = session.model.degreeRequiredHours;
        if (typeof required === 'number' && validation.degree_hours > required && !extra_hours_reason_he) {
          return { accepted: false,
            reason: `The plan reaches ${validation.degree_hours} weekly hours but the degree needs ${required}. Remove or swap electives that are not needed for any requirement (simulate_changes shows the effect), or give extra_hours_reason_he if a requirement forces the excess.`,
            degree_hours: validation.degree_hours, degree_hours_required: required };
        }
        // Open lock conflicts always reach the student, in the server's words.
        session.submission = { summaryHe: summary_he, tradeoffsHe: [...tradeoffs_he, ...session.lockConflicts.map((conflict) => conflict.messageHe)].slice(0, 12) };
        return { accepted: true };
      }),
    }),
  ];
}

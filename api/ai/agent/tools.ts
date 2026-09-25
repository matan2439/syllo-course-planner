/**
 * OpenAI Agents SDK tools for the planning co-pilot. Every academic fact comes
 * from the deterministic model/worker; the LLM only chooses which tool to call.
 * Parameters use `.nullable()` (not `.optional()`): the SDK sends strict JSON
 * schemas, where every property must be required.
 */
import { tool, type RunContext } from '@openai/agents';
import { z } from 'zod';
import type { PlanningSession } from './session';
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
import { defaultTermMapping } from '../../../shared/planner/schedule';
import { checkTimetable, WEEK_DAYS } from './timetable';
import { fetchScheduleFromBidit } from './session';

export const AGENT_TOOL_NAMES = [
  'get_student_context', 'get_requirements_gap', 'search_courses', 'get_course_details',
  'explain_constraint', 'update_preferences', 'build_plan', 'add_course', 'remove_course',
  'move_course', 'replace_course', 'simulate_changes', 'validate_plan', 'check_timetable',
  'ask_student', 'submit_proposal',
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

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
    const result = await body(session, args);
    const rejected = typeof result === 'object' && result !== null && 'accepted' in result
      && (result as { accepted: unknown }).accepted === false;
    session.emit({ type: 'tool_status', tool: name, status: rejected ? 'rejected' : 'completed' });
    return result;
  };
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

const listOrNull = (schema: z.ZodTypeAny) => z.array(schema).max(40).nullable();

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
          completed_course_ids: [...model.completedCourseIds],
          currently_taking_course_ids: [...(model.currentlyPlannedCourseIds ?? [])],
          committed_plan: planSummary(session),
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
        });
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
      description: 'Search the program catalog by Hebrew name, course id, category or syllabus topic. Use it to turn anything the student names into real course ids.',
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
          const haystack = normalizeHebrew([
            profile.course_id, profile.name_he, profile.category_name_he,
            ...profile.syllabus_topics_he, profile.syllabus_summary_he,
          ].filter(Boolean).join(' ')).toLowerCase();
          const score = profile.course_id === rawQuery ? 100 : terms.filter((term) => haystack.includes(term)).length;
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
              topics_he: profile.syllabus_topics_he.slice(0, 6),
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
          recommended_semester: profile.recommended_semester,
          prerequisites: prerequisiteStatus(session.worker, course_id, target_semester ?? undefined),
          corequisites: profile.corequisites,
          syllabus_summary_he: profile.syllabus_summary_he,
          workload_score: profile.workload_score,
          difficulty_score: profile.difficulty_score,
          status: courseStatus(session, course_id),
        }, fact('planner_model', profile.data_confidence, profile.provenance.name_source));
      }),
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
      }),
      execute: observed('update_preferences', (session, args: {
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
        for (const id of args.add_avoided_course_ids ?? []) { avoided.add(id); wanted.delete(id); }

        // Only touched lists are written: an untouched, unanswered leave-out list must
        // stay unknown rather than silently become "none".
        const patch: Record<string, unknown> = {};
        if (args.add_wanted_course_ids || args.remove_wanted_course_ids) patch.wanted_course_ids = [...wanted];
        if (args.add_avoided_course_ids || args.remove_avoided_course_ids || args.excluded_courses_answered) {
          patch.disallowed_course_ids = [...avoided];
        }
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
          conflicts: hard.reasons.map((reason) => ({ code: reason.code, course_ids: reason.courseIds, message_he: reason.messageHe })),
          note: 'Draft was reset to the committed board. Call build_plan next.',
        };
      }),
    }),

    tool({
      name: 'build_plan',
      description: 'Run the deterministic degree planner with the current preferences, starting from the committed board, and make its best valid plan the working draft. Returns the plan, per-semester loads and validation.',
      parameters: z.object({}),
      execute: observed('build_plan', (session) => {
        const { model } = session;
        const initialState = planContextToState(session.input.committedContext, model);
        const set = generateCandidateSet({
          buildModel: () => model,
          policy: model.distributionPolicy ?? 'neutral',
          initialState,
          profileVersion: 0,
          // ponytail: half the default search budget — the agent may build more than
          // once per turn inside Vercel's 300s limit (~35s per build on the real board).
          maxRuns: 4,
        });
        const selected = selectCandidate(set);
        session.candidateSet = set;
        session.worker = new PlannerWorker(model, cloneState(selected?.state ?? set.legacyState), { topN: 6, rolloutSteps: 80 });
        return {
          accepted: Boolean(selected),
          ...(selected ? {} : { reason: 'The planner found no plan satisfying every rule and constraint; the draft below is its best attempt.' }),
          planner_rationale_he: selected?.rationaleHe ?? null,
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
        safeMutation(session.worker, () => session.worker.removeCourse(course_id, 'llm'))),
    }),
    tool({
      name: 'move_course',
      description: 'Move a placed course to another semester. Rejected with reasons if illegal.',
      parameters: z.object({ course_id: courseId, to_semester_id: z.string().max(128) }),
      execute: observed('move_course', (session, { course_id, to_semester_id }: { course_id: string; to_semester_id: string }) =>
        safeMutation(session.worker, () => session.worker.moveCourse(course_id, to_semester_id, 'llm'))),
    }),
    tool({
      name: 'replace_course',
      description: 'Swap a placed course for another one (e.g. an elective the student prefers).',
      parameters: z.object({ out_course_id: courseId, in_course_id: courseId, semester_id: z.string().max(128).nullable() }),
      execute: observed('replace_course', (session, { out_course_id, in_course_id, semester_id }: { out_course_id: string; in_course_id: string; semester_id: string | null }) =>
        safeMutation(session.worker, () => session.worker.replaceCourse(out_course_id, in_course_id, semester_id ?? undefined, 'llm'))),
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
        const term = defaultTermMapping(session.model.knownSemesterIds, new Date())[args.semester_id];
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
            course: label(item.courseId), kind: item.kind, mode: item.mode, group: item.groupId,
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
        question_id: z.enum(['completed_courses', 'current_courses', 'excluded_courses', 'max_weekly_hours', 'track_or_focus']).nullable(),
      }),
      execute: observed('ask_student', (session, args: { question_he: string; options_he: string[]; question_id: 'completed_courses' | 'current_courses' | 'excluded_courses' | 'max_weekly_hours' | 'track_or_focus' | null }) => {
        if (args.question_id === 'excluded_courses' && session.excludedCoursesKnown()) {
          return { accepted: false, reason: 'Courses to leave out are already known (recorded, or taken as none after two unanswered asks). Do not ask again.' };
        }
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
      name: 'submit_proposal',
      description: 'Submit the current draft to the student as a proposal. It is validated first: if invalid you get the errors back and must fix the draft; if valid this ends your turn and the student sees it on their board.',
      parameters: z.object({
        summary_he: z.string().trim().min(1).max(1500).describe('Short Hebrew explanation of the plan and how it answers the student'),
        tradeoffs_he: z.array(z.string().trim().min(1).max(300)).max(8).describe('Requests that could not be fully honored, and why'),
      }),
      execute: observed('submit_proposal', (session, { summary_he, tradeoffs_he }: { summary_he: string; tradeoffs_he: string[] }) => {
        const validation = validationSummary(session);
        if (!validation.valid) {
          return { accepted: false, reason: 'The draft is not valid yet. Fix these issues (or explain to the student why they cannot be fixed).', validation };
        }
        session.submission = { summaryHe: summary_he, tradeoffsHe: tradeoffs_he };
        return { accepted: true };
      }),
    }),
  ];
}

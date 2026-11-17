/**
 * Academic continuity from official prerequisite data: what a course builds on and what it
 * leads to. This is the grounded backbone of specialization pathways — a follow-up course is
 * one whose OFFICIAL prerequisites include the course, never a guess from similar names.
 * Read-only and pure; availability comes from the planner model so an unavailable follow-up
 * is reported as such instead of being hidden.
 */
import { legalSemestersFor } from './planner_actions';
import type { ConstraintModel } from './planner_types';
import {
  evaluatePrerequisites, prerequisiteRecord, referencedCourseIds, unmetRequirements,
  type PrerequisiteCatalog, type PrerequisiteExpression, type PrerequisiteStatus,
} from './prerequisites';

export interface PathwayCourse {
  course_id: string;
  name_he: string | null;
  /** In this program's catalog at all. */
  in_program: boolean;
  /** Schedulable this year; false = exists but not offered now (say so, do not hide it). */
  offered: boolean;
  not_offered_reason_he: string | null;
  allowed_semesters: string[];
}

export interface CoursePathway {
  course: PathwayCourse;
  prerequisite_status: PrerequisiteStatus;
  /** The official requirement, as written (AND/OR). */
  prerequisites: PrerequisiteExpression | null;
  corequisites: PrerequisiteExpression | null;
  /** Requirements the student has not met yet — each entry lists the alternatives that would meet it. */
  unmet_prerequisites: PathwayCourse[][];
  /** Courses that officially require this one: the natural continuations. */
  leads_to: Array<PathwayCourse & { also_requires: PathwayCourse[] }>;
}

/** course id → the courses whose official prerequisites mention it. */
export function buildSuccessorIndex(catalog: PrerequisiteCatalog): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [courseId, record] of Object.entries(catalog)) {
    for (const required of new Set(referencedCourseIds(record.expression))) {
      index.set(required, [...(index.get(required) ?? []), courseId]);
    }
  }
  for (const list of index.values()) list.sort();
  return index;
}

export function coursePathway(input: {
  courseId: string;
  model: ConstraintModel;
  catalog: PrerequisiteCatalog | null;
  /** Completed or already planned — counts as met. */
  satisfied: (courseId: string) => boolean;
  successors?: Map<string, string[]>;
}): CoursePathway {
  const { model, catalog } = input;
  const describe = (id: string): PathwayCourse => {
    const profile = model.profiles.get(id);
    const name = profile?.name_he ?? (catalog?.[id] as { name_he?: string | null } | undefined)?.name_he ?? null;
    return {
      course_id: id, name_he: name, in_program: Boolean(profile),
      offered: Boolean(profile) && !profile!.excluded,
      not_offered_reason_he: profile?.excluded ? profile.exclusion_reason : null,
      allowed_semesters: profile && !profile.excluded ? legalSemestersFor(model, id) : [],
    };
  };
  const record = prerequisiteRecord(catalog, input.courseId);
  const successors = input.successors ?? (catalog ? buildSuccessorIndex(catalog) : new Map<string, string[]>());
  return {
    course: describe(input.courseId),
    prerequisite_status: record.status,
    prerequisites: record.expression,
    corequisites: record.corequisites,
    unmet_prerequisites: unmetRequirements(record.expression, input.satisfied).map((alternatives) => alternatives.map(describe)),
    leads_to: (successors.get(input.courseId) ?? [])
      // Only continuations inside this program; the same course can be required by other faculties.
      .filter((id) => model.profiles.has(id))
      .map((id) => {
        const expression = prerequisiteRecord(catalog, id).expression;
        const others = evaluatePrerequisites(expression, (required) => required === input.courseId || input.satisfied(required))
          ? [] : unmetRequirements(expression, (required) => required === input.courseId || input.satisfied(required)).flat();
        return { ...describe(id), also_requires: [...new Set(others)].map(describe) };
      }),
  };
}

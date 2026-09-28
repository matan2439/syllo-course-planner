/**
 * שער רוח final-assessment type — the student may prefer an exam, a take-home exam or a
 * paper/project. Classified from the official syllabus assessment line (its leading
 * "מטלת סיום" label), falling back to the BIDIT timetable's moed type. Unknown stays null.
 */
export const GATEWAY_ASSESSMENT_TYPES = ['final_exam', 'home_exam', 'paper'] as const;
export type GatewayAssessmentType = typeof GATEWAY_ASSESSMENT_TYPES[number];

const GATEWAY_CATEGORY_ID = 'shaar_ruach';

function classify(text: string): GatewayAssessmentType | null {
  const t = text.trim();
  if (/^(בחינת בית|take[- ]home)/i.test(t)) return 'home_exam';
  if (/^(בחינה סופית|final exam)/i.test(t)) return 'final_exam';
  if (/^(עבודת? |עבודה|פרוי?קט|רפרט|project|paper)/i.test(t)) return 'paper';
  return null;
}

export function gatewayAssessmentType(course: any): GatewayAssessmentType | null {
  const syllabus = typeof course?.syllabus_assessment_he === 'string' ? classify(course.syllabus_assessment_he) : null;
  if (syllabus) return syllabus;
  for (const term of Object.values(course?.bidit_schedule_2027 ?? {}) as any[]) {
    for (const group of term?.groups ?? []) {
      for (const moed of group?.assessment ?? []) {
        const type = typeof moed === 'string' ? classify(moed) : null;
        if (type) return type;
      }
    }
  }
  return null;
}

/** שער רוח course ids whose KNOWN assessment type is not one the student selected. */
export function gatewayAssessmentMismatchIds(board: any, types: readonly string[] | undefined): string[] {
  if (!types?.length) return [];
  const wanted = new Set(types);
  const courses: any[] = [...(board?.metadata?.program_repository_courses ?? [])];
  for (const s of board?.semesters ?? []) courses.push(...(s?.courses ?? []));
  const ids = new Set<string>();
  for (const c of courses) {
    if (c?.category_id !== GATEWAY_CATEGORY_ID || typeof c?.course_id !== 'string') continue;
    const type = gatewayAssessmentType(c);
    if (type && !wanted.has(type)) ids.add(c.course_id);
  }
  return [...ids];
}

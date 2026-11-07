/** Exact, bounded prerequisite/corequisite expressions. No inferred equivalences. */
export type PrerequisiteExpression =
  | { readonly course_id: string }
  | { readonly all_of: readonly PrerequisiteExpression[] }
  | { readonly any_of: readonly PrerequisiteExpression[] };

export type PrerequisiteStatus = 'satisfied' | 'unsatisfied' | 'unknown';
export interface PrerequisiteSelection {
  status: PrerequisiteStatus;
  /** One sufficient branch, never the union of OR alternatives. Empty unless satisfied. */
  courseIds: string[];
}

export const MAX_PREREQUISITE_NODES = 256;
export const MAX_PREREQUISITE_DEPTH = 16;

/** Root depth is one. Empty AND is verified none; empty OR is invalid. */
export function parsePrerequisiteExpression(value: unknown): PrerequisiteExpression | null {
  let count = 0;
  function parse(raw: unknown, depth: number): PrerequisiteExpression | null {
    if (++count > MAX_PREREQUISITE_NODES || depth > MAX_PREREQUISITE_DEPTH ||
      !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 1) return null;
    const key = keys[0];
    const node = raw as Record<string, unknown>;
    if (key === 'course_id') {
      const id = node.course_id;
      return typeof id === 'string' && id.trim().length > 0 ? { course_id: id } : null;
    }
    if (key !== 'all_of' && key !== 'any_of') return null;
    const children = node[key];
    if (!Array.isArray(children) || (key === 'any_of' && !children.length) ||
      count + children.length > MAX_PREREQUISITE_NODES) return null;
    const parsed: PrerequisiteExpression[] = [];
    for (const child of children) {
      const expression = parse(child, depth + 1);
      if (!expression) return null;
      parsed.push(expression);
    }
    return key === 'all_of' ? { all_of: parsed } : { any_of: parsed };
  }
  try { return parse(value, 1); } catch { return null; }
}

/** Only absent expressions fall back to the legacy conjunction. Null stays unknown. */
export function requirementExpression(expression: unknown, legacy?: readonly string[]): PrerequisiteExpression | null {
  return parsePrerequisiteExpression(expression === undefined && legacy !== undefined
    ? { all_of: legacy.map(course_id => ({ course_id })) }
    : expression);
}

/** Three-valued evaluation with a deterministic, sufficient witness for planning. */
export function selectPrerequisiteCourses(
  value: unknown,
  leafStatus: (courseId: string) => PrerequisiteStatus,
  cost: (courseId: string) => number = () => 1,
): PrerequisiteSelection {
  const expression = parsePrerequisiteExpression(value);
  const unknown = (): PrerequisiteSelection => ({ status: 'unknown', courseIds: [] });
  if (!expression) return unknown();
  function visit(node: PrerequisiteExpression): PrerequisiteSelection {
    if ('course_id' in node) {
      const status = leafStatus(node.course_id);
      return status === 'satisfied' ? { status, courseIds: [node.course_id] }
        : status === 'unsatisfied' ? { status, courseIds: [] } : unknown();
    }
    const results = ('all_of' in node ? node.all_of : node.any_of).map(visit);
    if ('all_of' in node) {
      if (results.some(r => r.status === 'unsatisfied')) return { status: 'unsatisfied', courseIds: [] };
      if (results.some(r => r.status === 'unknown')) return unknown();
      return { status: 'satisfied', courseIds: [...new Set(results.flatMap(r => r.courseIds))] };
    }
    const candidates = results.filter(r => r.status === 'satisfied');
    if (candidates.length) {
      const total = (r: PrerequisiteSelection) => r.courseIds.reduce((sum, id) => sum + cost(id), 0);
      return candidates.reduce((best, next) => total(next) < total(best) ? next : best);
    }
    return results.some(r => r.status === 'unknown') ? unknown() : { status: 'unsatisfied', courseIds: [] };
  }
  return visit(expression);
}

export function evaluatePrerequisiteExpression(
  value: unknown,
  leafStatus: (courseId: string) => PrerequisiteStatus,
): PrerequisiteStatus {
  return selectPrerequisiteCourses(value, leafStatus).status;
}

/**
 * Specialization pathway — a coherent, EXPLAINABLE academic progression built from evidence, not a
 * bag of keyword-matching courses.
 *
 * What is official and what is not (never blurred):
 *   - `official_prerequisite` edges come ONLY from the registrar's verified prerequisite records
 *     (data/prerequisites/tau.json, status `verified`). They say "B requires A".
 *   - Which courses are *members* of a focus area comes from the topic-fit signal (`courseFitById`),
 *     which is inferred from course names (and corroborated by syllabus text where available). That
 *     is an interpretation by SYLLO, never a university-defined specialization track.
 *   - Therefore every pathway is labelled `recommended_inferred`. A university-defined track (e.g. a
 *     program-page category) is a different object and is not created here.
 *
 * Pure and deterministic: no I/O except the optional committed prerequisite catalog, no LLM.
 */
import { loadPrerequisiteCatalog, type PrerequisiteCatalog } from './prerequisites';

export type PathwayEvidence = 'name_rule' | 'name_and_syllabus';

export interface PathwayMember { fit: number; evidence: PathwayEvidence }

export interface PathwayEdge {
  /** The prerequisite (earlier). */
  from: string;
  /** The course that requires it. */
  to: string;
  /** Edges are only ever taken from official, verified prerequisite records. */
  source: 'official_prerequisite';
  /** True when `from` is one alternative of an OR group (not individually mandatory). */
  alternative: boolean;
}

export interface SpecializationPathway {
  provenance: 'recommended_inferred';
  members: ReadonlyMap<string, PathwayMember>;
  /** Non-member courses that an official prerequisite chain requires on the way to a member. */
  foundations: ReadonlySet<string>;
  edges: readonly PathwayEdge[];
  /** Longest prerequisite chain (in courses) through members and foundations. */
  depth: number;
}

/** Foundations are followed at most this many prerequisite levels below a member. */
const FOUNDATION_LEVELS = 2;

function leavesWithAlternativeFlag(expression: unknown, insideAny = false): Array<{ id: string; alternative: boolean }> {
  const e = expression as { course?: string; all?: unknown[]; any?: unknown[] } | null;
  if (!e) return [];
  if (e.course) return [{ id: e.course, alternative: insideAny }];
  if (e.all) return e.all.flatMap((child) => leavesWithAlternativeFlag(child, insideAny));
  if (e.any) return e.any.flatMap((child) => leavesWithAlternativeFlag(child, true));
  return [];
}

export function buildSpecializationPathway(input: {
  /** Per-course topic fit for the requested focus (> 0 = member). */
  fitById: ReadonlyMap<string, number>;
  /** Courses the planner can actually place (the program universe); edges outside it are dropped. */
  universeIds: ReadonlySet<string>;
  evidenceById?: ReadonlyMap<string, PathwayEvidence>;
  catalog?: PrerequisiteCatalog | null;
}): SpecializationPathway {
  const catalog = input.catalog === undefined ? loadPrerequisiteCatalog() : input.catalog;
  const members = new Map<string, PathwayMember>();
  for (const [id, fit] of input.fitById) {
    if (fit > 0 && input.universeIds.has(id)) members.set(id, { fit, evidence: input.evidenceById?.get(id) ?? 'name_rule' });
  }
  const foundations = new Set<string>();
  const edges: PathwayEdge[] = [];
  const seenEdge = new Set<string>();
  let frontier = [...members.keys()];
  for (let level = 0; level < FOUNDATION_LEVELS && frontier.length; level++) {
    const next: string[] = [];
    for (const to of frontier) {
      const record = catalog?.[to];
      if (!record || record.status !== 'verified') continue; // only an official, verified requirement creates an edge
      for (const { id: from, alternative } of leavesWithAlternativeFlag(record.expression)) {
        if (!input.universeIds.has(from) || from === to) continue;
        const key = `${from}>${to}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from, to, source: 'official_prerequisite', alternative });
        if (!members.has(from) && !foundations.has(from)) { foundations.add(from); next.push(from); }
      }
    }
    frontier = next;
  }
  edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));

  // Longest chain (course count) over the acyclic prerequisite graph restricted to the pathway.
  const preds = new Map<string, string[]>();
  for (const e of edges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  const memo = new Map<string, number>();
  const chain = (id: string, stack: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (stack.has(id)) return 1; // defensive: official data should be acyclic
    stack.add(id);
    const best = 1 + Math.max(0, ...(preds.get(id) ?? []).map((p) => chain(p, stack)));
    stack.delete(id);
    memo.set(id, best);
    return best;
  };
  const depth = Math.max(0, ...[...members.keys(), ...foundations].map((id) => chain(id, new Set())));
  return { provenance: 'recommended_inferred', members, foundations, edges, depth };
}

export interface PathwayCoherence {
  membersPlaced: number;
  /** Placed members that have no pathway prerequisite, or at least one met by a placed/completed course. */
  preparedMembers: number;
  /** Pathway prerequisite edges whose two ends are both placed or completed. */
  satisfiedEdges: number;
  /** Scalar the planner ranks by; 0 when nothing of the pathway is placed. */
  score: number;
}

export function pathwayCoherence(placedOrDone: ReadonlySet<string>, pathway: SpecializationPathway, placedOnly?: ReadonlySet<string>): PathwayCoherence {
  const placed = placedOnly ?? placedOrDone;
  const placedMembers = [...pathway.members.keys()].filter((id) => placed.has(id));
  const incoming = new Map<string, PathwayEdge[]>();
  for (const e of pathway.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  const preparedMembers = placedMembers.filter((id) => {
    const into = incoming.get(id);
    return !into || into.some((e) => placedOrDone.has(e.from));
  }).length;
  const satisfiedEdges = pathway.edges.filter((e) => placedOrDone.has(e.from) && placedOrDone.has(e.to)).length;
  const score = placedMembers.length === 0 ? 0 : preparedMembers + 2 * satisfiedEdges;
  return { membersPlaced: placedMembers.length, preparedMembers, satisfiedEdges, score };
}

export interface PathwayCourseExplanation {
  courseId: string;
  role: 'member' | 'foundation' | 'not_in_pathway';
  evidence?: PathwayEvidence;
  /** Official prerequisites of this course that belong to the pathway. */
  buildsOn: string[];
  /** Pathway courses whose official prerequisites include this course. */
  enables: string[];
  /** Plain-language statement that never overstates the evidence. */
  statement: string;
}

export function explainPathwayCourse(courseId: string, pathway: SpecializationPathway): PathwayCourseExplanation {
  const member = pathway.members.get(courseId);
  const role = member ? 'member' : pathway.foundations.has(courseId) ? 'foundation' : 'not_in_pathway';
  const buildsOn = [...new Set(pathway.edges.filter((e) => e.to === courseId).map((e) => e.from))].sort();
  const enables = [...new Set(pathway.edges.filter((e) => e.from === courseId).map((e) => e.to))].sort();
  const evidenceText = member?.evidence === 'name_and_syllabus'
    ? 'the course name and its official syllabus text both point to this focus'
    : 'the course name points to this focus (not independently confirmed by syllabus text)';
  const statement = role === 'member'
    ? `Recommended for this focus because ${evidenceText}.${buildsOn.length ? ` Official prerequisites in the pathway: ${buildsOn.join(', ')}.` : ''}${enables.length ? ` It is an official prerequisite of: ${enables.join(', ')}.` : ''} This is a SYLLO-recommended pathway, not a university-defined track.`
    : role === 'foundation'
      ? `Foundation: an official prerequisite on the way to ${enables.join(', ') || 'a pathway course'}.`
      : 'Not part of the recommended pathway for this focus.';
  return { courseId, role, ...(member ? { evidence: member.evidence } : {}), buildsOn, enables, statement };
}

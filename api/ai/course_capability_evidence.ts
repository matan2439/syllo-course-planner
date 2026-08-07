/**
 * COURSE-KNOWLEDGE LAYER — evidence about what a course actually teaches, derived
 * ONLY from the official syllabus text the board already carries (syllabus_summary_he
 * + structure/topics) together with its provenance (source url, fetch date,
 * confidence). This is the sound replacement for title-token inference: a course
 * title may LOCATE a course, but is never proof of its substantive content.
 *
 * The evidence is deterministic and inspectable. It preserves the required
 * inference-level distinctions:
 *  - explicit : the official text directly states a design-methodology phrase;
 *  - derived  : the official text mentions designing an artifact (design activity),
 *               without a direct methodology phrase;
 *  - estimated: a derived mention but from a low-confidence source — must not be
 *               presented as certain;
 *  - missing  : no official design content (or no substantive official text).
 *
 * SCOPE: only `mechanical_design` has an extractor in this slice. Every other
 * capability returns `missing` (honest — no extractor/data yet), never a fabricated
 * or title-derived claim. External (goal→capability) relevance lives in a SEPARATE
 * layer (external_context_evidence.ts) and must never be conflated with this one.
 */

import type { AcademicFocusArea } from './academic_interest_profile';

export const EVIDENCE_INFERENCE_LEVELS = ['explicit', 'derived', 'estimated', 'missing'] as const;
export type EvidenceInferenceLevel = (typeof EVIDENCE_INFERENCE_LEVELS)[number];

export const EVIDENCE_SOURCE_TYPES = ['official_syllabus', 'official_catalog', 'none'] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export interface CourseCapabilityEvidence {
  courseId: string;
  capability: AcademicFocusArea;
  /** Human-readable claim (empty when missing). */
  claim: string;
  /** Planner-facing 0..1 weight; 0 when missing. Evidence quality drives this. */
  strength: number;
  sourceType: EvidenceSourceType;
  sourceUrl: string | null;
  sourceAuthority: string | null;
  sourceYear: number | null;
  /** The actual quoted snippet from the OFFICIAL text (never the title); null when missing. */
  extractedEvidence: string | null;
  inferenceLevel: EvidenceInferenceLevel;
  /** 0..1. */
  confidence: number;
  retrievedAt: string | null;
}

// FALSE-FRIEND GUARD: "תכן הקורס" (= course CONTENT header) and "תוכן" (content) are
// NOT the design sense of תכן. TAU syllabi routinely head their body with "תכן הקורס",
// so these collocations must be neutralized before any design matching, or nearly every
// course would falsely read as design.
const CONTENT_SENSE_PATTERNS: RegExp[] = [/תכן\s+הקורס/g, /תוכן/g];

// Design-METHODOLOGY phrases: a direct statement that the course teaches design
// methods/process. Unambiguous (never the content sense). ה on תכן is tolerated.
const DESIGN_EXPLICIT_PATTERNS: RegExp[] = [
  /שיטות\s+ה?תכן/,
  /שיטת\s+ה?תכן/,
  /תהליכ?י?\s+ה?תכן/,
  /תכן\s+הנדסי/,
  /עקרונות\s+ה?תכן/,
  /תכן\s+מפורט/,
  /design\s+process/i,
  /design\s+method/i,
  /engineering\s+design/i,
];
// Design-ACTIVITY signals: unambiguous design tooling / prototyping. Deliberately
// narrow (design tools + prototyping only) — NOT a bare "תכן" token, which is the
// false friend above.
const DESIGN_DERIVED_PATTERNS: RegExp[] = [
  /solidworks/i,
  /\bcad\b/i,
  /אב\s+טיפוס/,
  /prototyp/i,
  /תכן\s+ו?יי?צור/, // "תכן וייצור"/"תכן וייצור" — design-and-manufacture activity
];

const ESTIMATED_CONFIDENCE_FLOOR = 0.5;

/** Pull the official syllabus TEXT (never the title) + provenance from a board course object. */
function officialSyllabus(course: any): {
  text: string;
  hasContent: boolean;
  sourceUrl: string | null;
  sourceYear: number | null;
  retrievedAt: string | null;
  sourceConfidence: number;
} {
  const summary = typeof course?.syllabus_summary_he === 'string' ? course.syllabus_summary_he : '';
  const structure = typeof course?.syllabus_structure_he === 'string' ? course.syllabus_structure_he : '';
  const topics = Array.isArray(course?.syllabus_ai_topics)
    ? course.syllabus_ai_topics.join(' ')
    : Array.isArray(course?.syllabus_topics_he)
      ? course.syllabus_topics_he.join(' ')
      : '';
  let text = [summary, topics, structure].filter(Boolean).join(' \n ').trim();
  // Neutralize the content-sense of תכן before any design matching (false-friend guard).
  for (const re of CONTENT_SENSE_PATTERNS) text = text.replace(re, ' ');
  // Boilerplate-only summaries (hours/weight headers) carry no substantive content.
  const stripped = summary.replace(/[\s"״׳]/g, '');
  const boilerplateOnly = /^שעות:?\d/.test(stripped) || /^שעות.{0,20}ש["״]?ס/.test(summary.trim());
  const substantive = summary.replace(/שעות:.*?משקל:\s*\d+/g, '').replace(/[\s\d"״׳.:]/g, '');
  const hasContent = text.length > 0 && !boilerplateOnly && substantive.length > 3;

  const sourceUrl = course?.syllabus_source_url ?? course?.syllabus_url ?? null;
  const yearMatch = typeof sourceUrl === 'string' ? sourceUrl.match(/year=(\d{4})/) : null;
  const sourceYear = yearMatch ? Number(yearMatch[1]) : null;
  const retrievedAt = course?.syllabus_last_fetched_at ?? null;
  const sourceConfidence =
    typeof course?.syllabus_confidence === 'number' ? course.syllabus_confidence : 0.5;

  return { text, hasContent, sourceUrl, sourceYear, retrievedAt, sourceConfidence };
}

/** A short snippet of the official text around the first match, as the quoted evidence. */
function snippet(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m || m.index == null) return text.slice(0, 100).trim();
  const start = Math.max(0, m.index - 25);
  return text.slice(start, m.index + m[0].length + 55).replace(/\s+/g, ' ').trim();
}

function missing(course: any, capability: AcademicFocusArea, syl: ReturnType<typeof officialSyllabus>): CourseCapabilityEvidence {
  return {
    courseId: course?.course_id ?? '',
    capability,
    claim: '',
    strength: 0,
    sourceType: syl.hasContent ? 'official_syllabus' : 'none',
    sourceUrl: syl.hasContent ? syl.sourceUrl : null,
    sourceAuthority: syl.hasContent ? 'tau_official_syllabus' : null,
    sourceYear: syl.hasContent ? syl.sourceYear : null,
    extractedEvidence: null,
    inferenceLevel: 'missing',
    confidence: 0,
    retrievedAt: syl.hasContent ? syl.retrievedAt : null,
  };
}

/**
 * Extract evidence that `course` teaches `capability`, from official syllabus text only.
 * `course` is a board course object. Deterministic and title-blind.
 */
export function extractCourseCapabilityEvidence(
  course: any,
  capability: AcademicFocusArea,
): CourseCapabilityEvidence {
  const syl = officialSyllabus(course);
  // Only mechanical_design has a real extractor in this slice.
  if (capability !== 'mechanical_design' || !syl.hasContent) return missing(course, capability, syl);

  const explicit = DESIGN_EXPLICIT_PATTERNS.find((re) => re.test(syl.text));
  const derived = explicit ? undefined : DESIGN_DERIVED_PATTERNS.find((re) => re.test(syl.text));
  if (!explicit && !derived) return missing(course, capability, syl);

  const matchedRe = (explicit ?? derived)!;
  const level: EvidenceInferenceLevel = explicit
    ? 'explicit'
    : syl.sourceConfidence < ESTIMATED_CONFIDENCE_FLOOR
      ? 'estimated'
      : 'derived';
  const baseStrength = level === 'explicit' ? 0.9 : level === 'derived' ? 0.6 : 0.3;

  return {
    courseId: course?.course_id ?? '',
    capability,
    claim:
      level === 'explicit'
        ? 'הסילבוס הרשמי מציין במפורש עיסוק בשיטות/תהליך תכן.'
        : 'הסילבוס הרשמי מזכיר פעילות תכן (עיצוב מוצר/חלק/כלי תכן).',
    strength: baseStrength,
    sourceType: 'official_syllabus',
    sourceUrl: syl.sourceUrl,
    sourceAuthority: 'tau_official_syllabus',
    sourceYear: syl.sourceYear,
    extractedEvidence: snippet(syl.text, matchedRe),
    inferenceLevel: level,
    confidence: Math.min(1, baseStrength * syl.sourceConfidence + (level === 'explicit' ? 0.1 : 0)),
    retrievedAt: syl.retrievedAt,
  };
}

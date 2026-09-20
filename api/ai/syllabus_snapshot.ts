/**
 * AUTHORITATIVE SYLLABUS SNAPSHOT — the canonical, content-hashed record of a
 * course's OFFICIAL syllabus text (title excluded) plus provenance. It is the sole
 * input the semantic extractor is allowed to reason over, and its `contentHash` is
 * the cache identity: a changed syllabus produces a different hash, invalidating any
 * previously derived profile.
 *
 * Built only from data the board already carries — no invented text, URLs, or dates.
 */
import { createHash } from 'crypto';

export interface SyllabusSnapshot {
  courseId: string;
  institution: string;
  programOrCatalog: string;
  sourceType: 'official_syllabus' | 'official_catalog' | 'none';
  sourceUrl: string | null;
  sourceAuthority: string | null;
  sourceYear: number | null;
  language: 'he' | 'en' | 'unknown';
  retrievedAt: string | null;
  /** sha256 of normalizedContent. */
  contentHash: string;
  /** Whitespace-normalized official syllabus text; the course TITLE is never included. */
  normalizedContent: string;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** True when a summary is only the hours/weight header boilerplate (no substantive content). */
function isBoilerplateOnly(summary: string): boolean {
  const substantive = summary.replace(/שעות:.*?משקל:\s*[\d.]+/g, '').replace(/[\s\d"״׳.:]/g, '');
  return substantive.length <= 3;
}

/** Detect a mostly-Hebrew vs mostly-Latin snapshot (best-effort; 'unknown' when empty). */
function detectLanguage(text: string): SyllabusSnapshot['language'] {
  if (!text) return 'unknown';
  const he = (text.match(/[֐-׿]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  if (he === 0 && en === 0) return 'unknown';
  return he >= en ? 'he' : 'en';
}

export function buildSyllabusSnapshot(course: any, programOrCatalog: string): SyllabusSnapshot {
  const summary = typeof course?.syllabus_summary_he === 'string' ? course.syllabus_summary_he : '';
  const structure = typeof course?.syllabus_structure_he === 'string' ? course.syllabus_structure_he : '';
  const topics = Array.isArray(course?.syllabus_ai_topics)
    ? course.syllabus_ai_topics.join(' ')
    : Array.isArray(course?.syllabus_topics_he)
      ? course.syllabus_topics_he.join(' ')
      : '';
  const hasSummary = summary.trim().length > 0 && !isBoilerplateOnly(summary);
  const normalizedContent = hasSummary
    ? [summary, topics].filter(Boolean).join(' \n ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, ' \n ').trim()
    : '';

  const sourceUrl = course?.syllabus_source_url ?? course?.syllabus_url ?? null;
  const yearMatch = typeof sourceUrl === 'string' ? sourceUrl.match(/year=(\d{4})/) : null;
  const hasContent = normalizedContent.length > 0;
  void structure; // structure is provenance-only (hours header); intentionally excluded from content

  return {
    courseId: typeof course?.course_id === 'string' ? course.course_id : '',
    institution: 'TAU',
    programOrCatalog,
    sourceType: hasContent ? 'official_syllabus' : 'none',
    sourceUrl: hasContent ? sourceUrl : null,
    sourceAuthority: hasContent ? 'tau_official_syllabus' : null,
    sourceYear: hasContent && yearMatch ? Number(yearMatch[1]) : null,
    language: detectLanguage(normalizedContent),
    retrievedAt: hasContent ? (course?.syllabus_last_fetched_at ?? null) : null,
    contentHash: sha256(normalizedContent),
    normalizedContent,
  };
}

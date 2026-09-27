/**
 * A course's syllabus for the co-pilot: what the program board already carries,
 * topped up with the official syllabus page itself (the board's own syllabus
 * URL, via the host-allowlisted acquireSyllabus). When the board's year has no
 * published syllabus yet, the most recent published year within the configured
 * look-back is used and labelled as such — never presented as the current one.
 */
import {
  acquireSyllabus,
  extractContentLinks,
  extractContentSections,
} from '../syllabus_source';
import type { CourseInsightConfig } from './config';
import type { HttpFetcher } from './http';
import { TtlCache } from './http';
import type { BoardSyllabus, CourseSyllabus, LiveSyllabus } from './types';

export type { BoardSyllabus, CourseSyllabus, LiveSyllabus } from './types';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const texts = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());

/** A summary that is only the page's hours/weight header carries no content. */
function substantive(summary: string | null): string | null {
  if (!summary) return null;
  const withoutNumbers = summary.replace(/[\s\d"״׳.:()\-–]/g, '');
  // The header is a handful of short labels; real content is prose.
  return withoutNumbers.length > 40 ? summary : null;
}

export function boardSyllabusOf(raw: any): BoardSyllabus {
  return {
    url: text(raw?.syllabus_url) ?? text(raw?.syllabus_source_url),
    summary_he: substantive(text(raw?.syllabus_summary_he)),
    topics_he: [...new Set([...texts(raw?.syllabus_topics_he), ...texts(raw?.syllabus_ai_topics)])],
    assessment_he: text(raw?.syllabus_assessment_he),
    structure_he: text(raw?.syllabus_structure_he),
    prerequisites_he: texts(raw?.syllabus_prerequisites_he),
    complexity_notes_he: texts(raw?.syllabus_ai_complexity_notes),
  };
}

/** course param (8-digit course + 2-digit group) and year, read from the board's own syllabus URL. */
function urlParts(url: string): { course: string; year: number } | null {
  try {
    const params = new URL(url).searchParams;
    const course = (params.get('course') ?? '').replace(/\D/g, '');
    const year = Number(params.get('year'));
    return course.length >= 8 && Number.isInteger(year) && year > 0 ? { course, year } : null;
  } catch {
    return null;
  }
}

export class SyllabusReader {
  private readonly cache = new TtlCache<{ live: LiveSyllabus | null; reason: string | null }>();

  constructor(private readonly fetcher: HttpFetcher, private readonly config: CourseInsightConfig['syllabus']) {}

  async read(courseId: string, board: BoardSyllabus): Promise<CourseSyllabus> {
    const parts = board.url ? urlParts(board.url) : null;
    if (!this.config.enabled || !board.url || !parts) {
      return {
        course_id: courseId, board, live: null,
        live_unavailable_reason: !this.config.enabled ? 'disabled' : board.url ? 'unrecognized_syllabus_url' : 'no_syllabus_url',
      };
    }
    const { live, reason } = await this.cache.get(`${parts.course}:${parts.year}`, this.config.ttl_seconds,
      () => this.fetchLive(courseId, board.url as string, parts));
    return { course_id: courseId, board, live, live_unavailable_reason: reason };
  }

  private async fetchLive(courseId: string, boardUrl: string, parts: { course: string; year: number }) {
    let reason = 'no_syllabus_published';
    for (let back = 0; back <= this.config.lookback_years; back++) {
      const year = parts.year - back;
      const url = new URL(boardUrl);
      url.searchParams.set('year', String(year));
      let body = '';
      const capturing: HttpFetcher = async (target, opts) => {
        const res = await this.fetcher(target, opts);
        body = res.body;
        return res;
      };
      const result = await acquireSyllabus({
        institutionId: 'tau',
        courseId,
        academicYear: year,
        retrievedAt: new Date().toISOString(),
        url: url.toString(),
        config: { timeoutMs: this.config.timeout_ms, maxAttempts: 1 },
      }, capturing);
      if (result.status !== 'acquired') {
        reason = result.reason;
        // Only "nothing published for that year" is worth trying an earlier year for.
        if (result.reason !== 'no_syllabus_published') break;
        continue;
      }
      // Official cells sometimes trail into markup comments; keep the stated value only.
      const field = (label: string) => (result.document.labeledFields[label] ?? [])
        .map((value) => value.replace(/<!--[\s\S]*$/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const sections = extractContentSections(body);
      return {
        live: {
          academic_year: year,
          from_earlier_year: back > 0,
          source_url: result.document.sourceUrl,
          sections,
          lecturers: field('מרצה'),
          teaching_method: field('אופן ההוראה'),
          assignments_he: field('מטלות הקורס'),
          links: extractContentLinks(body, result.document.sourceUrl),
        },
        reason: null,
      };
    }
    return { live: null, reason };
  }
}

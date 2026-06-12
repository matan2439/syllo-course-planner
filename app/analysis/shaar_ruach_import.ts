/**
 * קורסי שער רוח (TAU Humanities "Gateway" courses) importer.
 *
 * This is intentionally a SEPARATE module from the engineering course /
 * syllabus importers (app/pipeline/import_course.py, bulk_import_courses.py,
 * app/scraping/tau_program_scraper.py). The שער רוח course list at
 * https://humanities.tau.ac.il/shar_ruach/courses has a different page
 * structure than the engineering program/syllabus pages on
 * ims.tau.ac.il — it must NOT be parsed with the engineering scraper, and
 * its output must never be merged into the engineering elective pool.
 *
 * Today this module is used to (re)generate
 * data/general_courses_shaar_ruach.json from a fetched copy of the
 * humanities course-list HTML. It can later be wired into a CLI script
 * (e.g. scripts/import_shaar_ruach_courses.ts) that fetches the URL,
 * parses it via parseShaarRuachCoursesFromHtml, and writes/merges the
 * repository JSON.
 */

export const SHAAR_RUACH_SOURCE_URL = 'https://humanities.tau.ac.il/shar_ruach/courses';

/** Program rule confirmed by the user — every שער רוח course is worth 2 נק"ז. */
export const SHAAR_RUACH_CREDITS_RULE = 'Each שער רוח course counts as 2 נק"ז';

export const SHAAR_RUACH_DEFAULT_CREDITS = 2;

export const SHAAR_RUACH_CATEGORY = 'קורסי שער רוח' as const;

export interface ShaarRuachImportedCourse {
  course_id: string;
  name_he: string;
  /** Always 2, per SHAAR_RUACH_CREDITS_RULE — not scraped, a known program rule. */
  credits: number;
  /** Semester offering, if the list page exposes it (e.g. "א"/"ב"). Null if unknown. */
  semester: string | null;
  /** Syllabus/course page URL, if one was found for this course. */
  syllabus_url: string | null;
  source_type: 'shaar_ruach';
  source_url: string;
  credits_rule: string;
  is_general_requirement: true;
  category: typeof SHAAR_RUACH_CATEGORY;
  does_not_count_as_engineering_elective: true;
  counts_toward_degree_hours: true;
  /** False when the list page only gave us a name/link, no syllabus page. */
  syllabus_text_available: boolean;
  /** "high" when a syllabus link with a course code was found, "medium"/"low" for fallbacks. */
  source_confidence: 'high' | 'medium' | 'low';
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Derives a "0609-1005"-style course_id from an ims.tau.ac.il syllabus `course=` param like "0609100501". */
function courseIdFromSyllabusParam(param: string): string | null {
  const digits = param.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function resolveUrl(href: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Parses the שער רוח course-list HTML into structured course entries.
 *
 * Robust by design: the humanities list page does not reliably publish
 * נק"ז or full syllabus links for every course. Any course with a
 * recognizable name + link is kept (syllabus_text_available=false,
 * source_confidence="medium"/"low" when no syllabus course-code link is
 * found), with credits defaulted to 2 (SHAAR_RUACH_DEFAULT_CREDITS). A
 * malformed or empty page never throws — it just yields [].
 */
export function parseShaarRuachCoursesFromHtml(
  html: string,
  sourceUrl: string = SHAAR_RUACH_SOURCE_URL,
): ShaarRuachImportedCourse[] {
  if (!html || typeof html !== 'string') return [];

  const results: ShaarRuachImportedCourse[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  let fallbackIndex = 0;
  while ((match = anchorRe.exec(html))) {
    const href = match[1];
    const rawText = match[2].replace(/<[^>]+>/g, ' ');
    const name_he = decodeHtmlEntities(rawText).replace(/\s+/g, ' ').trim();
    if (!name_he) continue;

    const syllabusMatch = href.match(/[?&]course=(\d{6,})/i);
    let course_id: string | null = null;
    let syllabus_url: string | null = null;
    let syllabus_text_available = false;
    let source_confidence: ShaarRuachImportedCourse['source_confidence'] = 'low';

    if (syllabusMatch) {
      course_id = courseIdFromSyllabusParam(syllabusMatch[1]);
      syllabus_url = resolveUrl(href, sourceUrl);
      syllabus_text_available = true;
      source_confidence = 'high';
    } else if (/\/shar_ruach\/courses\//i.test(href)) {
      // Course-page link without a recognizable syllabus course code —
      // keep the course but mark it as a lower-confidence fallback.
      syllabus_url = resolveUrl(href, sourceUrl);
      source_confidence = 'medium';
    } else {
      continue; // not a course link at all (nav/menu/etc.)
    }

    if (!course_id) {
      course_id = `shaar-ruach-${++fallbackIndex}`;
    }
    if (seen.has(course_id)) continue;
    seen.add(course_id);

    results.push({
      course_id,
      name_he,
      credits: SHAAR_RUACH_DEFAULT_CREDITS,
      semester: null,
      syllabus_url,
      source_type: 'shaar_ruach',
      source_url: sourceUrl,
      credits_rule: SHAAR_RUACH_CREDITS_RULE,
      is_general_requirement: true,
      category: SHAAR_RUACH_CATEGORY,
      does_not_count_as_engineering_elective: true,
      counts_toward_degree_hours: true,
      syllabus_text_available,
      source_confidence,
    });
  }

  return results;
}

/** Shape written to data/general_courses_shaar_ruach.json. */
export interface ShaarRuachRepository {
  _source: string;
  credits_rule: string;
  _note: string;
  category: typeof SHAAR_RUACH_CATEGORY;
  courses: Array<{
    course_id: string;
    name_he: string;
    credits: number;
    semester: string;
    syllabus_url: string | null;
    category: typeof SHAAR_RUACH_CATEGORY;
    is_general_requirement: true;
    counts_toward_degree_hours: true;
    does_not_count_as_engineering_elective: true;
  }>;
}

/** Builds the data/general_courses_shaar_ruach.json document shape from imported courses. */
export function buildShaarRuachRepository(
  courses: ShaarRuachImportedCourse[],
  sourceUrl: string = SHAAR_RUACH_SOURCE_URL,
): ShaarRuachRepository {
  return {
    _source: sourceUrl,
    credits_rule: SHAAR_RUACH_CREDITS_RULE,
    _note: 'Per the שער רוח program rule, every course in this repository is worth 2 נק"ז. This is a known program rule, not an estimate.',
    category: SHAAR_RUACH_CATEGORY,
    courses: courses.map(c => ({
      course_id: c.course_id,
      name_he: c.name_he,
      credits: c.credits,
      semester: c.semester ?? 'א',
      syllabus_url: c.syllabus_url,
      category: SHAAR_RUACH_CATEGORY,
      is_general_requirement: true,
      counts_toward_degree_hours: true,
      does_not_count_as_engineering_elective: true,
    })),
  };
}

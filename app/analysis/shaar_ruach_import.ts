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
 * The full שער רוח catalog is spread across 8 URLs (2 course "groups" x 4
 * tabs each). courses* pages = semester A ("א"), courses_2* pages =
 * semester B ("ב"). See SHAAR_RUACH_SOURCE_URLS.
 *
 * Two HTML formats are present on these pages:
 *  1. "Standard" blocks: an <h2> heading with the course name, followed
 *     (after optional empty <p>&nbsp;</p> spacers) by an <h3> heading of
 *     the form "<teacher> | מס' קורס <course-id>".
 *  2. "Frontal" sections (קורסים פרונטליים מהפקולטה למדעי הרוח): an HTML
 *     <table> with one header row (שם הקורס / מורה / מס' קורס / קישור
 *     לסילבוס) followed by one <tr> per course, each with 4 <td> cells:
 *     course name (bold), teacher, course id, syllabus link.
 *
 * Course IDs appear in several formats ("0609-1007-02", "0609.1007.02",
 * "0609-1007", "0609-1007-01") — normalizeShaarRuachCourseId() splits
 * these into a base id + optional section id.
 */

export const SHAAR_RUACH_SOURCE_URL = 'https://humanities.tau.ac.il/shar_ruach/courses';

/** All 8 source pages that make up the full שער רוח catalog (semesters A + B). */
export const SHAAR_RUACH_SOURCE_URLS: string[] = [
  'https://humanities.tau.ac.il/shar_ruach/courses',
  'https://humanities.tau.ac.il/shar_ruach/courses?tab=1',
  'https://humanities.tau.ac.il/shar_ruach/courses?tab=2',
  'https://humanities.tau.ac.il/shar_ruach/courses?tab=3',
  'https://humanities.tau.ac.il/shar_ruach/courses_2',
  'https://humanities.tau.ac.il/shar_ruach/courses_2?tab=1',
  'https://humanities.tau.ac.il/shar_ruach/courses_2?tab=2',
  'https://humanities.tau.ac.il/shar_ruach/courses_2?tab=3',
];

/** Program rule confirmed by the user — every שער רוח course is worth 2 נק"ז. */
export const SHAAR_RUACH_CREDITS_RULE = 'Each שער רוח course counts as 2 נק"ז';

export const SHAAR_RUACH_DEFAULT_CREDITS = 2;

export const SHAAR_RUACH_CATEGORY = 'קורסי שער רוח' as const;

export interface ShaarRuachImportedCourse {
  /** Normalized id used as the primary key — equals course_id_base. */
  course_id: string;
  /** "0609-1007" — the part shared across sections/semesters. */
  course_id_base: string;
  /** "01"/"02"/etc., if a section suffix was present in the source id. */
  section_id: string | null;
  /** The id exactly as found in the source HTML (e.g. "0609.1007.02"). */
  course_id_display: string;
  name_he: string;
  teacher_he: string | null;
  /** Always 2, per SHAAR_RUACH_CREDITS_RULE — not scraped, a known program rule. */
  credits: number;
  /** Semester offering: "A" / "B" / both, derived from which URL group the course came from. */
  semester: string | null;
  /** Deduped list of semesters ("A"/"B") this course (by base id) was found under. */
  offered_semesters: string[];
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
  /** "standard" (h2/h3 blocks) or "frontal" (table rows). */
  format: 'standard' | 'frontal';
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

/** Strips HTML tags from a fragment, decodes entities, and collapses whitespace. */
function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Given the inner HTML of a heading element, returns the last non-empty
 * "line" of text (splitting on tags/&nbsp;). The שער רוח pages often wrap
 * headings in stray empty paragraphs/spans, with the real title as the
 * final line of text content.
 */
function lastNonEmptyLine(html: string): string {
  const withBreaks = html.replace(/<[^>]+>/g, '\n');
  const decoded = decodeHtmlEntities(withBreaks);
  const lines = decoded
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l !== '&nbsp;');
  return lines.length ? lines[lines.length - 1] : '';
}

/** Matches a TAU שער רוח course id in any of the known formats. */
const COURSE_ID_RE = /\b(\d{4})[-.](\d{4})(?:[-.](\d{2}))?\b/;

export interface NormalizedShaarRuachCourseId {
  course_id_base: string;
  section_id: string | null;
  course_id_display: string;
}

/**
 * Normalizes a שער רוח course id found in source HTML/text into a base id
 * ("0609-1007") plus an optional 2-digit section id ("01"/"02"), handling
 * both dash- and dot-separated formats, with or without a trailing section.
 *
 * Examples:
 *   "0609-1007-02" -> base "0609-1007", section "02"
 *   "0609.1007.02" -> base "0609-1007", section "02"
 *   "0609-1007"    -> base "0609-1007", section null
 *   "0609-1007-01" -> base "0609-1007", section "01"
 */
export function normalizeShaarRuachCourseId(raw: string): NormalizedShaarRuachCourseId | null {
  if (!raw) return null;
  const m = raw.match(COURSE_ID_RE);
  if (!m) return null;
  const [, p1, p2, section] = m;
  return {
    course_id_base: `${p1}-${p2}`,
    section_id: section ?? null,
    course_id_display: raw.trim(),
  };
}

function resolveUrl(href: string, baseUrl: string): string {
  const decoded = decodeHtmlEntities(href);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  try {
    return new URL(decoded, baseUrl).toString();
  } catch {
    return decoded;
  }
}

/** Extracts the first href from an HTML fragment, if any. */
function firstHref(html: string): string | null {
  const m = html.match(/<a\b[^>]*href="([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Parses "standard" h2 (course name) + h3 ("<teacher> | מס' קורס <id>")
 * blocks out of a page's HTML.
 */
function parseStandardBlocks(
  html: string,
  sourceUrl: string,
  semester: 'A' | 'B',
): ShaarRuachImportedCourse[] {
  const out: ShaarRuachImportedCourse[] = [];
  // h2 ... (optional empty <p>) ... h3, where the h3 contains a course id.
  const pat = /<h2[^>]*>([\s\S]*?)<\/h2>\s*(?:<p[^>]*>(?:\s|&nbsp;)*<\/p>\s*)*<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match: RegExpExecArray | null;
  while ((match = pat.exec(html))) {
    const h2Html = match[1];
    const h3Html = match[2];
    const idMatch = h3Html.match(COURSE_ID_RE);
    if (!idMatch) continue; // not a course heading (e.g. intro/section blurb)

    const normalized = normalizeShaarRuachCourseId(idMatch[0]);
    if (!normalized) continue;

    const name_he = lastNonEmptyLine(h2Html);
    if (!name_he) continue;

    const h3Text = lastNonEmptyLine(h3Html);
    // h3 text looks like "<teacher> | מס' קורס 0609-1007-01" — teacher is
    // everything before the first "|".
    const teacherPart = h3Text.split('|')[0]?.trim();
    const teacher_he = teacherPart ? teacherPart : null;

    const href = firstHref(h3Html) || firstHref(h2Html);
    const syllabusMatch = href ? decodeHtmlEntities(href).match(/[?&]course=(\d{6,})/i) : null;
    const syllabus_url = href ? resolveUrl(href, sourceUrl) : null;

    out.push({
      course_id: normalized.course_id_base,
      course_id_base: normalized.course_id_base,
      section_id: normalized.section_id,
      course_id_display: normalized.course_id_display,
      name_he,
      teacher_he,
      credits: SHAAR_RUACH_DEFAULT_CREDITS,
      semester,
      offered_semesters: [semester],
      syllabus_url,
      source_type: 'shaar_ruach',
      source_url: sourceUrl,
      credits_rule: SHAAR_RUACH_CREDITS_RULE,
      is_general_requirement: true,
      category: SHAAR_RUACH_CATEGORY,
      does_not_count_as_engineering_elective: true,
      counts_toward_degree_hours: true,
      syllabus_text_available: !!syllabusMatch,
      source_confidence: syllabusMatch ? 'high' : 'medium',
      format: 'standard',
    });
  }
  return out;
}

/**
 * Parses "frontal" course tables (קורסים פרונטליים מהפקולטה למדעי הרוח):
 * one <table> with a header row, then one <tr> per course with 4 <td>
 * cells: course name, teacher, course id, syllabus link.
 */
function parseFrontalTables(
  html: string,
  sourceUrl: string,
  semester: 'A' | 'B',
): ShaarRuachImportedCourse[] {
  const out: ShaarRuachImportedCourse[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html))) {
    const tableHtml = tableMatch[1];
    const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableHtml))) {
      const rowHtml = rowMatch[1];

      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowHtml))) {
        cells.push(cellMatch[1]);
      }
      if (cells.length < 3) continue;

      // Course id is expected in the 3rd cell (שם הקורס / מורה / מס' קורס / קישור).
      const idCellText = stripTags(cells[2]);
      const idMatch = idCellText.match(COURSE_ID_RE);
      if (!idMatch) continue; // header row or non-course row

      const name_he = stripTags(cells[0]);
      const teacher_he = stripTags(cells[1]) || null;
      if (!name_he) continue;

      const normalized = normalizeShaarRuachCourseId(idMatch[0]);
      if (!normalized) continue;

      const linkCell = cells[3] ?? '';
      const href = firstHref(linkCell);
      const syllabusMatch = href ? decodeHtmlEntities(href).match(/[?&]course=(\d{6,})/i) : null;
      const syllabus_url = href ? resolveUrl(href, sourceUrl) : null;

      out.push({
        course_id: normalized.course_id_base,
        course_id_base: normalized.course_id_base,
        section_id: normalized.section_id,
        course_id_display: normalized.course_id_display,
        name_he,
        teacher_he,
        credits: SHAAR_RUACH_DEFAULT_CREDITS,
        semester,
        offered_semesters: [semester],
        syllabus_url,
        source_type: 'shaar_ruach',
        source_url: sourceUrl,
        credits_rule: SHAAR_RUACH_CREDITS_RULE,
        is_general_requirement: true,
        category: SHAAR_RUACH_CATEGORY,
        does_not_count_as_engineering_elective: true,
        counts_toward_degree_hours: true,
        syllabus_text_available: !!syllabusMatch,
        source_confidence: syllabusMatch ? 'high' : 'medium',
        format: 'frontal',
      });
    }
  }
  return out;
}

/**
 * Parses one שער רוח course-list page's HTML into structured course
 * entries, handling both the "standard" h2/h3 block format and the
 * "frontal" course table format.
 *
 * Robust by design: a malformed or empty page never throws — it just
 * yields [].
 *
 * @param html source HTML for one of the SHAAR_RUACH_SOURCE_URLS pages
 * @param sourceUrl the URL this HTML was fetched from (used to resolve
 *   relative links and to derive the semester: "courses*" -> "A",
 *   "courses_2*" -> "B")
 */
export function parseShaarRuachCoursesFromHtml(
  html: string,
  sourceUrl: string = SHAAR_RUACH_SOURCE_URL,
): ShaarRuachImportedCourse[] {
  if (!html || typeof html !== 'string') return [];

  const semester: 'A' | 'B' = /\/shar_ruach\/courses_2/i.test(sourceUrl) ? 'B' : 'A';

  const standard = parseStandardBlocks(html, sourceUrl, semester);
  const frontal = parseFrontalTables(html, sourceUrl, semester);

  // Dedupe within a single page (a course id could in principle appear in
  // both a standard block and a frontal table, though normally won't).
  const seen = new Set<string>();
  const out: ShaarRuachImportedCourse[] = [];
  for (const c of [...standard, ...frontal]) {
    const key = `${c.course_id_base}:${c.section_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Merges courses parsed from multiple pages, deduping by course_id_base.
 * If the same base id appears under both semester A and B (or with
 * different sections), the entries are merged into one with a combined
 * `offered_semesters` list. The first-seen entry's metadata (name,
 * teacher, syllabus link, etc.) is kept as the canonical record, except
 * `offered_semesters` and `semester` which are unioned/recomputed.
 */
export function mergeShaarRuachCourses(
  coursesByPage: ShaarRuachImportedCourse[][],
): ShaarRuachImportedCourse[] {
  const byBase = new Map<string, ShaarRuachImportedCourse>();

  for (const pageCourses of coursesByPage) {
    for (const c of pageCourses) {
      const existing = byBase.get(c.course_id_base);
      if (!existing) {
        byBase.set(c.course_id_base, { ...c, offered_semesters: [...c.offered_semesters] });
        continue;
      }
      const mergedSemesters = Array.from(new Set([...existing.offered_semesters, ...c.offered_semesters]));
      existing.offered_semesters = mergedSemesters;
      existing.semester = mergedSemesters.length > 1 ? mergedSemesters.join(',') : mergedSemesters[0] ?? existing.semester;
      // Prefer an entry with a syllabus link / higher confidence if the
      // existing one lacks one.
      if (!existing.syllabus_url && c.syllabus_url) {
        existing.syllabus_url = c.syllabus_url;
        existing.syllabus_text_available = c.syllabus_text_available;
        existing.source_confidence = c.source_confidence;
      }
      if (!existing.section_id && c.section_id) {
        existing.section_id = c.section_id;
      }
    }
  }

  return Array.from(byBase.values());
}

/** Shape written to data/general_courses_shaar_ruach.json. */
export interface ShaarRuachRepository {
  _source: string;
  _sources?: string[];
  credits_rule: string;
  _note: string;
  category: typeof SHAAR_RUACH_CATEGORY;
  courses: Array<{
    course_id: string;
    course_id_base: string;
    section_id: string | null;
    course_id_display: string;
    name_he: string;
    teacher_he: string | null;
    credits: number;
    semester: string;
    offered_semesters: string[];
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
  sourceUrl: string | string[] = SHAAR_RUACH_SOURCE_URL,
): ShaarRuachRepository {
  const sources = Array.isArray(sourceUrl) ? sourceUrl : [sourceUrl];
  return {
    _source: sources[0],
    _sources: sources.length > 1 ? sources : undefined,
    credits_rule: SHAAR_RUACH_CREDITS_RULE,
    _note: 'Per the שער רוח program rule, every course in this repository is worth 2 נק"ז. This is a known program rule, not an estimate.',
    category: SHAAR_RUACH_CATEGORY,
    courses: courses.map(c => ({
      course_id: c.course_id,
      course_id_base: c.course_id_base,
      section_id: c.section_id,
      course_id_display: c.course_id_display,
      name_he: c.name_he,
      teacher_he: c.teacher_he,
      credits: c.credits,
      semester: c.semester ?? 'A',
      offered_semesters: c.offered_semesters,
      syllabus_url: c.syllabus_url,
      category: SHAAR_RUACH_CATEGORY,
      is_general_requirement: true,
      counts_toward_degree_hours: true,
      does_not_count_as_engineering_elective: true,
    })),
  };
}

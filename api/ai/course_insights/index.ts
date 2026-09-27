/**
 * Course insights: live grade statistics + the official syllabus + suggestion
 * chips derived from them. One provider instance per server process keeps the
 * source caches warm; tests and callers may inject their own.
 */
import { loadCourseInsightConfig, type CourseInsightConfig } from './config';
import { createHttpFetcher, type HttpFetcher } from './http';
import { GradeStore, gradeCourseKey, summarizeCourseGrades, type CourseGradeSummary } from './grades';
import { SyllabusReader, type BoardSyllabus, type CourseSyllabus } from './syllabus';

export type { CourseGradeSummary } from './grades';
export type { BoardSyllabus, CourseSyllabus } from './syllabus';

export interface CourseInsightsProvider {
  grades(courseId: string): Promise<CourseGradeSummary>;
  /** `board` is what the program board carries (CourseProfile.syllabus_details). */
  syllabus(courseId: string, board: BoardSyllabus): Promise<CourseSyllabus>;
}

export function createCourseInsightsProvider(
  config: CourseInsightConfig = loadCourseInsightConfig(),
  fetcher: HttpFetcher = createHttpFetcher(config.user_agent),
): CourseInsightsProvider {
  const store = new GradeStore(fetcher);
  const reader = new SyllabusReader(fetcher, config.syllabus);
  return {
    async grades(courseId) {
      const key = gradeCourseKey(courseId);
      const sources = config.grade_sources.filter((source) => source.enabled);
      const results = await Promise.all(sources.map((source) => store.fetchCourse(source, key)));
      return summarizeCourseGrades(key, results, {
        recentTerms: config.insights.recent_terms,
        passingGrade: config.insights.passing_grade,
      });
    },
    syllabus: (courseId, board) => reader.read(courseId, board),
  };
}

let shared: CourseInsightsProvider | undefined;
export function defaultCourseInsights(): CourseInsightsProvider {
  shared ??= createCourseInsightsProvider();
  return shared;
}

// ── suggestion chips ────────────────────────────────────────────────────────

export interface SuggestionInput {
  name: string;
  grades: CourseGradeSummary | null;
  syllabus: CourseSyllabus | null;
  hasPrerequisites: boolean;
}

function fill(template: string, values: Record<string, string | number>): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === '') { missing = true; return ''; }
    return String(value);
  });
  return missing ? null : out;
}

/**
 * Chips for the signals this course's data actually has, in the configured
 * priority order. A template whose placeholders cannot all be filled is skipped.
 */
export function buildCourseSuggestions(
  input: SuggestionInput,
  config: Pick<CourseInsightConfig, 'suggestion_templates_he' | 'insights'> = loadCourseInsightConfig(),
): string[] {
  const { grades, syllabus } = input;
  const live = syllabus?.live ?? null;
  const topics = syllabus?.board.topics_he ?? [];
  const hasSyllabus = Boolean(live?.sections.length || syllabus?.board.summary_he || topics.length);
  const values: Record<string, string | number> = { name: input.name };
  const signals = new Set<string>();

  if (grades?.has_data && grades.overall) {
    signals.add('grades');
    values.mean = grades.overall.mean;
    if (grades.trend && grades.trend.direction !== 'flat') {
      signals.add(`grade_trend_${grades.trend.direction}`);
      values.older = grades.trend.older_mean;
      values.recent = grades.trend.recent_mean;
    }
    if (grades.lecturers.length >= 2) {
      signals.add('lecturers');
      values.lecturer_a = grades.lecturers[0].name;
      values.lecturer_b = grades.lecturers[1].name;
    }
  } else {
    signals.add('no_grades');
  }
  if (topics.length) { signals.add('syllabus_topic'); values.topic = topics[0]; }
  if (live?.sections.length) { signals.add('syllabus_content'); values.year = live.academic_year; }
  const assignment = live?.assignments_he[0] ?? syllabus?.board.assessment_he;
  if (assignment) { signals.add('assignments'); values.assignment = assignment.length > 40 ? `${assignment.slice(0, 40)}…` : assignment; }
  if (input.hasPrerequisites) signals.add('prerequisites');
  if (!hasSyllabus) signals.add('no_syllabus');

  const chips: string[] = [];
  for (const [signal, template] of Object.entries(config.suggestion_templates_he)) {
    if (signal.startsWith('_') || !signals.has(signal)) continue;
    const chip = fill(template, values);
    if (chip) chips.push(chip);
    if (chips.length >= config.insights.max_suggestions) break;
  }
  return chips;
}

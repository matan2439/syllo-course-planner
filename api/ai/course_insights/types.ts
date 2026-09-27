/**
 * Course-insight data shapes shared by the API and the web app. No imports, so
 * the browser bundle can use them without pulling in server modules.
 */

export interface GradeBin {
  from: number;
  to: number;
  /** Share of the sitting's students in this bin, 0–100. */
  percent: number;
}

export type GradeSourceStatus = 'ok' | 'no_data' | 'error';

export interface TermStats {
  /** Year exactly as the grade source labels it. */
  year: number;
  /** 'a' | 'b' | 'summer' | … as the source labels it. */
  term: string;
  mean: number;
  median: number | null;
  std: number | null;
  students: number | null;
  pass_rate: number | null;
  lecturers: string[];
  bins: GradeBin[];
  source: string;
}

export interface GradeAggregate {
  mean: number;
  median: number | null;
  pass_rate: number | null;
  students: number | null;
  terms: number;
}

export interface CourseGradeSummary {
  course_key: string;
  has_data: boolean;
  /** Lowest passing grade (config); pass_rate counts bins starting at or above it. */
  passing_grade: number;
  sources: Array<{ id: string; label_he: string; attribution_url: string | null; status: GradeSourceStatus; terms: number; detail?: string; snapshot_at?: string }>;
  overall: GradeAggregate | null;
  recent: GradeAggregate | null;
  trend: { direction: 'up' | 'down' | 'flat'; recent_mean: number; older_mean: number; delta: number } | null;
  /** Most-taught first. */
  lecturers: Array<{ name: string; mean: number; students: number | null; terms: number }>;
  /** Newest first. */
  terms: TermStats[];
}

export interface BoardSyllabus {
  url: string | null;
  summary_he: string | null;
  topics_he: string[];
  assessment_he: string | null;
  structure_he: string | null;
  prerequisites_he: string[];
  complexity_notes_he: string[];
}

export interface LiveSyllabus {
  academic_year: number;
  /** True when the board's own year had no published syllabus and an earlier year is shown. */
  from_earlier_year: boolean;
  source_url: string;
  sections: Array<{ title: string; text: string }>;
  lecturers: string[];
  teaching_method: string[];
  assignments_he: string[];
  links: string[];
}

export interface CourseSyllabus {
  course_id: string;
  board: BoardSyllabus;
  live: LiveSyllabus | null;
  /** Why no live syllabus is available (null when one is). */
  live_unavailable_reason: string | null;
}

/** GET /api/ai/course-insights response. */
export interface CourseInsightsResponse {
  course_id: string;
  name_he: string | null;
  grades: CourseGradeSummary;
  syllabus: CourseSyllabus | null;
  suggestions_he: string[];
}

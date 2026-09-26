/** Plan-context types shared with completion_analysis (the request shape the planner UI sends). */

export interface CourseInPlan {
  course_id: string;
  name_he?: string;
  hours?: number;
  difficulty_level?: string;
  difficulty_score?: number;
  course_type?: string;
  /** 'fixed' = mandatory locked to its semester; 'flexible' = movable mandatory; 'elective'. */
  placement_policy?: string | null;
  /** Semesters this course may legally be placed in (for movability reasoning). */
  effective_allowed_semesters?: string[] | null;
  /** True for year-long (annual) courses that occupy BOTH spanned semesters
   *  together. They are immovable, must not be split, and their degree hours are
   *  counted once (count_hours_once) even though they appear in two semesters. */
  is_annual?: boolean;
  spans_semesters?: string[] | null;
  count_hours_once?: boolean;
  category?: string;
  missing_prerequisites?: string[];
  // Difficulty sub-scores (1-5 scale; null/missing if not yet computed)
  workload_score?: number | null;
  conceptual_complexity_score?: number | null;
  prerequisite_depth_score?: number | null;
  assessment_intensity_score?: number | null;
  difficulty_confidence?: number | null;
  // Assessment / syllabus availability — booleans/labels only, no URLs (keeps context compact)
  assessment_type?: string | null;
  has_syllabus?: boolean;
  has_syllabus_summary?: boolean;
  /** Phase 2B — concise syllabus content inlined into the prompt so the LLM
   *  can ground its answers in actual topic text rather than a yes/no flag. */
  syllabus_summary_he?: string | null;
  syllabus_topics_he?: string[] | null;
}

export interface SemesterPlan {
  id: string;
  label: string;
  courses: CourseInPlan[];
  total_hours: number;
}

export interface CategoryProgress {
  name: string;
  required: number;
  placed: number;
}

export interface RequirementsProgress {
  completed_hours: number;
  required_hours: number;
  categories: CategoryProgress[];
}

export interface PrereqIssue {
  course_id: string;
  name_he?: string;
  missing: string[];
}

/** A course the user has personally marked as completed, in progress, or planned. */
export interface PersonalStatusCourse {
  course_id: string;
  name_he?: string;
  semester_label?: string;
}

/** Personal academic status — distinct from the official board placement. */
export interface PersonalStatus {
  completed?: PersonalStatusCourse[];
  currently_taking?: PersonalStatusCourse[];
  planned?: PersonalStatusCourse[];
}

/** Prerequisite issues that arise specifically from the user's personal course status. */
export interface PersonalPrereqIssue {
  course_id: string;
  name_he?: string;
  issues: string[];
}

export interface PlanContext {
  program_name?: string;
  semesters: SemesterPlan[];
  mandatory_unplaced?: Array<{ course_id: string; name_he?: string; hours?: number }>;
  requirements_progress?: RequirementsProgress;
  prerequisite_issues?: PrereqIssue[];
  personal_status?: PersonalStatus;
  personal_prerequisite_issues?: PersonalPrereqIssue[];
  grade_signals?: Record<string, {
    average_grade?: number;
    median_grade?: number | null;
    pass_rate?: number | null;
    num_students_total?: number;
  }>;
  /** course_ids the user marked as "אל תזיז" — must stay in their current semester. */
  pinned_course_ids?: string[];
  /** User preferences carried over from the plan-generation UI, for chat context (PART F). */
  preferences?: {
    wanted_course_ids?: string[];
    unwanted_course_ids?: string[];
    extra_request_he?: string;
  };
  /** Semesters whose total_hours already exceed a typical weekly cap. */
  overload_warnings?: Array<{ semester_id: string; label: string; total_hours: number }>;
  /** Elective category requirements with eligible (not yet completed/scheduled) candidates. */
  category_requirements?: Array<{
    name: string;
    category_id?: string | null;
    required: number;
    placed: number;
    candidates: Array<{
      course_id: string;
      name_he?: string;
      hours?: number | null;
      has_syllabus_summary?: boolean;
      grade_average?: number | null;
      is_wanted?: boolean;
      /** Semesters this course may legally be placed in (PART A). */
      effective_allowed_semesters?: string[] | null;
      /** Raw syllabus/program offering data, if known. */
      offered_semesters?: string[] | null;
      /** Whether effective_allowed_semesters is high-confidence (syllabus-sourced). */
      offering_confident?: boolean;
    }>;
  }>;
  /** קורסי שער רוח (humanities) requirement — program-specific, distinct from engineering electives. */
  general_course_requirements?: {
    name: string;
    /** Required נק"ז for this category for the current program (e.g. 6 for Mechanical Engineering). */
    required_credits: number;
    candidates: Array<{
      course_id: string;
      name_he?: string;
      hours?: number | null;
      has_syllabus_summary?: boolean;
      grade_average?: number | null;
      is_wanted?: boolean;
    }>;
  };
  /** Progress toward the degree-hour requirement. */
  total_hours_progress?: {
    known_completed_hours: number;
    /**
     * Hours of currently_taking/planned personal-status courses that are NOT
     * placed on the board — prior progress accrued before any AI proposal.
     * Tracked separately from known_completed_hours so the canonical
     * degree-progress model can count them under
     * `currently_planned_before_proposal` exactly once (Phase 1 unification).
     */
    currently_planned_hours?: number;
    /** Program-specific total degree hours; defaults to 185 if omitted. */
    degree_required_hours?: number;
    /** Manually entered total completed-degree hours — preferred over known_completed_hours if present. */
    manual_completed_degree_hours?: number;
    /** קורסי שער/רוח hours required by the degree. */
    required_general_hours?: number;
    /** קורסי שער/רוח hours already completed. */
    completed_general_hours?: number;
  };
  /** Courses that may legally be moved between semesters (not pinned, not completed). */
  movable_courses?: Array<{
    course_id: string;
    name_he?: string;
    current_semester: string | null;
    hours?: number | null;
    effective_allowed_semesters?: string[] | null;
  }>;
}

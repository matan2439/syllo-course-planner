/**
 * Course-insight source configuration (grades, live syllabus). Every URL, TTL
 * and limit comes from data/config/course_insight_sources.json, overridable per
 * source by env — no source literal lives in code.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export type GradeSourceKind = 'tauplus_butterknife' | 'arazim_grades_json';

export interface GradeSourceConfig {
  id: string;
  kind: GradeSourceKind;
  label_he: string;
  url: string;
  attribution_url: string | null;
  enabled: boolean;
  ttl_seconds: number;
  timeout_ms: number;
  /** Repo-relative local copy used when the live fetch fails. */
  fallback_path?: string;
}

export interface CourseInsightConfig {
  grade_sources: GradeSourceConfig[];
  syllabus: { enabled: boolean; lookback_years: number; ttl_seconds: number; timeout_ms: number };
  insights: { http_cache_max_age_seconds: number; recent_terms: number; max_suggestions: number; passing_grade: number };
  user_agent: string;
  /** Signal id → chip template; order is priority. */
  suggestion_templates_he: Record<string, string>;
}

export const REPO_ROOT = join(__dirname, '..', '..', '..');
const CONFIG_PATH = join(REPO_ROOT, 'data', 'config', 'course_insight_sources.json');

const envKey = (id: string) => `COURSE_INSIGHT_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`;

/** Apply env overrides: a per-source URL, and a comma list of disabled source ids. */
export function applyEnvOverrides(config: CourseInsightConfig, env: NodeJS.ProcessEnv = process.env): CourseInsightConfig {
  const disabled = new Set((env.COURSE_INSIGHT_DISABLED ?? '').split(',').map((id) => id.trim()).filter(Boolean));
  return {
    ...config,
    grade_sources: config.grade_sources.map((source) => ({
      ...source,
      url: (env[envKey(source.id)] ?? '').trim() || source.url,
      enabled: source.enabled && !disabled.has(source.id),
    })),
    syllabus: { ...config.syllabus, enabled: config.syllabus.enabled && !disabled.has('syllabus') },
  };
}

let cached: CourseInsightConfig | undefined;

export function loadCourseInsightConfig(): CourseInsightConfig {
  cached ??= applyEnvOverrides(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CourseInsightConfig);
  return cached;
}

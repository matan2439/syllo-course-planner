/**
 * preference_elicitation.ts — deterministic PreferenceElicitationCapability
 * (Slice 11). Impact-driven progressive profiling with NO external provider.
 *
 * Responsibilities (all pure, none of them plan or mutate a board):
 *   - know what is already captured (a topic id already in the profile);
 *   - skip topics the planner is not sensitive to, and cosmetic (impact 0) ones;
 *   - pick the SINGLE highest-impact unknown, relevant question;
 *   - report sufficiency (nothing impactful left → the user may build now);
 *   - apply an answer to the structured profile, interpreting vague free text
 *     cautiously (uncertain + requires confirmation, never a hard constraint);
 *   - surface contradictions for correction.
 *
 * The boundary is designed so a richer (LLM) interpreter can be injected later
 * behind the same method shapes — but this implementation is fully deterministic.
 */
import {
  makePreference,
  fromExplicitChoice,
  fromVagueStatement,
  confirmPreference,
  upsertPreference,
  type Preference,
  type PreferenceProfile,
  type PreferenceClassification,
} from './preference_model';

export interface ElicitationQuestionDef {
  /** Also the resulting Preference id — so an addressed topic is never re-asked. */
  id: string;
  category: string;
  affects: string;
  /** 0..1 — how materially the answer can change a legal plan's placement/ranking. */
  impact: number;
  answerType: 'single_choice' | 'number' | 'boolean' | 'text';
  question_he: string;
  rationale_he: string;
  options?: Array<{ value: string; label_he: string }>;
  /**
   * T6 — options derived from THIS request's real candidate differences, rather
   * than a fixed list. Used by the topic question so the student is only ever
   * offered choices that can actually change the outcome.
   */
  optionsFrom?: (ctx: ElicitationContext) => Array<{ value: string; label_he: string }>;
  allowIndifferent: boolean;
  allowFreeText: boolean;
  /** Optional extra relevance gate beyond impact + irrelevantTopicIds. */
  relevantWhen?: (ctx: ElicitationContext) => boolean;
}

export interface ElicitationContext {
  /** Topic ids the planner is currently NOT sensitive to (skip them). */
  irrelevantTopicIds?: string[];
  /** Minimum impact worth asking about (default 0.1). */
  impactThreshold?: number;
  /** At/above this impact, a vague free-text answer needs confirmation (default 0.5). */
  consequentialThreshold?: number;
  /**
   * K9C — the evidence-driven gate for a grounded course-feature question.
   * Supplied ONLY when official evidence has actually been prepared for this
   * request, and set truthfully from it. A grounded topic is asked when, and
   * only when, answering it could really change which plan is selected:
   * several legal candidates exist, the evidence genuinely separates them on
   * the feature, coverage is sufficient, and nothing is in conflict. Absent ⇒
   * the topic is never raised, so it can never be asked merely because it sits
   * in a fixed catalog.
   */
  groundedFeatureImpact?: {
    feature: string;
    /** ≥2 retained legal candidates actually differ on this feature. */
    distinguishesCandidates: boolean;
    /** Enough of the relevant courses carry official evidence to answer usefully. */
    coverageSufficient: boolean;
    /** An unresolved authoritative conflict touches the relevant courses. */
    hasConflicts: boolean;
  };
  /**
   * T6 — the same evidence-driven gate for a course CONTENT/TOPIC question.
   * `distinguishingTopics` is both the gate and the set of choices worth
   * offering: a topic appears only when it genuinely separates at least two
   * retained candidates in THIS request. This is deliberately not a generic
   * interest questionnaire — with no distinguishing topic, nothing is asked.
   */
  topicInterestImpact?: {
    category: string;
    distinguishesCandidates: boolean;
    /** Normalized topic ids that actually separate retained candidates. */
    distinguishingTopics: string[];
    /**
     * W1 — localized labels supplied BY THE SERVER for exactly those ids. The
     * server owns the vocabulary, so the UI never has to; the local map below
     * is only a fallback for a response that predates this field.
     */
    topicLabels?: Record<string, string>;
    /** More than one course carries a usable official content statement. */
    coverageSufficient: boolean;
    hasConflicts: boolean;
  };
}

/**
 * T6 — student-facing Hebrew names for the topic vocabulary. The internal id is
 * carried as the option VALUE (it is the shared vocabulary between profile and
 * evidence) but never shown as a label.
 */
export const TOPIC_INTEREST_LABELS_HE: Record<string, string> = {
  engineering_design: 'תכן ועיצוב הנדסי',
  finite_element_analysis: 'ניתוח אלמנטים סופיים',
  solid_mechanics: 'מכניקת מוצקים',
  robotics: 'רובוטיקה',
  control: 'בקרה ומערכות',
  manufacturing: 'ייצור ותהליכי עיבוד',
  materials: 'חומרים',
  thermofluids: 'זרימה, אנרגיה ומעבר חום',
  programming_electronics: 'תכנות ואלקטרוניקה',
};

export type ElicitationAnswer =
  | { kind: 'choice'; value: string }
  | { kind: 'indifferent' }
  | { kind: 'free_text'; text: string };

export interface ApplyAnswerResult {
  profile: PreferenceProfile;
  /** True when a consequential interpretation must be confirmed before it can affect planning. */
  requiresConfirmation: boolean;
}

export interface PreferenceContradiction {
  affects: string;
  preferenceIds: string[];
  detail_he: string;
}

/** Generic, program-agnostic starter catalog. Copy is localized; ids/affects are open. */
export const DEFAULT_QUESTION_CATALOG: ElicitationQuestionDef[] = [
  {
    id: 'workload_target', category: 'workload', affects: 'max_weekly_hours', impact: 0.9,
    answerType: 'single_choice',
    question_he: 'מה חשוב לך יותר כרגע: שבוע קל יותר, או לסיים כמה שיותר קורסים מוקדם?',
    rationale_he: 'זה קובע כמה קורסים לשבץ בכל סמסטר ומשפיע ישירות על העומס השבועי.',
    options: [
      { value: 'lighter_week', label_he: 'שבוע קל יותר' },
      { value: 'finish_sooner', label_he: 'לסיים מוקדם' },
    ],
    allowIndifferent: true, allowFreeText: true,
  },
  {
    id: 'semester_balance', category: 'semester_balance', affects: 'balance_score', impact: 0.6,
    answerType: 'single_choice',
    question_he: 'יש שתי אפשרויות חוקיות: מערכת מרוכזת יותר או עומס מאוזן בין הסמסטרים. מה עדיף לך?',
    rationale_he: 'קורסים שחוקיים בשני הסמסטרים יכולים להתאזן — זה משנה את פיזור העומס.',
    options: [
      { value: 'balanced', label_he: 'עומס מאוזן' },
      { value: 'compact', label_he: 'מערכת מרוכזת' },
    ],
    allowIndifferent: true, allowFreeText: true,
  },
  {
    id: 'time_of_day', category: 'time_of_day', affects: 'schedule_shape', impact: 0.4,
    answerType: 'single_choice',
    question_he: 'האם שעות בוקר מוקדמות מפריעות לך?',
    rationale_he: 'אם כן, אפשר להעדיף שיבוצים מאוחרים יותר כשקיימת אפשרות חוקית.',
    options: [
      { value: 'avoid_morning', label_he: 'עדיף להימנע מבוקר' },
      { value: 'morning_ok', label_he: 'בוקר בסדר' },
    ],
    allowIndifferent: true, allowFreeText: true,
  },
  {
    // K9C — the grounded course-feature topic. Its wording is about the STUDENT'S
    // experience of a course, never about evidence ids, source classes or the
    // planner's internal objective name.
    id: 'course_feature_practical', category: 'course_feature',
    affects: 'grounded_course_feature', impact: 0.5,
    answerType: 'single_choice',
    question_he: 'יש כמה הרכבים חוקיים שנבדלים ביניהם באופן ההוראה. איזה סוג קורס מתאים לך יותר?',
    rationale_he: 'לפי הסילבוסים הרשמיים, חלק מהקורסים האפשריים מועברים כמעבדה או כפרויקט — זה יכול לשנות איזו תוכנית תיבחר.',
    options: [
      { value: 'practical_laboratory', label_he: 'מעדיף/ה קורסים עם מעבדה או עבודה מעשית' },
      // K8 — added after the coverage audit measured the same official
      // delivery-mode field at 8/8 and an end-to-end selection change was proven.
      { value: 'project_based', label_he: 'מעדיף/ה קורסים מבוססי פרויקט' },
      { value: 'no_feature_preference', label_he: 'אין לי העדפה בעניין הזה' },
    ],
    allowIndifferent: true, allowFreeText: false,
    // Asked ONLY when the answer can actually change the selected plan.
    relevantWhen: (ctx) => {
      const g = ctx.groundedFeatureImpact;
      return !!g && g.distinguishesCandidates && g.coverageSufficient && !g.hasConflicts;
    },
  },
  {
    // T6 — the grounded course CONTENT/TOPIC question. Asked only when official
    // content evidence genuinely separates retained candidates, and offering
    // only the topics that do the separating.
    id: 'course_topic_interest', category: 'course_topic_interest',
    affects: 'grounded_topic_interest', impact: 0.45,
    answerType: 'single_choice',
    question_he: 'יש כמה הרכבים חוקיים שנבדלים בתוכן הקורסים. יש תחום תוכן שמעניין אותך במיוחד?',
    rationale_he: 'לפי שדה "תוכן הקורס ומטרתו" בסילבוסים הרשמיים, חלק מהקורסים האפשריים עוסקים בתחומים שונים — זה יכול לשנות איזו תוכנית תיבחר.',
    optionsFrom: (ctx) =>
      (ctx.topicInterestImpact?.distinguishingTopics ?? []).map((value) => ({
        value,
        label_he: ctx.topicInterestImpact?.topicLabels?.[value] ?? TOPIC_INTEREST_LABELS_HE[value] ?? value,
      })),
    allowIndifferent: true, allowFreeText: false,
    relevantWhen: (ctx) => {
      const t = ctx.topicInterestImpact;
      return !!t && t.distinguishesCandidates && t.coverageSufficient && !t.hasConflicts
        && t.distinguishingTopics.length > 0;
    },
  },
];

const DEFAULT_IMPACT_THRESHOLD = 0.1;
const DEFAULT_CONSEQUENTIAL_THRESHOLD = 0.5;

export class DeterministicPreferenceElicitation {
  constructor(private catalog: ElicitationQuestionDef[] = DEFAULT_QUESTION_CATALOG) {}

  private candidates(profile: PreferenceProfile, ctx: ElicitationContext): ElicitationQuestionDef[] {
    const threshold = ctx.impactThreshold ?? DEFAULT_IMPACT_THRESHOLD;
    const known = new Set(profile.preferences.map((p) => p.id));
    const irrelevant = new Set(ctx.irrelevantTopicIds ?? []);
    return this.catalog.filter(
      (q) =>
        !known.has(q.id) &&
        !irrelevant.has(q.id) &&
        q.impact >= threshold &&
        (q.relevantWhen ? q.relevantWhen(ctx) : true),
    );
  }

  /** The single next best question, or null when nothing impactful remains. */
  selectNextQuestion(profile: PreferenceProfile, ctx: ElicitationContext): ElicitationQuestionDef | null {
    const candidates = this.candidates(profile, ctx);
    if (candidates.length === 0) return null;
    // Highest impact wins; stable catalog order breaks ties.
    const q = candidates.reduce((best, c) => (c.impact > best.impact ? c : best), candidates[0]);
    // T6 — materialise request-specific options, so a caller always receives a
    // ready-to-render question and can never see an unresolved generator.
    return q.optionsFrom ? { ...q, options: q.optionsFrom(ctx) } : q;
  }

  isSufficient(profile: PreferenceProfile, ctx: ElicitationContext): boolean {
    return this.selectNextQuestion(profile, ctx) === null;
  }

  applyAnswer(
    profile: PreferenceProfile,
    q: ElicitationQuestionDef,
    answer: ElicitationAnswer,
    ctx: ElicitationContext = {},
  ): ApplyAnswerResult {
    if (answer.kind === 'indifferent') {
      const pref = makePreference({
        id: q.id, category: q.category, normalized: 'indifferent', value: null,
        classification: 'indifferent', confidence: 1, source: 'explicit_answer', affects: q.affects,
      });
      return { profile: upsertPreference(profile, pref), requiresConfirmation: false };
    }
    if (answer.kind === 'choice') {
      const pref = fromExplicitChoice({
        id: q.id, category: q.category, normalized: answer.value, value: answer.value, affects: q.affects,
      });
      return { profile: upsertPreference(profile, pref), requiresConfirmation: false };
    }
    // free_text — a vague statement. Captured as uncertain + inert; a consequential
    // topic must be confirmed before it can influence planning.
    const consequential = q.impact >= (ctx.consequentialThreshold ?? DEFAULT_CONSEQUENTIAL_THRESHOLD);
    const pref = fromVagueStatement({
      id: q.id, category: q.category, originalWording: answer.text, normalized: 'free_text', affects: q.affects,
    });
    return { profile: upsertPreference(profile, pref), requiresConfirmation: consequential };
  }

  confirmInterpretation(
    profile: PreferenceProfile,
    id: string,
    opts: { as?: PreferenceClassification } = {},
  ): PreferenceProfile {
    const pref = profile.preferences.find((p) => p.id === id);
    if (!pref) return profile;
    return upsertPreference(profile, confirmPreference(pref, opts));
  }

  /** Two active preferences influencing the same planner knob with different values → conflict. */
  detectContradictions(profile: PreferenceProfile): PreferenceContradiction[] {
    const byAffects = new Map<string, Preference[]>();
    for (const p of profile.preferences) {
      if (p.classification === 'indifferent' || p.classification === 'uncertain') continue;
      const arr = byAffects.get(p.affects) ?? [];
      arr.push(p);
      byAffects.set(p.affects, arr);
    }
    const conflicts: PreferenceContradiction[] = [];
    for (const [affects, prefs] of byAffects) {
      const distinctValues = new Set(prefs.map((p) => String(p.normalized)));
      if (prefs.length > 1 && distinctValues.size > 1) {
        conflicts.push({
          affects,
          preferenceIds: prefs.map((p) => p.id),
          detail_he: `יש העדפות סותרות המשפיעות על אותו שיקול תכנון (${affects}).`,
        });
      }
    }
    return conflicts;
  }
}

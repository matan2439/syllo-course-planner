/**
 * K3 — grounded, rule-based extraction of a NARROW course-feature set from an
 * official syllabus document. No LLM, no model, no inference beyond what the
 * source literally states.
 *
 * The governing discipline: ABSENCE IS NOT FALSEHOOD.
 *
 * A feature may be concluded `false` ONLY when the official field it comes from
 * is SCHEMA-COMPLETE — an enumerated field the institution always populates, so
 * that a value other than the one sought is genuine negative evidence. The
 * delivery-mode field (`אופן ההוראה`) is such a field: it is always present on a
 * published syllabus and always names the mode, so "mode = שיעור" really does
 * mean "not a laboratory". Free prose is NOT schema-complete: prose that never
 * mentions a project is not evidence that the course has none, so it yields
 * `unknown`. Every feature therefore carries a ternary `true | false | 'unknown'`
 * and its supporting evidence; a feature with no evidence makes no claim.
 *
 * Deliberately NOT extracted, because no official source states them: subjective
 * difficulty, actual weekly workload, teaching quality, career value, grading
 * generosity, or topic emphasis. Those would be inference dressed as fact.
 *
 * The official prerequisite TEXT is retained as evidence only. It never
 * overrides the normalized prerequisite engine — `authoritativeForPlanning` is
 * false on it, permanently and by construction.
 *
 * Nothing here is subject- or institution-specific beyond the official field
 * labels of the source template; the topic vocabulary is generic and versioned,
 * and encodes no user preference and no particular course.
 */

import { syllabusToEvidence, type SyllabusDocument } from './syllabus_source';
import type { AcademicEvidence } from './academic_evidence';

export const FEATURE_EXTRACTION_VERSION = '1.0.0';
export const TOPIC_VOCABULARY_VERSION = '1.0.0';

/** Ternary: a feature is true, false, or genuinely not known. Never defaulted. */
export type Ternary = true | false | 'unknown';

export interface FeatureValue<T> {
  value: T;
  /** 0..1. Zero when the value is 'unknown' — an unknown carries no weight. */
  confidence: number;
  /** The evidence supporting this value. Empty ⇒ no claim is being made. */
  evidence: AcademicEvidence[];
  /** The extraction rule that produced it, for traceability. */
  rule: string;
  /**
   * Present and FALSE on features that are descriptive only and must never
   * influence hard planning legality (e.g. the raw prerequisite text).
   */
  authoritativeForPlanning?: boolean;
}

export interface NormalizedTopic {
  /** The original syllabus wording, always preserved. */
  rawText: string;
  /** Normalized vocabulary id. Absent when the mapping is not certain. */
  topicId?: string;
  state: 'mapped' | 'uncertain';
}

export interface CourseFeatures {
  courseId: string;
  academicYear: number;
  extractionVersion: string;
  topicVocabularyVersion: string;
  /** Practical laboratory component (official delivery mode). */
  laboratory: FeatureValue<Ternary>;
  /**
   * K8 — project/design-based delivery, read from the SAME schema-complete
   * official `אופן ההוראה` field. Distinct from `project` below, which comes
   * from the assessment field: the K8A audit measured assessment at 0/8 across
   * the live corpus, while delivery mode is 8/8, so only this one is usable.
   */
  projectDelivery: FeatureValue<Ternary>;
  /** Project component. */
  project: FeatureValue<Ternary>;
  /** Final examination. */
  finalExam: FeatureValue<Ternary>;
  /** Ongoing coursework / assignments. */
  coursework: FeatureValue<Ternary>;
  /** The official delivery mode, verbatim. */
  deliveryMode: FeatureValue<string | 'unknown'>;
  /** Explicitly listed topics, raw text preserved alongside normalized ids. */
  topics: FeatureValue<NormalizedTopic[]>;
  /** Official prerequisite text — EVIDENCE ONLY, never a planning authority. */
  prerequisiteText: FeatureValue<string | 'unknown'>;
}

/** The injectable boundary — a future extractor can replace the rule-based one. */
export interface FeatureExtractor {
  extract(doc: SyllabusDocument): CourseFeatures;
}

// ── topic vocabulary ─────────────────────────────────────────────────────────

/**
 * A generic, versioned controlled vocabulary. Entries are broad engineering/
 * science topics, not courses: no course id, no program, and nothing derived
 * from any particular user's preferences appears here. An unmatched phrase stays
 * `uncertain` with its raw text — it is never coerced into the nearest id.
 */
const TOPIC_VOCABULARY: ReadonlyArray<{ topicId: string; patterns: RegExp[] }> = [
  { topicId: 'heat_transfer', patterns: [/מעבר\s*חום/, /heat\s*transfer/i] },
  { topicId: 'thermodynamics', patterns: [/תרמודינמיקה/, /thermodynamics/i] },
  { topicId: 'fluid_mechanics', patterns: [/מכניקת\s*הזורמים/, /זרימ/, /fluid/i] },
  { topicId: 'solid_mechanics', patterns: [/מכניקת\s*המוצקים/, /solid\s*mechanics/i] },
  { topicId: 'control', patterns: [/בקרה/, /control/i] },
  { topicId: 'measurement', patterns: [/מדיד/, /מתמר/, /כיול/, /measurement/i] },
  { topicId: 'signal_processing', patterns: [/עיבוד\s*אותות/, /דגימה/, /signal/i] },
  { topicId: 'materials', patterns: [/תכונות\s*החומר/, /חומרים/, /material/i] },
  { topicId: 'statistics', patterns: [/הסתברות/, /סטטיסטיקה/, /statistic/i] },
  { topicId: 'optics_imaging', patterns: [/אופטי/, /עיבוד\s*תמונה/, /optic|imaging/i] },
  { topicId: 'electronics', patterns: [/אלקטרוניקה/, /electronic/i] },
];

/**
 * Map raw syllabus phrases onto the controlled vocabulary. A phrase matching
 * exactly one entry is `mapped`; anything unmatched — or ambiguous, matching
 * more than one — stays `uncertain`, preserving the original wording.
 */
export function normalizeTopics(rawTopics: string[]): NormalizedTopic[] {
  return rawTopics.map((rawText) => {
    const hits = TOPIC_VOCABULARY.filter((v) => v.patterns.some((p) => p.test(rawText)));
    if (hits.length === 1) return { rawText, topicId: hits[0].topicId, state: 'mapped' as const };
    return { rawText, state: 'uncertain' as const };
  });
}

// ── extraction helpers ───────────────────────────────────────────────────────

const UNKNOWN_TERNARY = (rule: string): FeatureValue<Ternary> => ({
  value: 'unknown', confidence: 0, evidence: [], rule,
});

/** A short, copyright-safe excerpt: the matched phrase in a small window. */
function excerptAround(text: string, match: string, window = 60): string {
  const i = text.indexOf(match);
  if (i < 0) return match.slice(0, window);
  const start = Math.max(0, i - Math.floor(window / 3));
  return text.slice(start, start + window).trim();
}

const DELIVERY_LABEL = 'אופן ההוראה';
const ASSIGNMENTS_LABEL = 'מטלות הקורס';
const PREREQ_LABEL = 'קורסי קדם נדרשים';

/** Laboratory delivery modes, as the official enumerated field spells them. */
const LAB_MODE = /מעבד/;
/** Project/design delivery mode — the field spells it "פרוייקט" (also "פרויקט"). */
const PROJECT_MODE = /פרוי/;
const PROJECT_TERMS = /פרויקט|פרוייקט|project/i;
const EXAM_TERMS = /בחינה|מבחן|exam/i;
const COURSEWORK_TERMS = /תרגיל|מטלה|מטלות|דו"?ח|דוח|הגש|assignment|homework/i;

export class RuleBasedFeatureExtractor implements FeatureExtractor {
  extract(doc: SyllabusDocument): CourseFeatures {
    const fields = doc.labeledFields;
    const delivery = fields[DELIVERY_LABEL]?.join(' ; ');
    const assignments = fields[ASSIGNMENTS_LABEL]?.join(' ; ');
    const prereq = fields[PREREQ_LABEL]?.join(' ; ');

    const evidenceFor = (
      factValue: unknown,
      confidence: number,
      method: string,
      excerpt: string,
      locator: string,
    ): AcademicEvidence[] => [
      syllabusToEvidence(doc, {
        factType: 'descriptive_feature',
        value: factValue,
        confidence,
        extractionMethod: method,
        extractionVersion: FEATURE_EXTRACTION_VERSION,
        excerpt,
        locator,
      }),
    ];

    // ── delivery mode (SCHEMA-COMPLETE enumerated official field) ────────────
    // Present ⇒ we may conclude both true AND false. Absent ⇒ unknown.
    const deliveryMode: FeatureValue<string | 'unknown'> = delivery
      ? {
          value: delivery,
          confidence: 0.95,
          evidence: evidenceFor(delivery, 0.95, 'rule:delivery_mode', excerptAround(delivery, delivery), `field:${DELIVERY_LABEL}`),
          rule: 'rule:delivery_mode',
        }
      : { value: 'unknown', confidence: 0, evidence: [], rule: 'rule:delivery_mode' };

    /**
     * Both readings share the SAME schema-complete field: present ⇒ we may
     * conclude true AND false; absent ⇒ unknown for both. They are independent
     * questions about one enumerated value, not competing interpretations.
     */
    const fromDeliveryMode = (test: RegExp, rule: string): FeatureValue<Ternary> =>
      delivery
        ? {
            value: test.test(delivery),
            confidence: 0.95,
            evidence: evidenceFor(test.test(delivery), 0.95, rule, excerptAround(delivery, delivery), `field:${DELIVERY_LABEL}`),
            rule,
          }
        : UNKNOWN_TERNARY(rule);

    const laboratory = fromDeliveryMode(LAB_MODE, 'rule:delivery_mode.laboratory');
    const projectDelivery = fromDeliveryMode(PROJECT_MODE, 'rule:delivery_mode.project');

    // ── assessment components (official assignments field) ───────────────────
    // This field is populated when the institution publishes assessment detail.
    // Present ⇒ a term's absence is meaningful within it. Absent ⇒ unknown for
    // ALL of exam/project/coursework: prose elsewhere cannot falsify them.
    const fromAssignments = (
      re: RegExp,
      rule: string,
    ): FeatureValue<Ternary> => {
      if (!assignments) return UNKNOWN_TERNARY(rule);
      const present = re.test(assignments);
      const m = assignments.match(re);
      return {
        value: present,
        confidence: 0.9,
        evidence: evidenceFor(present, 0.9, rule, excerptAround(assignments, m?.[0] ?? assignments), `field:${ASSIGNMENTS_LABEL}`),
        rule,
      };
    };

    const finalExam = fromAssignments(EXAM_TERMS, 'rule:assignments.final_exam');
    const project = fromAssignments(PROJECT_TERMS, 'rule:assignments.project');
    const coursework = fromAssignments(COURSEWORK_TERMS, 'rule:assignments.coursework');

    // ── explicitly listed topics ────────────────────────────────────────────
    // Only an explicit "נושאי לימוד:" list is read. Nothing is inferred from
    // narrative prose, and unmatched phrases stay uncertain with raw text kept.
    const topicsRaw = extractListedTopics(doc.text);
    const topics: FeatureValue<NormalizedTopic[]> = topicsRaw.length
      ? {
          value: normalizeTopics(topicsRaw),
          confidence: 0.7,
          evidence: evidenceFor(topicsRaw, 0.7, 'rule:listed_topics', excerptAround(doc.text, topicsRaw[0]), 'section:נושאי לימוד'),
          rule: 'rule:listed_topics',
        }
      : { value: [], confidence: 0, evidence: [], rule: 'rule:listed_topics' };

    // ── prerequisite text — EVIDENCE ONLY ───────────────────────────────────
    const prerequisiteText: FeatureValue<string | 'unknown'> = {
      value: prereq ?? 'unknown',
      confidence: prereq ? 0.8 : 0,
      evidence: prereq ? evidenceFor(prereq, 0.8, 'rule:prerequisite_text', excerptAround(prereq, prereq), `field:${PREREQ_LABEL}`) : [],
      rule: 'rule:prerequisite_text',
      // Permanently false: the normalized prerequisite engine stays the only
      // authority on prerequisite legality. This text is context for a human.
      authoritativeForPlanning: false,
    };

    return {
      courseId: doc.courseId,
      academicYear: doc.academicYear,
      extractionVersion: FEATURE_EXTRACTION_VERSION,
      topicVocabularyVersion: TOPIC_VOCABULARY_VERSION,
      laboratory, projectDelivery, project, finalExam, coursework, deliveryMode, topics, prerequisiteText,
    };
  }
}

/**
 * Topics from an EXPLICIT "נושאי לימוד:" list only. Narrative prose is never
 * mined for topics — an inferred topic is exactly the "emphasis not supported by
 * the source" this extractor refuses to produce.
 */
function extractListedTopics(text: string): string[] {
  const m = text.match(/נושאי\s*לימוד\s*:?\s*([\s\S]{0,600})/);
  if (!m) return [];
  return m[1]
    .split(/\n|,|;|־/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 80)
    .slice(0, 25);
}

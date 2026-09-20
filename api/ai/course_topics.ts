/**
 * T3 — normalized topic knowledge, extracted from the official course-content
 * field and mapped through a controlled, versioned vocabulary.
 *
 * ── Why this source ─────────────────────────────────────────────────────────
 * The K8A audit measured `נושאי לימוד` at 2/23 documents and rejected topic
 * alignment on that basis. It was measuring the wrong thing: `נושאי לימוד` is an
 * optional sub-heading INSIDE the official `תוכן הקורס ומטרתו` section, and that
 * section is present on 23/23 acquired documents. It is a labelled, official
 * course-content field — not narrative page text, not navigation, not a
 * lecturer biography, and not the course title.
 *
 * ── Why the exclusion rule is load-bearing ──────────────────────────────────
 * The same section frequently contains PREREQUISITE and RECOMMENDATION clauses
 * naming other subjects: 0542-3792 lists "מכניקת המוצקים" and "מכניקת הזורמים"
 * as prerequisites and recommends studying "אלקטרוניקה בסיסית ומעבר חום"
 * alongside. Mapping those would assert that the course teaches solid mechanics,
 * fluid mechanics and electronics — which it does not. Those clauses are removed
 * by a deterministic rule before any mapping happens, using the document's own
 * discourse markers.
 *
 * ── What this module refuses to do ──────────────────────────────────────────
 *   - no arbitrary substring matching (phrase boundaries are enforced, so
 *     "החומר הנלמד" cannot become materials science);
 *   - no mapping from the course TITLE;
 *   - no LLM, no semantic expansion, no inferred career value;
 *   - an ambiguous phrase produces NO assertion — it is disclosed instead, so a
 *     reviewer can see what was deliberately not mapped.
 *
 * Absence of a topic is NOT a claim that the course omits it. Prose that does
 * not mention robotics does not establish that the course has no robotics
 * content, so a topic is only ever asserted TRUE or left unknown. Consumers must
 * therefore count affirmative topics only, and never penalise silence.
 */
import type { SyllabusDocument } from './syllabus_source';

export const TOPIC_MAPPER_VERSION = 'topic-map/1.1.0';

/**
 * Only domains actually evidenced by official wording in the acquired corpus.
 * Nothing is added here because a user asked for it.
 */
export const TOPIC_IDS = [
  'engineering_design',
  'finite_element_analysis',
  'solid_mechanics',
  'robotics',
  'control',
  'manufacturing',
  'materials',
  'thermofluids',
  'energy_systems',
  'programming_electronics',
] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

export type TopicStatus = 'current' | 'stale' | 'conflicting';

export interface TopicAssertion {
  topicId: TopicId;
  /** The official phrase, verbatim, so the mapping can be audited. */
  rawWording: string;
  language: 'he' | 'en';
  /** The document this came from. */
  evidenceId: string;
  sourceRef: string;
  academicYear: number | string;
  /**
   * Measured, not assumed: across the five multi-group courses in the acquired
   * corpus the content section is byte-identical between groups, so it
   * describes the course, not a section.
   */
  scope: 'course';
  mapperVersion: string;
  confidence: number;
  ambiguous: boolean;
  status: TopicStatus;
}

export interface CourseTopicExtraction {
  courseId: string;
  academicYear: number | string;
  /** Whether the official content section existed at all. */
  contentAvailable: boolean;
  assertions: TopicAssertion[];
  /** Official phrases that matched an AMBIGUOUS entry and were left unmapped. */
  ambiguousPhrases: string[];
}

// ── the official content section ─────────────────────────────────────────────

const CONTENT_START = /תוכן\s+הקורס\s+ומטרתו/;
const CONTENT_END = /לסילבוס\s+המפורט|הסילבוס\s+המפורט\s+מפורסם|מטלות\s+הקורס|-->/;

/**
 * Clauses that describe OTHER courses rather than this one. Everything from the
 * marker to the end of its sentence is removed before mapping.
 */
const EXCLUDED_CLAUSE = /(דרישות\s+קדם|קורסי\s+קדם|מומלץ\s+ללמוד|מומלץ\s+לקחת|רקע\s+נדרש|חומר\s+רשות)/;
/** A sentence ends at a full stop followed by whitespace — so "3.5" is not one. */
const SENTENCE_END = /\.(?=\s|$)/;

/** The official content section of a document, or undefined when it has none. */
export function officialContentSection(doc: SyllabusDocument): string | undefined {
  const text = (doc.text ?? '').replace(/ /g, ' ');
  const start = CONTENT_START.exec(text);
  if (!start) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const end = CONTENT_END.exec(rest);
  // Preserve paragraph boundaries: prerequisite/recommendation blocks in the
  // official template are sometimes terminated by a blank line rather than a
  // full stop. Flattening all whitespace first makes that authoritative
  // boundary unrecoverable and can erase the following course-content prose.
  const section = (end ? rest.slice(0, end.index) : rest)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n{2,} */g, '\n\n')
    .replace(/ *\n */g, '\n')
    .trim();
  return section.length > 0 ? section : undefined;
}

/** Drop every prerequisite/recommendation clause, keeping the rest verbatim. */
export function contentWithoutForeignClauses(section: string): string {
  let out = '';
  let rest = section;
  for (;;) {
    const m = EXCLUDED_CLAUSE.exec(rest);
    if (!m) return `${out}${rest}`;
    out += rest.slice(0, m.index);
    const after = rest.slice(m.index);
    const sentenceStop = SENTENCE_END.exec(after);
    const paragraphStop = /\n\s*\n/.exec(after);
    const sentenceAt = sentenceStop?.index ?? Number.POSITIVE_INFINITY;
    const paragraphAt = paragraphStop?.index ?? Number.POSITIVE_INFINITY;
    const stopAt = Math.min(sentenceAt, paragraphAt);
    if (!Number.isFinite(stopAt)) return out; // the clause runs to the end
    rest = after.slice(stopAt + (paragraphAt < sentenceAt ? paragraphStop![0].length : 1));
  }
}

// ── the controlled vocabulary ────────────────────────────────────────────────

interface VocabularyEntry {
  topicId: TopicId;
  /** Official phrases, exactly as the corpus spells them. */
  phrases: string[];
  confidence: number;
}

/**
 * Every phrase below was observed in an official document in the acquired
 * corpus. Deliberately specific: bare `תכן` and bare `חומר` are NOT here,
 * because both occur in the corpus with unrelated meanings.
 */
const VOCABULARY: VocabularyEntry[] = [
  {
    topicId: 'engineering_design',
    phrases: ['תכן (עיצוב) הנדסי', 'תכן הנדסי', 'עיצוב הנדסי', 'העיצוב ההנדסי', 'שיטות תכן', 'תכן מכני',
      'תכנון ראשוני', 'תכנון מפורט', 'לתכן פתרון', 'עיצוב מוצר', 'product design', 'engineering design'],
    confidence: 0.9,
  },
  {
    topicId: 'finite_element_analysis',
    phrases: ['אלמנטים סופיים', 'FEA', 'ANSYS'],
    confidence: 0.95,
  },
  {
    topicId: 'solid_mechanics',
    phrases: ['מכניקת המוצקים', 'מכניקת מוצקים', 'חוזק חומרים', 'solid mechanics'],
    confidence: 0.9,
  },
  {
    topicId: 'robotics',
    phrases: ['זרוע רובוטית', 'רובוטיקה', 'רובוט', 'קינמטיקה', 'RRT', 'robotics'],
    confidence: 0.9,
  },
  {
    topicId: 'control',
    phrases: ['בקרים', 'זיהוי מערכת', 'תכנון תנועה', 'תכנון מסלול', 'משוב כוח', 'מכאטרונית', 'מכאטרוניקה', 'control systems'],
    confidence: 0.9,
  },
  {
    topicId: 'manufacturing',
    phrases: ['תהליכי ייצור', 'תהליכי עיבוד', 'עיבוד שבבי', 'ייצור', 'הדפסה תלת-מימדית', 'הדפסת תלת-מימד',
      'הדפסה תלת מימדית', 'הדפסת תלת מימד', 'הזרקה', 'Injection Molding', 'טיב פני שטח'],
    confidence: 0.9,
  },
  {
    topicId: 'materials',
    phrases: ['חומרים הנדסיים', 'תכונות החומר', 'עולם החומר', 'פולימרים', 'מבנה מטלוגרפי', 'נתכי', 'טיפולים תרמיים'],
    confidence: 0.9,
  },
  {
    topicId: 'thermofluids',
    phrases: ['מעבר חום', 'מכניקת הזורמים', 'תרמודינמיקה', 'זרימה', 'מחליפי החום', 'מחליפי חום',
      'מיזוג אוויר', 'נוויה-סטוקס', 'אווירודינמיים', 'גל הלם'],
    confidence: 0.9,
  },
  {
    topicId: 'energy_systems',
    // Specific energy-system equipment/process wording from the official
    // corpus. Bare "energy"/"אנרגיה" is deliberately excluded: conservation
    // of energy in an unrelated mechanics equation is not evidence that the
    // course teaches energy systems.
    phrases: ['מערכות קירור ומיזוג אוויר', 'משאבת חום', 'refrigeration system', 'heat pump'],
    confidence: 0.9,
  },
  {
    topicId: 'programming_electronics',
    phrases: ['תכנות', 'מיקרו-בקר', 'מעגל חשמלי', 'חיישנים', 'עיבוד אותות', 'אלקטרוניקה', 'ארדואינו'],
    confidence: 0.9,
  },
];

/**
 * Phrases that genuinely occur in the corpus with more than one meaning. They
 * are detected and DISCLOSED, never mapped — `בקרה` appears in 0542-4391 meaning
 * control of the solution process, not control engineering.
 */
const AMBIGUOUS_PHRASES = ['בקרה', 'תכן', 'חומר', 'אנליזה', 'מודל'];

/** Hebrew single-letter prefixes that attach to a following word. */
const PREFIXES = 'והבלמשכ';
const LETTER = /[֐-׿A-Za-z0-9]/;

/**
 * Every boundary-respecting occurrence of `phrase`. A match must not sit inside
 * a longer word: the character before must be a non-letter (optionally one
 * Hebrew prefix letter after a non-letter), and the character after must be a
 * non-letter. This is what stops `רובוט` matching inside `רובוטיקה` and
 * `חומר` matching inside `החומר הנלמד` when only a longer phrase is listed.
 */
function occurrences(haystack: string, phrase: string): number[] {
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(phrase, from);
    if (i < 0) return hits;
    from = i + 1;
    const after = haystack[i + phrase.length];
    if (after !== undefined && LETTER.test(after)) continue;
    const before = haystack[i - 1];
    if (before === undefined || !LETTER.test(before)) { hits.push(i); continue; }
    // Allow exactly one attached Hebrew prefix letter.
    const beforeThat = haystack[i - 2];
    if (PREFIXES.includes(before) && (beforeThat === undefined || !LETTER.test(beforeThat))) hits.push(i);
  }
}

const isEnglish = (phrase: string): boolean => /^[\x20-\x7E]+$/.test(phrase);

/**
 * Extract normalized topic assertions from one official document.
 *
 * `requestedYear` marks assertions from another academic year as `stale` rather
 * than dropping them, so staleness is disclosed rather than silently applied.
 */
export function extractCourseTopics(
  doc: SyllabusDocument,
  opts: { academicYear?: number | string } = {},
): CourseTopicExtraction {
  const section = officialContentSection(doc);
  const base = {
    courseId: doc.courseId,
    academicYear: doc.academicYear,
    contentAvailable: section !== undefined,
  };
  if (section === undefined) return { ...base, assertions: [], ambiguousPhrases: [] };

  const body = contentWithoutForeignClauses(section);
  const requested = opts.academicYear ?? doc.academicYear;
  const status: TopicStatus = String(requested) === String(doc.academicYear) ? 'current' : 'stale';

  const assertions: TopicAssertion[] = [];
  for (const entry of VOCABULARY) {
    for (const phrase of entry.phrases) {
      for (const at of occurrences(body, phrase)) {
        assertions.push({
          topicId: entry.topicId,
          rawWording: body.slice(at, at + phrase.length),
          language: isEnglish(phrase) ? 'en' : 'he',
          evidenceId: doc.contentHash,
          sourceRef: doc.sourceUrl,
          academicYear: doc.academicYear,
          scope: 'course',
          mapperVersion: TOPIC_MAPPER_VERSION,
          confidence: entry.confidence,
          ambiguous: false,
          status,
        });
      }
    }
  }

  const ambiguousPhrases = AMBIGUOUS_PHRASES.filter((p) => occurrences(body, p).length > 0);

  // Deterministic order: topic, then wording, then position in the document.
  assertions.sort((a, b) =>
    a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : a.rawWording < b.rawWording ? -1 : a.rawWording > b.rawWording ? 1 : 0,
  );
  return { ...base, assertions, ambiguousPhrases };
}

/**
 * The set of topics a course SUPPORTS, from all its documents.
 *
 * Duplicate evidence never counts twice: a topic stated in three documents, or
 * three times in one document, is one supported topic. Stale and ambiguous
 * assertions do not contribute.
 */
export function supportedTopics(extractions: CourseTopicExtraction[]): Set<TopicId> {
  const out = new Set<TopicId>();
  for (const e of extractions) {
    for (const a of e.assertions) if (a.status === 'current' && !a.ambiguous) out.add(a.topicId);
  }
  return out;
}

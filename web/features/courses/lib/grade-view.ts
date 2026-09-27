import type { CourseGradeSummary, GradeBin, TermStats } from '../../../../api/ai/course_insights/types'

const TERM_HE: Record<string, string> = { a: 'סמ׳ א׳', b: 'סמ׳ ב׳', summer: 'קיץ' }

/** "2026 סמ׳ א׳" — the year as the grade source labels it. */
export function termLabel(term: Pick<TermStats, 'year' | 'term'>): string {
  return `${term.year} ${TERM_HE[term.term] ?? term.term}`
}

export const termId = (term: Pick<TermStats, 'year' | 'term'>) => `${term.year}${term.term}`

export interface GradeScopeView {
  mean: number
  median: number | null
  passRate: number | null
  students: number | null
  bins: GradeBin[]
  terms: number
}

/** Student-weighted bins over the terms that share the newest term's bin edges. */
export function aggregateBins(terms: TermStats[]): GradeBin[] {
  const withBins = terms.filter((term) => term.bins.length)
  if (!withBins.length) return []
  const edges = (term: TermStats) => term.bins.map((bin) => `${bin.from}-${bin.to}`).join(',')
  const reference = edges(withBins[0])
  const same = withBins.filter((term) => edges(term) === reference)
  const weight = (term: TermStats) => term.students ?? 1
  const total = same.reduce((sum, term) => sum + weight(term), 0)
  return same[0].bins.map((bin, i) => ({
    ...bin,
    percent: same.reduce((sum, term) => sum + term.bins[i].percent * weight(term), 0) / total,
  }))
}

/** Headline numbers + distribution for "all semesters" or one semester. */
export function scopeView(summary: CourseGradeSummary, scope: string): GradeScopeView | null {
  if (scope === 'all') {
    if (!summary.overall) return null
    return {
      mean: summary.overall.mean,
      median: summary.overall.median,
      passRate: summary.overall.pass_rate,
      students: summary.overall.students,
      bins: aggregateBins(summary.terms),
      terms: summary.overall.terms,
    }
  }
  const term = summary.terms.find((candidate) => termId(candidate) === scope)
  if (!term) return null
  return { mean: term.mean, median: term.median, passRate: term.pass_rate, students: term.students, bins: term.bins, terms: 1 }
}

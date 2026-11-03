'use client'

import type { RepoCourseVM } from '../../../lib/repository'
import { useLocale } from '../../locale/LocaleProvider'
import { assessmentLabel } from './RepositoryDiscoveryControls'

/** The exact historical evidence used by discovery, also carried into course details. */
export default function RepositoryCourseEvidence({ course, detailed = false }: {
  course: Pick<RepoCourseVM, 'assessment' | 'gradeSummary'>
  detailed?: boolean
}) {
  const { t, locale } = useLocale()
  const grade = course.gradeSummary
  return <div className="space-y-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
    <p>{assessmentLabel(course.assessment?.kind ?? 'unknown', t)} · <span>{grade ? `${t('ממוצע היסטורי', 'Historical average')} ${grade.mean.toFixed(1)}` : t('ממוצע לא ידוע', 'Unknown average')}</span></p>
    {grade && <p>{grade.students == null ? t('גודל מדגם לא ידוע', 'Unknown sample size') : t(`${grade.students} רשומות ציונים`, `${grade.students} grade records`)}{grade.terms == null ? '' : t(` · ${grade.terms} סמסטרים`, ` · ${grade.terms} semesters`)}{grade.years?.length ? ` · ${Math.min(...grade.years)}–${Math.max(...grade.years)}` : ''}</p>}
    {grade?.sources.length ? <p>{t('מקור', 'Source')}: {grade.sources.map((source, index) => <span key={`${source.label}-${index}`}>{index > 0 && ' · '}{source.url && /^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer noopener" className="underline">{source.label}</a> : source.label}{source.snapshotAt && <> ({t('תמונת מצב', 'snapshot')} {new Date(source.snapshotAt).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'UTC' })})</>}</span>)}</p> : grade ? <p>{t('מקור לא זמין', 'Source unavailable')}</p> : null}
    {detailed && course.assessment?.text && <p className="border-s-2 border-[var(--border)] ps-2">{course.assessment.text}</p>}
  </div>
}

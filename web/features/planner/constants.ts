import type { DraftCourseVM } from '../../lib/planner/draft-vm'
import type { StaleReason } from './types'

/** Hebrew labels for the non-'proposal' structured agent outcomes (opt-in path). */
export const AGENT_OUTCOME_LABEL_HE: Record<string, string> = {
  clarification_required: 'נדרש מידע נוסף לפני החלה',
  validation_failed: 'נמצאה סתירה בנתונים — נדרשת בדיקה לפני החלה',
  // Slice 18A — a HARD constraint cannot be satisfied at all (a contradiction
  // between selections, or an impossibility against an authoritative fact).
  infeasible: 'לא קיימת תוכנית חוקית שעונה על הדרישות שסימנת — לא ניתן להחיל',
  blocked: 'הצעה חסומה — לא ניתן להחיל',
  error: 'אירעה שגיאה פנימית — לא ניתן להחיל',
}

export const STALE_MESSAGE_HE: Record<StaleReason, string> = {
  catalog: 'הקטלוג השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  status: 'סטטוס הקורסים שהשלמת השתנה מאז הבנייה — יש לבנות מחדש לפני החלה.',
  preferences: 'ההעדפות שלך השתנו מאז הבנייה — יש לבנות מחדש לפני החלה.',
  manual: 'הלוח השתנה בעריכה ידנית — יש לבנות מחדש לפני החלה.',
}

export const MARKER_LABEL: Record<DraftCourseVM['marker'], string | null> = {
  new: 'חדש', moved: 'הוזז', unchanged: null,
}

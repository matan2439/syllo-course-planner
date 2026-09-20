import { Card } from '../../../components/ui'
import type { ChatMsg } from '../types'

/** Free-text notes to the planner. Sending only records the note; it never builds a plan. */
export default function PlannerChatCard({ messages, draftText, setDraftText, sendMessage }: {
  messages: ChatMsg[]
  draftText: string
  setDraftText: (text: string) => void
  sendMessage: () => void
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold tracking-tight">עוזר התכנון</h2>
      <div aria-label="שיחה" className="flex max-h-56 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">כתבו העדפות או בקשות. שליחת הודעה לא מייצרת תוכנית — לחצו "בנה תוכנית".</p>
        ) : (
          messages.map((m, i) => (
            <p key={i} className={m.role === 'user' ? 'text-sm' : 'text-xs text-[var(--text-muted)]'}>
              <span aria-hidden="true">{m.role === 'user' ? '🧑 ' : 'ℹ️ '}</span>
              <span>{m.text}</span>
            </p>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          name="planner-message"
          aria-label="הודעה / בקשה / העדפה"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage() } }}
          placeholder="כתבו העדפה או בקשה…"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
        <button type="button" onClick={sendMessage} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium">
          שלח
        </button>
      </div>
    </Card>
  )
}

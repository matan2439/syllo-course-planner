import type { ChatMsg } from '../types'

/** Notes shown under the assistant: the latest system message and the state of the saved academic status. */
export default function AgentContextStatus({ messages, academicContextPhase }: {
  messages: ChatMsg[]
  academicContextPhase: 'loading' | 'ready' | 'error'
}) {
  return (
    <>
      {messages.filter((message) => message.role === 'system').slice(-1).map((message) => (
        <p key={message.text} role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
          {message.text}
        </p>
      ))}

      {academicContextPhase === 'loading' && (
        <p role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">
          טוען את הסטטוס האקדמי השמור…
        </p>
      )}
      {academicContextPhase === 'error' && (
        <p role="alert" className="text-xs text-red-600">
          לא ניתן לטעון את הסטטוס האקדמי השמור. הבנייה חסומה כדי לא לדרוס אותו.
        </p>
      )}
    </>
  )
}

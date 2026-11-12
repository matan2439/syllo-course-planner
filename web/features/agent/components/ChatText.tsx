import { Fragment, type ReactNode } from 'react'

/**
 * Assistant prose as readable blocks: blank lines split paragraphs, "## " lines are headings,
 * "- " lines a bullet list, "1. " lines a numbered list; **bold** and [label](url) are rendered.
 * Every block takes its direction from its own text (`dir="auto"`), so a Hebrew paragraph, an
 * English course title and a list of numbers each read the right way; course numbers are isolated
 * so they never flip inside a Hebrew sentence. No HTML is ever injected; only http(s) links are linked.
 * Typography lives in `.chat-text` (globals.css), one style for every place the assistant speaks.
 */
export default function ChatText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <div className={`chat-text ${className}`.trim()}>
      {blocks.flatMap((block, i) => groups(block.split('\n')).map((group, k) => {
        const key = `${i}-${k}`
        if (group.kind === 'heading') return <h3 key={key} dir="auto">{inline(group.lines[0].replace(HEADING, ''))}</h3>
        if (group.kind === 'bullets') return <ul key={key} dir="auto">{group.lines.map((line, j) => <li key={j} dir="auto">{inline(line.replace(BULLET, ''))}</li>)}</ul>
        if (group.kind === 'numbers') return <ol key={key} dir="auto">{group.lines.map((line, j) => <li key={j} dir="auto">{inline(line.replace(NUMBER, ''))}</li>)}</ol>
        return <p key={key} dir="auto">{group.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}</p>
      }))}
    </div>
  )
}

const HEADING = /^\s*#{1,3}\s+/
const BULLET = /^\s*[-•*]\s+/
const NUMBER = /^\s*\d{1,2}[.)]\s+/
type Kind = 'heading' | 'bullets' | 'numbers' | 'text'
const kindOf = (line: string): Kind =>
  HEADING.test(line) ? 'heading' : BULLET.test(line) ? 'bullets' : NUMBER.test(line) ? 'numbers' : 'text'

/** Consecutive lines of one kind form one list or paragraph; every heading stands alone. */
function groups(lines: string[]): Array<{ kind: Kind; lines: string[] }> {
  const out: Array<{ kind: Kind; lines: string[] }> = []
  for (const line of lines) {
    const kind = kindOf(line)
    if (kind !== 'heading' && out.at(-1)?.kind === kind) out.at(-1)!.lines.push(line)
    else out.push({ kind, lines: [line] })
  }
  return out
}

const TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)|(\b\d{4}-\d{4}\b)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    if (match.index! > last) out.push(text.slice(last, match.index))
    const [, bold, label, href, bare, courseNumber] = match
    if (bold) out.push(<strong key={out.length}>{bold}</strong>)
    else if (courseNumber) out.push(<bdi key={out.length} className="chat-ltr">{courseNumber}</bdi>)
    else {
      const url = href ?? bare!
      let shown = label
      if (!shown) { try { shown = new URL(url).hostname } catch { shown = url } }
      out.push(<a key={out.length} href={url} target="_blank" rel="noopener noreferrer">{shown}</a>)
    }
    last = match.index! + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

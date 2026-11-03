import { Fragment, type ReactNode } from 'react'

/**
 * Assistant prose as readable blocks: blank lines split paragraphs, "- " lines become a list,
 * **bold** and [label](url) are rendered. No HTML is ever injected; only http(s) links are linked.
 */
export default function ChatText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <div className={`flex flex-col gap-2 text-sm leading-relaxed ${className}`}>
      {blocks.flatMap((block, i) => groups(block.split('\n')).map((group, k) => group.list
        ? <ul key={`${i}-${k}`} className="flex list-disc flex-col gap-0.5 ps-5">{group.lines.map((line, j) => <li key={j}>{inline(line.replace(ITEM, ''))}</li>)}</ul>
        : <p key={`${i}-${k}`}>{group.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}</p>))}
    </div>
  )
}

const ITEM = /^\s*[-•*]\s+/
/** Consecutive list lines form one list; other lines form paragraphs between them. */
function groups(lines: string[]): Array<{ list: boolean; lines: string[] }> {
  const out: Array<{ list: boolean; lines: string[] }> = []
  for (const line of lines) {
    const list = ITEM.test(line)
    if (out.at(-1)?.list === list) out.at(-1)!.lines.push(line)
    else out.push({ list, lines: [line] })
  }
  return out
}

const TOKEN =/\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    if (match.index! > last) out.push(text.slice(last, match.index))
    const [, bold, label, href, bare] = match
    if (bold) out.push(<strong key={out.length}>{bold}</strong>)
    else {
      const url = href ?? bare!
      let shown = label
      if (!shown) { try { shown = new URL(url).hostname } catch { shown = url } }
      out.push(<a key={out.length} href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--purple-strong)] underline underline-offset-2">{shown}</a>)
    }
    last = match.index! + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

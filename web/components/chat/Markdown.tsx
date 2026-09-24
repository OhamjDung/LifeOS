import { Fragment, ReactNode } from 'react'

// Tiny, safe markdown for chat replies: paragraphs, - / 1. lists, ## headings,
// **bold**, *italic*, `code`. Builds React nodes — never injects HTML.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key} className="px-1 rounded bg-black/10 text-[0.92em]">{tok.slice(1, -1)}</code>)
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []

  const flushPara = () => {
    if (!para.length) return
    const k = `p${blocks.length}`
    const lines = para
    blocks.push(<p key={k}>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const k = `l${blocks.length}`
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>)
    blocks.push(list.ordered
      ? <ol key={k} className="list-decimal pl-5 space-y-0.5">{items}</ol>
      : <ul key={k} className="list-disc pl-5 space-y-0.5">{items}</ul>)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const head = /^#{1,4}\s+(.*)$/.exec(line)
    if (bullet || num) {
      flushPara()
      const ordered = !bullet
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((bullet ?? num)![1])
    } else if (head) {
      flushPara(); flushList()
      blocks.push(<p key={`h${blocks.length}`} className="font-bold">{inline(head[1], `h${blocks.length}`)}</p>)
    } else if (!line.trim()) {
      flushPara(); flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara(); flushList()
  return <div className="space-y-2 leading-relaxed">{blocks}</div>
}

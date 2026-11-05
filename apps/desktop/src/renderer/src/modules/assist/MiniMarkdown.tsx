/**
 * MiniMarkdown — a tiny, dependency-free renderer for assistant replies:
 * headings, bold, inline code, fenced code blocks, bullets and paragraphs.
 * Not a full markdown engine — deliberately small and fast.
 */
import type { ReactNode } from 'react'

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-mirai-text">
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <code
          key={key++}
          className="rounded border border-mirai-border bg-mirai-base px-1 py-0.5 font-mono text-[11px] text-mirai-accent-3"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let listBuffer: string[] = []
  let codeBuffer: string[] = []
  let inCode = false
  let key = 0

  const flushList = () => {
    if (listBuffer.length === 0) return
    blocks.push(
      <ul key={key++} className="my-1 ml-4 list-disc space-y-0.5">
        {listBuffer.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed text-mirai-dim">
            {renderInline(item)}
          </li>
        ))}
      </ul>,
    )
    listBuffer = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push(
          <pre
            key={key++}
            data-selectable="true"
            className="my-2 max-w-full overflow-x-auto rounded-lg border border-mirai-border bg-mirai-base p-3 font-mono text-[11px] leading-relaxed text-mirai-accent-3"
          >
            {codeBuffer.join('\n')}
          </pre>,
        )
        codeBuffer = []
        inCode = false
      } else {
        flushList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      listBuffer.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    flushList()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      blocks.push(
        <p
          key={key++}
          className={
            level === 1
              ? 'mt-2 mb-1 font-display text-sm font-bold text-mirai-text'
              : level === 2
                ? 'mt-2 mb-1 font-display text-[13px] font-bold text-mirai-text'
                : 'mt-1 font-semibold text-[12px] text-mirai-text'
          }
        >
          {renderInline(heading[2]!)}
        </p>,
      )
      continue
    }
    if (line.trim().length === 0) {
      blocks.push(<div key={key++} className="h-2" />)
      continue
    }
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed text-mirai-dim" data-selectable="true">
        {renderInline(line)}
      </p>,
    )
  }
  flushList()
  if (inCode && codeBuffer.length > 0) {
    blocks.push(
      <pre
        key={key++}
        data-selectable="true"
        className="my-2 max-w-full overflow-x-auto rounded-lg border border-mirai-border bg-mirai-base p-3 font-mono text-[11px] leading-relaxed text-mirai-accent-3"
      >
        {codeBuffer.join('\n')}
      </pre>,
    )
  }
  return <div className="space-y-0.5">{blocks}</div>
}

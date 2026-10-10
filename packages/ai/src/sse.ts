/**
 * SSE line parser — the wire format OpenRouter streams.
 * Yields each `data:` payload; `[DONE]` is surfaced for the caller to stop.
 */
export async function* parseSseDataEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        const data = extractData(line)
        if (data !== null) yield data
        newlineIndex = buffer.indexOf('\n')
      }
    }
    // Flush a trailing line without newline.
    const trailing = extractData(buffer.replace(/\r$/, ''))
    if (trailing !== null) yield trailing
  } finally {
    reader.releaseLock()
  }
}

function extractData(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).trim()
}

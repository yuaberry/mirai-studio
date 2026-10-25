import { describe, expect, it } from 'vitest'
import { parseSseDataEvents } from '../src/sse'
import { sseStream } from './fakes'

async function collect(events: string[], splitEvery = 7): Promise<string[]> {
  const out: string[] = []
  for await (const data of parseSseDataEvents(sseStream(events, splitEvery))) {
    out.push(data)
  }
  return out
}

describe('parseSseDataEvents', () => {
  it('parses complete events', async () => {
    const events = ['data: {"a":1}', 'data: [DONE]']
    expect(await collect(events, 100)).toEqual(['{"a":1}', '[DONE]'])
  })

  it('survives events split mid-token (realistic chunking)', async () => {
    const events = ['data: {"choices":[{"delta":{"content":"hello"}}]}', 'data: [DONE]']
    expect(await collect(events, 3)).toEqual([
      '{"choices":[{"delta":{"content":"hello"}}]}',
      '[DONE]',
    ])
  })

  it('ignores comments and empty lines, flushes a trailing event without newline', async () => {
    const out = await collect([': keep-alive', '', 'data: {"ok":true}'], 4)
    expect(out).toEqual(['{"ok":true}'])
  })
})

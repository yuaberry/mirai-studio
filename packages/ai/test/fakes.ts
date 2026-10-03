/**
 * Test fakes: an in-memory transport for the provider port, SSE stream
 * builder and a manual clock. No network is ever touched.
 */
import type { FetchInit, FetchLike, FetchResponse } from '../src/types'

export interface RecordedCall {
  url: string
  init: FetchInit
}

export type Responder = (call: RecordedCall) => FakeResponse

export class FakeResponse implements FetchResponse {
  ok: boolean
  status: number
  private readonly raw: string

  constructor(options: { status?: number; json?: unknown; text?: string; sse?: string[]; stream?: ReadableStream<Uint8Array> | null }) {
    this.status = options.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    if (options.json !== undefined) {
      this.raw = JSON.stringify(options.json)
    } else if (options.text !== undefined) {
      this.raw = options.text
    } else if (options.sse !== undefined) {
      this.raw = options.sse.join('\n')
      this.body = sseStream(options.sse)
    } else {
      this.raw = ''
    }
    if (options.stream !== undefined) {
      this.body = options.stream
    }
  }

  body: ReadableStream<Uint8Array> | null = null

  async text(): Promise<string> {
    return this.raw
  }
}

export function sseStream(events: string[], splitEvery = 7): ReadableStream<Uint8Array> {
  const payload = `${events.join('\n')}\n`
  const encoder = new TextEncoder()
  let position = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position >= payload.length) {
        controller.close()
        return
      }
      const end = Math.min(payload.length, position + splitEvery)
      controller.enqueue(encoder.encode(payload.slice(position, end)))
      position = end
    },
  })
}

export function makeFetch(responder: Responder): { fetchFn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchFn: FetchLike = (url, init) => {
    const call = { url, init }
    calls.push(call)
    return Promise.resolve(responder(call))
  }
  return { fetchFn, calls }
}

export function makeClock(start = 1_000_000) {
  return {
    current: start,
    now(): number {
      return this.current
    },
    advance(ms: number): void {
      this.current += ms
    },
  }
}

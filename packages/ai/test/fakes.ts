/**
 * Test fakes: an in-memory transport for the provider port, SSE stream
 * builder and a manual clock. No network is ever touched.
 */
import type { FetchHeaders, FetchInit, FetchLike, FetchResponse } from '../src/types'

export interface RecordedCall {
  url: string
  init: FetchInit
}

export type Responder = (call: RecordedCall) => FakeResponse

/** A minimal `Headers` implementation — the real one satisfies `get()`. */
export class FakeHeaders implements FetchHeaders {
  constructor(private readonly entries: Record<string, string> = {}) {}

  get(name: string): string | null {
    const value = this.entries[name.toLowerCase()]
    return value === undefined ? null : value
  }
}

export class FakeResponse implements FetchResponse {
  ok: boolean
  status: number
  headers?: FakeHeaders
  private readonly raw: string
  private readonly bytes: Uint8Array

  constructor(options: {
    status?: number
    json?: unknown
    text?: string
    sse?: string[]
    stream?: ReadableStream<Uint8Array> | null
    headers?: Record<string, string>
    bytes?: Uint8Array
  }) {
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
    this.bytes = options.bytes ?? new TextEncoder().encode(this.raw)
    if (options.headers) {
      this.headers = new FakeHeaders(
        Object.fromEntries(
          Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]),
        ),
      )
    }
    if (options.stream !== undefined) {
      this.body = options.stream
    }
  }

  body: ReadableStream<Uint8Array> | null = null

  async text(): Promise<string> {
    return this.raw
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const copy = new Uint8Array(this.bytes)
    return copy.buffer
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

/**
 * Minimal WebSocket (WSS) client — just enough for Edge TTS, no dependency.
 *
 * WHY NOT `new WebSocket()`
 * -------------------------
 * The browser-style WebSocket (including Node's undici build) cannot send
 * custom handshake headers, and the Edge endpoint needs `Origin`,
 * `User-Agent`, `Pragma` and `Cache-Control` — a raw TLS socket with a
 * hand-written upgrade request is the only portable way to control the
 * handshake in Node/Electron. The codec below is the RFC 6455 subset the
 * protocol actually uses: client frames masked, server frames plain,
 * text/binary opcodes, 16/64-bit extended lengths.
 *
 * Every byte-level decision here is pinned by unit tests (the parser is fed
 * crafted frames) and by a LIVE round-trip against the real endpoint in the
 * smoke/e2e suites.
 */
import { createHash, randomUUID } from 'node:crypto'
import { connect, type TLSSocket } from 'node:tls'

export interface WssFrame {
  opcode: 1 | 2 // text | binary
  payload: Buffer
}

/**
 * A connected, upgraded socket — the surface the client needs. The real
 * implementation is a `node:tls` socket; tests inject a fake one.
 */
export interface WssSocket {
  write(data: Buffer): void
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'end', listener: () => void): unknown
  end(): void
  destroy(): void
}

export type WssSocketFactory = (url: string, headers: Record<string, string>) => Promise<WssSocket>

/** Builds the RFC 6455 handshake request (the upgrade headers included). */
export function buildHandshakeRequest(url: string, headers: Record<string, string>): string {
  const parsed = new URL(url)
  const key = randomUUID().replace(/-/g, '')
  const lines = [
    `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
    `Host: ${parsed.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ]
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`)
  return `${lines.join('\r\n')}\r\n\r\n`
}

/** Random 4-byte masking key (RFC 6455: client frames MUST be masked). */
function maskingKey(): Buffer {
  return Buffer.from(Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)))
}

/** Encodes ONE client frame (masked, FIN set). */
export function encodeClientFrame(payload: Buffer, opcode: 1 | 2 = 1): Buffer {
  const mask = maskingKey()
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0)

  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, mask, masked])
}

/**
 * Accumulates bytes and yields complete SERVER frames (never masked).
 * A frame with a 126/127 length prefix is only emitted once every byte of
 * its payload arrived — partial data is buffered, never misparsed.
 */
export class WssFrameParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): WssFrame[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk])
    const frames: WssFrame[] = []
    for (;;) {
      const frame = this.take()
      if (!frame) break
      frames.push(frame)
    }
    return frames
  }

  private take(): WssFrame | null {
    if (this.buffer.length < 2) return null
    const first = this.buffer[0] ?? 0
    const second = this.buffer[1] ?? 0
    const opcode = (first & 0x0f) as WssFrame['opcode']
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (this.buffer.length < 4) return null
      length = this.buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (this.buffer.length < 10) return null
      length = Number(this.buffer.readBigUInt64BE(2))
      offset = 10
    }
    if (this.buffer.length < offset + length) return null
    const payload = this.buffer.subarray(offset, offset + length)
    this.buffer = this.buffer.subarray(offset + length)
    if (opcode !== 1 && opcode !== 2) return null // ping/pong/close — ignore
    return { opcode, payload: Buffer.from(payload) }
  }
}

/** Splits `headers\r\n\r\ndata` — the framing the Edge protocol uses. */
export function splitHeadersAndData(frame: Buffer): { headers: Map<string, string>; data: Buffer } {
  const end = frame.indexOf('\r\n\r\n')
  if (end === -1) return { headers: new Map(), data: frame }
  const headers = new Map<string, string>()
  for (const line of frame.subarray(0, end).toString('utf8').split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { headers, data: frame.subarray(end + 4) }
}

/**
 * The TLS socket factory: performs the upgrade and REJECTS anything that is
 * not a 101 — a redirected/failed handshake must surface as an error, not a
 * socket that silently never speaks.
 */
export const createTlsSocket: WssSocketFactory = (url, headers) =>
  new Promise<WssSocket>((resolve, reject) => {
    const parsed = new URL(url)
    const sock: TLSSocket = connect({ host: parsed.hostname, port: Number(parsed.port || 443), servername: parsed.hostname })
    let handshakeDone = false
    let pending = Buffer.alloc(0)

    const fail = (message: string) => {
      sock.destroy()
      reject(new Error(message))
    }

    sock.on('data', (chunk: Buffer | string) => {
      if (handshakeDone) return
      pending = Buffer.concat([pending, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
      const end = pending.indexOf('\r\n\r\n')
      if (end === -1) return
      const head = pending.subarray(0, end).toString('utf8')
      const statusLine = head.split('\r\n')[0] ?? ''
      pending = pending.subarray(end + 4)
      handshakeDone = true
      if (!statusLine.includes(' 101 ')) {
        fail(`Edge TTS handshake refused: ${statusLine}`)
        return
      }
      resolve(toWssSocket(sock, pending))
    })
    sock.on('error', (err: Error) => {
      if (!handshakeDone) fail(`Edge TTS socket error: ${err.message}`)
    })

    sock.write(buildHandshakeRequest(url, headers))
    setTimeout(() => {
      if (!handshakeDone) fail('Edge TTS handshake timed out')
    }, 20_000)
  })

/** Wraps the raw socket into the client's surface, replaying buffered bytes. */
function toWssSocket(sock: TLSSocket, buffered: Buffer): WssSocket {
  const listeners = new Map<string, Array<(arg: unknown) => void>>()
  const emit = (event: string, arg?: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(arg)
  }
  sock.on('data', (chunk: Buffer | string) => emit('data', typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
  sock.on('error', (err: Error) => emit('error', err))
  sock.on('close', () => emit('close'))
  sock.on('end', () => emit('end'))
  if (buffered.length > 0) setImmediate(() => emit('data', buffered))
  return {
    write: (data) => sock.write(data),
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener as (arg: unknown) => void)
      listeners.set(event, list)
      return undefined
    },
    end: () => sock.end(),
    destroy: () => sock.destroy(),
  }
}

/** SHA-256 of a string as uppercase hex — exposed for the handshake tests. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
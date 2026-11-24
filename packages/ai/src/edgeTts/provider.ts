/**
 * Edge TTS provider — real neural voices, KEYLESS, "never expires".
 *
 * THE PROPERTY THE USER ASKED FOR
 * -------------------------------
 * "Edge TTS nunca pode morrer." A session-token design CAN die (the token
 * expires, the login flow changes). This endpoint authenticates with a
 * CLOCK-DERIVED token (edgeTts/token.ts): regenerate it per request, adjust
 * the clock skew from the server's `Date` header, and there is nothing left
 * to expire. What remains is what every network client must have:
 *
 *   · honest errors — the UI says WHICH step failed instead of pretending
 *     a voice exists (see EdgeTtsError);
 *   · retries with clock-skew correction — a machine whose clock is off
 *     gets a 403 and a precise `Date`, so we re-time and retry once;
 *   · a documented free fallback — the app's FFmpeg voice polish + the
 *     Google Translate adapter still exist for when Edge is unreachable.
 *
 * WHAT IT SPEAKS: 300+ neural voices (no account), one per language and
 * gender — the character list can have DISTINCT voices, unlike the
 * single-voice Google endpoint.
 *
 * The protocol (message formats, header order, the X-Timestamp "Z" bug)
 * mirrors the reference implementation; a live round-trip against the
 * endpoint is pinned by the smoke suite.
 */
import { randomUUID } from 'node:crypto'
import { MiraiError } from '@mirai/shared'
import {
  CHROMIUM_FULL_VERSION,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
  adjustClockSkewSeconds,
  generateSecMsGec,
  parseHttpDate,
} from './token'
import { encodeClientFrame, splitHeadersAndData, WssFrameParser, createTlsSocket, type WssSocket } from './wss'

const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const VOICES_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list' +
  `?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`

/** The Chromium major the client impersonates (the endpoint pins it). */
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0]

/** Headers for the WSS handshake (the reference's set). */
export function wssHeaders(): Record<string, string> {
  return {
    'User-Agent':
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  }
}

/**
 * Headers for the voice list — the reference's VOICE_HEADERS. Note there is
 * NO chrome-extension Origin here (that belongs to the socket handshake);
 * a plain fetch with that Origin is refused by the fetch layer itself.
 */
export function voicesHeaders(): Record<string, string> {
  return {
    'User-Agent':
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    Authority: 'speech.platform.bing.com',
    Accept: '*/*',
    'Sec-MS-GEC': generateSecMsGec(),
    'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
  }
}

/** A JavaScript-style date the endpoint expects: `Mon Nov 24 2026 … GMT+0000 (…)`. */
export function jsTimestamp(now: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${now.getUTCFullYear()} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  )
}

export interface EdgeVoice {
  /** e.g. 'pt-BR-AntonioNeural' — what the app stores per character. */
  shortName: string
  name: string
  gender: 'Male' | 'Female' | string
  locale: string
}

/** Fetches the voice catalog over real HTTPS (no key). */
export async function listEdgeVoices(fetchFn: typeof fetch = fetch): Promise<EdgeVoice[]> {
  let response: Response
  try {
    response = await fetchFn(VOICES_URL, { headers: voicesHeaders() })
  } catch (err) {
    throw new MiraiError('AI_OFFLINE', `Could not reach the Edge voice catalog: ${(err as Error).message}`, {
      retryable: true,
    })
  }
  if (response.status === 403) {
    const skew = parseHttpDate(response.headers.get('date'))
    if (skew !== null) adjustClockSkewSeconds(skew - Date.now() / 1000)
    throw new MiraiError('AI_PROVIDER_ERROR', 'Edge rejected the request (403) — the clock was corrected, retry.', {
      retryable: true,
    })
  }
  if (!response.ok) {
    throw new MiraiError('AI_PROVIDER_ERROR', `Edge voice catalog answered HTTP ${response.status}.`, {
      retryable: response.status >= 500,
    })
  }
  const voices = (await response.json()) as Array<Record<string, unknown>>
  return voices
    .map((v) => ({
      shortName: String(v.ShortName ?? ''),
      name: String(v.Name ?? v.FriendlyName ?? v.ShortName ?? ''),
      gender: String(v.Gender ?? ''),
      locale: String(v.Locale ?? ''),
    }))
    .filter((v) => v.shortName.length > 0)
}

export interface EdgeTtsOptions {
  text: string
  voice: string
  /** Prosody hints, in the SSML vocabulary ('+0Hz' | '+0%' | '+0%'). */
  pitch?: string
  rate?: string
  volume?: string
  signal?: AbortSignal
  /** Injectable for tests; the real client is the TLS socket factory. */
  connectSocket?: (url: string, headers: Record<string, string>) => Promise<WssSocket>
}

export interface EdgeTtsResult {
  bytes: Buffer
  mimeType: string
  voice: string
}

/** Strips the controls the service rejects (the reference's set). */
export function sanitizeText(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return (code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) ? ' ' : char
    })
    .join('')
}

/** XML-escapes the spoken text (voice names and voices are app-controlled). */
export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '<'
      case '>':
        return '>'
      case '&':
        return '&'
      case "'":
        return '&apos;'
      default:
        return '"'
    }
  })
}

/** The SSML document for one utterance (the reference's exact shape). */
export function buildSsml(options: EdgeTtsOptions): string {
  const pitch = options.pitch ?? '+0Hz'
  const rate = options.rate ?? '+0%'
  const volume = options.volume ?? '+0%'
  const locale = options.voice.split('-').slice(0, 2).join('-')
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
    `<voice name='${escapeXml(options.voice)}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
    `${escapeXml(sanitizeText(options.text))}` +
    `</prosody></voice></speak>`
  )
}

/** The speech.config message — note the header ORDER and the trailing CRLF. */
export function buildConfigMessage(now: Date = new Date()): string {
  return (
    `X-Timestamp:${jsTimestamp(now)}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"' +
    '},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"' +
    '}}}}\r\n'
  )
}

/**
 * The SSML request — `X-Timestamp` ends with a literal "Z", which the
 * reference documents as a Microsoft Edge bug we must reproduce.
 */
export function buildSsmlMessage(options: EdgeTtsOptions, requestId: string, now: Date = new Date()): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${jsTimestamp(now)}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    buildSsml(options)
  )
}

/** The synthesis URL — ConnectionId first, then the clock token. */
export function edgeWssUrl(connectionId: string): string {
  return (
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}&Sec-MS-GEC=${generateSecMsGec()}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
  )
}

/** Transient network failures a retry can survive (endpoint resets, DNS hiccups). */
function isTransient(message: string): boolean {
  return /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|timeout/i.test(message)
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Speaks one utterance through the real endpoint and returns MP3 bytes.
 * Rejects with a MiraiError whose message names the failing STEP — a user
 * (or a test) must be able to tell "no internet" from "rejected by the
 * service" from "socket closed mid-stream" without guessing.
 *
 * ROBUSTNESS ("never dies"): each attempt opens a FRESH socket (new clock
 * token, new connection id — everything the endpoint tracks per request),
 * transient network failures retry with backoff, and a rejected token is
 * handled through the clock skew (see listEdgeVoices). After the attempts
 * the error is honest about what happened.
 */
export async function edgeSpeak(options: EdgeTtsOptions): Promise<EdgeTtsResult> {
  if (!options.text.trim()) throw new MiraiError('VALIDATION_ERROR', 'Edge TTS has nothing to speak.')
  const attempts = 3
  const connectSocket = options.connectSocket ?? createTlsSocket
  let lastError: MiraiError | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new MiraiError('CANCELLED', 'Cancelled.')
    try {
      return await speakOnce(options, connectSocket)
    } catch (err) {
      const error = err instanceof MiraiError ? err : new MiraiError('AI_OFFLINE', String(err), { retryable: true })
      lastError = error
      const transient = (error.details as { retryable?: boolean } | undefined)?.retryable === true || isTransient(error.message)
      if (!transient || attempt === attempts) throw error
      await pause(400 * attempt) // 400ms → 800ms before the fresh socket
    }
  }
  throw lastError ?? new MiraiError('AI_PROVIDER_ERROR', 'Edge TTS could not synthesize the utterance.')
}

/** ONE synthesis attempt on a fresh socket (fresh clock token + connection id). */
async function speakOnce(
  options: EdgeTtsOptions,
  connectSocket: (url: string, headers: Record<string, string>) => Promise<WssSocket>,
): Promise<EdgeTtsResult> {
  const connectionId = randomId()
  const socket = await connectSocket(edgeWssUrl(connectionId), wssHeaders())
  const parser = new WssFrameParser()
  const audio: Buffer[] = []
  let bytes = 0

  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true
          reject(new MiraiError('AI_OFFLINE', 'Edge TTS did not answer in time.', { retryable: true }))
        }
      }, 45_000)

      const finish = (error?: Error) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }

      options.signal?.addEventListener('abort', () => finish(new MiraiError('CANCELLED', 'Cancelled.')))

      socket.on('data', (chunk) => {
        for (const frame of parser.push(chunk as Buffer)) {
          if (frame.opcode === 1) {
            // Text frame: `Path:turn.end` closes the turn (others are metadata).
            const { headers } = splitHeadersAndData(frame.payload)
            if (headers.get('path') === 'turn.end') finish()
            continue
          }
          // Binary frame: [2-byte header length][header block][\r\n][audio].
          // The reference reads the block by its declared length — NOT by
          // searching for a blank line (the block ends mid-header on the
          // wire; only `+2` after it reaches the audio bytes).
          if (frame.payload.length < 4) continue
          const headerLength = frame.payload.readUInt16BE(0)
          if (headerLength > frame.payload.length) continue
          const headers = new Map<string, string>()
          for (const line of frame.payload.subarray(2, 2 + headerLength).toString('utf8').split('\r\n')) {
            const colon = line.indexOf(':')
            if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
          }
          const data = frame.payload.subarray(2 + headerLength + 2)
          if (headers.get('path') === 'audio' && data.length > 0) {
            audio.push(Buffer.from(data))
            bytes += data.length
          }
        }
      })
      socket.on('error', (err) =>
        finish(new MiraiError('AI_OFFLINE', `Edge TTS socket failed: ${(err as Error).message}`, { retryable: true })),
      )
      socket.on('close', () =>
        finish(
          bytes > 0
            ? undefined
            : new MiraiError('AI_PROVIDER_ERROR', 'Edge TTS closed the socket before any audio arrived.', {
                retryable: true,
              }),
        ),
      )

      socket.write(encodeClientFrame(Buffer.from(buildConfigMessage(), 'utf8')))
      socket.write(encodeClientFrame(Buffer.from(buildSsmlMessage(options, randomId()), 'utf8')))
    })
  } finally {
    socket.end()
  }

  if (audio.length === 0) {
    throw new MiraiError('AI_PROVIDER_ERROR', 'Edge TTS answered without audio.', { retryable: true })
  }
  return { bytes: Buffer.concat(audio), mimeType: 'audio/mpeg', voice: options.voice }
}

function randomId(): string {
  return randomUUID().replace(/-/g, '')
}
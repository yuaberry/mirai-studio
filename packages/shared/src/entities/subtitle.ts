/**
 * Subtitle entities + REAL SRT/VTT codecs (Phase 4 wrap-up).
 *
 * The parsers/writers are pure functions (unit-testable, used by core for
 * import/export and by the renderer for previews).
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

export const SubtitleRecord = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  text: z.string().min(1).max(1_000),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type SubtitleRecord = z.infer<typeof SubtitleRecord>

export const SubtitleInput = z
  .object({
    sceneId: zEntityId,
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    text: z.string().min(1).max(1_000),
  })
  .refine((s) => s.endSec > s.startSec + 0.01, { message: 'End must be after start.' })
export type SubtitleInput = z.infer<typeof SubtitleInput>

export const SubtitlePatch = z
  .object({
    startSec: z.number().min(0).optional(),
    endSec: z.number().min(0).optional(),
    text: z.string().min(1).max(1_000).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch is empty.' })
export type SubtitlePatch = z.infer<typeof SubtitlePatch>

// ---------------------------------------------------------------- codecs

/** One parsed cue — index is the SRT sequence number (optional in VTT). */
export interface SubtitleCue {
  startSec: number
  endSec: number
  text: string
}

function pad(n: number, len = 2): string {
  return String(Math.floor(n)).padStart(len, '0')
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT) → seconds. */
export function parseTimecode(tc: string): number | null {
  const m = /^(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})$/.exec(tc.trim())
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/** Seconds → `HH:MM:SS,mmm`. */
export function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec)
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)},${pad((s - Math.floor(s)) * 1000, 3)}`
}

/** Seconds → `HH:MM:SS.mmm`. */
export function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(',', '.')
}

/**
 * Parse SRT text into cues. Tolerant of CRLF, BOM, missing trailing blank
 * lines and out-of-order blocks (output is sorted).
 */
export function parseSrt(content: string): SubtitleCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [from, to] = timeLine.split('-->')
    const start = parseTimecode(from ?? '')
    const end = parseTimecode(to ?? '')
    if (start === null || end === null) continue
    const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l.trim()))
    const text = textLines.join('\n').trim()
    if (text.length === 0) continue
    cues.push({ startSec: start, endSec: end, text })
  }
  return cues.sort((a, b) => a.startSec - b.startSec)
}

/** Parse WebVTT text (header optional in tolerance mode). */
export function parseVtt(content: string): SubtitleCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  // Strip cue settings after the timecode (e.g. "align:center line:0").
  const cleaned = normalized.replace(/^(?:WEBVTT).*$/m, (m) => m)
  const blocks = cleaned.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [fromRaw, toRaw] = timeLine.split('-->')
    // VTT allows MM:SS.mmm without hours.
    const fix = (tc: string): string => {
      const parts = tc.trim().split(':')
      return parts.length === 2 ? `00:${tc}` : tc
    }
    const start = parseTimecode(fix(fromRaw ?? ''))
    const end = parseTimecode(fix((toRaw ?? '').trim().split(/\s+/)[0] ?? ''))
    if (start === null || end === null) continue
    // VTT semantics: the cue text is everything AFTER the timecode line;
    // anything before it is the optional cue identifier (dropped).
    const timeIdx = lines.indexOf(timeLine)
    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .trim()
    if (text.length === 0) continue
    cues.push({ startSec: start, endSec: end, text })
  }
  return cues.sort((a, b) => a.startSec - b.startSec)
}

/** Write SRT text from cues. */
export function writeSrt(cues: ReadonlyArray<SubtitleCue>): string {
  return (
    cues
      .map((cue, i) => {
        const from = formatSrtTime(cue.startSec)
        const to = formatSrtTime(cue.endSec)
        return `${i + 1}\n${from} --> ${to}\n${cue.text}`
      })
      .join('\n\n') + '\n'
  )
}

/** Write WebVTT text from cues. */
export function writeVtt(cues: ReadonlyArray<SubtitleCue>): string {
  const body = cues
    .map((cue, i) => {
      const from = formatVttTime(cue.startSec)
      const to = formatVttTime(cue.endSec)
      return `${i + 1}\n${from} --> ${to}\n${cue.text}`
    })
    .join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

/** Seconds → ASS `H:MM:SS.cc` (centiseconds — the ASS/V4+ convention). */
export function formatAssTime(sec: number): string {
  const s = Math.max(0, sec)
  const cs = Math.round((s - Math.floor(s)) * 100)
  const safe = cs === 100 ? (Math.floor(s) + 1) + 0 : s // guard: 0.9995 → carry
  const total = cs === 100 ? Math.floor(safe) : Math.floor(s)
  const carry = cs === 100 ? 0 : cs
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = total % 60
  return `${h}:${pad(m)}:${pad(ss)}.${pad(carry)}`
}

/** ASS `H:MM:SS.cc` → seconds (null on malformed). */
export function parseAssTime(tc: string): number | null {
  const m = /^(\d+):(\d{2}):(\d{2})[.](\d{2})$/.exec(tc.trim())
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
}

/**
 * Parse ASS (Advanced SubStation Alpha / V4+) — tolerant: unknown style lines
 * and non-Dialogue events are ignored, `{\...}` override tags are stripped,
 * `\N` / `\n` become newlines, `\h` becomes a space.
 */
export function parseAss(content: string): SubtitleCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues: SubtitleCue[] = []
  for (const line of normalized.split('\n')) {
    if (!line.startsWith('Dialogue:')) continue
    // Dialogue: layer, start, end, style, name, marginL, marginR, marginV, effect, text
    const body = line.slice('Dialogue:'.length).trim()
    const fields = body.split(',')
    if (fields.length < 10) continue
    const start = parseAssTime(fields[1] ?? '')
    const end = parseAssTime(fields[2] ?? '')
    if (start === null || end === null || end <= start) continue
    const text = fields
      .slice(9)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N|\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
    if (text.length === 0) continue
    cues.push({ startSec: start, endSec: end, text })
  }
  return cues.sort((a, b) => a.startSec - b.startSec)
}

/** Write a minimal, spec-correct ASS file (Default style, full-opacity white). */
export function writeAss(cues: ReadonlyArray<SubtitleCue>): string {
  const header = [
    '[Script Info]',
    '; Generated by Mirai Studio',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,DejaVu Sans,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,40,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
  const events = cues
    .map((cue) => {
      const text = cue.text.replace(/\n/g, '\\N')
      return `Dialogue: 0,${formatAssTime(cue.startSec)},${formatAssTime(cue.endSec)},Default,,0,0,0,,${text}`
    })
    .join('\n')
  return `${header}\n${events}\n`
}

/** The subtitle active at a given time (for preview overlays). */
export function cueAt(cues: ReadonlyArray<SubtitleCue>, atSec: number): SubtitleCue | null {
  return cues.find((c) => atSec >= c.startSec && atSec <= c.endSec) ?? null
}

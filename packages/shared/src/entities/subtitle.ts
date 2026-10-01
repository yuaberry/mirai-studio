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

/** The subtitle active at a given time (for preview overlays). */
export function cueAt(cues: ReadonlyArray<SubtitleCue>, atSec: number): SubtitleCue | null {
  return cues.find((c) => atSec >= c.startSec && atSec <= c.endSec) ?? null
}

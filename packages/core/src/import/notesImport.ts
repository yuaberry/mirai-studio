/**
 * NotesImportService (v0.15) — reads the user's REAL story-note documents
 * for the AI to analyze: .txt/.md/.csv/.json (plain), .docx/.odt (zip+XML
 * containers), .pdf (text-layer streams) and .zip archives containing any
 * of those (Google Docs exports land here as .docx/.odt/.pdf/.txt).
 *
 * Zero new dependencies: zip = local-header reader + inflateRawSync,
 * docx/odt = XML text nodes, pdf = stream scan + Flate + Tj/TJ operators.
 * Everything is text-only — scanned/image PDFs are reported honestly.
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { readZipEntries } from './zip'
import { MiraiError, type ImportedNoteFile, type NoteFormat } from '@mirai/shared'

/** Per-file raw cap (bytes) — keeps a 5 MB scan of a broken archive harmless. */
const MAX_FILE_BYTES = 2_000_000
/** Total extracted text cap (chars) — the AI reads a bounded context. */
const MAX_TOTAL_CHARS = 400_000
/** Archive guards: depth + entry count. */
const MAX_ZIP_DEPTH = 3

const PLAIN: NoteFormat[] = ['txt', 'md', 'markdown', 'csv', 'json']

function extOf(name: string): string {
  return extname(name).replace('.', '').toLowerCase()
}

function toNoteFormat(name: string): NoteFormat | null {
  const ext = extOf(name)
  if (PLAIN.includes(ext as NoteFormat)) return (ext === 'markdown' ? 'md' : ext) as NoteFormat
  if (ext === 'docx' || ext === 'odt' || ext === 'pdf' || ext === 'zip') return ext
  return null
}

// ------------------------------------------------------------------ zip reader

// ------------------------------------------------------------------ extractors

function xmlToText(xml: string): string {
  // Paragraph-aware: block elements become newlines, the rest is stripped.
  // (Never INSERT tags — an unclosed fake tag makes the strip regex eat the
  // text up to the next '>' in the document.)
  return xml
    .replace(/<(?:w|text):p[ >/]/g, '\n')
    .replace(/<\/(?:w|text):p>/g, '\n')
    .replace(/<(?:w|text):h[ >/]/g, '\n## ')
    .replace(/<\/(?:w|text):h>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    // Entity decode — & LAST so double-encoded entities stay correct.
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractDocx(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new MiraiError('VALIDATION_ERROR', 'This .docx has no word/document.xml (corrupt or unusual export).')
  return xmlToText(doc.data.toString('utf8'))
}

function extractOdt(buffer: Buffer): string {
  const entries = readZipEntries(buffer)
  const doc = entries.find((e) => e.name === 'content.xml')
  if (!doc) throw new MiraiError('VALIDATION_ERROR', 'This .odt has no content.xml (corrupt or unusual export).')
  return xmlToText(doc.data.toString('utf8'))
}

/** Extracts `(…)Tj` and `[…]TJ` operands from a PDF's content streams. */
function pdfStreamsToText(buffer: Buffer): string {
  const out: string[] = []
  const text = buffer.toString('latin1')
  const streamRe = /stream\r?\n?/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(text)) !== null) {
    const end = text.indexOf('endstream', m.index + m[0].length)
    if (end < 0) break
    const start = m.index + m[0].length
    const chunk = Buffer.from(text.slice(start, end), 'latin1')
    let content: Buffer | null = null
    // Inspect the dict right before the stream for the filter.
    const dict = text.slice(Math.max(0, m.index - 400), m.index)
    try {
      if (/FlateDecode/.test(dict)) {
        // Real-world PDFs use BOTH zlib-wrapped and raw deflate streams.
        try {
          content = inflateRawSync(chunk)
        } catch {
          content = inflateSync(chunk)
        }
      } else {
        content = chunk
      }
    } catch {
      content = null
    }
    if (!content) continue
    const decoded = content.toString('latin1')
    if (!/Tj|TJ/.test(decoded)) continue
    for (const tmatch of decoded.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      const literal = tmatch[0].slice(1, -1)
      out.push(literal.replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n'))
    }
  }
  return out.join(' ').replace(/\s{3,}/g, ' ').trim()
}

function extractPdf(buffer: Buffer): string {
  const text = pdfStreamsToText(buffer)
  if (text.length < 30) {
    throw new MiraiError(
      'VALIDATION_ERROR',
      'This PDF has no extractable text layer (scanned/image PDF?) — export it as .docx or .txt from Google Docs/Word.',
    )
  }
  return text
}

// ------------------------------------------------------------------ service

export class NotesImportService {
  /**
   * Reads one file (or one archive entry) into text. `depth` guards zip
   * recursion. Returns null when the format is unsupported.
   */
  private readOne(name: string, data: Buffer, depth: number, collected: ImportedNoteFile[], skipped: { name: string; reason: string }[]): void {
    if (collected.length >= 80) return // import breadth cap
    if (data.length > MAX_FILE_BYTES) {
      skipped.push({ name, reason: `File exceeds ${Math.round(MAX_FILE_BYTES / 1000)} KB import limit.` })
      return
    }
    const format = toNoteFormat(name)
    if (!format) {
      skipped.push({ name, reason: 'Unsupported format (use .txt, .md, .docx, .odt, .pdf or .zip).' })
      return
    }
    try {
      if (format === 'zip') {
        if (depth >= MAX_ZIP_DEPTH) {
          skipped.push({ name, reason: 'Nested .zip too deep (max 3 levels).' })
          return
        }
        for (const entry of readZipEntries(data)) {
          this.readOne(entry.name, entry.data, depth + 1, collected, skipped)
        }
        return
      }
      const text =
        format === 'docx'
          ? extractDocx(data)
          : format === 'odt'
            ? extractOdt(data)
            : format === 'pdf'
              ? extractPdf(data)
              : data.toString('utf8')
      if (text.trim().length === 0) {
        skipped.push({ name, reason: 'No readable text found in the file.' })
        return
      }
      collected.push({
        name,
        format,
        chars: text.length,
        truncated: false, // set below when the global cap clips it
        text,
      })
    } catch (err) {
      skipped.push({ name, reason: err instanceof MiraiError ? err.message : 'Could not read the file.' })
    }
  }

  /** Import a list of real files from disk into bounded, AI-ready text. */
  importFiles(paths: string[]): { files: ImportedNoteFile[]; totalChars: number; combined: string; skipped: { name: string; reason: string }[] } {
    if (paths.length === 0) throw new MiraiError('VALIDATION_ERROR', 'No files to import.')
    const files: ImportedNoteFile[] = []
    const skipped: { name: string; reason: string }[] = []
    for (const p of paths) {
      let data: Buffer
      try {
        data = readFileSync(p)
      } catch {
        skipped.push({ name: p.split('/').pop() ?? p, reason: 'File not readable on disk.' })
        continue
      }
      this.readOne(p.split('/').pop() ?? p, data, 0, files, skipped)
    }
    if (files.length === 0) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        skipped[0]?.reason ?? 'None of the files produced readable text.',
        { details: skipped },
      )
    }
    // Global char cap — clip the tail files with an explicit truncation flag.
    let total = 0
    const kept: ImportedNoteFile[] = []
    for (const f of files) {
      const room = MAX_TOTAL_CHARS - total
      if (room <= 0) {
        skipped.push({ name: f.name, reason: 'Import text cap reached (400k chars) — file skipped.' })
        continue
      }
      if (f.text.length > room) {
        kept.push({ ...f, text: f.text.slice(0, room), chars: room, truncated: true })
        total = MAX_TOTAL_CHARS
      } else {
        kept.push(f)
        total += f.text.length
      }
    }
    const combined = kept
      .map((f) => `===== FILE: ${f.name} (${f.format}${f.truncated ? ', truncated' : ''}) =====\n${f.text}`)
      .join('\n\n')
    return { files: kept, totalChars: total, combined, skipped }
  }
}

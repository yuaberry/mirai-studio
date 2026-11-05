/**
 * PdfWriter (v0.15) — a real, dependency-free PDF 1.4 writer for the
 * Project Dossier: A4 pages, Helvetica (base-14, no embedding), wrapped
 * text, headings, cover page and numbered footers. Text-only by design —
 * the dossier is a professional planning document.
 *
 * Structure: catalog + pages tree + per-page content streams + xref table.
 * All string escaping is handled; widths use the standard Helvetica AFM
 * metrics (approximation table for wrapping with a safety margin).
 */
import { deflateSync } from 'node:zlib'

const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 56.7 // 2 cm
const BODY_SIZE = 11
const BODY_LEADING = 16
const H1_SIZE = 17
const H1_LEADING = 22
const H2_SIZE = 12.5
const H2_LEADING = 17

/** Helvetica AFM widths (units/1000) for ASCII 32..126. */
const W_HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667,
  556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556,
  556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722,
  500, 500, 500, 334, 260, 334, 584,
]
const W_HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556,
  611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
]

type Font = 'F1' | 'F2' | 'F3'

interface Op {
  x: number
  y: number
  size: number
  font: Font
  text: string
}

function widthOf(text: string, size: number, font: Font): number {
  const table = font === 'F2' ? W_HELV_BOLD : W_HELV
  let units = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32
    units += code >= 32 && code <= 126 ? (table[code - 32] ?? 556) : 556
  }
  return (units / 1000) * size
}

function wrap(text: string, size: number, font: Font, maxWidth: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`
      if (widthOf(candidate, size, font) <= maxWidth) {
        line = candidate
      } else {
        if (line.length > 0) lines.push(line)
        // A single word wider than the column is hard-split.
        if (widthOf(word, size, font) > maxWidth) {
          let piece = ''
          for (const ch of word) {
            if (widthOf(piece + ch, size, font) > maxWidth) {
              lines.push(piece)
              piece = ch
            } else piece += ch
          }
          line = piece
        } else {
          line = word
        }
      }
    }
    if (line.length > 0) lines.push(line)
  }
  return lines
}

function escapePdfText(text: string): string {
  // Non-ASCII → 2-byte UTF-16 hex strings would need a CID font; base-14
  // Helvetica with WinAnsi covers Latin-1. Map exotic chars to '?', keep
  // Latin-1 (accents survive for pt-BR content).
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32
    if (code >= 32 && code <= 255) {
      const c = code <= 126 ? String.fromCharCode(code) : ch
      out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c
    } else if (code === 10 || code === 13) {
      out += ' '
    } else {
      out += '?'
    }
  }
  return out
}

/** A flowing document: sections of paragraphs/headings, auto-paginated. */
export class PdfWriter {
  private ops: Op[] = []
  private pages: string[] = []
  private currentY = 0
  private readonly footer: string

  constructor(footer: string) {
    this.footer = footer
  }

  private pageHeight(): number {
    return A4_H - 2 * MARGIN
  }

  private newPage(): void {
    this.pages.push(this.renderPage())
    this.ops = []
    this.currentY = 0
  }

  private ensureSpace(needed: number): void {
    if (this.currentY + needed > this.pageHeight()) this.newPage()
  }

  /** A big H1 section heading — starts on a fresh area with extra spacing. */
  heading1(text: string): void {
    this.ensureSpace(H1_LEADING * 2.4)
    this.ensureSpace(1)
    if (this.currentY > 0) this.currentY += H1_LEADING * 0.6
    this.emit(text, H1_SIZE, 'F2', H1_LEADING)
    this.currentY += H1_LEADING * 0.35
  }

  heading2(text: string): void {
    this.ensureSpace(H2_LEADING * 2)
    this.currentY += H2_LEADING * 0.45
    this.emit(text, H2_SIZE, 'F2', H2_LEADING)
    this.currentY += H2_LEADING * 0.2
  }

  paragraph(text: string, opts: { italic?: boolean } = {}): void {
    const font: Font = opts.italic ? 'F3' : 'F1'
    const lines = wrap(text, BODY_SIZE, font, A4_W - 2 * MARGIN)
    for (const line of lines) {
      this.ensureSpace(BODY_LEADING)
      this.emit(line, BODY_SIZE, font, BODY_LEADING)
    }
    this.currentY += BODY_LEADING * 0.35
  }

  /** Key: value metadata lines (bold, one logical line each, wrapped). */
  metaLine(key: string, value: string): void {
    const lines = wrap(`${key}: ${value}`, BODY_SIZE, 'F2', A4_W - 2 * MARGIN)
    for (const line of lines) {
      this.ensureSpace(BODY_LEADING)
      this.emit(line, BODY_SIZE, 'F2', BODY_LEADING)
    }
    this.currentY += BODY_LEADING * 0.15
  }

  spacer(h: number): void {
    this.ensureSpace(h)
    this.currentY += h
  }

  pageBreak(): void {
    this.newPage()
  }

  private emit(text: string, size: number, font: Font, leading: number): void {
    this.ensureSpace(leading)
    this.ops.push({ x: MARGIN, y: this.currentY, size, font, text: escapePdfText(text) })
    this.currentY += leading
  }

  private renderPage(): string {
    const parts: string[] = []
    for (const op of this.ops) {
      parts.push(
        `BT /${op.font} ${op.size} Tf 1 0 0 1 ${op.x.toFixed(2)} ${(A4_H - MARGIN - op.y).toFixed(2)} Tm (${op.text}) Tj ET`,
      )
    }
    // Footer: page number is added by the assembler (it knows the index).
    return parts.join('\n')
  }

  /** Assembles the final PDF bytes. Returns { bytes, pages }. */
  build(): { bytes: Buffer; pages: number } {
    if (this.ops.length > 0 || this.pages.length === 0) this.newPage()
    const objects: string[] = []
    const pageObjectIds: number[] = []
    // 1: catalog, 2: pages, 3-5: fonts (F1 Helvetica, F2 Bold, F3 Oblique)
    const fonts: Array<[string, string]> = [
      ['F1', 'Helvetica'],
      ['F2', 'Helvetica-Bold'],
      ['F3', 'Helvetica-Oblique'],
    ]
    let nextId = 6
    for (let p = 0; p < this.pages.length; p++) {
      const contentId = nextId++
      const pageId = nextId++
      pageObjectIds.push(pageId)
      const footerOps = `BT /F1 8 Tf 1 0 0 1 ${MARGIN} 30 Tm (${escapePdfText(`${this.footer} — página ${p + 1} de ${this.pages.length}`)}) Tj ET`
      const stream = `${this.pages[p]}\n${footerOps}`
      const compressed = deflateSync(Buffer.from(stream, 'latin1'))
      objects[contentId] = `<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed.toString('latin1')}\nendstream`
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] ` +
        `/Resources << /Font << ${fonts.map(([alias], i) => `/${alias} ${3 + i} 0 R`).join(' ')} >> >> /Contents ${contentId} 0 R >>`
    }
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    objects[2] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`
    fonts.forEach(([, name], i) => {
      objects[3 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`
    })

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const offsets: number[] = []
    for (let id = 1; id < nextId; id++) {
      offsets[id] = Buffer.byteLength(out, 'latin1')
      out += `${id} 0 obj\n${objects[id]}\nendobj\n`
    }
    const xrefStart = Buffer.byteLength(out, 'latin1')
    out += `xref\n0 ${nextId}\n0000000000 65535 f \n`
    for (let id = 1; id < nextId; id++) {
      out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
    }
    out += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
    return { bytes: Buffer.from(out, 'latin1'), pages: pageObjectIds.length }
  }
}

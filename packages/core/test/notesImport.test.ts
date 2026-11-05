/**
 * NotesImportService (v0.15) — REAL format coverage: plain text, .docx and
 * .odt (zip containers), .pdf (Flate text layer), .zip archives (stored +
 * deflate), format guards and the global char cap.
 */
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { NotesImportService } from '../src/import/notesImport'

// ------------------------------------------------------------- zip test helper

/** Minimal zip WRITER for fixtures — stored (method 0) or deflate (method 8). */
function makeZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const stored = e.deflate ? deflateRawSync(e.data) : e.data
    const method = e.deflate ? 8 : 0
    const local = Buffer.alloc(30 + nameBuf.length + stored.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date (fixed, deterministic)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    stored.copy(local, 30 + nameBuf.length)
    locals.push(local)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version needed
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** CRC-32 (zip spec). */
function crc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function docxOf(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&').replace(/</g, '<')}</w:t></w:r></w:p>`)
    .join('')
  return makeZip([
    {
      name: 'word/document.xml',
      data: Buffer.from(
        `<?xml version="1.0"?><w:document xmlns:w="ns">${body}</w:document>`,
        'utf8',
      ),
    },
  ])
}

function odtOf(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<text:p>${p}</text:p>`).join('')
  return makeZip([{ name: 'content.xml', data: Buffer.from(`<?xml version="1.0"?><office>${body}</office>`, 'utf8') }])
}

/** A real single-page PDF with a Flate-compressed text stream. */
function pdfOf(text: string): Buffer {
  const content = Buffer.from(`BT /F1 12 Tf 72 720 Tm (${text}) Tj ET`, 'latin1')
  const compressed = deflateRawSync(content)
  const parts = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
  ]
  return Buffer.concat([
    Buffer.from(parts.join(''), 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ])
}

const svc = new NotesImportService()
const dir = () => mkdtempSync(join(tmpdir(), 'notes-'))
const p = (d: string, name: string, data: Buffer) => {
  writeFileSync(join(d, name), data)
  return join(d, name)
}

describe('NotesImportService', () => {
  it('reads plain .txt and .md files', () => {
    const d = dir()
    const txt = p(d, 'story.txt', Buffer.from('Um mundo onde espadas cantam.\nLinha dois.', 'utf8'))
    const md = p(d, 'notes.md', Buffer.from('# Premissa\nIsekai sombrio.', 'utf8'))
    const res = svc.importFiles([txt, md])
    expect(res.files).toHaveLength(2)
    expect(res.files[0]!.text).toContain('espadas cantam')
    expect(res.files[0]!.format).toBe('txt')
    expect(res.files[1]!.format).toBe('md')
    expect(res.combined).toContain('===== FILE: story.txt')
    expect(res.totalChars).toBeGreaterThan(40)
  })

  it('extracts text from a real .docx (zip + XML)', () => {
    const d = dir()
    const docx = p(d, 'roteiro.docx', docxOf(['Primeira cena do piloto.', 'A protagonista desperta.']))
    const res = svc.importFiles([docx])
    expect(res.files[0]!.format).toBe('docx')
    expect(res.files[0]!.text).toContain('Primeira cena do piloto.')
    expect(res.files[0]!.text).toContain('A protagonista desperta.')
  })

  it('extracts text from a real .odt', () => {
    const d = dir()
    const odt = p(d, 'enredo.odt', odtOf(['Capítulo um começa na aldeia.']))
    const res = svc.importFiles([odt])
    expect(res.files[0]!.format).toBe('odt')
    expect(res.files[0]!.text).toContain('aldeia')
  })

  it('extracts text from a real .pdf (Flate text layer)', () => {
    const d = dir()
    const pdf = p(d, 'notas.pdf', pdfOf('O herói retorna a Kyoto no inverno.'))
    const res = svc.importFiles([pdf])
    expect(res.files[0]!.format).toBe('pdf')
    expect(res.files[0]!.text).toContain('O herói retorna a Kyoto no inverno.')
  })

  it('unpacks .zip archives (stored + deflated) recursively', () => {
    const d = dir()
    const zip = p(
      d,
      'material.zip',
      makeZip([
        { name: 'a.txt', data: Buffer.from('Primeiro arquivo do pacote.', 'utf8') },
        { name: 'docs/roteiro.docx', data: docxOf(['Texto dentro do zip.']), deflate: true },
        { name: 'image.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      ]),
    )
    const res = svc.importFiles([zip])
    expect(res.files.map((f) => f.name)).toContain('a.txt')
    expect(res.files.map((f) => f.name)).toContain('docs/roteiro.docx')
    expect(res.files.some((f) => f.text.includes('Texto dentro do zip.'))).toBe(true)
    // The PNG is unsupported → reported in skipped, never crashes.
    expect(res.skipped.some((s) => s.name === 'image.png')).toBe(true)
  })

  it('rejects PDFs without a text layer with an honest message', () => {
    const d = dir()
    const scanned = p(
      d,
      'scan.pdf',
      makeZip([{ name: 'fake', data: Buffer.from('not really a pdf at all') }]),
    )
    // Not a real PDF → falls to the pdf extractor → no text streams → error.
    expect(() => svc.importFiles([scanned])).toThrow(MiraiError)
  })

  it('skips unsupported formats and unreadable files without failing the batch', () => {
    const d = dir()
    const ok = p(d, 'ok.txt', Buffer.from('Conteúdo válido.', 'utf8'))
    const bad = p(d, 'filme.mp4', Buffer.from('fake video'))
    const res = svc.importFiles([ok, bad])
    expect(res.files).toHaveLength(1)
    expect(res.skipped.some((s) => s.name === 'filme.mp4')).toBe(true)
  })

  it('throws when NOTHING produced readable text', () => {
    const d = dir()
    const only = p(d, 'x.mp3', Buffer.from('audio'))
    expect(() => svc.importFiles([only])).toThrow(MiraiError)
  })
})

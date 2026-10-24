/**
 * DocxService (v0.23) — Light Novel Pro slice II: the exported .docx is
 * unzipped and every OOXML part is validated — the same honesty pattern
 * as the EPUB tests (we can't run Word here, but we CAN prove the
 * package structure Word requires is intact and the content is real).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { DocxService } from '../src/production/docxService'
import { readZipEntries } from '../src/import/zip'
import { makeClock } from './helpers'

// XML entities spelled via concat so editors/tools never decode them.
const QUOT = '&quot;'
const AMP = '&amp;'
const LT = '&lt;'
const GT = '&gt;'

const chapter = (n: number) => ({
  title: `Capítulo ${n}: The Lantern`,
  scenes: [
    { title: `Scene ${n}a`, body: 'The keeper trims the wick at dusk.' },
    { title: `Scene ${n}b`, body: `"I wish to save her," Yuki says.\nThe lantern gutters.` },
  ],
})

describe('DocxService', () => {
  it('writes a valid OOXML .docx: content types, rels, document, styles, core props', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-'))
    const svc = new DocxService(dir, makeClock())
    const result = svc.export({
      title: 'The Lantern Keeper',
      author: 'Test Author',
      language: 'ja',
      chapters: [chapter(1), chapter(2), chapter(3)],
    })

    expect(existsSync(result.path)).toBe(true)
    expect(result.chapters).toBe(3)
    expect(result.scenes).toBe(6)
    expect(result.path.endsWith('.docx')).toBe(true)
    expect(result.path).toContain(join('exports', 'lightnovel'))
    expect(statSync(result.path).size).toBe(result.bytes)

    const raw = readFileSync(result.path)
    expect(raw.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04') // a real zip
    const entries = readZipEntries(raw)
    const byName = new Map(entries.map((e) => [e.name, e.data.toString('utf8')]))

    // ---- the parts Word requires
    const types = byName.get('[Content_Types].xml')!
    expect(types).toContain('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"')
    expect(types).toContain('PartName="/word/document.xml"')
    expect(types).toContain('wordprocessingml.document.main+xml')

    const rels = byName.get('_rels/.rels')!
    expect(rels).toContain('Target="word/document.xml"')
    expect(rels).toContain('/officeDocument"')

    const docRels = byName.get('word/_rels/document.xml.rels')!
    expect(docRels).toContain('Target="styles.xml"')

    expect(byName.has('word/styles.xml')).toBe(true)
    expect(byName.get('word/styles.xml')!).toContain('w:styleId="Heading1"')

    // ---- core properties carry the real title/author
    const core = byName.get('docProps/core.xml')!
    expect(core).toContain('<dc:title>The Lantern Keeper</dc:title>')
    expect(core).toContain('<dc:creator>Test Author</dc:creator>')

    // ---- document body: title page + chapters + scenes + prose
    const doc = byName.get('word/document.xml')!
    expect(doc).toContain('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')
    expect(doc).toContain('The Lantern Keeper')
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>')
    expect(doc).toContain('Capítulo 1: The Lantern')
    expect(doc).toContain('Capítulo 3: The Lantern')
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain('Scene 2b')
    expect(doc).toContain('The keeper trims the wick at dusk.')
    // soft line break inside a paragraph (single newline) + escaped quotes
    expect(doc).toContain(`${QUOT}I wish to save her,${QUOT} Yuki says.</w:t><w:br/><w:t xml:space="preserve">The lantern gutters.`)
    expect(doc).not.toContain('"I wish')
    expect(doc).toContain('<w:sectPr>')
    // every chapter ends with a page break except the document end
    expect((doc.match(/<w:br w:type="page"\/>/g) ?? []).length).toBe(3) // 1 (title) + 2 (ch1, ch2)
  })

  it('escapes XML-hostile content safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-esc-'))
    const svc = new DocxService(dir, makeClock())
    const result = svc.export({
      title: 'Yuna & Rin <Final> "Requiem"',
      author: 'A <B>',
      language: 'pt-BR',
      chapters: [{ title: 'Ch 1 & <Bold>', scenes: [{ title: 'S & T', body: 'x & <y>' }] }],
    })
    const byName = new Map(readZipEntries(readFileSync(result.path)).map((e) => [e.name, e.data.toString('utf8')]))
    const doc = byName.get('word/document.xml')!
    expect(doc).toContain(`Yuna ${AMP} Rin ${LT}Final${GT} ${QUOT}Requiem${QUOT}`)
    expect(doc).toContain(`Ch 1 ${AMP} ${LT}Bold${GT}`)
    expect(doc).toContain(`x ${AMP} ${LT}y${GT}`)
    // raw (unescaped) specials must NEVER leak into text runs
    expect(doc).not.toContain('Yuna & Rin <Final>')
    expect(doc).not.toContain('x & <y>')
  })

  it('skips empty scenes honestly (no fabricated sections) and counts only real ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-empty-'))
    const svc = new DocxService(dir, makeClock())
    const result = svc.export({
      title: 'Hollow',
      author: 'A',
      language: 'en',
      chapters: [
        { title: 'Full chapter', scenes: [{ title: 'Real scene', body: 'Prose.' }] },
        { title: 'Chapter with an empty untitled scene', scenes: [{ body: '   ' }] },
      ],
    })
    expect(result.chapters).toBe(2)
    expect(result.scenes).toBe(1)
    const doc = new Map(readZipEntries(readFileSync(result.path)).map((e) => [e.name, e.data.toString('utf8')])).get('word/document.xml')!
    expect(doc).toContain('Full chapter')
    // the REAL scene keeps its heading; the empty untitled one leaves nothing
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain('Real scene')
  })

  it('throws an honest VALIDATION_ERROR when there is nothing to export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-none-'))
    const svc = new DocxService(dir, makeClock())
    expect(() => svc.export({ title: 'x', author: 'y', language: 'ja', chapters: [] })).toThrow(MiraiError)
  })
})

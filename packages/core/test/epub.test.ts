/**
 * EpubService (v0.20) — REAL EPUB 3 validation: the written book is read
 * back with the core zip reader; structure asserts mirror the EPUB spec
 * requirements (mimetype stored+uncompressed+first, container, OPF, spine).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EpubService } from '../src/production/epubService'
import { readZipEntries } from '../src/import/zip'
import { makeClock } from './helpers'

/** The XML-escaped forms used by the writer (concat keeps the literal entities). */
const AMP = '&' + 'amp;'
const LT = '&' + 'lt;'
const GT = '&' + 'gt;'
const QUOT = '&' + 'quot;'

const chapters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Chapter ${i + 1}: The Lantern`,
    body: `The keeper trims the wick at dusk.\n\nA wish arrives with the wind — and every wish costs a memory.\n\n"I wish to save her," Yuki says.`,
  }))

describe('EpubService', () => {
  it('writes a valid EPUB 3: mimetype stored+first, container, OPF, nav, chapters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'epub-'))
    const svc = new EpubService(dir, makeClock())
    const result = svc.export({
      title: 'The Lantern Keeper',
      author: 'Test Author',
      language: 'ja',
      chapters: chapters(3),
    })

    expect(existsSync(result.path)).toBe(true)
    expect(result.chapters).toBe(3)
    expect(result.bytes).toBeGreaterThan(3_000)

    const raw = readFileSync(result.path)
    // EPUB spec: the mimetype file MUST be first, uncompressed, 20 bytes.
    expect(raw.subarray(0, 30).toString('latin1').startsWith('PK')).toBe(true)
    const entries = readZipEntries(raw)
    expect(entries[0]!.name).toBe('mimetype')
    expect(entries[0]!.data.toString()).toBe('application/epub+zip')

    const byName = new Map(entries.map((e) => [e.name, e.data.toString('utf8')]))
    expect(byName.has('META-INF/container.xml')).toBe(true)
    const opf = byName.get('OEBPS/content.opf')!
    expect(opf).toContain('xmlns="http://www.idpf.org/2007/opf" version="3.0"')
    expect(opf).toContain('<dc:title>The Lantern Keeper</dc:title>')
    expect(opf).toContain('<dc:creator>Test Author</dc:creator>')
    expect(opf).toMatch(/<dc:identifier id="pubid">urn:uuid:[0-9a-f-]{36}/)
    expect(opf).toContain('<meta property="dcterms:modified">')
    expect(opf).toContain('properties="nav"')
    expect(opf).toMatch(/<spine[^>]*>\s*<itemref idref="titlepage"\/>\s*<itemref idref="chapter1"\/>/)
    expect(opf).toContain('<itemref idref="chapter3"/>')

    const nav = byName.get('OEBPS/nav.xhtml')!
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toContain('href="chapter2.xhtml"')

    // chapter content: escaped prose (quotes become the XML entity)
    const ch1 = byName.get('OEBPS/chapter1.xhtml')!
    expect(ch1).toContain('Chapter 1: The Lantern')
    expect(ch1).toContain('<p>The keeper trims the wick at dusk.</p>')
    expect(ch1).toContain(`${QUOT}I wish to save her,${QUOT} Yuki says.`)
    expect(ch1).toContain('xmlns:epub="http://www.idpf.org/2007/ops"')

    expect(byName.get('OEBPS/toc.ncx')!).toContain('navMap')
    expect(statSync(result.path).size).toBe(result.bytes)
  })

  it('escapes XML-hostile titles safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'epub-'))
    const svc = new EpubService(dir, makeClock())
    const result = svc.export({
      title: 'Yuna & Rin <Final> "Requiem"',
      author: 'A <B>',
      language: 'pt-BR',
      chapters: [{ title: 'Ch 1 & <Bold>', body: 'x & <y>' }],
    })
    const entries = readZipEntries(readFileSync(result.path))
    const opf = entries.find((e) => e.name === 'OEBPS/content.opf')!.data.toString('utf8')
    expect(opf).toContain(`<dc:title>Yuna ${AMP} Rin ${LT}Final${GT} ${QUOT}Requiem${QUOT}</dc:title>`)
    expect(opf).toContain(`<dc:creator>A ${LT}B${GT}</dc:creator>`)
  })

  it('refuses to export an empty book', () => {
    const dir = mkdtempSync(join(tmpdir(), 'epub-'))
    const svc = new EpubService(dir, makeClock())
    expect(() => svc.export({ title: 'Empty', author: 'X', language: 'ja', chapters: [] })).toThrow()
  })
})

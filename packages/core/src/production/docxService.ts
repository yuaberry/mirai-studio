/**
 * DocxService (v0.23) — Light Novel Pro slice II (master prompt §9):
 * exports the project's episodes as a REAL Word .docx (Office Open XML).
 * Chapters are the episodes; scenes become Heading2 sections inside the
 * chapter with their screenplays as justified prose. Dependency-free:
 * the same zip util the EPUB writer uses, OOXML parts are plain
 * templates — the honesty pattern of EpubService + the dossier PdfWriter.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Clock } from '../types'
import { writeZipEntries } from '../import/zip'
import { MiraiError } from '@mirai/shared'

export interface DocxScene {
  title?: string
  /** Prose body (paragraphs separated by blank lines). */
  body: string
}

export interface DocxChapter {
  title: string
  scenes: DocxScene[]
}

export interface DocxExportOptions {
  title: string
  author: string
  language: string
  chapters: DocxChapter[]
}

export interface DocxResult {
  path: string
  chapters: number
  scenes: number
  bytes: number
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** One paragraph. `style` maps to a pStyle; `center` centers it. */
const para = (text: string, opts?: { style?: string; center?: boolean; bold?: boolean; sizeHalfPt?: number; indent?: boolean }): string => {
  const props: string[] = []
  if (opts?.style) props.push(`<w:pStyle w:val="${opts.style}"/>`)
  if (opts?.center) props.push('<w:jc w:val="center"/>')
  if (opts?.indent) props.push('<w:ind w:firstLine="709"/>') // 1.25cm prose indent
  const pPr = props.length > 0 ? `<w:pPr>${props.join('')}</w:pPr>` : ''
  // newlines inside a paragraph become soft line breaks
  const runs = xmlEscape(text)
    .split('\n')
    .map((line, i) => (i === 0 ? '' : '<w:br/>') + `<w:t xml:space="preserve">${line}</w:t>`)
    .join('')
  const rPr = `${opts?.bold ? '<w:b/>' : ''}${opts?.sizeHalfPt ? `<w:sz w:val="${opts.sizeHalfPt}"/>` : ''}`
  return `<w:p>${pPr}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${runs}</w:r></w:p>`
}

const pageBreak = (): string => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Yu Gothic"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="480" w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="360" w:after="180"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:color w:val="4C5566"/><w:sz w:val="26"/></w:rPr>
  </w:style>
</w:styles>`

export class DocxService {
  constructor(
    private readonly projectRoot: string,
    private readonly clock: Clock,
  ) {}

  /** Renders + writes a valid .docx. Returns the real file facts. */
  export(opts: DocxExportOptions): DocxResult {
    if (opts.chapters.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'Nothing to export — write at least one episode first.')
    }

    const body: string[] = []

    // ---- title page
    body.push(para(opts.title, { center: true, bold: true, sizeHalfPt: 56 }))
    body.push(para(opts.author, { center: true, sizeHalfPt: 28 }))
    body.push(pageBreak())

    let sceneCount = 0
    opts.chapters.forEach((ch) => {
      body.push(para(ch.title, { style: 'Heading1' }))
      ch.scenes.forEach((scene) => {
        sceneCount += 1
        if (scene.title) body.push(para(scene.title, { style: 'Heading2' }))
        const paragraphs = scene.body
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
        if (paragraphs.length === 0 && !scene.title) {
          sceneCount -= 1 // nothing real here — do not fabricate a section
          return
        }
        paragraphs.forEach((p) => body.push(para(p, { indent: true })))
      })
      body.push(pageBreak())
    })
    // drop the trailing page break — Word adds its own at the end
    body.pop()

    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}>
  <w:body>
${body.join('\n')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:mar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`

    const created = this.clock.isoNow().replace(/\.\d+Z$/, 'Z')
    const entries = [
      {
        name: '[Content_Types].xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
      },
      {
        name: '_rels/.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
      },
      {
        name: 'docProps/core.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(opts.title)}</dc:title>
  <dc:creator>${xmlEscape(opts.author)}</dc:creator>
  <dc:language>${xmlEscape(opts.language)}</dc:language>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
</cp:coreProperties>`,
      },
      {
        name: 'word/_rels/document.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      },
      { name: 'word/styles.xml', data: STYLES },
      { name: 'word/document.xml', data: document },
    ]

    const zip = writeZipEntries(entries)
    // the uuid makes every export distinct until content changes the stamp day
    const dir = join(this.projectRoot, 'exports', 'lightnovel')
    mkdirSync(dir, { recursive: true })
    const stamp = this.clock.isoNow().slice(0, 10)
    const safe = opts.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'novel'
    const unique = randomUUID().slice(0, 8)
    const path = join(dir, `${safe}-${stamp}-${unique}.docx`)
    writeFileSync(path, zip)
    return { path, chapters: opts.chapters.length, scenes: sceneCount, bytes: zip.length }
  }
}

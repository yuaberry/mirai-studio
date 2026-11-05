/**
 * EpubService (v0.20) — Light Novel Pro slice: exports the project's
 * episodes as a REAL EPUB 3 book (master prompt §9). Chapters are the
 * episodes; each chapter opens with the episode synopsis and renders its
 * scenes' screenplays as prose. Dependency-free: the zip layer is the
 * core util, XHTML/OPF are plain templates — the same honesty pattern as
 * the dossier PdfWriter.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Clock } from '../types'
import { writeZipEntries } from '../import/zip'
import { MiraiError } from '@mirai/shared'

export interface EpubChapter {
  title: string
  /** Prose body (paragraphs separated by blank lines). */
  body: string
}

export interface EpubExportOptions {
  title: string
  author: string
  language: string
  chapters: EpubChapter[]
}

export interface EpubResult {
  path: string
  chapters: number
  bytes: number
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const xhtmlDoc = (title: string, bodyXhtml: string): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body>
${bodyXhtml}
</body>
</html>`

const proseToXhtml = (body: string): string =>
  body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((p) => p.length > 0)
    .map((p) => `  <p>${xmlEscape(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')

const STYLE = `body { font-family: serif; line-height: 1.7; margin: 5% 8%; color: #14161c; background: #ffffff; }
h1.chapter { font-size: 1.5em; margin: 2em 0 1em; letter-spacing: 0.04em; }
h2.scene { font-size: 1.1em; margin: 1.8em 0 0.6em; color: #4c5566; }
p { margin: 0 0 0.9em; text-indent: 1.2em; }
p.no-indent { text-indent: 0; }
.title-page { text-align: center; margin-top: 25%; }
.title-page .t { font-size: 2.2em; font-weight: bold; letter-spacing: 0.06em; }
.title-page .a { font-size: 1.1em; margin-top: 1.2em; color: #4c5566; }`

export class EpubService {
  constructor(
    private readonly projectRoot: string,
    private readonly clock: Clock,
  ) {}

  /** Renders + writes a valid EPUB 3. Returns the real file facts. */
  export(opts: EpubExportOptions): EpubResult {
    if (opts.chapters.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'Nothing to export — write at least one episode first.')
    }
    const uuid = `urn:uuid:${randomUUID()}`
    const modified = this.clock.isoNow().replace(/\.\d+Z$/, 'Z')

    const entries: Array<{ name: string; data: string; method?: 'store' | 'deflate' }> = [
      // EPUB REQUIRES the mimetype entry first, STORED (uncompressed).
      { name: 'mimetype', data: 'application/epub+zip', method: 'store' },
      { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>` },
      { name: 'OEBPS/style.css', data: STYLE },
      {
        name: 'OEBPS/title.xhtml',
        data: xhtmlDoc(
          opts.title,
          `  <div class="title-page" epub:type="titlepage">
    <p class="t no-indent">${xmlEscape(opts.title)}</p>
    <p class="a no-indent">${xmlEscape(opts.author)}</p>
  </div>`,
        ),
      },
    ]

    const manifest: string[] = [
      `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `    <item id="css" href="style.css" media-type="text/css"/>`,
      `    <item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    ]
    const spine: string[] = [`    <itemref idref="titlepage"/>`]
    const navItems: string[] = []
    const ncxNavPoints: string[] = []

    opts.chapters.forEach((ch, i) => {
      const id = `chapter${i + 1}`
      const file = `${id}.xhtml`
      entries.push({
        name: `OEBPS/${file}`,
        data: xhtmlDoc(ch.title, `  <h1 class="chapter">${xmlEscape(ch.title)}</h1>\n${proseToXhtml(ch.body)}`),
      })
      manifest.push(`    <item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`)
      spine.push(`    <itemref idref="${id}"/>`)
      navItems.push(
        `      <li><a href="${file}">${xmlEscape(ch.title)}</a></li>`,
      )
      ncxNavPoints.push(`    <navPoint id="np${i + 1}" playOrder="${i + 2}">
      <navLabel><text>${xmlEscape(ch.title)}</text></navLabel>
      <content src="${file}"/>
    </navPoint>`)
    })

    entries.push({
      name: 'OEBPS/nav.xhtml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${xmlEscape(opts.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1 class="no-indent">${xmlEscape(opts.title)}</h1>
    <ol>
${navItems.join('\n')}
    </ol>
  </nav>
</body>
</html>`,
    })
    entries.push({
      name: 'OEBPS/toc.ncx',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uuid}"/>
  </head>
  <docTitle><text>${xmlEscape(opts.title)}</text></docTitle>
  <navMap>
    <navPoint id="np0" playOrder="1">
      <navLabel><text>Title Page</text></navLabel>
      <content src="title.xhtml"/>
    </navPoint>
${ncxNavPoints.join('\n')}
  </navMap>
</ncx>`,
    })
    entries.push({
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pubid" xml:lang="${xmlEscape(opts.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pubid">${uuid}</dc:identifier>
    <dc:title>${xmlEscape(opts.title)}</dc:title>
    <dc:creator>${xmlEscape(opts.author)}</dc:creator>
    <dc:language>${xmlEscape(opts.language)}</dc:language>
    <dc:date>${modified}</dc:date>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine toc="ncx">
${spine.join('\n')}
  </spine>
</package>`,
    })

    const zip = writeZipEntries(entries)
    const dir = join(this.projectRoot, 'exports', 'epub')
    mkdirSync(dir, { recursive: true })
    const stamp = this.clock.isoNow().slice(0, 10)
    const safe = opts.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'book'
    const path = join(dir, `${safe}-${stamp}.epub`)
    writeFileSync(path, zip)
    return { path, chapters: opts.chapters.length, bytes: zip.length }
  }
}

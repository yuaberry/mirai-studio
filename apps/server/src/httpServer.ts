/**
 * The collaboration HTTP server.
 *
 * Transport-free by construction: everything it does goes through PublishStore,
 * which these same tests (and nothing else) exercise. The server is a plain
 * Node http server with NO framework, because the surface is tiny and a
 * dependency-free server is one less thing to audit.
 *
 * ROUTES
 *   GET  /health                       → { ok, name }
 *   GET  /projects                     → PublishCatalog
 *   POST /projects                     → publish (multipart or JSON+base64)
 *   GET  /projects/:id                 → PublishManifest (and counts a download)
 *   GET  /projects/:id/bundle          → the zip bytes
 *   DELETE /projects/:id?token=…       → remove, needs the right token
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { PublishStore } from './publishStore'
import { PublishCatalog, PublishManifest, type PublishManifest as PublishManifestType } from '@mirai/shared'

export interface MiraiServerOptions {
  store: PublishStore
  port?: number
  host?: string
  /** Public name of this registry, shown to browsing clients. */
  serverName?: string
}

const MAX_BODY_BYTES = 8 * 1024 * 1024 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // A router on someone else's LAN: no caching of identity or projects.
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength
    if (total > limit) throw new Error('The request body exceeds the server limit.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** Parses `title`, `author` (JSON) and `bundle` (base64) out of a JSON body. */
interface PublishBody {
  title: string
  tagline?: string
  tags?: string[]
  medium?: string
  author: PublishManifestType['author']
  bundleB64: string
}

export function createMiraiServer(opts: MiraiServerOptions) {
  const name = opts.serverName ?? 'Mirai Studio server'

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    try {
      if (req.method === 'GET' && path === '/health') {
        json(res, 200, { ok: true, name })
        return
      }

      // ---- browse -------------------------------------------------------
      if (req.method === 'GET' && path === '/projects') {
        const catalog = PublishCatalog.parse({
          projects: opts.store.list().map((s) => s.manifest),
          serverName: name,
        })
        json(res, 200, catalog)
        return
      }

      const projectMatch = /^\/projects\/([0-9a-z]{12})(\/bundle)?$/.exec(path)
      if (projectMatch && req.method === 'GET') {
        const id = projectMatch[1]!
        const stored = opts.store.get(id)
        if (!stored) {
          json(res, 404, { error: 'Unknown project.' })
          return
        }
        if (projectMatch[2] === '/bundle') {
          // The download COUNT belongs to the manifest route, not the bytes:
          // a browsing client polls the bundle once per retry.
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' })
          const { createReadStream } = await import('node:fs')
          createReadStream(stored.bundlePath).pipe(res)
          return
        }
        const manifest = opts.store.countDownload(id)
        json(res, 200, PublishManifest.parse(manifest))
        return
      }

      // ---- publish ------------------------------------------------------
      if (req.method === 'POST' && path === '/projects') {
        const raw = await readBody(req)
        let body: PublishBody
        try {
          body = JSON.parse(raw.toString('utf8')) as PublishBody
        } catch {
          json(res, 400, { error: 'The body must be JSON.' })
          return
        }
        if (!body.author || typeof body.author !== 'object') {
          json(res, 400, { error: 'A project must say WHO made it.' })
          return
        }
        if (typeof body.bundleB64 !== 'string') {
          json(res, 400, { error: 'The bundle must be base64.' })
          return
        }
        const bundle = Buffer.from(body.bundleB64, 'base64')
        const published = await opts.store.publish({
          title: body.title,
          tagline: body.tagline,
          tags: body.tags,
          medium: body.medium,
          author: body.author,
          totalBytes: bundle.byteLength,
          bundle,
        })
        json(res, 201, { id: published.id, token: published.token, manifest: published.manifest })
        return
      }

      // ---- delete -------------------------------------------------------
      if (req.method === 'DELETE' && projectMatch) {
        const id = projectMatch[1]!
        const token = url.searchParams.get('token') ?? ''
        const result = opts.store.remove(id, token)
        json(res, result.ok ? 200 : 403, result)
        return
      }

      json(res, 404, { error: 'No such route.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A server must not crash on one bad request.
      json(res, 500, { error: message })
    }
  })

  const listen = (port: number, host: string) =>
    new Promise<{ port: number; host: string }>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        const address = server.address()
        const actual = typeof address === 'object' && address ? address.port : port
        resolve({ port: actual, host })
      })
    })

  return { server, listen, name }
}
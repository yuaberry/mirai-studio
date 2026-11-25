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
 *
 * v2.1 — TEMPO REAL (o celular e o computador na MESMA conta):
 *   GET  /events?since=&token=…        → SSE: eventos desde `since` (e os
 *                                        novos, ao vivo, enquanto conectado)
 *   POST /ops                          → enfileira uma operação (o celular
 *                                        manda; o computador executa)
 *   GET  /ops/pending?for=computer     → a próxima operação da fila
 *   POST /ops/:id/progress             → progresso (0–100) do computador
 *   POST /ops/:id/done                 → resultado (ou falha)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { PublishStore } from './publishStore'
import { AccountStore } from './accountStore'
import { SyncStore } from './syncStore'
import type { SyncEvent } from '@mirai/shared'
import { PublishCatalog, PublishManifest, type PublishManifest as PublishManifestType } from '@mirai/shared'

export interface MiraiServerOptions {
  store: PublishStore
  accounts?: AccountStore
  /** The real-time channel (v2.1). Optional so the legacy surface is unchanged. */
  sync?: SyncStore
  port?: number
  host?: string
  /** Public name of this registry, shown to browsing clients. */
  serverName?: string
}

/** Reads a bearer token from the Authorization header. */
function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
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

      // ---- accounts (v2.1) ------------------------------------------------
      if (req.method === 'POST' && path === '/register') {
        const raw = await readBody(req, 64 * 1024)
        let body: { handle?: string; password?: string }
        try {
          body = JSON.parse(raw.toString('utf8')) as { handle?: string; password?: string }
        } catch {
          json(res, 400, { error: 'The body must be JSON.' })
          return
        }
        if (!opts.accounts) {
          json(res, 501, { error: 'This server has no account database.' })
          return
        }
        try {
          const account = opts.accounts.register(body.handle ?? '', body.password ?? '')
          const { token } = opts.accounts.login(body.handle ?? '', body.password ?? '')
          json(res, 201, { id: account.id, handle: account.handle, token })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }

      if (req.method === 'POST' && path === '/login') {
        const raw = await readBody(req, 64 * 1024)
        let body: { handle?: string; password?: string }
        try {
          body = JSON.parse(raw.toString('utf8')) as { handle?: string; password?: string }
        } catch {
          json(res, 400, { error: 'The body must be JSON.' })
          return
        }
        if (!opts.accounts) {
          json(res, 501, { error: 'This server has no account database.' })
          return
        }
        try {
          const session = opts.accounts.login(body.handle ?? '', body.password ?? '')
          json(res, 200, { token: session.token, handle: session.handle })
        } catch (err) {
          json(res, 401, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }

      if (req.method === 'GET' && path === '/me') {
        const token = bearer(req)
        const account = opts.accounts?.resolve(token)
        if (!account) {
          json(res, 401, { error: 'That session is not valid.' })
          return
        }
        const sessions = opts.accounts!.listSessions(account.handle)
        json(res, 200, {
          handle: account.handle,
          createdAt: account.createdAt,
          sessions: sessions.length,
          projects: opts.store.listByOwner(account.handle),
        })
        return
      }

      if (req.method === 'POST' && path === '/logout') {
        const token = bearer(req)
        json(res, 200, { ok: opts.accounts?.logout(token) ?? false })
        return
      }

      if (req.method === 'POST' && path === '/revoke') {
        const token = bearer(req)
        const account = opts.accounts?.resolve(token)
        if (!account) {
          json(res, 401, { error: 'That session is not valid.' })
          return
        }
        // Revoking means BOTH: every session of this account, and every
        // project it published. A user who says "take my work down" means the
        // work, not just the login.
        const revoked = opts.accounts!.revokeAllSessions(account.handle)
        const projects = opts.store.removeByOwner(account.handle)
        json(res, 200, { ok: true, revokedSessions: revoked, removedProjects: projects.removed })
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
        // The session (when present) becomes the project's OWNER — it is what
        // "revoke my projects" will act on. Publishing without an account
        // still works: that is the legacy token path.
        const session = opts.accounts ? opts.accounts.resolve(bearer(req)) : null
        const published = await opts.store.publish({
          title: body.title,
          tagline: body.tagline,
          tags: body.tags,
          medium: body.medium,
          author: body.author,
          owner: session?.handle ?? null,
          totalBytes: bundle.byteLength,
          bundle,
        })
        opts.sync?.emit({
          type: 'project.published',
          owner: published.manifest.owner ?? undefined,
          projectId: published.id,
          summary: `${published.manifest.title} publicado`,
          data: published.manifest,
        })
        json(res, 201, { id: published.id, token: published.token, manifest: published.manifest })
        return
      }

      // ---- real-time channel (v2.1) -------------------------------------
      if (req.method === 'GET' && path === '/events') {
        const since = Number(url.searchParams.get('since') ?? '0') || 0
        const session = opts.accounts ? opts.accounts.resolve(bearer(req)) : null
        const owner = session?.handle
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write(`retry: 2000\n\n`)
        const send = (event: SyncEvent) => {
          res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
        }
        if (!opts.sync) {
          res.write(': this server has no sync channel\n\n')
          return
        }
        // 1. tudo que aconteceu enquanto o celular estava fora
        for (const event of opts.sync.eventsSince(since, owner)) send(event)
        // 2. e o que acontecer daqui em diante, ao vivo
        const unsubscribe = opts.sync.subscribe((event) => {
          if (owner !== undefined && event.owner !== undefined && event.owner !== owner) return
          send(event)
        })
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000)
        req.on('close', () => {
          clearInterval(keepAlive)
          unsubscribe()
        })
        return
      }

      // ---- operations: the phone SENDS, the computer EXECUTES -------------
      if (req.method === 'POST' && path === '/ops') {
        if (!opts.sync) {
          json(res, 501, { error: 'This server has no operations channel.' })
          return
        }
        const session = opts.accounts ? opts.accounts.resolve(bearer(req)) : null
        const raw = await readBody(req, 1024 * 1024)
        let body: { kind?: string; projectId?: string; payload?: Record<string, unknown> }
        try {
          body = JSON.parse(raw.toString('utf8')) as typeof body
        } catch {
          json(res, 400, { error: 'The body must be JSON.' })
          return
        }
        const kind = body.kind
        if (
          kind !== 'produceEpisode' &&
          kind !== 'renderCamera' &&
          kind !== 'speakShot' &&
          kind !== 'generateFrames' &&
          kind !== 'render' &&
          kind !== 'refreshSnapshot'
        ) {
          json(res, 400, { error: `Unknown operation: ${String(kind)}` })
          return
        }
        if (!body.projectId) {
          json(res, 400, { error: 'An operation must name the project.' })
          return
        }
        const op = opts.sync.enqueue(kind, body.projectId, body.payload ?? {})
        // O evento SAI sempre (um telefone anônimo também precisa ver a fila
        // andar); quando há sessão, é ESCOPADO ao dono — a operação de uma
        // conta não vaza para o feed de outra.
        opts.sync.emit({
          type: 'op.queued',
          opId: op.id,
          owner: session?.handle,
          projectId: op.projectId,
          summary: `${kind} enfileirado`,
        })
        json(res, 201, { opId: op.id, status: op.status })
        return
      }

      if (req.method === 'GET' && path === '/ops/pending') {
        if (!opts.sync) {
          json(res, 501, { error: 'This server has no operations channel.' })
          return
        }
        const op = opts.sync.claimNext()
        json(res, 200, { op })
        return
      }

      const opMatch = /^\/ops\/([0-9a-z_]+)\/(progress|done)$/.exec(path)
      if (opMatch && req.method === 'POST') {
        if (!opts.sync) {
          json(res, 501, { error: 'This server has no operations channel.' })
          return
        }
        const opId = opMatch[1]!
        const raw = await readBody(req, 64 * 1024 * 1024)
        let body: Record<string, unknown> = {}
        try {
          body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
        } catch {
          json(res, 400, { error: 'The body must be JSON.' })
          return
        }
        if (opMatch[2] === 'progress') {
          opts.sync.progressOp(opId, Number(body.progress ?? 0), String(body.message ?? ''))
        } else {
          if (body.error) opts.sync.failOp(opId, String(body.error))
          else opts.sync.completeOp(opId, body.result)
        }
        json(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && path === '/ops') {
        json(res, 200, { ops: opts.sync?.listOps() ?? [] })
        return
      }

      // ---- delete -------------------------------------------------------
      if (req.method === 'DELETE' && projectMatch) {
        const id = projectMatch[1]!
        const token = url.searchParams.get('token') ?? ''
        const result = opts.store.remove(id, token)
        if (result.ok) {
          opts.sync?.emit({ type: 'project.removed', projectId: id, summary: `Projeto ${id} removido` })
        }
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
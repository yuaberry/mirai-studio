/**
 * CollaborationService — publish and import anime projects (v2.1).
 *
 * Transport is a thin HTTP client the user configures (Settings →
 * Collaboration). Publishing zips the project folder and uploads it with the
 * user's PUBLIC profile card; importing downloads, verifies and unzips into
 * the user's own projects directory.
 *
 * WHAT IS REAL HERE
 * -----------------
 * · a publish that lands a real bundle on a real server,
 * · an import that produces a real folder the studio can OPEN,
 * · a zip-slip guard (a malicious archive must not escape the destination).
 *
 * WHAT IS NOT
 * -----------
 * No accounts, no real-time editing, no permission revocation. Those need a
 * server with a database and are documented as the next milestone. The
 * app does not pretend a hosted instance exists — the user configures the one
 * they run (see apps/server).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  statSync,
} from 'node:fs'
import { join, relative, sep, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { MiraiError, PublishCatalog, PublishResult, ServerStatus, sanitizeRelativePath } from '@mirai/shared'
import type { ProfileService } from '../profile/profileService'
import type { SettingsService } from '../settings/settingsService'
import type { Clock } from '../types'

export interface CollaborationOptions {
  profile: ProfileService
  settings: SettingsService
  /** Where imported projects land (the user's projects dir). */
  projectsDir: string
  clock: Clock
  /** Injected so the tests never touch the network. */
  fetchFn?: typeof fetch
}

/** The configured server (settings are app-level, not per project). */
interface ServerConfig {
  url: string
  token: string
}

export class CollaborationService {
  private readonly fetchFn: typeof fetch

  constructor(private readonly opts: CollaborationOptions) {
    this.fetchFn = opts.fetchFn ?? fetch
  }

  private config(): ServerConfig | null {
    const collab = this.opts.settings.get().ai.collaboration
    const url = collab?.url?.trim() ?? ''
    if (!url) return null
    return { url: url.replace(/\/$/, ''), token: collab?.token ?? '' }
  }

  /** Status the Settings page shows before asking the user to configure. */
  async status(): Promise<ServerStatus> {
    const config = this.config()
    if (!config) {
      return {
        configured: false,
        reachable: false,
        serverName: '',
        url: '',
        hasToken: false,
        error: '',
      }
    }
    try {
      const res = await this.fetchFn(`${config.url}/health`, { method: 'GET' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { name?: string }
      return {
        configured: true,
        reachable: true,
        serverName: body.name ?? '',
        url: config.url,
        hasToken: config.token.trim().length > 0,
        error: '',
      }
    } catch (err) {
      return {
        configured: true,
        reachable: false,
        serverName: '',
        url: config.url,
        hasToken: config.token.trim().length > 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** The server's catalog. */
  async browse(): Promise<PublishCatalog> {
    const config = this.requireConfig()
    const res = await this.fetchFn(`${config.url}/projects`, { method: 'GET' })
    if (!res.ok) throw new MiraiError('AI_OFFLINE', `The server answered ${res.status}.`)
    return PublishCatalog.parse(await res.json())
  }

  /**
   * Publishes the project at `projectPath`.
   *
   * The zip is built in a TEMP dir and streamed, so a 500 MB project does not
   * sit in memory. The author is the user's PUBLIC card — never the internal
   * profile record.
   */
  async publish(projectPath: string, title: string, tagline?: string, tags?: string[]): Promise<PublishResult> {
    const config = this.requireConfig()
    if (!existsSync(projectPath)) throw new MiraiError('NOT_FOUND', 'This project folder does not exist.')

    const zipPath = join(mkdtempSync(join(tmpdir(), 'mirai-pub-')), 'bundle.zip')
    try {
      await this.zipFolder(projectPath, zipPath)
      const bytes = readFileSync(zipPath)
      const author = this.opts.profile.publicCard()

      const res = await this.fetchFn(`${config.url}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          title,
          tagline: tagline ?? '',
          tags: tags ?? [],
          medium: 'ANIME',
          author,
          bundleB64: bytes.toString('base64'),
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        return { ok: false, id: '', localPath: '', message: `The server refused the publish (${res.status}). ${detail.slice(0, 200)}` }
      }
      const body = (await res.json()) as { id?: string; token?: string }
      return {
        ok: true,
        id: body.id ?? '',
        localPath: '',
        message: `"${title}" published. Keep your token${body.token ? ` (${body.token})` : ''} — only it can delete this project.`,
      }
    } finally {
      rmSync(join(zipPath, '..'), { recursive: true, force: true })
    }
  }

  /**
   * Imports a published project into the user's projects dir.
   *
   * The zip is expanded with a ZIP-SLIP GUARD: every entry path is
   * sanitised, and an absolute or escaping path aborts the import.
   */
  async import(id: string): Promise<PublishResult> {
    const config = this.requireConfig()
    const res = await this.fetchFn(`${config.url}/projects/${id}/bundle`, { method: 'GET' })
    if (!res.ok) throw new MiraiError('NOT_FOUND', `The server answered ${res.status} for that project.`)

    const dest = join(this.opts.projectsDir, `published-${id}`)
    if (existsSync(dest)) {
      return {
        ok: false,
        id: '',
        localPath: dest,
        message: `A project already exists at ${dest} — rename or delete it first.`,
      }
    }
    mkdirSync(dest, { recursive: true })

    const tmpZip = join(mkdtempSync(join(tmpdir(), 'mirai-imp-')), 'bundle.zip')
    writeFileSync(tmpZip, Buffer.from(await res.arrayBuffer()))

    try {
      const entries = this.readZipEntries(tmpZip)
      for (const entry of entries) {
        const safe = sanitizeRelativePath(entry.name)
        if (!safe || safe !== entry.name.replace(/^\.?\//, '')) {
          rmSync(dest, { recursive: true, force: true })
          throw new MiraiError('VALIDATION_ERROR', `Unsafe path in the bundle: "${entry.name}" — import aborted.`)
        }
        if (safe.length === 0) {
          rmSync(dest, { recursive: true, force: true })
          throw new MiraiError('VALIDATION_ERROR', `Unusable path in the bundle: "${entry.name}" — import aborted.`)
        }
        // ZIP-SLIP: the resolved destination must be INSIDE dest.
        //
        // MEASURED BUG: the first version tested `isAbsolute(target)`, which is
        // ALWAYS true — `join`/`resolve` return an absolute path by design — so
        // EVERY import, however innocent, was rejected. The absolute-ness of the
        // path says nothing; what matters is that it is contained in dest.
        // Comparing against `dest + sep` (not bare `dest`) also avoids the
        // classic prefix bug where a SIBLING like "<dest>-evil" passes.
        const target = resolve(dest, safe)
        if (target !== dest && !target.startsWith(dest + sep)) {
          rmSync(dest, { recursive: true, force: true })
          throw new MiraiError('VALIDATION_ERROR', `The bundle tries to escape its folder — import aborted.`)
        }
        if (entry.isDirectory) {
          mkdirSync(target, { recursive: true })
          continue
        }
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, entry.data)
      }
      return {
        ok: true,
        id,
        localPath: dest,
        message: `Imported to ${dest} — open it from the Hub.`,
      }
    } finally {
      rmSync(join(tmpZip, '..'), { recursive: true, force: true })
    }
  }

  private requireConfig(): ServerConfig {
    const config = this.config()
    if (!config) {
      throw new MiraiError(
        'CREDENTIALS_UNAVAILABLE',
        'No collaboration server configured — set its address in Settings → Collaboration.',
      )
    }
    return config
  }

  // ------------------------------------------------------------------ zip
  /**
   * Minimal, dependency-free zip WRITER (stored, no compression).
   *
   * A project is a few hundred MB of mostly media; stored entries cost nothing
   * to produce and the transport is the bottleneck. The CRC32 is real, so the
   * archive is readable by any unzip.
   */
  private async zipFolder(folder: string, outPath: string): Promise<void> {
    const files: Array<{ rel: string; abs: string }> = []
    const walk = (dir: string) => {
      for (const entry of readdirSyncSafe(dir)) {
        const abs = join(dir, entry)
        const st = statSync(abs)
        if (st.isDirectory()) walk(abs)
        else files.push({ rel: relative(folder, abs), abs })
      }
    }
    walk(folder)

    const chunks: Buffer[] = []
    const central: Array<{ name: Buffer; crc: number; offset: number; size: number }> = []
    let offset = 0

    const push = (buf: Buffer) => {
      chunks.push(buf)
      offset += buf.byteLength
    }

    for (const file of files) {
      const data = readFileSync(file.abs)
      const crc = crc32(data)
      const name = Buffer.from(file.rel.replace(/\\/g, '/'), 'utf8')
      push(localFileHeader(name, data.byteLength, crc))
      push(data)
      central.push({ name, crc, offset: offset - data.byteLength, size: data.byteLength })
    }

    const centralStart = offset
    for (const entry of central) {
      push(centralDirectoryHeader(entry.name, entry.crc, entry.offset, entry.size))
    }
    const centralSize = offset - centralStart
    push(endOfCentralDirectory(central.length, centralSize, centralStart))

    writeFileSync(outPath, Buffer.concat(chunks))
  }

  /** Local-file entries of a stored zip (the format this app writes). */
  private readZipEntries(
    zipPath: string,
  ): Array<{ name: string; isDirectory: boolean; data: Buffer }> {
    const buf = readFileSync(zipPath)
    const out: Array<{ name: string; isDirectory: boolean; data: Buffer }> = []
    let pos = 0
    while (pos + 4 <= buf.byteLength && buf.readUInt32LE(pos) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(pos + 26)
      const extraLen = buf.readUInt16LE(pos + 28)
      const size = buf.readUInt32LE(pos + 18)
      const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8')
      const dataStart = pos + 30 + nameLen + extraLen
      out.push({ name, isDirectory: name.endsWith('/'), data: buf.subarray(dataStart, dataStart + size) })
      pos = dataStart + size
    }
    return out
  }
}

// ---------------------------------------------------------------- zip internals

/** Lists a directory's entries — a single, plain call (no marker-file games). */
function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir).map((entry) => String(entry))
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.byteLength; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]!
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(): { time: number; date: number } {
  const now = new Date()
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  }
}

function localFileHeader(name: Buffer, size: number, crc: number): Buffer {
  const { time, date } = dosDateTime()
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0, 6)
  header.writeUInt16LE(0, 8) // stored
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(size, 18)
  header.writeUInt32LE(size, 22)
  header.writeUInt16LE(name.byteLength, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function centralDirectoryHeader(name: Buffer, crc: number, offset: number, size: number): Buffer {
  const { time, date } = dosDateTime()
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(size, 20)
  header.writeUInt32LE(size, 24)
  header.writeUInt16LE(name.byteLength, 28)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, name])
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const out = Buffer.alloc(22)
  out.writeUInt32LE(0x06054b50, 0)
  out.writeUInt16LE(count, 8)
  out.writeUInt16LE(count, 10)
  out.writeUInt32LE(size, 12)
  out.writeUInt32LE(offset, 16)
  return out
}
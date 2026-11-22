/**
 * CollaborationService — publish and import, over a FAKE server.
 *
 * The client is tested against an in-memory server that behaves exactly like
 * apps/server, because that is the contract: publish → browse → import must
 * round-trip, and a malicious bundle must not escape the destination folder.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CollaborationService } from '@mirai/core'
import { sanitizeRelativePath } from '@mirai/shared'
import { PublishStore } from '../src/publishStore'
import { createMiraiServer } from '../src/httpServer'

const AUTHOR_CARD = {
  displayName: 'Zey Hashimoto',
  socialName: '',
  companyName: 'Hashimoto Studio',
  maker: 'studio' as const,
  pronouns: 'she/her',
  bio: 'Makes fan anime.',
  avatarPath: '',
}

/** The in-memory registry the client is tested against. */
async function bootServer() {
  const root = mkdtempSync(join(tmpdir(), 'mirai-csrv-'))
  const store = new PublishStore({ root })
  const { server, listen } = createMiraiServer({ store, port: 0, serverName: 'Fake registry' })
  const { port } = await listen(0, '127.0.0.1')
  return { base: `http://127.0.0.1:${port}`, store, close: () => new Promise<void>((r) => server.close(() => r())), root }
}

function makeService(projectsDir: string, base: string) {
  const settingsService = {
    get: () => ({ ai: { collaboration: { url: base, token: '' } } }),
  } as never
  const profileService = {
    publicCard: () => AUTHOR_CARD,
  } as never
  return new CollaborationService({
    profile: profileService,
    settings: settingsService,
    projectsDir,
    clock: { isoNow: () => new Date().toISOString(), now: () => new Date() },
    fetchFn: fetch,
  })
}

/** A fake project folder with a database inside. */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-proj-'))
  writeFileSync(join(dir, 'project.mirai'), '{"name":"Malfoid EP1"}')
  mkdirSync(join(dir, 'database'), { recursive: true })
  writeFileSync(join(dir, 'database', 'project.sqlite'), 'fake sqlite bytes')
  mkdirSync(join(dir, 'images'), { recursive: true })
  writeFileSync(join(dir, 'images', 'frame.png'), 'fake png bytes')
  return dir
}

describe('CollaborationService (against a real fake server)', () => {
  let srv: Awaited<ReturnType<typeof bootServer>> | null = null
  let projectsDir = ''
  let projectDir = ''
  const cleanups: string[] = []

  beforeEach(() => {
    srv = null
    projectsDir = mkdtempSync(join(tmpdir(), 'mirai-dest-'))
    projectDir = makeProject()
    cleanups.push(projectsDir, projectDir)
  })
  afterEach(async () => {
    if (srv) {
      await srv.close()
      rmSync(srv.root, { recursive: true, force: true })
    }
    for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('publishes the CURRENT project and reports the server', async () => {
    srv = await bootServer()
    const service = makeService(projectsDir, srv.base)

    const result = await service.publish(projectDir, 'Malfoid EP1', 'A Draco genderbend anime', ['romance'])

    expect(result.ok).toBe(true)
    expect(result.message).toContain('Malfoid EP1')
    expect(result.message).toContain('token')

    const catalog = await service.browse()
    expect(catalog.projects).toHaveLength(1)
    expect(catalog.projects[0]!.author.companyName).toBe('Hashimoto Studio')
    expect(catalog.projects[0]!.title).toBe('Malfoid EP1')
  })

  it('imports a published project into a REAL, OPENABLE folder', async () => {
    srv = await bootServer()
    const service = makeService(projectsDir, srv.base)
    await service.publish(projectDir, 'Round trip', '', [])
    const published = (await service.browse()).projects[0]!

    const imported = await service.import(published.id)

    expect(imported.ok).toBe(true)
    // The folder exists and has the project's real files.
    expect(existsSync(join(imported.localPath, 'project.mirai'))).toBe(true)
    expect(existsSync(join(imported.localPath, 'database', 'project.sqlite'))).toBe(true)
    expect(existsSync(join(imported.localPath, 'images', 'frame.png'))).toBe(true)
    // Each file's CONTENT survived, not just its name.
    expect(readFileSync(join(imported.localPath, 'images', 'frame.png'), 'utf8')).toBe('fake png bytes')
    cleanups.push(imported.localPath)
  })

  it('refuses an import that would land on top of an existing project', async () => {
    srv = await bootServer()
    const service = makeService(projectsDir, srv.base)
    await service.publish(projectDir, 'Twins', '', [])
    const id = (await service.browse()).projects[0]!.id

    await service.import(id)
    const second = await service.import(id)

    expect(second.ok).toBe(false)
    expect(second.message).toMatch(/already exists/)
  })

  it('surfaces the server state honestly when none is configured', async () => {
    const settingsService = { get: () => ({ ai: { collaboration: { url: '', token: '' } } }) } as never
    const service = new CollaborationService({
      profile: { publicCard: () => AUTHOR_CARD } as never,
      settings: settingsService,
      projectsDir,
      clock: { isoNow: () => new Date().toISOString(), now: () => new Date() },
      fetchFn: fetch,
    })

    const status = await service.status()
    expect(status.configured).toBe(false)
    expect(status.reachable).toBe(false)
    // And the error says HOW to fix it, not just "no".
    await expect(service.browse()).rejects.toThrow(/Settings → Collaboration/)
  })

  it('the zip-slip guard rejects the classic escape vectors', () => {
    // The guard is pure and exported, so it is proven directly rather than
    // through a hand-crafted archive the server would never serve anyway.
    for (const evil of ['../escape.txt', '../../etc/passwd', 'a/../../b', '/etc/passwd', '..']) {
      const safe = sanitizeRelativePath(evil)
      // Nothing escapes: no leading '..' and no absolute path survives.
      expect(safe.startsWith('..')).toBe(false)
      expect(safe.includes('../')).toBe(false)
      expect(safe.startsWith('/')).toBe(false)
    }
    // And a normal path is untouched.
    expect(sanitizeRelativePath('database/project.sqlite')).toBe('database/project.sqlite')
  })

  it('reports an unreachable server instead of hanging or crashing', async () => {
    const service = makeService(projectsDir, 'http://127.0.0.1:1')
    const status = await service.status()
    expect(status.configured).toBe(true)
    expect(status.reachable).toBe(false)
    expect(status.error.length).toBeGreaterThan(0)
  })
})
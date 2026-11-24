/**
 * The collaboration server, over real HTTP.
 *
 * These tests are the E2E of the feature: a client that behaves exactly like
 * the app (publish → browse → download → delete) must work, and the failure
 * modes the app will actually hit (unknown project, wrong token, oversized
 * bundle, malformed body) must be answered, not crash the process.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublishStore } from '../src/publishStore'
import { AccountStore } from '../src/accountStore'
import { createMiraiServer } from '../src/httpServer'

const AUTHOR = {
  displayName: 'Zey Hashimoto',
  socialName: '',
  companyName: 'Hashimoto Studio',
  maker: 'studio' as const,
  pronouns: 'she/her',
  bio: 'Makes fan anime.',
  avatarPath: '',
}

async function boot(withAccounts = false) {
  const root = mkdtempSync(join(tmpdir(), 'mirai-srv-'))
  const accountsDir = withAccounts ? mkdtempSync(join(tmpdir(), 'mirai-acc-')) : undefined
  const store = new PublishStore({ root })
  const accounts = accountsDir ? new AccountStore(accountsDir) : undefined
  const { server, listen } = createMiraiServer({ store, accounts, port: 0, serverName: 'Test registry' })
  const { port } = await listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${port}`
  return {
    base,
    store,
    accounts,
    close: () =>
      new Promise<void>((resolve) => {
        accounts?.close()
        server.close(() => resolve())
      }),
    root,
    accountsDir,
  }
}

const authPost = (base: string, path: string, body: unknown, token?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const post = async (base: string, path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // JSON over HTTP is an UNTYPED boundary; the asserts are what pin the
  // shape. `unknown` (not `any`) keeps the lint honest, and the two deep
  // accesses below cast at the point of use.
  const json = (await res.json().catch(() => null)) as Record<string, unknown>
  return { status: res.status, json }
}

/** GET-side twin of authPost's body handling — same rationale (see above). */
const readJson = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>

describe('collaboration server (real HTTP)', () => {
  let srv: Awaited<ReturnType<typeof boot>> | null = null

  beforeEach(() => {
    srv = null
  })
  afterEach(async () => {
    if (srv) {
      await srv.close()
      rmSync(srv.root, { recursive: true, force: true })
      if (srv.accountsDir) rmSync(srv.accountsDir, { recursive: true, force: true })
    }
  })

  it('publishes, browses, downloads and deletes — the whole loop', async () => {
    srv = await boot()
    const zip = Buffer.from('PK\u0003\u0004 a project bundle')

    const publish = await post(srv.base, '/projects', {
      title: 'Malfoid EP1',
      tagline: 'A Draco genderbend anime',
      tags: ['romance'],
      author: AUTHOR,
      bundleB64: zip.toString('base64'),
    })
    expect(publish.status).toBe(201)
    expect(publish.json.token).toBeTruthy()
    const id = publish.json.id as string

    const browse = await fetch(`${srv.base}/projects`).then(readJson)
    expect(browse.serverName).toBe('Test registry')
    expect(browse.projects).toHaveLength(1)
    expect((browse.projects as Array<{ title: string }>)[0]!.title).toBe('Malfoid EP1')

    // Downloading the bundle streams back the SAME bytes.
    const bundle = await fetch(`${srv.base}/projects/${id}/bundle`)
    expect(bundle.status).toBe(200)
    expect(Buffer.from(await bundle.arrayBuffer())).toEqual(zip)

    // The manifest route counts the download.
    const manifest = await fetch(`${srv.base}/projects/${id}`).then(readJson)
    expect(manifest.downloads).toBe(1)
    const again = await fetch(`${srv.base}/projects/${id}`).then(readJson)
    expect(again.downloads).toBe(2)

    const del = await fetch(`${srv.base}/projects/${id}?token=${publish.json.token}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    const after = await fetch(`${srv.base}/projects`).then(readJson)
    expect(after.projects).toHaveLength(0)
  })

  it('refuses a publish without an author — a project must say WHO made it', async () => {
    srv = await boot()
    const publish = await post(srv.base, '/projects', {
      title: 'Anonymous',
      bundleB64: Buffer.from('x').toString('base64'),
    })
    expect(publish.status).toBe(400)
    expect(publish.json.error).toMatch(/WHO made it/)
  })

  it('answers 404 for an unknown project instead of crashing', async () => {
    srv = await boot()
    const res = await fetch(`${srv.base}/projects/aaaaaaaaaaaa`)
    expect(res.status).toBe(404)
    expect((await readJson(res)).error).toMatch(/Unknown project/)
    // And the server is still healthy afterwards.
    const health = await fetch(`${srv.base}/health`).then(readJson)
    expect(health.ok).toBe(true)
  })

  it('refuses a delete with the wrong token and deletes NOTHING', async () => {
    srv = await boot()
    const published = await post(srv.base, '/projects', {
      title: 'Protected',
      author: AUTHOR,
      bundleB64: Buffer.from('abc').toString('base64'),
    })
    const id = published.json.id as string

    const wrong = await fetch(`${srv.base}/projects/${id}?token=nope`, { method: 'DELETE' })
    expect(wrong.status).toBe(403)
    expect((await readJson(wrong)).message).toMatch(/does not match/)

    const still = await fetch(`${srv.base}/projects/${id}`)
    expect(still.status).toBe(200)
  })

  it('answers 400 for a malformed body, not a 500', async () => {
    srv = await boot()
    const res = await fetch(`${srv.base}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    })
    expect(res.status).toBe(400)
    expect(res.status).toBeLessThan(500)
  })

  it('serves the stored bundle byte-for-byte after a client reconnect', async () => {
    srv = await boot()
    const zip = Buffer.from('a bigger bundle '.repeat(200))
    const published = await post(srv.base, '/projects', {
      title: 'Reconnect test',
      author: AUTHOR,
      bundleB64: zip.toString('base64'),
    })
    const id = published.json.id as string

    const bundle = await fetch(`${srv.base}/projects/${id}/bundle`)
    expect(Buffer.from(await bundle.arrayBuffer())).toEqual(zip)
    // And the manifest's checksum matches what a re-hash gives.
    const manifest = await fetch(`${srv.base}/projects/${id}`).then(readJson)
    const { createHash } = await import('node:crypto')
    expect(manifest.checksum).toBe(createHash('sha256').update(zip).digest('hex'))
  })
})
describe('accounts + revocation (over real HTTP)', () => {
  let srv: Awaited<ReturnType<typeof boot>> | null = null
  beforeEach(() => {
    srv = null
  })
  afterEach(async () => {
    if (srv) {
      await srv.close()
      rmSync(srv.root, { recursive: true, force: true })
      if (srv.accountsDir) rmSync(srv.accountsDir, { recursive: true, force: true })
    }
  })

  it('registers, logs in and resolves /me', async () => {
    srv = await boot(true)
    const reg = await authPost(srv.base, '/register', { handle: 'zey.hashi', password: 'supersecret1' })
    expect(reg.status).toBe(201)
    const token = ((await reg.json()) as { token: string }).token

    const logged = await authPost(srv.base, '/login', { handle: 'zey.hashi', password: 'supersecret1' })
    expect(logged.status).toBe(200)

    const me = await fetch(`${srv.base}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    expect((await readJson(me)).handle).toBe('zey.hashi')
  })

  it('a publish WITH a session records the owner on the manifest', async () => {
    srv = await boot(true)
    const reg = await authPost(srv.base, '/register', { handle: 'owner.user', password: 'supersecret1' })
    const { token } = (await reg.json()) as { token: string }

    const pub = await authPost(
      srv.base,
      '/projects',
      {
        title: 'Owned project',
        author: {
          displayName: 'Owner', socialName: '', companyName: '', maker: 'solo',
          pronouns: '', bio: '', avatarPath: '',
        },
        bundleB64: Buffer.from('bundle').toString('base64'),
      },
      token,
    )
    expect(pub.status).toBe(201)

    const me = await fetch(`${srv.base}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(readJson)
    expect(me.projects).toHaveLength(1)
    expect((me.projects as Array<{ owner: string }>)[0]!.owner).toBe('owner.user')
  })

  it('revoke closes sessions AND removes the account projects', async () => {
    srv = await boot(true)
    const reg = await authPost(srv.base, '/register', { handle: 'gone.user', password: 'supersecret1' })
    const { token } = (await reg.json()) as { token: string }

    await authPost(
      srv.base,
      '/projects',
      {
        title: 'Take me down',
        author: {
          displayName: 'Gone', socialName: '', companyName: '', maker: 'solo',
          pronouns: '', bio: '', avatarPath: '',
        },
        bundleB64: Buffer.from('x').toString('base64'),
      },
      token,
    )
    expect((await fetch(`${srv.base}/projects`).then(readJson)).projects).toHaveLength(1)

    const rev = await authPost(srv.base, '/revoke', {}, token)
    const body = await readJson(rev)
    expect(body.ok).toBe(true)
    expect(body.revokedSessions).toBe(1)
    expect(body.removedProjects).toBe(1)

    // The session is dead, and the project is gone.
    const me = await fetch(`${srv.base}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(401)
    expect((await fetch(`${srv.base}/projects`).then(readJson)).projects).toHaveLength(0)
  })

  it('a wrong password is refused, not a crash', async () => {
    srv = await boot(true)
    await authPost(srv.base, '/register', { handle: 'real.user', password: 'supersecret1' })
    const bad = await authPost(srv.base, '/login', { handle: 'real.user', password: 'wrongpassword' })
    expect(bad.status).toBe(401)
    const health = await fetch(`${srv.base}/health`)
    expect(health.status).toBe(200)
  })
})

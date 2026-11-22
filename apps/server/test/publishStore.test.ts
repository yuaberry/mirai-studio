/**
 * PublishStore — the collaboration registry, on disk.
 *
 * The rules that matter, all exercised without HTTP:
 *   1. A publish lands a REAL bundle and a manifest; the checksum is the
 *      SERVER's measurement, not the client's claim.
 *   2. An oversized bundle is rejected and leaves NO directory behind — a
 *      partial upload must never become a downloadable project.
 *   3. Delete needs the right token, and a WRONG token deletes nothing.
 *   4. A malformed manifest never breaks the listing.
 *   5. Ids are server-generated and charset-limited (no path escape).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PublishStore } from '../src/publishStore'
import { createHash } from 'node:crypto'

const AUTHOR = {
  displayName: 'Zey Hashimoto',
  socialName: '',
  companyName: 'Hashimoto Studio',
  maker: 'studio' as const,
  pronouns: 'she/her',
  bio: 'Makes fan anime.',
  avatarPath: '',
}

function makeStore(maxBundleBytes = 1024 * 1024) {
  const root = mkdtempSync(join(tmpdir(), 'mirai-pub-'))
  return { store: new PublishStore({ root, maxBundleBytes }), root }
}

describe('PublishStore', () => {
  let dirs: Array<{ root: string }> = []
  beforeEach(() => {
    dirs = []
  })
  afterEach(() => {
    for (const d of dirs) rmSync(d.root, { recursive: true, force: true })
  })

  it('publishes a real bundle and a manifest with the SERVER checksum', async () => {
    const made = makeStore()
    dirs.push(made)
    const zip = Buffer.from('PK\u0003\u0004 a fake project bundle')

    const { id, token, manifest } = await made.store.publish({
      title: 'Malfoid EP1',
      tagline: 'A Draco genderbend anime',
      tags: ['romance', 'fan'],
      author: AUTHOR,
      totalBytes: zip.byteLength,
      bundle: zip,
    })

    expect(id).toMatch(/^[0-9a-z]{12}$/)
    expect(token.length).toBeGreaterThan(20)
    expect(manifest.title).toBe('Malfoid EP1')
    expect(manifest.author.companyName).toBe('Hashimoto Studio')
    // The checksum is what the server MEASURED, not what the client claimed.
    const expected = createHash('sha256').update(zip).digest('hex')
    expect(manifest.checksum).toBe(expected)
    expect(manifest.totalBytes).toBe(zip.byteLength)
    expect(manifest.downloads).toBe(0)

    const listed = made.store.list()
    expect(listed.length).toBe(1)
    expect(listed[0]!.manifest.id).toBe(id)
    expect(readFileSync(made.store.get(id)!.bundlePath)).toEqual(zip)
  })

  it('rejects an oversized bundle and leaves NOTHING on disk', async () => {
    const made = makeStore(1024)
    dirs.push(made)
    const zip = Buffer.alloc(4096)

    await expect(
      made.store.publish({ title: 'Too big', author: AUTHOR, totalBytes: zip.byteLength, bundle: zip }),
    ).rejects.toThrow(/server allows 0 MB/)

    // No orphan directory, no partial bundle.
    expect(existsSync(made.root)).toBe(true)
    const entries = (await import('node:fs')).readdirSync(made.root)
    expect(entries.length).toBe(0)
  })

  it('removes with the right token, and refuses a WRONG one', async () => {
    const made = makeStore()
    dirs.push(made)
    const zip = Buffer.from('bundle')
    const { id, token } = await made.store.publish({
      title: 'Deletable',
      author: AUTHOR,
      totalBytes: zip.byteLength,
      bundle: zip,
    })

    const wrong = await made.store.remove(id, `${token.slice(0, -1)}x`)
    expect(wrong.ok).toBe(false)
    expect(wrong.message).toMatch(/does not match/)
    expect(made.store.get(id)).not.toBeNull()

    const right = await made.store.remove(id, token)
    expect(right.ok).toBe(true)
    expect(right.message).toContain('Deletable')
    expect(made.store.get(id)).toBeNull()
  })

  it('a malformed manifest never breaks the listing', async () => {
    const made = makeStore()
    dirs.push(made)
    await made.store.publish({ title: 'Good', author: AUTHOR, totalBytes: 3, bundle: Buffer.from('abc') })
    // A project folder without a valid manifest (a crash mid-write, say).
    mkdirSync(join(made.root, 'broken00000'), { recursive: true })
    writeFileSync(join(made.root, 'broken00000', 'manifest.json'), '{ not json')

    const listed = made.store.list()
    expect(listed.length).toBe(1)
    expect(listed[0]!.manifest.title).toBe('Good')
  })

  it('refuses to look up an id that is not the server charset', async () => {
    const made = makeStore()
    dirs.push(made)
    for (const bad of ['../etc', 'ABC12345678', 'short', 'aaaa bbbb']) {
      expect(made.store.get(bad)).toBeNull()
    }
  })

  it('counts downloads — the only social signal the app shows', async () => {
    const made = makeStore()
    dirs.push(made)
    await made.store.publish({ title: 'Imported a lot', author: AUTHOR, totalBytes: 3, bundle: Buffer.from('xyz') })
    const id = made.store.list()[0]!.manifest.id

    made.store.countDownload(id)
    const manifest = made.store.countDownload(id)
    expect(manifest!.downloads).toBe(2)
  })

  it('publishes from a STREAM, not only a buffer', async () => {
    const made = makeStore()
    dirs.push(made)
    const zip = Buffer.from('a streamed project bundle with several chunks')
    const chunks: Buffer[] = []
    for (let i = 0; i < zip.length; i += 9) chunks.push(zip.subarray(i, i + 9))
    const stream = (async function* () {
      for (const chunk of chunks) yield chunk
    })()

    const { manifest } = await made.store.publish({
      title: 'Streamed',
      author: AUTHOR,
      totalBytes: zip.byteLength,
      bundle: stream,
    })
    // A streamed upload must land EXACTLY the same bytes on disk.
    expect(manifest.totalBytes).toBe(zip.byteLength)
    const stored = made.store.get(manifest.id)!
    expect(readFileSync(stored.bundlePath)).toEqual(zip)
  })
})
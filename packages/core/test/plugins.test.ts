/**
 * Phase 9 — plugin registry: manifest validation (strict), seeding,
 * enable/disable persistence, folder installation, permission surface.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { PluginRegistry } from '../src/plugins/pluginRegistry'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { APP_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const root = join(tmpdir(), `mirai-plugin-${name}-${Date.now()}`)
  const db = openDatabase(join(root, 'app.sqlite'))
  runMigrations(db, APP_DB_MIGRATIONS)
  const pluginsDir = join(root, 'plugins')
  const registry = new PluginRegistry(db, makeClock(), pluginsDir)
  return { root, db, pluginsDir, registry }
}

describe('PluginRegistry', () => {
  it('seeds the two bundled example plugins on first run (idempotent)', () => {
    const env = makeEnv('seed')
    const list = env.registry.list()
    const ids = list.map((p) => p.manifest.id)
    expect(ids).toContain('starter-commands')
    expect(ids).toContain('prompt-pack-manga')
    // Contributions parsed and exposed.
    const starter = list.find((p) => p.manifest.id === 'starter-commands')!
    expect(starter.manifest.commands.length).toBe(2)
    expect(starter.manifest.permissions).toContain('READ')
    const pack = list.find((p) => p.manifest.id === 'prompt-pack-manga')!
    expect(pack.manifest.prompts.length).toBe(2)
    expect(pack.manifest.permissions).toEqual(['SUGGEST'])
    // Files exist on disk.
    expect(existsSync(join(env.pluginsDir, 'starter-commands', 'manifest.json'))).toBe(true)
    expect(existsSync(join(env.pluginsDir, 'starter-commands', 'index.js'))).toBe(true)
  })

  it('persists enable/disable across instances', () => {
    const env = makeEnv('enable')
    const enabled = env.registry.setEnabled('starter-commands', true)
    expect(enabled.enabled).toBe(true)
    // New registry instance (same db + dir) reads the same state.
    const reopened = new PluginRegistry(env.db, makeClock(), env.pluginsDir)
    expect(reopened.get('starter-commands').enabled).toBe(true)
    reopened.setEnabled('starter-commands', false)
    expect(reopened.get('starter-commands').enabled).toBe(false)
  })

  it('rejects invalid manifests (locked, listed with errors)', () => {
    const env = makeEnv('invalid')
    const bad = join(env.pluginsDir, 'bad-plugin')
    mkdirSync(bad, { recursive: true })
    writeFileSync(
      join(bad, 'manifest.json'),
      JSON.stringify({ id: 'bad plugin!', name: '', version: 'one' }),
    )
    const listed = env.registry.list().find((p) => p.manifest.id === 'bad-plugin')
    expect(listed).toBeDefined()
    expect(listed!.enabled).toBe(false)
    expect(listed!.errors.length).toBeGreaterThan(0)
    // Locked plugins can't be enabled.
    expect(() => env.registry.setEnabled('bad-plugin', true)).toThrow(MiraiError)
  })

  it('installs a valid plugin folder (and reinstalls idempotently)', () => {
    const env = makeEnv('install')
    const source = join(env.root, 'my-provider')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'manifest.json'),
      JSON.stringify({
        id: 'my-provider',
        name: 'My Provider Adapter',
        version: '1.2.3',
        author: 'Community',
        description: 'Declares a community chat provider.',
        permissions: ['SUGGEST'],
        providers: [
          { id: 'chat-x', label: 'Community Chat X', kind: 'chat', baseUrl: 'https://api.example.test/v1', model: 'community/model' },
        ],
      }),
    )
    writeFileSync(join(source, 'index.js'), 'module.exports = {}')
    const installed = env.registry.installFromFolder(source)
    expect(installed.manifest.version).toBe('1.2.3')
    expect(installed.manifest.providers[0]!.model).toBe('community/model')
    // Re-install replaces cleanly.
    const again = env.registry.installFromFolder(source)
    expect(again.manifest.id).toBe('my-provider')

    // Missing manifest → actionable error.
    const empty = join(env.root, 'empty')
    mkdirSync(empty, { recursive: true })
    expect(() => env.registry.installFromFolder(empty)).toThrow(/manifest\.json/)
  })

  it('deletes an installed plugin (folder + enable state)', () => {
    const env = makeEnv('delete')
    const before = env.registry.get('prompt-pack-manga')
    env.registry.setEnabled('prompt-pack-manga', true)
    env.registry.delete('prompt-pack-manga')
    expect(() => env.registry.get('prompt-pack-manga')).toThrow(MiraiError)
    expect(existsSync(before.folder)).toBe(false)
    // Re-seeding does NOT resurrect deleted examples (seed runs once).
    const reopened = new PluginRegistry(env.db, makeClock(), env.pluginsDir)
    expect(() => reopened.get('prompt-pack-manga')).toThrow(MiraiError)
  })
})

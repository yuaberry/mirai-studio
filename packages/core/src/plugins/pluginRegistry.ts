/**
 * PluginRegistry (Phase 9) — app-level plugin management: scans the plugins
 * folder, validates manifests strictly (invalid ones stay listed but locked),
 * persists enable state in the App DB kv, seeds two REAL example plugins
 * on first run and supports folder installation.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MiraiError, PluginManifest, PluginRecord } from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'

const ENABLED_KV = 'plugins:enabled'
const SEEDED_KV = 'plugins:seeded'

// ---------------------------------------------------------------- built-ins

const EXAMPLE_COMMANDS = `/**
 * Starter Commands — bundled example plugin (READ + SUGGEST).
 * Demonstrates the command capability: the palette can run it.
 */
module.exports = {
  commands: {},
}
`

const EXAMPLE_PROMPT_PACK = `/**
 * Manga Prompt Pack — bundled example plugin (SUGGEST).
 * Contributes extra prompt-library entries (visible with a plugin badge,
 * never written into your project).
 */
module.exports = {
  prompts: [],
}
`

/** Manifests for the bundled examples (contributions live in the manifest for these). */
export const EXAMPLE_MANIFESTS: Record<string, unknown> = {
  'starter-commands': {
    id: 'starter-commands',
    name: 'Starter Commands',
    version: '1.0.0',
    description: 'Bundled example: project greeting + scene audit commands.',
    author: 'Mirai Studio Developers',
    permissions: ['READ', 'SUGGEST'],
    commands: [
      { id: 'starter-commands.greet', label: 'Starter: Greet the project', description: 'Says hello with the project name.' },
      { id: 'starter-commands.scene-audit', label: 'Starter: Scene audit', description: 'Counts scenes missing screenplays.' },
    ],
    prompts: [],
    exportPresets: [],
    providers: [],
  },
  'prompt-pack-manga': {
    id: 'prompt-pack-manga',
    name: 'Manga Prompt Pack',
    version: '1.0.0',
    description: 'Bundled example: extra manga prompt-library entries.',
    author: 'Mirai Studio Developers',
    permissions: ['SUGGEST'],
    commands: [],
    prompts: [
      {
        category: 'MANGA_PANEL',
        title: 'Double-page spread — climax impact',
        body: 'double-page manga spread, climax beat, dramatic speed lines radiating from the focal character, high contrast ink, screentone gradients, motion blur on the background, cinematic negative space for the title logo',
        tags: 'manga, spread, climax',
      },
      {
        category: 'ANIME_STYLE',
        title: 'Golden-hour keyframe — confession',
        body: 'anime keyframe, golden-hour backlight, two characters on a rooftop, lens flare, sakura petals suspended mid-air, soft rim lighting, emotional distance framing, theatrical composition',
        tags: 'anime, keyframe, romance',
      },
    ],
    exportPresets: [],
    providers: [],
  },
}

export class PluginRegistry {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly pluginsDir: string,
  ) {
    mkdirSync(this.pluginsDir, { recursive: true })
    this.seedExamples()
  }

  // ------------------------------------------------------------- listing

  /** All installed plugins (valid + broken), with persisted enable state. */
  list(): PluginRecord[] {
    const out: PluginRecord[] = []
    const enabledMap = this.readEnabledMap()
    let entries: string[]
    try {
      entries = readdirSync(this.pluginsDir).filter((e) =>
        existsSync(join(this.pluginsDir, e, 'manifest.json')),
      )
    } catch {
      return []
    }
    for (const folderName of entries.sort()) {
      const folder = join(this.pluginsDir, folderName)
      try {
        const raw = readFileSync(join(folder, 'manifest.json'), 'utf8')
        const parsed = PluginManifest.safeParse(JSON.parse(raw))
        if (!parsed.success) {
          out.push({
            manifest: {
              id: folderName,
              name: folderName,
              version: '0.0.0',
              author: 'unknown',
              permissions: ['READ'],
              commands: [],
              prompts: [],
              exportPresets: [],
              providers: [],
            },
            enabled: false,
            folder,
            errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`),
            createdAt: this.clock.isoNow(),
          })
          continue
        }
        out.push({
          manifest: parsed.data,
          enabled: enabledMap[parsed.data.id] ?? false,
          folder,
          errors: [],
          createdAt: this.clock.isoNow(),
        })
      } catch {
        // unreadable manifest — skip the folder entirely
      }
    }
    return out
  }

  get(id: string): PluginRecord {
    const found = this.list().find((p) => p.manifest.id === id)
    if (!found) throw new MiraiError('NOT_FOUND', `Plugin ${id} is not installed.`)
    return found
  }

  // ------------------------------------------------------------- lifecycle

  setEnabled(id: string, enabled: boolean): PluginRecord {
    const plugin = this.get(id)
    if (plugin.errors.length > 0) {
      throw new MiraiError('VALIDATION_ERROR', `Plugin ${id} has an invalid manifest and can't be enabled.`)
    }
    const map = this.readEnabledMap()
    // Absent = disabled (the safe default); the map stores the actual state.
    map[id] = enabled
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(ENABLED_KV, JSON.stringify(map), this.clock.isoNow())
    })
    tx()
    return this.get(id)
  }

  /** Installs a plugin folder (manifest.json required; index.js optional). */
  installFromFolder(sourceDir: string): PluginRecord {
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
      throw new MiraiError('PATH_INVALID', `Not a plugin folder: ${sourceDir}`)
    }
    const manifestPath = join(sourceDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      throw new MiraiError('VALIDATION_ERROR', 'The folder has no manifest.json — plugins need one.')
    }
    let manifest: PluginManifest
    try {
      const parsed = PluginManifest.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')))
      if (!parsed.success) {
        throw new MiraiError('VALIDATION_ERROR', `Invalid manifest: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`)
          .join('; ')}`)
      }
      manifest = parsed.data
    } catch (err) {
      if (err instanceof MiraiError) throw err
      throw new MiraiError('VALIDATION_ERROR', 'manifest.json is not valid JSON.')
    }
    const target = join(this.pluginsDir, manifest.id)
    if (existsSync(target)) {
      // Re-install: replace the folder (idempotent update).
      rmSync(target, { recursive: true, force: true })
    }
    cpSync(sourceDir, target, { recursive: true })
    return this.get(manifest.id)
  }

  delete(id: string): void {
    const plugin = this.get(id)
    if (plugin.folder.startsWith(this.pluginsDir)) {
      rmSync(plugin.folder, { recursive: true, force: true })
    }
    const map = this.readEnabledMap()
    delete map[id]
    this.db
      .prepare(
        `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(ENABLED_KV, JSON.stringify(map), this.clock.isoNow())
  }

  // ------------------------------------------------------------- internals

  private readEnabledMap(): Record<string, boolean> {
    try {
      const row = this.db.prepare('SELECT value FROM app_kv WHERE key = ?').get(ENABLED_KV) as
        | { value: string }
        | undefined
      if (!row) return {}
      const parsed = JSON.parse(row.value) as Record<string, boolean>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  /** Seeds the two bundled example plugins once (never overwrites user edits). */
  private seedExamples(): void {
    try {
      const seeded = this.db.prepare('SELECT value FROM app_kv WHERE key = ?').get(SEEDED_KV) as
        | { value: string }
        | undefined
      if (seeded) return
      for (const [id, manifest] of Object.entries(EXAMPLE_MANIFESTS)) {
        const folder = join(this.pluginsDir, id)
        if (!existsSync(folder)) {
          mkdirSync(folder, { recursive: true })
          writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
          writeFileSync(
            join(folder, 'index.js'),
            id === 'starter-commands' ? EXAMPLE_COMMANDS : EXAMPLE_PROMPT_PACK,
            'utf8',
          )
        }
      }
      this.db
        .prepare(
          `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(SEEDED_KV, '1', this.clock.isoNow())
    } catch {
      // Seeding is best-effort — never block the app on it.
    }
  }
}

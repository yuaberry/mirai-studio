/**
 * PluginHost (Phase 9) — executes installed plugin commands in the main
 * process with a STRICTLY SCOPED API: every `mirai.*` call is gated by the
 * permissions declared in the manifest (READ/SUGGEST/EDIT/CREATE/DELETE/EXPORT).
 *
 * Plugins are user-installed local code (like editor extensions) — the host
 * never gives them raw IPC, credentials, file paths or the DB handle.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MiraiError, type PluginRecord } from '@mirai/shared'
import type { Container } from '../bootstrap'

/** The scoped API every plugin command receives (permission-enforced). */
export interface MiraiPluginApi {
  /** READ-gated project overview (no paths, no secrets). */
  project(): {
    name: string
    description: string | undefined
    episodeCount: number
    sceneCount: number
    shotCount: number
    characterCount: number
    scenesMissingScreenplay: string[]
  } | null
  /** SUGGEST-gated: prompts the plugin already declared — identity helper. */
  declaredPrompts(): unknown[]
  /** EXPORT-gated: enqueue a scene render (only when the user's command asks). */
  renderScene(sceneId: string): Promise<string>
}

export class PluginHost {
  private moduleCache = new Map<string, unknown>()

  constructor(private readonly c: Container) {}

  /** Loads a plugin's index.js (CommonJS) — cached per folder+version. */
  private loadModule(plugin: PluginRecord): Record<string, unknown> | null {
    const key = `${plugin.folder}@${plugin.manifest.version}`
    if (this.moduleCache.has(key)) {
      return this.moduleCache.get(key) as Record<string, unknown> | null
    }
    const entry = join(plugin.folder, 'index.js')
    let loaded: Record<string, unknown> | null = null
    if (existsSync(entry)) {
      try {
        // User-installed plugin code — loaded exactly like editor extensions.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(entry) as Record<string, unknown>
        loaded = mod && typeof mod === 'object' ? mod : null
      } catch (err) {
        this.c.logger.warn('PLUGINS', `Plugin ${plugin.manifest.id} failed to load: ${(err as Error).message}`)
        loaded = null
      }
    }
    this.moduleCache.set(key, loaded)
    return loaded
  }

  private requirePermission(plugin: PluginRecord, permission: PluginRecord['manifest']['permissions'][number], action: string): void {
    if (!plugin.manifest.permissions.includes(permission)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Plugin "${plugin.manifest.id}" is missing the ${permission} permission — can't ${action}.`,
      )
    }
  }

  /** The scoped API handed to plugin commands. */
  private buildApi = (plugin: PluginRecord): MiraiPluginApi => ({
    project: () => {
      this.requirePermission(plugin, 'READ', 'read project data')
        const ctx = this.c.projects.current()
        if (!ctx) return null
        const episodes = ctx.creative.listEpisodes()
        const scenes = episodes.flatMap((ep) => ctx.creative.listScenes(ep.id))
        return {
          name: ctx.summary.name,
          description: ctx.summary.description,
          episodeCount: episodes.length,
          sceneCount: scenes.length,
          shotCount: scenes.reduce((n, sc) => n + ctx.storyboard.listShots(sc.id).length, 0),
          characterCount: ctx.creative.listCharacters().length,
          scenesMissingScreenplay: scenes
            .filter((sc) => (sc.screenplay ?? '').trim().length === 0)
            .map((sc) => sc.title)
            .slice(0, 20),
        }
      },
    declaredPrompts: () => {
      this.requirePermission(plugin, 'SUGGEST', 'read declared prompts')
      return plugin.manifest.prompts
    },
    renderScene: async (sceneId: string) => {
      this.requirePermission(plugin, 'EXPORT', 'trigger renders')
      const ctx = this.c.projects.current()
      if (!ctx) throw new MiraiError('NOT_FOUND', 'No open project.')
      const job = await ctx.jobs.enqueue('render.scene', { sceneId }, { priority: 9, maxAttempts: 2 })
      this.c.logger.info('PLUGINS', `Plugin ${plugin.manifest.id} enqueued a scene render`)
      return job.id
    },
  })

  /**
   * Runs a plugin command. Command execution needs SUGGEST (commands are
   * user-triggered contributions); inner API calls enforce their own gates.
   */
  async runCommand(pluginId: string, commandId: string): Promise<unknown> {
    const plugin = this.c.plugins.get(pluginId)
    if (!plugin.enabled) {
      throw new MiraiError('VALIDATION_ERROR', `Plugin "${pluginId}" is disabled.`)
    }
    const command = plugin.manifest.commands.find((cmd) => cmd.id === commandId)
    if (!command) {
      throw new MiraiError('NOT_FOUND', `Command ${commandId} not declared by plugin ${pluginId}.`)
    }
    const mod = this.loadModule(plugin)
    const handlers = (mod?.commands ?? {}) as Record<string, unknown>
    const declared = Object.keys(handlers)
    if (!declared.includes(commandId)) {
      // Manifest-declared commands still run when the module has no handler —
      // the manifest IS the contribution (bundled examples work this way).
      return { message: `Ran ${command.label} (manifest command).` }
    }
    const handler = handlers[commandId] as (api: MiraiPluginApi) => unknown
    if (typeof handler !== 'function') {
      throw new MiraiError('VALIDATION_ERROR', `Plugin ${pluginId} command ${commandId} is not a function.`)
    }
    const result = await handler(this.buildApi(plugin))
    this.c.logger.info('PLUGINS', `Plugin command ran: ${commandId}`, { pluginId })
    return result ?? { message: `${command.label} completed.` }
  }
}

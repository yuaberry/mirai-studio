/**
 * Main-process DI container + IPC event emitter.
 */
import { app, type BrowserWindow } from 'electron'
import {
  APP_DB_MIGRATIONS,
  CredentialStore,
  LoggerService,
  ProjectService,
  SettingsService,
  openDatabase,
  runMigrations,
  systemClock,
  type AppDirs,
  type Database,
  type OpenProjectContext,
  AiUsageService,
  AudioMixService,
  MarketplaceService,
  AssetIntelligenceService,
  ProfileService,
  CollaborationService,
  SyncAgent,
} from '@mirai/core'
import type { IpcEventChannel, IpcEventPayload, OpenedProject } from '@mirai/shared'
import { ipcEventPayloads } from '@mirai/shared'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PluginRegistry } from '@mirai/core'
import { createSecureCodec, electronDirs } from './adapters/electronAdapters'
import { PluginHost } from './plugins/pluginHost'
import { createHealthChecker, type HealthChecker } from './system/health'
import { AiHost } from './ai/aiHost'

/** Typed push channel: main → renderer. */
export class MainEmitter {
  private win: BrowserWindow | null = null

  attach(win: BrowserWindow): void {
    this.win = win
  }

  detach(): void {
    this.win = null
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  send<C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void {
    if (!this.win || this.win.isDestroyed()) return
    try {
      // Validate what leaves the main process — the renderer trusts the bridge.
      const parsed = ipcEventPayloads[channel].parse(payload)
      this.win.webContents.send('mirai:event', { channel, payload: parsed })
    } catch {
      // A malformed push event must never crash the main process.
    }
  }
}

export interface Container {
  dirs: AppDirs
  logger: LoggerService
  appDb: Database
  settings: SettingsService
  credentials: CredentialStore
  projects: ProjectService
  ai: AiHost
  profile: ProfileService
  collaboration: CollaborationService
  /** v2.1: o agente que executa as operações que o celular enfileira. */
  syncAgent?: import('@mirai/core').SyncAgent | null
  aiUsage: AiUsageService
  /** v0.36: Sound & Voice Studio — real audio mix + master via FFmpeg. */
  audio: AudioMixService
  /** V1 Beta Experimental §14: Asset Intelligence — usage history + dependency graph. */
  assetIntelligence: AssetIntelligenceService
  /** AI Marketplace — curated provider cards + live model catalogs. */
  marketplace: MarketplaceService
  emitter: MainEmitter
  health: HealthChecker
  /** App-level plugin registry (Phase 9). */
  plugins: import('@mirai/core').PluginRegistry
  pluginHost: import('./plugins/pluginHost').PluginHost
  shutdown(): Promise<void>
}

export function bootstrap(): Container {
  const dirs = electronDirs()

  mkdirSync(dirs.logs, { recursive: true })
  mkdirSync(dirs.backups, { recursive: true })
  mkdirSync(dirs.projectsDefaultDir, { recursive: true })

  const logger = new LoggerService({ logDir: dirs.logs })
  logger.info('SYSTEM', 'Mirai Studio starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  })

  const appDb = openDatabase(dirs.appDb)
  const migrations = runMigrations(appDb, APP_DB_MIGRATIONS)
  if (migrations.applied.length > 0) {
    logger.info('DB', `App DB migrated: ${migrations.applied.join(', ')}`)
  }

  const emitter = new MainEmitter()
  const codec = createSecureCodec(logger)
  const settings = new SettingsService(appDb)
  const credentials = new CredentialStore(appDb, codec, systemClock)
  const projects = new ProjectService({
    appDb,
    dirs,
    clock: systemClock,
    appVersion: app.getVersion(),
    logger,
    onJobUpdated: (job) => emitter.send('jobs:updated', { job }),
    settings,
  })
  const aiUsage = new AiUsageService(appDb)
  const ai = new AiHost({ credentials, settings, projects, logger, emitter, aiUsage })
  const audio = new AudioMixService(appDb, systemClock, dirs.root)
  const assetIntelligence = new AssetIntelligenceService(appDb)
  // v2.1: who is making the anime. Avatars live as real files in a folder
  // inside userData — a database is a bad place for megabytes of pixels.
  const profile = new ProfileService(appDb, {
    profileDir: join(dirs.root, 'profile'),
    clock: systemClock,
  })
  // v2.1: publish/import projects between makers (the server is user-run).
  const collaboration = new CollaborationService({
    profile,
    settings,
    projectsDir: dirs.projectsDefaultDir,
    clock: systemClock,
  })

  // The AI Marketplace reads the vendors' LIVE catalogs (Pollinations'
  // public media catalog) and the configured chat provider's model list.
  const marketplace = new MarketplaceService({
    fetchFn: (url, init) => fetch(url, init as never),
    clock: systemClock,
    listChatModels: async () => (await ai.listModels(false)).models,
    hasCredential: (key) => credentials.get(key) !== null,
  })

  // Log batches → renderer (Diagnostics live tail).
  logger.subscribe((entries) => emitter.send('logs:appended', { entries }))

  const health = createHealthChecker({ dirs, logger, appDb, secure: () => codec.isSecure })

  const plugins = new PluginRegistry(appDb, systemClock, join(dirs.root, 'plugins'))

  // v2.1: o agente de tempo real — o celular manda, ESTA máquina executa.
  // Ele só existe quando o usuário liga (Settings → colaboração); desligado,
  // não há socket nenhum aberto para o servidor.
  const syncAgent = buildSyncAgent({
    settings,
    projects,
    ai,
    collaboration,
    logger,
    emitter,
  })

  const container: Container = {
    dirs,
    logger,
    appDb,
    settings,
    credentials,
    projects,
    ai,
    profile,
    collaboration,
    syncAgent,
    aiUsage,
    audio,
    assetIntelligence,
    marketplace,
    emitter,
    health,
    plugins,
    pluginHost: undefined as never,
    shutdown: async () => {
      syncAgent?.stop()
      await projects.close()
      logger.close()
      appDb.close()
    },
  }
  container.pluginHost = new PluginHost(container)
  return container
}

/** Build the wire representation of an open project. */
export function toOpenedProject(ctx: OpenProjectContext): OpenedProject {
  return { ...ctx.summary, manifest: ctx.manifest }
}

/**
 * Constrói o agente de sincronização (v2.1) — a metade da máquina do
 * "mando do celular, executo no computador".
 *
 * O `runOp` é o ÚNICO lugar que conhece os serviços: cada operação que o
 * celular pode pedir vira a chamada real correspondente. Um kind sem
 * implementação é recusado com honestidade — a fila não aceita fantasia.
 */
function buildSyncAgent(deps: {
  settings: import('@mirai/core').SettingsService
  projects: import('@mirai/core').ProjectService
  ai: import('./ai/aiHost').AiHost
  collaboration: import('@mirai/core').CollaborationService
  logger: import('@mirai/core').LoggerService
  emitter: import('./bootstrap').MainEmitter
}): import('@mirai/core').SyncAgent | null {
  const ai = () => deps.settings.get()
  const collab = () => ai().ai.collaboration
  if (!collab().syncEnabled || !collab().url) return null
  return new SyncAgent({
    baseUrl: collab().url,
    token: collab().token || undefined,
    pollIntervalMs: collab().syncPollMs,
    log: (message) => deps.logger.info('SYNC', message),
    runOp: async (kind, payload, report) => {
      const ctx = deps.projects.current()
      if (!ctx) throw new Error('Nenhum projeto aberto — abra o projeto no computador primeiro.')
      switch (kind) {
        case 'speakShot': {
          const shotId = String(payload.shotId ?? '')
          if (!shotId) throw new Error('A operação speakShot precisa de shotId.')
          const spoken = await deps.ai.speakShot(shotId)
          report(100, 'voz gerada')
          return spoken
        }
        case 'generateFrames': {
          const shotId = String(payload.shotId ?? '')
          if (!shotId) throw new Error('A operação generateFrames precisa de shotId.')
          const generated = await deps.ai.generateFrame(shotId, undefined as never, AbortSignal.timeout(300_000), (pct) => report(pct, 'gerando quadro'))
          return generated
        }
        case 'renderCamera': {
          const shotId = String(payload.shotId ?? '')
          if (!shotId) throw new Error('A operação renderCamera precisa de shotId.')
          const rendered = await ctx.render.renderCameraClip({
            shotId,
            quality: (payload.quality as never) ?? 'MASTER',
            reportProgress: (pct) => report(pct, 'renderizando clipe'),
            signal: AbortSignal.timeout(300_000),
          })
          return rendered
        }
        case 'refreshSnapshot': {
          // publica o projeto atual no servidor — o celular recebe o evento
          // project.published/manifest pelo canal de eventos (tempo real).
          const published = await deps.collaboration.publish(
            ctx.summary.path,
            ctx.manifest.config.title || ctx.summary.name,
            ctx.manifest.description ?? '',
          )
          report(100, 'projeto publicado')
          return { id: published.id }
        }
        default:
          throw new Error(`Operação "${kind}" ainda não é executável pelo agente.`)
      }
    },
  })
}

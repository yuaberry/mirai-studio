/**
 * All IPC handlers, grouped by domain. This is a THIN layer:
 * every call delegates to a core service — no business logic lives here.
 */
import { clipboard, dialog, shell } from 'electron'
import { MiraiError, type ProjectConfig } from '@mirai/shared'
import { handleIpc } from './router'
import { toOpenedProject, type Container } from '../bootstrap'
import { join } from 'node:path'
import { newEntityId } from '@mirai/core'

export function registerIpcHandlers(c: Container): void {
  // ---------------------------------------------------------------- projects
  handleIpc('projects:list', (req) => ({ projects: c.projects.list(req.includeArchived) }))

  handleIpc('projects:create', async (req) => {
    const project = c.projects.create({
      name: req.name,
      description: req.description,
      dir: req.dir,
      config: req.config,
    })
    return { project }
  })

  handleIpc('projects:open', async (req) => {
    const ctx = await c.projects.open(req.path)
    if (ctx.recoveredCount > 0) {
      c.emitter.send('notify', {
        kind: 'recovered',
        title: `Recovered ${ctx.recoveredCount} interrupted ${ctx.recoveredCount === 1 ? 'job' : 'jobs'}`,
        description: 'They were paused when the app closed. Resume or discard them in the Jobs panel.',
      })
    }
    c.emitter.send('project:changed', { project: toOpenedProject(ctx) })
    return { project: toOpenedProject(ctx) }
  })

  handleIpc('projects:close', async () => {
    await c.projects.close()
    c.emitter.send('project:changed', { project: null })
    return { ok: true }
  })

  handleIpc('projects:current', () => {
    const ctx = c.projects.current()
    return { project: ctx ? toOpenedProject(ctx) : null }
  })

  handleIpc('projects:duplicate', (req) => ({ project: c.projects.duplicate(req.id) }))

  handleIpc('projects:archive', (req) => ({ project: c.projects.archive(req.id) }))

  handleIpc('projects:restore', (req) => ({ project: c.projects.restore(req.id) }))

  handleIpc('projects:removeFromList', (req) => {
    c.projects.removeFromList(req.id)
    return { ok: true }
  })

  handleIpc('projects:revealInFolder', (req) => {
    const summary = c.projects.summaryById(req.id)
    shell.showItemInFolder(join(summary.path, 'project.mirai'))
    return { ok: true }
  })

  handleIpc('projects:pickDirectory', async () => {
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose a location for your project',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: c.dirs.projectsDefaultDir,
    })
    return { path: result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]! }
  })

  handleIpc('projects:updateConfig', (req) => {
    const manifest = c.projects.updateActiveConfig(req.config as ProjectConfig)
    const ctx = c.projects.current()
    if (ctx) c.emitter.send('project:changed', { project: toOpenedProject(ctx) })
    return { manifest }
  })

  handleIpc('projects:validate', async () => {
    const ctx = c.projects.current()
    if (!ctx) {
      throw new MiraiError('NOT_FOUND', 'Open a project first — validation runs on the active project.')
    }
    const job = await ctx.jobs.enqueue(
      'project.validate',
      { projectId: ctx.summary.id },
      { priority: 8 },
    )
    return { jobId: job.id }
  })

  handleIpc('projects:backup', (req) => ({ backup: c.projects.backup(req.id) }))

  handleIpc('projects:listBackups', (req) => ({ backups: c.projects.listBackups(req.id) }))

  handleIpc('projects:restoreBackup', async (req) => {
    await c.projects.restoreBackup(req.id, req.backupId)
    return { ok: true }
  })

  handleIpc('projects:deleteBackup', (req) => {
    c.projects.deleteBackup(req.id, req.backupId)
    return { ok: true }
  })

  // ----------------------------------------------------------------- creative
  handleIpc('story-bible:get', () => ({ bible: requireActive(c).creative.getBible() }))

  handleIpc('story-bible:update', (req) => ({
    bible: requireActive(c).creative.updateBible(req.bible),
  }))

  handleIpc('characters:list', () => ({ characters: requireActive(c).creative.listCharacters() }))

  handleIpc('characters:create', (req) => ({
    character: requireActive(c).creative.createCharacter(req.input),
  }))

  handleIpc('characters:update', (req) => ({
    character: requireActive(c).creative.updateCharacter(req.id, req.input),
  }))

  handleIpc('characters:delete', (req) => {
    requireActive(c).creative.deleteCharacter(req.id)
    return { ok: true }
  })

  handleIpc('locations:list', () => ({ locations: requireActive(c).creative.listLocations() }))

  handleIpc('locations:create', (req) => ({
    location: requireActive(c).creative.createLocation(req.input),
  }))

  handleIpc('locations:update', (req) => ({
    location: requireActive(c).creative.updateLocation(req.id, req.input),
  }))

  handleIpc('locations:delete', (req) => {
    requireActive(c).creative.deleteLocation(req.id)
    return { ok: true }
  })

  handleIpc('episodes:list', () => ({ episodes: requireActive(c).creative.listEpisodes() }))

  handleIpc('episodes:create', (req) => ({
    episode: requireActive(c).creative.createEpisode(req.input),
  }))

  handleIpc('episodes:update', (req) => ({
    episode: requireActive(c).creative.updateEpisode(req.id, req.input),
  }))

  handleIpc('episodes:delete', (req) => {
    requireActive(c).creative.deleteEpisode(req.id)
    return { ok: true }
  })

  handleIpc('scenes:list', (req) => ({ scenes: requireActive(c).creative.listScenes(req.episodeId) }))

  handleIpc('scenes:create', (req) => ({
    scene: requireActive(c).creative.createScene(req.episodeId, req.input),
  }))

  handleIpc('scenes:update', (req) => ({
    scene: requireActive(c).creative.updateScene(req.id, req.input),
  }))

  handleIpc('scenes:delete', (req) => {
    requireActive(c).creative.deleteScene(req.id)
    return { ok: true }
  })

  handleIpc('scenes:move', (req) => {
    requireActive(c).creative.moveScene(req.id, req.direction)
    return { ok: true }
  })

  // -------------------------------------------------------------- prompt library
  handleIpc('prompts:list', () => ({ prompts: requireActive(c).prompts.list() }))

  handleIpc('prompts:create', (req) => ({
    prompt: requireActive(c).prompts.create(req.input),
  }))

  handleIpc('prompts:update', (req) => ({
    prompt: requireActive(c).prompts.update(req.id, req.input),
  }))

  handleIpc('prompts:delete', (req) => {
    requireActive(c).prompts.delete(req.id)
    return { ok: true }
  })

  // -------------------------------------------------------------- Storyboard
  handleIpc('shots:list', (req) => ({
    shots: requireActive(c).storyboard.listShots(req.sceneId),
  }))

  handleIpc('shots:create', (req) => ({
    shot: requireActive(c).storyboard.createShot(req.sceneId, req.input),
  }))

  handleIpc('shots:update', (req) => ({
    shot: requireActive(c).storyboard.updateShot(req.id, req.input),
  }))

  handleIpc('shots:delete', (req) => {
    requireActive(c).storyboard.deleteShot(req.id)
    return { ok: true }
  })

  handleIpc('shots:move', (req) => {
    requireActive(c).storyboard.moveShot(req.id, req.direction)
    return { ok: true }
  })

  handleIpc('shots:importFrame', async (req) => {
    const ctx = requireActive(c)
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import a frame image',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
        },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      throw new MiraiError('CANCELLED', 'Frame import cancelled.')
    }
    const asset = ctx.storyboard.importFrame(req.shotId, result.filePaths[0]!)
    c.logger.info('MEDIA', `Frame imported for shot ${req.shotId}`, { assetId: asset.id, bytes: asset.bytes })
    return { asset }
  })

  handleIpc('shots:clearFrame', (req) => {
    requireActive(c).storyboard.clearFrame(req.shotId)
    return { ok: true }
  })

  handleIpc('assets:reveal', (req) => {
    const ctx = requireActive(c)
    shell.showItemInFolder(ctx.storyboard.revealAssetPath(req.assetId))
    return { ok: true }
  })

  // ---- Style Bible (Module 23)
  handleIpc('style-bible:get', () => ({ style: requireActive(c).storyboard.getStyleBible() }))

  handleIpc('style-bible:update', (req) => ({
    style: requireActive(c).storyboard.updateStyleBible(req.style),
  }))

  // -------------------------------------------------------------------- AI Core
  handleIpc('ai:status', () => c.ai.status())

  handleIpc('ai:models', async (req) => {
    try {
      return await c.ai.listModels(req.force)
    } catch (err) {
      c.logger.warn('AI', 'Model discovery failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  handleIpc('ai:chat', (req) => {
    const requestId = newEntityId()
    c.ai.startChat(requestId, {
      messages: req.messages,
      context: req.context,
      model: req.model,
    })
    return { requestId }
  })

  handleIpc('ai:abort', (req) => ({ ok: c.ai.abort(req.requestId) }))

  // ---- Scene Writer agent (draft + explicit approval) -----------------------
  handleIpc('ai:draftScreenplay', async (req) => c.ai.draftScreenplay(req.sceneId, req.guidance))

  handleIpc('ai:recordDecision', (req) => {
    const ctx = requireActive(c)
    ctx.storyboard.addDecision({
      kind: req.kind,
      summary: req.summary,
      sceneId: req.sceneId,
      shotId: req.shotId,
    })
    c.logger.log('info', 'AI', `Decision recorded: ${req.kind}`)
    return { ok: true }
  })

  handleIpc('ai:decisions:list', (req) => {
    const ctx = requireActive(c)
    return { decisions: ctx.storyboard.listDecisions(req.limit) }
  })

  // ---- Frame generation (Phase 4) -------------------------------------------
  handleIpc('ai:generateFrame', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('ai.generateFrame', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { shotId?: string; extraPrompt?: string }
      if (!payload.shotId) {
        throw new MiraiError('VALIDATION_ERROR', 'generateFrame payload missing shotId.')
      }
      // Bridge the cooperative flag to a real AbortSignal for fetch.
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        return await c.ai.generateFrame(
          payload.shotId,
          payload.extraPrompt,
          controller.signal,
          jobCtx.reportProgress,
        )
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue(
      'ai.generateFrame',
      { shotId: req.shotId, extraPrompt: req.extraPrompt },
      { priority: 8, maxAttempts: 2 },
    )
    return { jobId: job.id }
  })

  // ---- Voice import (Phase 4) -------------------------------------------------
  handleIpc('media:importVoice', async (req) => {
    const ctx = requireActive(c)
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import a voice line',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac', 'aac', 'weba'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      throw new MiraiError('CANCELLED', 'Voice import cancelled.')
    }
    const asset = ctx.storyboard.importVoice(req.shotId, result.filePaths[0]!)
    c.logger.info('MEDIA', `Voice imported for shot ${req.shotId}`, { assetId: asset.id })
    return { asset }
  })

  handleIpc('shots:clearVoice', (req) => {
    requireActive(c).storyboard.clearVoice(req.shotId)
    return { ok: true }
  })

  // ---------------------------------------------------------------- settings
  handleIpc('settings:get', () => ({ settings: c.settings.get() }))

  handleIpc('settings:update', (req) => ({ settings: c.settings.update(req.settings) }))

  // -------------------------------------------------------------- credentials
  handleIpc('credentials:set', (req) => {
    // The value NEVER gets logged or pushed back to the renderer.
    const { secure } = c.credentials.set(req.key, req.value)
    c.logger.info('AI', `Credential configured: ${req.key}`, { secure })
    return { ok: true, secure }
  })

  handleIpc('credentials:status', () => ({ credentials: c.credentials.status() }))

  handleIpc('credentials:clear', (req) => {
    c.credentials.clear(req.key)
    c.logger.info('AI', `Credential cleared: ${req.key}`)
    return { ok: true }
  })

  // --------------------------------------------------------------------- jobs
  handleIpc('jobs:list', () => {
    const ctx = c.projects.current()
    return { jobs: ctx ? ctx.jobs.list() : [] }
  })

  handleIpc('jobs:retry', (req) => {
    requireActive(c).jobs.retry(req.id)
    return { ok: true }
  })

  handleIpc('jobs:cancel', (req) => {
    requireActive(c).jobs.cancel(req.id)
    return { ok: true }
  })

  handleIpc('jobs:resumeInterrupted', () => {
    const ctx = requireActive(c)
    const resumed = ctx.jobs.resumePaused()
    if (resumed > 0) {
      c.emitter.send('notify', {
        kind: 'success',
        title: `Resumed ${resumed} ${resumed === 1 ? 'job' : 'jobs'}`,
      })
    }
    return { resumed }
  })

  handleIpc('jobs:discardInterrupted', () => {
    const ctx = requireActive(c)
    const discarded = ctx.jobs.discardPaused()
    if (discarded > 0) {
      c.emitter.send('notify', {
        kind: 'info',
        title: `Discarded ${discarded} interrupted ${discarded === 1 ? 'job' : 'jobs'}`,
      })
    }
    return { discarded }
  })

  // --------------------------------------------------------------------- logs
  handleIpc('logs:recent', (req) => ({ entries: c.logger.recent(req) }))

  handleIpc('logs:clear', () => {
    c.logger.clear()
    return { ok: true }
  })

  handleIpc('logs:revealLogsFolder', () => {
    void shell.openPath(c.logger.logsDir)
    return { ok: true }
  })

  // ------------------------------------------------------------------- system
  handleIpc('system:health', () => ({ health: c.health.report() }))

  handleIpc('system:copyText', (req) => {
    clipboard.writeText(req.text)
    return { ok: true }
  })

  handleIpc('window:minimize', () => {
    c.emitter.window?.minimize()
    return { ok: true }
  })

  handleIpc('window:toggleMaximize', () => {
    const win = c.emitter.window
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
    return { ok: true }
  })

  handleIpc('window:close', () => {
    c.emitter.window?.close()
    return { ok: true }
  })

  handleIpc('app:reload', () => {
    c.emitter.window?.webContents.reload()
    return { ok: true }
  })

  handleIpc('app:toggleDevtools', () => {
    c.emitter.window?.webContents.toggleDevTools()
    return { ok: true }
  })

  c.logger.info('IPC', 'Registered handlers for all channels')
}

function requireActive(c: Container) {
  const ctx = c.projects.current()
  if (!ctx) throw new MiraiError('NOT_FOUND', 'No project is open.')
  return ctx
}



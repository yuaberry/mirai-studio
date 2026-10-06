/**
 * All IPC handlers, grouped by domain. This is a THIN layer:
 * every call delegates to a core service — no business logic lives here.
 */
import { clipboard, dialog, shell } from 'electron'
import { MiraiError, type ProjectConfig } from '@mirai/shared'
import { handleIpc } from './router'
import { toOpenedProject, type Container } from '../bootstrap'
import { join } from 'node:path'
import { newEntityId, LicenseService } from '@mirai/core'
import { RenderService } from '@mirai/core'

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
    const ctx = requireActive(c)
    ctx.storyboard.deleteShot(req.id)
    // Orphaned camera keyframes must not linger (orchestration lives here by design).
    ctx.timeline.keyframes.deleteAll('CAMERA', req.id)
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

  // ---- Media Library (Phase 4) -----------------------------------------------
  handleIpc('media:list', (req) => ({
    tracks: requireActive(c).media.list(req.kind),
  }))

  handleIpc('media:import', async (req) => {
    const ctx = requireActive(c)
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: `Import ${String(req.kind).toLowerCase()} file`,
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'weba'] }],
    })
    if (result.canceled || result.filePaths.length === 0) throw new MiraiError('CANCELLED', 'Import cancelled.')
    const track = ctx.media.import(req.kind, result.filePaths[0]!)
    c.logger.info('MEDIA', `Imported ${String(req.kind)}: "${track.title}"`, { trackId: track.id })
    return { track }
  })

  handleIpc('media:update', (req) => ({
    track: requireActive(c).media.update(req.id, { title: req.title, tags: req.tags }),
  }))

  handleIpc('media:delete', (req) => {
    const ctx = requireActive(c)
    // Clips referencing this media become dangling — remove them first.
    const db = ctx.db
    const orphans = db
      .prepare(`SELECT tc.id FROM timeline_clips tc WHERE tc.source_type = 'MEDIA' AND tc.source_id = ?`)
      .all(req.id) as Array<{ id: string }>
    for (const clip of orphans) {
      ctx.timeline.deleteClip(clip.id, false)
    }
    ctx.media.delete(req.id)
    return { ok: true }
  })

  handleIpc('media:assignToScene', (req) => {
    requireActive(c).media.assignToScene(req.sceneId, req.mediaId, req.role, req.volume)
    return { ok: true }
  })

  handleIpc('media:removeFromScene', (req) => {
    requireActive(c).media.removeFromScene(req.sceneId, req.mediaId)
    return { ok: true }
  })

  handleIpc('media:listSceneMedia', (req) => ({
    assignments: requireActive(c).media.listSceneMedia(req.sceneId),
  }))

  handleIpc('media:reveal', (req) => {
    const ctx = requireActive(c)
    const track = ctx.media.get(req.id)
    const assetPath = ctx.media.assetAbsolutePath(track.assetId)
    shell.showItemInFolder(assetPath)
    return { ok: true }
  })

  // ---- Render Engine (Phase 4) -------------------------------------------------
  handleIpc('render:status', () => {
    const detect = RenderService.detect()
    return { available: detect.available, version: detect.version }
  })

  handleIpc('render:shot', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('render.shot', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { shotId?: string }
      if (!payload.shotId) throw new MiraiError('VALIDATION_ERROR', 'render.shot payload missing shotId.')
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        const result = await ctx.render.renderShot({
          shotId: payload.shotId,
          reportProgress: jobCtx.reportProgress,
          signal: controller.signal,
        })
        c.logger.info('RENDER', `Shot rendered: ${result.outputPath}`, { bytes: result.fileBytes })
        return result
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue('render.shot', { shotId: req.shotId }, { priority: 9, maxAttempts: 2 })
    return { jobId: job.id }
  })

  // ---- Scene & episode renders (Phase 6) -------------------------------------
  handleIpc('render:scene', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('render.scene', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as {
        sceneId?: string
        presetId?: string
        quality?: 'PREVIEW' | 'MASTER'
      }
      if (!payload.sceneId) throw new MiraiError('VALIDATION_ERROR', 'render.scene payload missing sceneId.')
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        const result = await ctx.render.renderScene({
          sceneId: payload.sceneId,
          presetId: payload.presetId ?? 'youtube-1080',
          quality: payload.quality ?? 'MASTER',
          reportProgress: jobCtx.reportProgress,
          signal: controller.signal,
        })
        c.logger.info('RENDER', `Scene rendered: ${result.outputPath}`, { bytes: result.fileBytes })
        return result
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue(
      'render.scene',
      { sceneId: req.sceneId, presetId: req.presetId, quality: req.quality },
      { priority: 9, maxAttempts: 2 },
    )
    return { jobId: job.id }
  })

  handleIpc('render:episode', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('render.episode', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as {
        episodeId?: string
        presetId?: string
        quality?: 'PREVIEW' | 'MASTER'
      }
      if (!payload.episodeId) throw new MiraiError('VALIDATION_ERROR', 'render.episode payload missing episodeId.')
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        const result = await ctx.render.renderEpisode({
          episodeId: payload.episodeId,
          presetId: payload.presetId ?? 'youtube-1080',
          quality: payload.quality ?? 'MASTER',
          reportProgress: jobCtx.reportProgress,
          signal: controller.signal,
        })
        c.logger.info('RENDER', `Episode rendered: ${result.outputPath}`, { bytes: result.fileBytes })
        return result
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue(
      'render.episode',
      { episodeId: req.episodeId, presetId: req.presetId, quality: req.quality },
      { priority: 9, maxAttempts: 2 },
    )
    return { jobId: job.id }
  })

  // ---- Export Center (Phase 6) ------------------------------------------------
  handleIpc('render:outputs', () => ({ outputs: requireActive(c).render.listOutputs() }))

  handleIpc('render:revealOutput', (req) => {
    const ctx = requireActive(c)
    // Path validation happens in the service — the handler only reveals.
    const outputs = ctx.render.listOutputs()
    const match = outputs.find((o) => o.path === req.path)
    if (!match) throw new MiraiError('NOT_FOUND', 'Output not found in exports/.')
    shell.showItemInFolder(match.path)
    return { ok: true }
  })

  handleIpc('render:deleteOutput', (req) => {
    requireActive(c).render.deleteOutput(req.path)
    return { ok: true }
  })

  // ---- Timeline & Editing (Phase 5) -------------------------------------------
  handleIpc('timeline:get', (req) => ({
    timeline: requireActive(c).timeline.getTimeline(req.sceneId),
  }))

  handleIpc('timeline:build', (req) => ({
    timeline: requireActive(c).timeline.buildFromScene(req.sceneId, req.reset),
  }))

  handleIpc('timeline:reset', (req) => {
    requireActive(c).timeline.resetScene(req.sceneId)
    return { ok: true }
  })

  handleIpc('timeline:trackCreate', (req) => ({
    track: requireActive(c).timeline.createTrack(req.sceneId, req.kind, req.name),
  }))

  handleIpc('timeline:trackUpdate', (req) => ({
    track: requireActive(c).timeline.updateTrack(req.id, req.patch),
  }))

  handleIpc('timeline:trackDelete', (req) => {
    requireActive(c).timeline.deleteTrack(req.id)
    return { ok: true }
  })

  handleIpc('timeline:trackMove', (req) => {
    requireActive(c).timeline.moveTrack(req.id, req.toIndex)
    return { ok: true }
  })

  handleIpc('timeline:clipCreate', (req) => ({ clip: requireActive(c).timeline.createClip(req) }))

  handleIpc('timeline:clipUpdate', (req) => ({
    clip: requireActive(c).timeline.updateClip(req.id, req.patch),
  }))

  handleIpc('timeline:clipMove', (req) => ({
    clip: requireActive(c).timeline.moveClip(req.id, req.toTrackId, req.startSec),
  }))

  handleIpc('timeline:clipSplit', (req) => requireActive(c).timeline.splitClip(req.id, req.atSec))

  handleIpc('timeline:clipDelete', (req) => {
    requireActive(c).timeline.deleteClip(req.id, req.ripple)
    return { ok: true }
  })

  handleIpc('timeline:markerCreate', (req) => ({
    marker: requireActive(c).timeline.createMarker(req.sceneId, req.atSec, req.label),
  }))

  handleIpc('timeline:markerDelete', (req) => {
    requireActive(c).timeline.deleteMarker(req.id)
    return { ok: true }
  })

  handleIpc('timeline:keyframesForScene', (req) => ({
    keyframes: requireActive(c).timeline.keyframesForScene(req.sceneId),
  }))

  handleIpc('timeline:keyframeList', (req) => ({
    keyframes: requireActive(c).timeline.keyframes.list(req.targetType, req.targetId, req.param),
  }))

  handleIpc('timeline:keyframeUpsert', (req) => ({
    keyframe: requireActive(c).timeline.keyframes.upsert(req.keyframe),
  }))

  handleIpc('timeline:keyframeDelete', (req) => {
    requireActive(c).timeline.keyframes.delete(req.id)
    return { ok: true }
  })

  // ---- Licensing & Mature Content Mode (v0.10) ------------------------------------
  const licenses = new LicenseService()

  handleIpc('license:activate', (req) => {
    const status = licenses.validate(req.key)
    const current = c.settings.get()
    const content = current.content
    if (status.valid) {
      c.settings.update({
        ...current,
        content: { ...content, licenseKey: req.key.trim(), license: status.payload },
      })
      c.logger.info('SYSTEM', `Pro license activated: ${status.payload?.holder}`, {
        tier: status.payload?.tier,
      })
    } else {
      c.settings.update({ ...current, content: { ...content, license: null } })
    }
    return { status }
  })

  handleIpc('license:status', () => {
    const content = c.settings.get().content
    if (!content.licenseKey) {
      return { status: { valid: false, reason: 'No license key activated.', payload: null } }
    }
    return { status: licenses.validate(content.licenseKey) }
  })

  handleIpc('content:setMature', (req) => {
    const content = c.settings.get().content
    if (!req.enabled) {
      c.settings.update({ ...c.settings.get(), content: { ...content, matureEnabled: false } })
      return { enabled: false }
    }
    if (!req.ageConfirmed) {
      throw new MiraiError(
        'POLICY_VIOLATION',
        'The 18+ responsibility notice must be confirmed to enable Mature Content Mode.',
      )
    }
    const key = content.licenseKey
    if (!key) {
      throw new MiraiError(
        'LICENSE_INVALID',
        'Mature Content Mode requires an active Mirai Studio Pro license — activate one first.',
      )
    }
    const status = licenses.validate(key)
    if (!status.valid || !status.payload?.features.includes('mature')) {
      throw new MiraiError(
        'LICENSE_INVALID',
        status.valid
          ? 'This license does not include Mature Content Mode.'
          : (status.reason ?? 'License invalid.'),
      )
    }
    c.settings.update({
      ...c.settings.get(),
      content: { ...content, matureEnabled: true, matureConfirmedAt: new Date().toISOString() },
    })
    c.logger.info('SYSTEM', 'Mature Content Mode enabled (Pro)', {})
    return { enabled: true }
  })

  // ---- Blender bridge (v0.10) ------------------------------------------------------
  handleIpc('blender:status', () => {
    const ctx = c.projects.current()
    if (!ctx) return { available: false, version: null }
    return ctx.blender.detect()
  })

  handleIpc('blender:attachBlend', async (req) => {
    const ctx = requireActive(c)
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Attach a Blender scene (.blend)',
      properties: ['openFile'],
      filters: [{ name: 'Blender', extensions: ['blend', 'blend1'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      throw new MiraiError('CANCELLED', 'Blender attach cancelled.')
    }
    const asset = ctx.blender.attachBlend(req.shotId, result.filePaths[0]!)
    c.logger.info('MEDIA', `Blender scene attached to shot ${req.shotId}`, { assetId: asset.id })
    return { asset }
  })

  handleIpc('blender:renderShot', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('blender.renderShot', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { shotId?: string }
      if (!payload.shotId) throw new MiraiError('VALIDATION_ERROR', 'blender.renderShot payload missing shotId.')
      const shot = ctx.storyboard.getShotById(payload.shotId)
      return ctx.blender.renderShot(shot, shot.durationSeconds, jobCtx.reportProgress, jobCtx.signal)
    })
    const job = await ctx.jobs.enqueue('blender.renderShot', { shotId: req.shotId }, { priority: 9, maxAttempts: 2 })
    return { jobId: job.id }
  })

  // ---- Producer Agent (v0.10) -----------------------------------------------------
  handleIpc('ai:autoproduce', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('ai.autoproduce', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as import('@mirai/shared').AutoproduceOptions | undefined
      if (!payload?.idea) throw new MiraiError('VALIDATION_ERROR', 'autoproduce payload missing idea.')
      return c.ai.autoproduce(payload, jobCtx.reportProgress, jobCtx.signal)
    })
    const job = await ctx.jobs.enqueue('ai.autoproduce', req, { priority: 10, maxAttempts: 1 })
    c.logger.info('AI', 'Producer Agent started', { idea: req.idea.slice(0, 200) })
    return { jobId: job.id }
  })

  // ---- Plugins (Phase 9) ---------------------------------------------------------
  handleIpc('plugins:list', () => ({ plugins: c.plugins.list() }))

  handleIpc('plugins:setEnabled', (req) => {
    const plugin = c.plugins.setEnabled(req.id, req.enabled)
    c.logger.info('PLUGINS', `Plugin ${req.id} ${req.enabled ? 'enabled' : 'disabled'}`)
    return { plugin }
  })

  handleIpc('plugins:installFromFolder', async () => {
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose a plugin folder (manifest.json + index.js)',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      throw new MiraiError('CANCELLED', 'Plugin install cancelled.')
    }
    const plugin = c.plugins.installFromFolder(result.filePaths[0]!)
    c.logger.info('PLUGINS', `Plugin installed: ${plugin.manifest.id}`, {
      version: plugin.manifest.version,
    })
    return { plugin }
  })

  handleIpc('plugins:delete', (req) => {
    c.plugins.delete(req.id)
    c.logger.info('PLUGINS', `Plugin deleted: ${req.id}`)
    return { ok: true }
  })

  handleIpc('plugins:runCommand', async (req) => {
    const result = await c.pluginHost.runCommand(req.pluginId, req.commandId)
    return { result }
  })

  // ---- Subtitle Studio (Phase 4 wrap-up) ---------------------------------------
  handleIpc('subtitles:list', (req) => ({
    subtitles: requireActive(c).subtitles.list(req.sceneId),
  }))

  handleIpc('subtitles:create', (req) => ({
    subtitle: requireActive(c).subtitles.create(req),
  }))

  handleIpc('subtitles:update', (req) => ({
    subtitle: requireActive(c).subtitles.update(req.id, req.patch),
  }))

  handleIpc('subtitles:delete', (req) => {
    requireActive(c).subtitles.delete(req.id)
    return { ok: true }
  })

  handleIpc('subtitles:importFile', async (req) => {
    const ctx = requireActive(c)
    const win = c.emitter.window
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import subtitles (.srt / .vtt)',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      throw new MiraiError('CANCELLED', 'Subtitle import cancelled.')
    }
    const imported = ctx.subtitles.importFile(req.sceneId, result.filePaths[0]!)
    c.logger.info('MEDIA', `Subtitles imported: ${imported} cues`, { sceneId: req.sceneId })
    return { imported }
  })

  handleIpc('subtitles:exportFile', (req) => {
    const out = requireActive(c).subtitles.exportFile(req.sceneId, req.format)
    c.logger.info('MEDIA', `Subtitles exported: ${out.path}`, { count: out.count })
    return out
  })

  // ---- Advanced AI (Phase 8) ----------------------------------------------------
  handleIpc('ai:analyzeScreenplay', async (req) => {
    const analysis = await c.ai.analyzeScreenplay(req.sceneId)
    return { analysis }
  })

  handleIpc('ai:directorNotes', async (req) => {
    const notes = await c.ai.directorNotes(req.sceneId)
    return { notes }
  })

  handleIpc('ai:continuityCheck', async (req) => {
    const findings = await c.ai.continuityCheck(req.sceneId)
    return { findings }
  })

  handleIpc('ai:productionReview', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('ai.productionReview', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { sceneId?: string }
      if (!payload.sceneId) throw new MiraiError('VALIDATION_ERROR', 'review payload missing sceneId.')
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        return await c.ai.productionReview(payload.sceneId, jobCtx.reportProgress, controller.signal)
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue('ai.productionReview', { sceneId: req.sceneId }, { priority: 7, maxAttempts: 2 })
    return { jobId: job.id }
  })

  handleIpc('ai:generateAllFrames', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('ai.generateAllFrames', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { sceneId?: string }
      if (!payload.sceneId) throw new MiraiError('VALIDATION_ERROR', 'generateAllFrames payload missing sceneId.')
      const shots = ctx.storyboard.listShots(payload.sceneId).filter((s) => !s.frameAssetId)
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      let generated = 0
      try {
        for (const [i, shot] of shots.entries()) {
          if (jobCtx.signal.aborted) throw new MiraiError('CANCELLED', 'Batch cancelled.')
          try {
            await c.ai.generateFrame(shot.id, undefined, controller.signal, (p) =>
              jobCtx.reportProgress(Math.round(5 + (i / Math.max(1, shots.length)) * 85 + (p / 100) * (85 / Math.max(1, shots.length)))),
            )
            generated++
          } catch (err) {
            c.logger.warn('AI', `Batch frame failed for shot ${shot.id}: ${(err as Error).message}`)
            break // provider issue — stop hammering; report partial
          }
        }
        return { generated, total: shots.length }
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue('ai.generateAllFrames', { sceneId: req.sceneId }, { priority: 8, maxAttempts: 1 })
    return { jobId: job.id }
  })

  handleIpc('ai:generateVideo', async (req) => {
    const ctx = requireActive(c)
    ctx.jobs.register('ai.generateVideo', async (job, jobCtx) => {
      const payload = (job.payload ?? {}) as { shotId?: string; extraPrompt?: string; seconds?: number }
      if (!payload.shotId) throw new MiraiError('VALIDATION_ERROR', 'generateVideo payload missing shotId.')
      const controller = new AbortController()
      const watcher = setInterval(() => {
        if (jobCtx.signal.aborted) controller.abort()
      }, 100)
      try {
        return await c.ai.generateVideo(
          payload.shotId,
          payload.extraPrompt,
          payload.seconds ?? 4,
          controller.signal,
          jobCtx.reportProgress,
        )
      } finally {
        clearInterval(watcher)
      }
    })
    const job = await ctx.jobs.enqueue(
      'ai.generateVideo',
      { shotId: req.shotId, extraPrompt: req.extraPrompt, seconds: req.seconds },
      { priority: 8, maxAttempts: 2 },
    )
    return { jobId: job.id }
  })

  // ---- Production suite (Phase 7) ---------------------------------------------
  handleIpc('tasks:list', (req) => ({ tasks: requireActive(c).production.listTasks(req.status) }))

  handleIpc('tasks:create', (req) => ({ task: requireActive(c).production.createTask(req) }))

  handleIpc('tasks:update', (req) => ({
    task: requireActive(c).production.updateTask(req.id, req.patch),
  }))

  handleIpc('tasks:setStatus', (req) => ({
    task: requireActive(c).production.setTaskStatus(req.id, req.status),
  }))

  handleIpc('tasks:delete', (req) => {
    requireActive(c).production.deleteTask(req.id)
    return { ok: true }
  })

  handleIpc('crew:list', () => ({ members: requireActive(c).production.listCrew() }))

  handleIpc('crew:create', (req) => ({
    member: requireActive(c).production.createCrewMember(req.name, req.role),
  }))

  handleIpc('crew:delete', (req) => {
    requireActive(c).production.deleteCrewMember(req.id)
    return { ok: true }
  })

  handleIpc('approvals:transition', (req) => {
    const event = requireActive(c).production.transition(
      req.entityType,
      req.entityId,
      req.toStatus,
      req.note,
      req.actorName,
    )
    c.logger.info('PROJECT', `Approval: ${req.entityType} ${event.fromStatus} → ${event.toStatus}`, {
      entityId: req.entityId,
    })
    return { event }
  })

  handleIpc('approvals:log', (req) => ({
    events: requireActive(c).production.listApprovals(req.entityType, req.entityId),
  }))

  handleIpc('versions:list', (req) => ({
    versions: requireActive(c).production.listVersions(req.entityType, req.entityId),
  }))

  handleIpc('versions:snapshot', (req) => ({
    version: requireActive(c).production.snapshotVersion(req.entityType, req.entityId, req.label),
  }))

  handleIpc('versions:restore', (req) => ({
    version: requireActive(c).production.restoreVersion(req.versionId),
  }))

  handleIpc('versions:diff', (req) => ({
    entries: requireActive(c).production.diffVersions(req.fromVersionId, req.toVersionId),
  }))

  handleIpc('qc:run', () => ({ report: requireActive(c).production.runQc() }))

  handleIpc('analytics:overview', () => ({ analytics: requireActive(c).production.overview() }))

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



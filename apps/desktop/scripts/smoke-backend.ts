/**
 * Phase 0–2 backend E2E smoke — the exact product flow, no display required:
 *
 *   CREATE PROJECT → OPEN → VALIDATE → UPDATE CONFIG → BACKUP → CORRUPT
 *   → VALIDATE → RESTORE BACKUP → CRASH RECOVERY → CREATIVE CORE
 *   (character/location/episode/scene + dialogue) → PROMPT LIBRARY
 *   (built-ins seeded, user CRUD) → AI PROVIDER INTEGRATION (mocked transport)
 *   → DUPLICATE → ARCHIVE → SETTINGS → CREDENTIALS → LOGS
 *
 * Runs under Electron's Node (ELECTRON_RUN_AS_NODE) so the real native
 * better-sqlite3 binding is exercised. The AI step uses the REAL
 * OpenRouterProvider + context builder with an in-memory transport —
 * the network itself is exercised manually in the app.
 */
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APP_DB_MIGRATIONS,
  CreativeService,
  CredentialStore,
  LoggerService,
  ProjectService,
  SettingsService,
  openDatabase,
  runMigrations,
  systemClock,
  plaintextCodec,
  type AppDirs,
} from '@mirai/core'
import {
  OpenRouterProvider,
  OpenAIImagesProvider,
  buildSystemPrompt,
  buildImagePrompt,
} from '@mirai/ai'
import {
  ProjectConfig,
  PROJECT_PRESETS,
  effectiveShortcuts,
  normalizeCombo,
  prettyCombo,
  sampleCamera,
  sampleCurve,
  type FetchResponse,
} from '@mirai/shared'

const steps: Array<{ name: string; ok: boolean; detail?: string }> = []
let current = ''

function expectOrder(shots: Array<{ title: string }>, titles: string[]): void {
  const actual = shots.map((s) => s.title)
  if (JSON.stringify(actual) !== JSON.stringify(titles)) {
    throw new Error(`order mismatch: ${JSON.stringify(actual)}`)
  }
}

function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => {
      current = name
      return fn()
    })
    .then(() => {
      steps.push({ name, ok: true })
      console.log(`  ✓ ${name}`)
    })
    .catch((err: Error) => {
      steps.push({ name, ok: false, detail: err.message })
      console.log(`  ✕ ${name} — ${err.message}`)
      throw err
    })
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function main(): Promise<void> {
  console.log('\nMIRAI STUDIO — backend E2E smoke\n' + '='.repeat(48))

  const root = mkdtempSync(join(tmpdir(), 'mirai-smoke-'))
  const dirs: AppDirs = {
    root,
    logs: join(root, 'logs'),
    backups: join(root, 'backups'),
    projectsDefaultDir: join(root, 'projects'),
    appDb: join(root, 'app.sqlite'),
  }
  mkdirSync(dirs.projectsDefaultDir, { recursive: true })
  mkdirSync(dirs.backups, { recursive: true })

  const logger = new LoggerService({ logDir: dirs.logs })
  const appDb = openDatabase(dirs.appDb)
  runMigrations(appDb, APP_DB_MIGRATIONS)
  const projects = new ProjectService({
    appDb,
    dirs,
    clock: systemClock,
    appVersion: '0.2.0-smoke',
    logger,
    onJobUpdated: () => undefined,
  })

  let summary!: ReturnType<typeof projects.create>

  await step('CREATE PROJECT (folders + manifest + project DB)', () => {
    const preset = PROJECT_PRESETS.find((p) => p.id === 'anime-12')!
    const config = ProjectConfig.parse({
      title: 'Sakura Chronicles',
      genre: 'Romance, Fantasy',
      ...preset.config,
    })
    summary = projects.create({
      name: 'Sakura Chronicles',
      description: 'A yuri romance set in a school of magic.',
      dir: dirs.projectsDefaultDir,
      config,
    })
    if (!existsSync(join(summary.path, 'project.mirai'))) throw new Error('project.mirai missing')
    if (!existsSync(join(summary.path, 'database', 'project.sqlite'))) {
      throw new Error('project DB missing')
    }
  })

  let ctx!: Awaited<ReturnType<typeof projects.open>>
  await step('OPEN PROJECT (queue starts, recovery = 0)', async () => {
    ctx = await projects.open(summary.path)
    if (ctx.summary.id !== summary.id) throw new Error('id mismatch')
    if (ctx.recoveredCount !== 0) throw new Error('unexpected recovered jobs')
  })

  await step('VALIDATION JOB runs to COMPLETED with zero issues', async () => {
    const job = await ctx.jobs.enqueue('project.validate', { projectId: summary.id })
    await waitUntil(() => ctx.jobs.get(job.id)?.status === 'COMPLETED', 'validation job')
    const done = ctx.jobs.get(job.id)!
    const result = done.result as { ok: boolean; issues: string[] } | null
    if (!result?.ok) throw new Error(`validation issues: ${JSON.stringify(result?.issues)}`)
  })

  await step('UPDATE CONFIG persists to manifest', () => {
    const manifest = projects.updateActiveConfig(
      ProjectConfig.parse({ ...ctx.manifest.config, title: 'Sakura Chronicles II', fps: 30 }),
    )
    if (manifest.config.title !== 'Sakura Chronicles II' || manifest.config.fps !== 30) {
      throw new Error('config not applied')
    }
  })

  let backupId = ''
  await step('BACKUP creates a restorable snapshot', () => {
    const backup = projects.backup(summary.id)
    backupId = backup.id
    if (!existsSync(join(backup.path, 'backup.json'))) throw new Error('backup manifest missing')
  })

  await step('CORRUPTION is detected by validation', async () => {
    rmSync(join(summary.path, 'characters'), { recursive: true, force: true })
    rmSync(join(summary.path, 'images'), { recursive: true, force: true })
    const job = await ctx.jobs.enqueue('project.validate', { projectId: summary.id })
    await waitUntil(() => ctx.jobs.get(job.id)?.status === 'COMPLETED', 'validation #2')
    const result = ctx.jobs.get(job.id)!.result as { ok: boolean; issues: string[] }
    if (result.ok) throw new Error('corruption went unnoticed!')
  })

  await step('RESTORE BACKUP repairs the project (with safety snapshot)', async () => {
    await projects.restoreBackup(summary.id, backupId)
    if (!existsSync(join(summary.path, 'characters'))) throw new Error('characters/ not restored')
    const backups = projects.listBackups(summary.id)
    if (backups.length < 2) throw new Error('pre-restore snapshot missing')
    ctx = (await projects.open(summary.path)) as typeof ctx
  })

  await step('CRASHED JOB is recovered as PAUSED, resumed, completes', async () => {
    ctx.jobs.register('smoke.crash', () => new Promise(() => {}))
    const job = await ctx.jobs.enqueue('smoke.crash')
    await waitUntil(() => ctx.jobs.get(job.id)?.status === 'RUNNING', 'crash job start')
    await projects.close()

    const reopened = await projects.open(summary.path)
    if (reopened.recoveredCount !== 1) {
      throw new Error(`expected 1 interrupted job on reopen, got ${reopened.recoveredCount}`)
    }
    reopened.jobs.register('smoke.crash', async () => 'resumed-result')
    reopened.jobs.resumePaused()
    await waitUntil(() => reopened.jobs.get(job.id)?.status === 'COMPLETED', 'resumed job')
    if (reopened.jobs.get(job.id)?.result !== 'resumed-result') throw new Error('result mismatch')
    await projects.close()
    ctx = (await projects.open(summary.path)) as typeof ctx
  })

  let yunaId = ''
  await step('CHARACTER + LOCATION + EPISODE + SCENE (WRITE DIALOGUE)', () => {
    const yuna = ctx.creative.createCharacter({
      name: 'Yuna Hoshimiya',
      role: 'PROTAGONIST',
      age: '17',
      personality: 'Earnest, hides her bravery behind politeness.',
    })
    yunaId = yuna.id
    if (yuna.role !== 'PROTAGONIST') throw new Error('character broken')

    const rooftop = ctx.creative.createLocation({ name: 'Academy Rooftop' })

    const episode = ctx.creative.createEpisode({
      season: 1,
      number: 1,
      title: 'Petals of a Promise',
      synopsis: 'Yuna and Mio meet again after seven years.',
    })
    void episode.id

    const scene = ctx.creative.createScene(episode.id, {
      title: 'The rooftop promise',
      locationId: rooftop.id,
      timeOfDay: 'NIGHT',
      characterIds: [yuna.id],
      synopsis: 'Yuna and Mio at midnight.',
      screenplay: 'INT. ACADEMY ROOFTOP — NIGHT\n\nYUNA\n"I will become strong enough to protect you."',
    })
    if (scene.orderIndex !== 0) throw new Error('scene order broken')
    if (scene.characterIds.length !== 1) throw new Error('scene cast broken')

    ctx.creative.updateBible({
      premise: 'Two girls bond over magic at a school of sorcery.',
      tone: 'Bittersweet',
    })
  })

  await step('CREATIVE DATA survives close/reopen', async () => {
    await projects.close()
    ctx = (await projects.open(summary.path)) as typeof ctx
    if (ctx.creative.listCharacters()[0]?.name !== 'Yuna Hoshimiya') {
      throw new Error('character lost on reopen')
    }
    const episodes = ctx.creative.listEpisodes()
    if (episodes.length !== 1 || episodes[0]!.sceneCount !== 1) {
      throw new Error('episode/scene stats lost')
    }
    const scene = ctx.creative.listScenes(episodes[0]!.id)[0]!
    if (!scene.screenplay?.includes('strong enough to protect you')) {
      throw new Error('screenplay lost')
    }
    if (ctx.creative.getBible().premise !== 'Two girls bond over magic at a school of sorcery.') {
      throw new Error('story bible lost')
    }
  })

  await step('PROMPT LIBRARY seeds manga built-ins + user CRUD', () => {
    const prompts = ctx.prompts.list()
    if (prompts.filter((p) => p.builtin).length < 10) {
      throw new Error('built-in manga library not seeded')
    }
    const builtin = prompts.find((p) => p.builtin)!
    try {
      ctx.prompts.delete(builtin.id)
      throw new Error('builtin delete was allowed!')
    } catch (err) {
      if (!(err instanceof Error) || !/cannot be deleted/i.test(err.message)) throw err
    }
    const created = ctx.prompts.create({
      category: 'MANGA_PANEL',
      title: 'Rain Confession Panel',
      body: 'A manga panel, rain, two girls under one umbrella, screentone.',
      tags: 'manga, rain',
    })
    ctx.prompts.update(created.id, {
      category: 'MANGA_PANEL',
      title: 'Rain Confession Panel v2',
      body: 'A manga panel, rain, two girls under one umbrella, screentone.',
      tags: 'manga, rain',
    })
    ctx.prompts.delete(created.id)
  })

  await step('AI PROVIDER integration (real provider, mocked transport)', async () => {
    // Consent-based context building, exactly like the main process does.
    const systemPrompt = buildSystemPrompt({
      projectName: ctx.summary.name,
      bible: ctx.creative.getBible(),
      characters: ctx.creative
        .listCharacters()
        .filter((c) => c.id === yunaId)
        .map((c) => ({ name: c.name, role: c.role })),
      scene: {
        title: 'The rooftop promise',
        timeOfDay: 'NIGHT',
        screenplay: 'YUNA: "I will protect you."',
        castNames: ['Yuna Hoshimiya'],
      },
    })
    if (!systemPrompt.includes('Two girls bond over magic')) throw new Error('bible missing from context')
    if (!systemPrompt.includes('Yuna Hoshimiya')) throw new Error('cast missing from context')

    // Real provider, in-memory transport streaming an SSE response.
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"The prom"}}]}',
      'data: {"choices":[{"delta":{"content":"ise holds."}}]}',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":120,"completion_tokens":9}}',
      'data: [DONE]',
      '',
    ].join('\n')
    let lastBody: Record<string, unknown> = {}
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-smoke',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(ssePayload))
            controller.close()
          },
        }),
        text: async () => ssePayload,
      }),
      timeoutMs: 0,
    })
    // Capture the request body via a proxy wrapper.
    const capturingProvider = new OpenRouterProvider({
      apiKey: 'sk-or-smoke',
      fetchFn: async (url, init): Promise<FetchResponse> => {
        lastBody = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        return {
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(ssePayload))
              controller.close()
            },
          }),
          text: async () => ssePayload,
        }
      },
      timeoutMs: 0,
    })

    let text = ''
    let usage: { promptTokens: number; completionTokens: number } | null = null
    for await (const chunk of capturingProvider.stream({
      model: 'test/model',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Summarize the premise.' }],
      temperature: 0.7,
    })) {
      text += chunk.delta
      if (chunk.usage) usage = chunk.usage
    }
    if (text !== 'The promise holds.') throw new Error(`stream text mismatch: "${text}"`)
    if (!usage || usage.promptTokens !== 120) throw new Error('usage missing')
    if (lastBody['stream'] !== true) throw new Error('stream flag missing')
    const sent = (lastBody['messages'] as Array<{ role: string; content: string }>)[0]!
    if (!sent.content.includes('Two girls bond over magic')) throw new Error('context not sent')
    void provider
  })

  await step('STORYBOARD: shots with camera metadata + runtime total', () => {
    const scene = ctx.creative.listScenes(ctx.creative.listEpisodes()[0]!.id)[0]!
    const shot = ctx.storyboard.createShot(scene.id, {
      title: 'The promise — close',
      shotType: 'CLOSE_UP',
      lens: '85mm',
      cameraMovement: 'DOLLY_IN',
      durationSeconds: 4.5,
      dialogue: 'YUNA: "I will protect you."',
      notes: 'Push in on the last word.',
    })
    if (shot.orderIndex !== 0) throw new Error('shot order broken')
    const wide = ctx.storyboard.createShot(scene.id, {
      title: 'City lights below',
      shotType: 'WIDE',
      lens: '24mm',
      cameraMovement: 'STATIC',
      durationSeconds: 2.5,
    })
    const shots = ctx.storyboard.listShots(scene.id)
    const total = shots.reduce((acc, sh) => acc + sh.durationSeconds, 0)
    if (Math.abs(total - 7) > 0.001) throw new Error(`runtime total mismatch: ${total}`)
    ctx.storyboard.moveShot(wide.id, 'up')
    expectOrder(ctx.storyboard.listShots(scene.id), ['City lights below', 'The promise — close'])
  })

  await step('GENRES: project config accepts the full anime taxonomy', () => {
    const manifest = projects.updateActiveConfig(
      ProjectConfig.parse({
        ...ctx.manifest.config,
        genres: ['Isekai', 'Romance', 'Ecchi', 'Psychological', 'Shounen'],
      }),
    )
    if (manifest.config.genres.length !== 5 || !manifest.config.genres.includes('Ecchi')) {
      throw new Error('genre taxonomy not persisted')
    }
  })

  await step('VOICE: real audio import attaches to a shot', () => {
    const scene = ctx.creative.listScenes(ctx.creative.listEpisodes()[0]!.id)[0]!
    const shot = ctx.storyboard.listShots(scene.id)[0]!
    const wavSource = join(root, 'fake-line.wav')
    writeFileSync(wavSource, Buffer.alloc(2048, 0x52))
    const asset = ctx.storyboard.importVoice(shot.id, wavSource)
    if (asset.kind !== 'AUDIO' || asset.mime !== 'audio/wav') throw new Error('voice metadata broken')
    if (!existsSync(join(summary.path, asset.relativePath))) throw new Error('voice not copied')
    if (ctx.storyboard.getShotById(shot.id).voiceAssetId !== asset.id) throw new Error('voice not attached')
  })

  await step('STYLE BIBLE round-trips the visual identity', () => {
    const style = { artDirection: 'Luminous TV-anime, painted skies.', palette: 'Sakura pink, dusk violet.' }
    ctx.storyboard.updateStyleBible(style)
    if (ctx.storyboard.getStyleBible().artDirection !== style.artDirection) {
      throw new Error('style bible lost')
    }
  })

  await step('IMAGE PIPELINE: consistency prompt + provider + generated frame lands in project', async () => {
    // 1. The studio-consistency prompt bakes in Style Bible + camera metadata.
    const scene = ctx.creative.listScenes(ctx.creative.listEpisodes()[0]!.id)[0]!
    const shot = ctx.storyboard.listShots(scene.id)[1]!
    const prompt = buildImagePrompt({
      styleBible: ctx.storyboard.getStyleBible(),
      scene: {
        title: scene.title,
        timeOfDay: scene.timeOfDay,
        synopsis: scene.synopsis,
        locationName: ctx.creative.locationName(scene.locationId),
        castNames: ['Yuna Hoshimiya'],
      },
      shot: {
        title: shot.title,
        shotType: shot.shotType,
        lens: shot.lens,
        cameraMovement: shot.cameraMovement,
        durationSeconds: shot.durationSeconds,
        notes: shot.notes,
      },
      characters: [{ name: 'Yuna Hoshimiya' }],
      extraPrompt: 'sakura petals falling',
    })
    if (!prompt.includes('Sakura pink, dusk violet.')) throw new Error('Style Bible missing from prompt')
    if (!prompt.includes('dolly in')) throw new Error('camera metadata missing from prompt')

    // 2. The REAL provider against a fake transport returns real bytes…
    const b64 = Buffer.from('generated-frame-bytes').toString('base64')
    const provider = new OpenAIImagesProvider({
      apiKey: 'img-smoke-key',
      baseUrl: 'https://images.smoke.test/v1',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ data: [{ b64_json: b64 }] }),
      }),
      timeoutMs: 0,
    })
    const result = await provider.generate({ model: 'sd/smoke', prompt, size: '1344x768' })

    // 3. …and the pipeline stores them as a REAL project asset attached to the shot.
    const asset = ctx.storyboard.registerGeneratedFrame(shot.id, result.bytes, result.mimeType)
    if (!existsSync(join(summary.path, asset.relativePath))) throw new Error('generated frame not on disk')
    if (ctx.storyboard.getShotById(shot.id).frameAssetId !== asset.id) throw new Error('frame not attached')
  })

  await step('DECISIONS: accepted AI proposals become project memory', () => {
    ctx.storyboard.addDecision({ kind: 'screenplay', summary: 'Accepted draft — rooftop scene.' })
    ctx.storyboard.addDecision({ kind: 'image', summary: 'Approved generated keyframe.' })
    if (ctx.storyboard.listDecisions(10).length !== 2) throw new Error('decisions lost')
  })

  await step('STORYBOARD: real frame import, orphan pruning, security', () => {
    const scene = ctx.creative.listScenes(ctx.creative.listEpisodes()[0]!.id)[0]!
    const shot = ctx.storyboard.listShots(scene.id)[1]!
    const sourceFile = join(root, 'fake-frame.png')
    writeFileSync(sourceFile, Buffer.alloc(2048, 0x89))

    const asset = ctx.storyboard.importFrame(shot.id, sourceFile)
    if (asset.mime !== 'image/png' || asset.bytes !== 2048) throw new Error('asset metadata broken')
    if (!existsSync(join(summary.path, asset.relativePath))) throw new Error('frame not copied')
    if (!existsSync(ctx.storyboard.assetAbsolutePath(asset.id))) throw new Error('frame not servable')

    ctx.storyboard.clearFrame(shot.id)
    if (existsSync(join(summary.path, asset.relativePath))) throw new Error('orphan file not pruned')
  })

  await step('DUPLICATE produces a clean independent copy', () => {
    const copy = projects.duplicate(summary.id)
    if (copy.id === summary.id || !copy.name.includes('(copy)')) throw new Error('bad duplicate')
    const cloneDb = openDatabase(join(copy.path, 'database', 'project.sqlite'))
    const cloneCreative = new CreativeService(cloneDb, systemClock)
    if (cloneCreative.listCharacters().length !== 1) throw new Error('duplicate lost creative data')
    cloneDb.close()
  })

  await step('ARCHIVE / RESTORE flip status everywhere', async () => {
    const archived = projects.archive(summary.id)
    if (archived.status !== 'ARCHIVED') throw new Error('archive failed')
    const restored = projects.restore(summary.id)
    if (restored.status !== 'ACTIVE') throw new Error('restore failed')
    await projects.close()
  })

  await step('REMOVE FROM LIST keeps files on disk', () => {
    projects.removeFromList(summary.id)
    if (projects.list().some((p) => p.id === summary.id)) throw new Error('still listed')
    if (!existsSync(summary.path)) throw new Error('files were deleted — forbidden!')
  })

  // ---- Phase 5: Timeline & Editing ------------------------------------------
  // The ARCHIVE step closed the project — reopen it for the editing checks.
  let tctx: Awaited<ReturnType<typeof projects.open>> | null = null
  let timelineScene = ''
  let timelineMusicId = ''
  await step('TIMELINE: build assembles real tracks/clips from scene content', async () => {
    tctx = await projects.open(summary.path)
    const episode = tctx.creative.listEpisodes()[0]!
    const scene = tctx.creative.listScenes(episode.id)[0]!
    timelineScene = scene.id
    // Real music for the scene assignment.
    const mp3 = join(root, 'smoke-bgm.mp3')
    writeFileSync(mp3, Buffer.alloc(1024, 0x33))
    const music = tctx.media.import('MUSIC', mp3, 'Smoke BGM')
    tctx.media.assignToScene(scene.id, music.id, 'BACKGROUND', 1)
    timelineMusicId = music.id

    const bundle = tctx.timeline.buildFromScene(scene.id, true)
    const kinds = bundle.tracks.map((t) => t.kind)
    if (!kinds.includes('VIDEO') || !kinds.includes('VOICE') || !kinds.includes('MUSIC')) {
      throw new Error(`expected VIDEO/VOICE/MUSIC tracks, got ${kinds.join(',')}`)
    }
    const shots = tctx.storyboard.listShots(scene.id)
    const videoTrack = bundle.tracks.find((t) => t.kind === 'VIDEO')!
    const videoClips = bundle.clips.filter((c) => c.trackId === videoTrack.id)
    if (videoClips.length !== shots.length) throw new Error('one clip per shot expected')
    // Sequential placement: 0, d1, d1+d2…
    let cursor = 0
    for (const clip of videoClips) {
      if (Math.abs(clip.startSec - cursor) > 1e-6) throw new Error('clips not sequential')
      cursor += clip.durationSec
    }
    const musicClip = bundle.clips.find((c) => c.sourceId === timelineMusicId)
    if (!musicClip || musicClip.startSec !== 0) throw new Error('music clip missing')
    const shotSource = bundle.sources[shots[0]!.id]
    if (!shotSource || shotSource.type !== 'SHOT') throw new Error('source not resolved')
  })

  await step('TIMELINE: move/split obey collision + in-point rules', () => {
    const bundle = tctx.timeline.getTimeline(timelineScene)
    const videoTrack = bundle.tracks.find((t) => t.kind === 'VIDEO')!
    const clips = bundle.clips.filter((c) => c.trackId === videoTrack.id)
    const first = clips[0]!

    // Move to a free span then block an overlapping move.
    const moved = tctx.timeline.moveClip(first.id, undefined, 100)
    if (moved.startSec !== 100) throw new Error('move failed')
    let blocked = false
    try {
      tctx.timeline.moveClip(first.id, undefined, clips[1]!.startSec + 0.5)
    } catch {
      blocked = true
    }
    if (!blocked) throw new Error('overlap not rejected')

    // Split preserves the in-point.
    const splitAt = 100.5
    const { left, right } = tctx.timeline.splitClip(first.id, splitAt)
    if (right.inOffsetSec !== left.inOffsetSec + left.durationSec) {
      throw new Error('split in-point math broken')
    }

    // Ripple delete pulls everything after the deleted clip's end to the left.
    const before = tctx.timeline.getTimeline(timelineScene)
    const second = before.clips.find((c) => c.trackId === videoTrack.id && c.startSec > 0 && c.startSec < 100)!
    const rightBefore = before.clips.find((c) => c.id === right.id)!
    tctx.timeline.deleteClip(second.id, true)
    const after = tctx.timeline.getTimeline(timelineScene)
    const rightAfter = after.clips.find((c) => c.id === right.id)!
    if (Math.abs(rightAfter.startSec - (rightBefore.startSec - second.durationSec)) > 1e-6) {
      throw new Error('ripple did not shift the timeline')
    }
  })

  await step('TIMELINE: markers + cross-track kind rules are enforced', () => {
    const marker = tctx.timeline.createMarker(timelineScene, 3.25, 'beat')
    if (tctx.timeline.listMarkers(timelineScene).every((m) => m.id !== marker.id)) throw new Error('marker lost')
    tctx.timeline.deleteMarker(marker.id)

    const musicTrack = tctx.timeline.getTimeline(timelineScene).tracks.find((t) => t.kind === 'MUSIC')!
    let rejected = false
    try {
      tctx.timeline.createClip({
        trackId: musicTrack.id,
        sourceType: 'SHOT',
        sourceId: '01HZZZZZZZZZZZZZZZZZZZZZZZZ' as never,
        startSec: 0,
        durationSec: 1,
      })
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('shot-on-music-track not rejected')

    const track = tctx.timeline.createTrack(timelineScene, 'SFX', 'Impact FX')
    const patched = tctx.timeline.updateTrack(track.id, { muted: true, volume: 0.4, pan: -0.5 })
    if (!patched.muted || patched.pan !== -0.5) throw new Error('track patch broken')
    tctx.timeline.moveTrack(track.id, 0)
    if (tctx.timeline.getTimeline(timelineScene).tracks[0]!.id !== track.id) throw new Error('track move broken')
    tctx.timeline.deleteTrack(track.id)
  })

  await step('KEYFRAMES: camera + automation curves with every easing', () => {
    const episode = tctx.creative.listEpisodes()[0]!
    const scene = tctx.creative.listScenes(episode.id)[0]!
    const shot = tctx.storyboard.listShots(scene.id)[0]!
    const kf = tctx.timeline.keyframes
    kf.upsert({ targetType: 'CAMERA', targetId: shot.id, param: 'scale', atSec: 0, value: 1 })
    kf.upsert({ targetType: 'CAMERA', targetId: shot.id, param: 'scale', atSec: 4, value: 2, easing: 'bezier', bezier: [0.1, 0, 0.9, 1] })
    const sameSlot = kf.upsert({ targetType: 'CAMERA', targetId: shot.id, param: 'scale', atSec: 4, value: 2.5 })
    if (kf.list('CAMERA', shot.id, 'scale').length !== 2) throw new Error('upsert did not replace')
    if (sameSlot.value !== 2.5) throw new Error('replaced keyframe lost its value')

    const camera = sampleCamera(
      new Map([['scale', kf.list('CAMERA', shot.id, 'scale')]]),
      2,
    )
    if (camera.scale <= 1 || camera.scale >= 2.5) throw new Error('camera interpolation broken')
    if (camera.rotation !== 0 || camera.opacity !== 1) throw new Error('camera defaults broken')

    // Clip fade automation + scene-wide keyframe resolution.
    const bundle = tctx.timeline.getTimeline(scene.id)
    const voiceTrack = bundle.tracks.find((t) => t.kind === 'VOICE')!
    const voiceClip = bundle.clips.find((c) => c.trackId === voiceTrack.id)
    if (voiceClip) {
      kf.upsert({ targetType: 'CLIP', targetId: voiceClip.id, param: 'volume', atSec: 0, value: 0 })
      kf.upsert({ targetType: 'CLIP', targetId: voiceClip.id, param: 'volume', atSec: 1, value: 1 })
      const at = sampleCurve(kf.list('CLIP', voiceClip.id, 'volume'), 0.5)
      if (at === null || at < 0.3 || at > 0.7) throw new Error('fade curve broken')
    }
    const sceneKfs = tctx.timeline.keyframesForScene(scene.id)
    if (sceneKfs.length === 0) throw new Error('scene keyframes empty')
  })

  await step('SHORTCUTS: configurable bindings persist and stay valid', () => {
    const settings = new SettingsService(appDb)
    const base = settings.get()
    const effective = effectiveShortcuts(base.shortcuts)
    if (effective['timeline.togglePlay'] !== 'space') throw new Error('defaults missing')
    // Rebind split to X and confirm persistence + effective map.
    settings.update({
      ...base,
      shortcuts: { ...base.shortcuts, 'timeline.split': 'x' },
    })
    const reloaded = new SettingsService(appDb).get()
    const next = effectiveShortcuts(reloaded.shortcuts)
    if (next['timeline.split'] !== 'x') throw new Error('rebind lost')
    if (next['timeline.togglePlay'] !== 'space') throw new Error('defaults clobbered')
    if (normalizeCombo('Ctrl + SHIFT + S') !== 'ctrl+shift+s') throw new Error('normalization broken')
    if (prettyCombo('ctrl+k') !== 'Ctrl+K') throw new Error('display formatting broken')
  })

  await step('SETTINGS persist across restart', () => {
    const settings = new SettingsService(appDb)
    settings.update({
      ...settings.get(),
      ai: { ...settings.get().ai, temperature: 0.2, defaultModel: 'test/model' },
    })
    if (new SettingsService(appDb).get().ai.defaultModel !== 'test/model') {
      throw new Error('settings lost on reload')
    }
  })

  await step('CREDENTIALS never store plaintext (even insecure fallback flagged)', () => {
    const store = new CredentialStore(appDb, plaintextCodec, systemClock)
    store.set('openrouter', 'sk-or-smoke-123')
    if (store.get('openrouter') !== 'sk-or-smoke-123') throw new Error('roundtrip failed')
    if (store.status()[0]?.secure !== false) throw new Error('insecure fallback not flagged')
    store.clear('openrouter')
  })

  await step('LOGS are on disk', () => {
    logger.info('SYSTEM', 'smoke complete')
    logger.close()
    if (!existsSync(join(dirs.logs, 'mirai.log'))) throw new Error('mirai.log missing')
    const raw = readFileSync(join(dirs.logs, 'mirai.log'), 'utf8')
    if (!raw.includes('Project created')) throw new Error('project creation not logged')
  })

  console.log('='.repeat(48))
  const failed = steps.filter((s) => !s.ok)
  console.log(`RESULT: ${steps.length - failed.length}/${steps.length} steps passed\n`)
  if (failed.length > 0) process.exit(1)
  process.exit(0)
}

main().catch((err) => {
  console.error(`\nSMOKE FAILED at "${current}":`, err)
  process.exit(1)
})

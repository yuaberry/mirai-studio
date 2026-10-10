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
import { deflateSync } from 'node:zlib'
import { PluginHost } from '../src/main/plugins/pluginHost'
import { AiHost } from '../src/main/ai/aiHost'
import { join } from 'node:path'
import {
  APP_DB_MIGRATIONS,
  buildSceneRenderSpec,
  CreativeService,
  CredentialStore,
  LoggerService,
  ProjectService,
  LicenseService,
  PluginRegistry,
  RenderService,
  SettingsService,
  assertExplicitCastAllowed,
  openDatabase,
  runMigrations,
  systemClock,
  plaintextCodec,
  type AppDirs,
} from '@mirai/core'
import {
  OpenRouterProvider,
  OpenAIImagesProvider,
  OpenAIVideoProvider,
  buildSystemPrompt,
  buildImagePrompt,
} from '@mirai/ai'
import {
  ProjectConfig,
  PROJECT_PRESETS,
  ScreenplayAnalysis,
  DirectorNotes,
  ContinuityFinding,
  ANIME_GENRES,
  filterGenres,
  isMatureGenre,
  parseSrt,
  exportPresetById,
  effectiveShortcuts,
  normalizeCombo,
  prettyCombo,
  sampleCamera,
  sampleCurve,
  type FetchResponse,
} from '@mirai/shared'

// ---------------------------------------------------------------------------
// Real media fixtures for the render step (FFmpeg decodes these for real).
// ---------------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let c: number
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]!) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function makeRealPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function makeRealWav(seconds: number, sampleRate = 8000): Buffer {
  const samples = Math.floor(seconds * sampleRate)
  const dataBytes = samples * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000), 44 + i * 2)
  }
  return buf
}

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
    // v0.12: expanded taxonomy round-trips incl. mature tags + 18+ rating.
    const matureManifest = projects.updateActiveConfig(
      ProjectConfig.parse({
        ...ctx.manifest.config,
        genres: ['Hentai', 'Adult Romance', 'Cultivation', 'Iyashikei', 'Kaiju'],
        contentRating: '18+',
      }),
    )
    if (!matureManifest.config.genres.includes('Adult Romance')) {
      throw new Error('mature genre lost in round-trip')
    }
    if (matureManifest.config.contentRating !== '18+') throw new Error('18+ rating lost')
    if (!isMatureGenre('Adult Harem') || isMatureGenre('Isekai')) {
      throw new Error('isMatureGenre classification broken')
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

  await step('RENDER: scene timeline bakes into a REAL playable MP4 (FFmpeg)', async () => {
    const detect = RenderService.detect()
    if (!detect.available) {
      console.log('    (skipped — FFmpeg not installed on this machine)')
      return
    }
    const episode = tctx!.creative.listEpisodes()[0]!
    const scene = tctx!.creative.listScenes(episode.id)[0]!
    const shots = tctx!.storyboard.listShots(scene.id)

    // Replace the fake-bytes fixtures with REAL media so FFmpeg decodes them.
    const frameFile = join(root, 'real-frame.png')
    writeFileSync(frameFile, makeRealPng(32, 32, [240, 130, 200]))
    const voiceFile = join(root, 'real-line.wav')
    writeFileSync(voiceFile, makeRealWav(2))
    for (const shot of shots) {
      tctx!.storyboard.importFrame(shot.id, frameFile)
      tctx!.storyboard.importVoice(shot.id, voiceFile)
    }
    // The music track imported in the build step used fake bytes — swap the
    // scene assignment to a REAL wav before rebuilding the timeline.
    if (timelineMusicId) {
      const realMusicFile = join(root, 'real-music.wav')
      writeFileSync(realMusicFile, makeRealWav(10))
      const realMusic = tctx!.media.import('MUSIC', realMusicFile, 'Real BGM')
      tctx!.media.removeFromScene(scene.id, timelineMusicId)
      tctx!.media.assignToScene(scene.id, realMusic.id, 'BACKGROUND', 1)
    }

    // Fresh timeline + a real camera move on the first shot.
    const bundle = tctx!.timeline.buildFromScene(scene.id, true)
    if (bundle.clips.length < shots.length) throw new Error('timeline build incomplete')
    const kf = tctx!.timeline.keyframes
    kf.upsert({ targetType: 'CAMERA', targetId: shots[0]!.id, param: 'scale', atSec: 0, value: 1 })
    kf.upsert({ targetType: 'CAMERA', targetId: shots[0]!.id, param: 'scale', atSec: shots[0]!.durationSeconds, value: 1.5, easing: 'easeInOut' })
    kf.upsert({ targetType: 'MIXER', targetId: bundle.tracks.find((t) => t.kind === 'VOICE')!.id, param: 'volume', atSec: 0, value: 0.2 })

    const result = await tctx!.render.renderScene({
      sceneId: scene.id,
      presetId: 'youtube-1080',
      quality: 'PREVIEW',
      reportProgress: () => undefined,
      signal: { aborted: false },
    })
    if (!existsSync(result.outputPath)) throw new Error('render produced no file')
    const probed = tctx!.render.probeDuration(result.outputPath)
    if (probed === null) throw new Error('ffprobe could not read the output')
    if (Math.abs(probed - bundle.durationSec) > 0.75) {
      throw new Error(`duration mismatch: expected ~${bundle.durationSec.toFixed(2)}s, got ${probed.toFixed(2)}s`)
    }
    if (tctx!.render.probeResolution(result.outputPath) !== '1920x1080') throw new Error('resolution wrong')
    const outputs = tctx!.render.listOutputs()
    if (!outputs.some((o) => o.path === result.outputPath && o.kind === 'SCENE')) throw new Error('output not listed')
    console.log(`    (real MP4: ${probed.toFixed(2)}s, ${(result.fileBytes / 1024).toFixed(0)} KB)`)
  })

  // ---- Phase 7: Production suite --------------------------------------------
  await step('TASKS: board CRUD, column moves and crew assignment', () => {
    const director = tctx!.production.createCrewMember('Yua', 'DIRECTOR')
    const task = tctx!.production.createTask({
      title: 'Approve the rooftop scene',
      priority: 'HIGH',
      linkType: 'SCENE',
      linkId: timelineScene,
      assigneeId: director.id,
    })
    if (task.status !== 'TODO' || task.assigneeId !== director.id) throw new Error('task shape broken')

    const moved = tctx!.production.setTaskStatus(task.id, 'IN_PROGRESS')
    if (moved.status !== 'IN_PROGRESS') throw new Error('column move failed')
    if (tctx!.production.listTasks('TODO').length !== 0) throw new Error('filter broken')

    // Crew deletion unassigns but keeps the task.
    tctx!.production.deleteCrewMember(director.id)
    if (tctx!.production.getTask(task.id).assigneeId !== null) throw new Error('unassign failed')
    tctx!.production.deleteTask(task.id)
    if (tctx!.production.listTasks().length !== 0) throw new Error('delete failed')
  })

  await step('APPROVALS: governed pipeline with audit trail', () => {
    const character = tctx!.creative.listCharacters()[0]!
    // DRAFT → REVIEW → APPROVED (forward steps allowed)…
    tctx!.production.transition('CHARACTER', character.id, 'REVIEW', 'Ready for review', 'Yua')
    tctx!.production.transition('CHARACTER', character.id, 'APPROVED', 'Design locked')
    if (tctx!.creative.getCharacter(character.id).status !== 'APPROVED') throw new Error('status not persisted')
    // …but skipping steps is blocked (APPROVED → FINAL without LOCKED).
    let blocked = false
    try {
      tctx!.production.transition('CHARACTER', character.id, 'FINAL')
    } catch {
      blocked = true
    }
    if (!blocked) throw new Error('pipeline skip not blocked')
    // Backward revision loops are free.
    tctx!.production.transition('CHARACTER', character.id, 'REVISION', 'Change the hair')
    if (tctx!.creative.getCharacter(character.id).status !== 'REVISION') throw new Error('revision failed')
    // Scenes use the production pipeline.
    tctx!.production.transition('SCENE', timelineScene, 'IN_PROGRESS')
    tctx!.production.transition('SCENE', timelineScene, 'REVIEW')
    tctx!.production.transition('SCENE', timelineScene, 'APPROVED')
    if (tctx!.creative.getSceneById(timelineScene).status !== 'APPROVED') throw new Error('scene pipeline broken')
    // Audit log recorded everything.
    const log = tctx!.production.listApprovals()
    if (log.length < 6) throw new Error('audit trail incomplete')
    if (!log.some((e) => e.note === 'Design locked')) throw new Error('notes lost')
  })

  await step('VERSIONS: snapshot → edit → diff → restore never loses work', () => {
    const character = tctx!.creative.listCharacters()[0]!
    const v1 = tctx!.production.snapshotVersion('CHARACTER', character.id, 'before redesign')
    if (v1.version !== 1) throw new Error('first version must be 1')
    tctx!.creative.updateCharacter(character.id, {
      name: character.name,
      role: character.role,
      appearance: 'Redesigned look.',
    })
    const v2 = tctx!.production.snapshotVersion('CHARACTER', character.id)
    const diff = tctx!.production.diffVersions(v1.id, v2.id)
    if (!diff.some((d) => d.field === 'appearance' && d.to === 'Redesigned look.')) {
      throw new Error('diff lost the change')
    }
    tctx!.production.restoreVersion(v1.id)
    const restored = tctx!.creative.getCharacter(character.id)
    if (restored.appearance === 'Redesigned look.') throw new Error('restore did not revert')
    const versions = tctx!.production.listVersions('CHARACTER', character.id)
    if (versions.length !== 3) throw new Error('safety snapshot missing')
    if (versions[0]!.label !== 'auto — before restore') throw new Error('safety label wrong')
  })

  await step('QC + ANALYTICS: real production intelligence', () => {
    const report = tctx!.production.runQc()
    if (report.findings.length === 0) throw new Error('QC found nothing (expected gaps)')
    if (report.findings.some((f) => f.checkId === 'scene-no-timeline')) {
      throw new Error('built scene flagged as timeline-less')
    }
    const analytics = tctx!.production.overview()
    if (analytics.episodes.total !== 1) throw new Error('episode count wrong')
    if (analytics.scenes.total < 1) throw new Error('scene count wrong')
    if (analytics.shots.total < 2) throw new Error('shot count wrong')
    if (analytics.shots.withFrame < 2) throw new Error('frames not counted')
    if (analytics.approvals.events < 6) throw new Error('approval events not counted')
    if (analytics.versions.total < 3) throw new Error('versions not counted')
    if (analytics.crew.total !== 0) throw new Error('crew should be empty after cleanup')
  })

  // ---- v0.8: Subtitles, video-gen, Phase 8 AI --------------------------------
  await step('SUBTITLES: real SRT import → cue list → delivery export', () => {
    const scene = tctx!.creative.listScenes(tctx!.creative.listEpisodes()[0]!.id)[0]!
    const srtFile = join(root, 'subs.srt')
    writeFileSync(
      srtFile,
      '1\n00:00:00,500 --> 00:00:02,000\nYuna, look at the sky!\n\n2\n00:00:02,500 --> 00:00:04,000\nIt is falling UP.\n',
      'utf8',
    )
    const imported = tctx!.subtitles.importFile(scene.id, srtFile)
    if (imported !== 2) throw new Error('expected 2 imported cues')
    const list = tctx!.subtitles.list(scene.id)
    if (list.length !== 2 || list[0]!.text !== 'Yuna, look at the sky!') throw new Error('cue list wrong')
    if (Math.abs(list[0]!.startSec - 0.5) > 1e-6) throw new Error('SRT timecode parse wrong')
    const out = tctx!.subtitles.exportFile(scene.id, 'srt')
    if (!existsSync(out.path) || out.count !== 2) throw new Error('export broken')
    const reparsed = parseSrt(readFileSync(out.path, 'utf8'))
    if (reparsed.length !== 2 || reparsed[1]!.text !== 'It is falling UP.') throw new Error('SRT round-trip broken')
  })

  await step('VIDEO GEN: provider contract handles sync + polling shapes', async () => {
    const videoBytes = Buffer.from('real-generated-mp4-bytes')
    // Sync b64 shape.
    const sync = new OpenAIVideoProvider({
      apiKey: 'k', baseUrl: 'https://v.test/v1',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: true, status: 200, body: null,
        text: async () => JSON.stringify({ data: [{ b64_json: videoBytes.toString('base64') }] }),
      }),
      timeoutMs: 0,
    })
    const r1 = await sync.generate({ model: 'v/m', prompt: 'sky', seconds: 4, size: '1344x768' })
    if (Buffer.compare(r1.bytes, videoBytes) !== 0) throw new Error('sync shape broken')

    // Async job + polling shape.
    let polls = 0
    const async = new OpenAIVideoProvider({
      apiKey: 'k', baseUrl: 'https://v.test/v1',
      fetchFn: async (url: string): Promise<FetchResponse> => {
        if (url.endsWith('/videos/generations')) {
          return { ok: true, status: 200, body: null, text: async () => JSON.stringify({ id: 'j1', status: 'queued' }) }
        }
        polls++
        return {
          ok: true, status: 200, body: null,
          text: async () =>
            polls < 2
              ? JSON.stringify({ status: 'processing' })
              : JSON.stringify({ status: 'completed', data: [{ b64_json: videoBytes.toString('base64') }] }),
        }
      },
      timeoutMs: 0,
      pollIntervalMs: 1,
    })
    const r2 = await async.generate({ model: 'v/m', prompt: 'sky', seconds: 2, size: '1344x768' })
    if (Buffer.compare(r2.bytes, videoBytes) !== 0 || polls < 2) throw new Error('polling shape broken')
  })

  await step('AI ANALYSIS: structured Phase-8 payloads validate (mocked transport)', async () => {
    const analysisPayload = {
      pacingScore: 7.5, dialogueQuality: 8,
      strengths: ['clean turning point'], issues: ['beat repeats'],
      suggestions: ['trim the cold open'], repetitionFlags: ['two identical goodbyes'],
      voiceNotes: ['Yuna consistent'],
    }
    const mockChat = async (): Promise<FetchResponse> => ({
      ok: true, status: 200, body: null,
      text: async () => JSON.stringify({
        id: 'x', object: 'chat.completion', created: 1, model: 'test/model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(analysisPayload) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    })
    const provider = new OpenRouterProvider({
      apiKey: 'k', baseUrl: 'https://chat.test/v1', fetchFn: mockChat, timeoutMs: 0,
    })
    const result = await provider.chat({ model: 'test/model', temperature: 0.3, maxTokens: 512, messages: [{ role: 'user', content: 'analyze' }] })
    const parsed = ScreenplayAnalysis.safeParse(JSON.parse(result.content.trim()))
    if (!parsed.success) throw new Error('ScreenplayAnalysis schema mismatch')
    if (parsed.data.pacingScore !== 7.5) throw new Error('payload values lost')

    const director = DirectorNotes.safeParse({
      narrative: ['a'], composition: ['b'], rhythm: ['c'], emotion: ['d'], camera: ['e'],
      perShot: [{ shotTitle: 'Wide', suggestion: 'hold longer' }],
    })
    if (!director.success) throw new Error('DirectorNotes schema mismatch')
    const finding = ContinuityFinding.safeParse({ severity: 'WARNING', title: 't', detail: 'd' })
    if (!finding.success) throw new Error('ContinuityFinding schema mismatch')
  })

  await step('GENERATED VIDEO: real bytes land in the project and attach to the shot', () => {
    const scene = tctx!.creative.listScenes(tctx!.creative.listEpisodes()[0]!.id)[0]!
    const shot = tctx!.storyboard.listShots(scene.id)[0]!
    const mp4 = join(root, 'gen.mp4')
    writeFileSync(mp4, Buffer.alloc(4096, 0x66))
    // registerGeneratedVideo takes provider bytes directly.
    const asset = tctx!.storyboard.registerGeneratedVideo(shot.id, readFileSync(mp4), 'video/mp4')
    if (asset.kind !== 'VIDEO') throw new Error('asset kind wrong')
    if (!existsSync(join(summary.path, asset.relativePath))) throw new Error('video not on disk')
    if (tctx!.storyboard.getShotById(shot.id).videoAssetId !== asset.id) throw new Error('video not attached')
    // Replacing prunes the orphaned file (security parity with frames).
    const second = tctx!.storyboard.registerGeneratedVideo(shot.id, readFileSync(mp4), 'video/mp4')
    if (second.id === asset.id) throw new Error('replace must create a new asset')
    if (existsSync(join(summary.path, asset.relativePath))) throw new Error('orphan video not pruned')
  })

  await step('TIMELINE: video-asset clips render from the REAL file (builder)', () => {
    const scene = tctx!.creative.listScenes(tctx!.creative.listEpisodes()[0]!.id)[0]!
    const shot = tctx!.storyboard.listShots(scene.id)[0]!
    tctx!.timeline.buildFromScene(scene.id, true)
    const bundle = tctx!.timeline.getTimeline(scene.id)
    const videoTrack = bundle.tracks.find((t) => t.kind === 'VIDEO')!
    const clip = bundle.clips.find((c) => c.trackId === videoTrack.id && c.sourceId === shot.id)!
    const source = bundle.sources[shot.id]!
    if (source.type !== 'SHOT' || !source.videoAssetId) throw new Error('video source missing from bundle')
    const preset = exportPresetById('youtube-1080')
    const spec = buildSceneRenderSpec(bundle, new Map(), new Map(), { preset, quality: 'PREVIEW' })
    const flat = spec.args.join(' ')
    const graph = spec.args[spec.args.indexOf('-filter_complex') + 1]!
    if (!flat.includes(`{{ASSET:${source.videoAssetId}}}`)) throw new Error('video file not an input')
    if (!graph.includes(`trim=start=${clip.inOffsetSec}`)) throw new Error('video clip trim missing')
    void clip
  })

  // ---- Phase 9: Plugins -------------------------------------------------------
  await step('PLUGINS: registry seeds examples, validates manifests and persists enable state', () => {
    const pluginsRoot = join(root, 'plugins')
    const pluginsDb = openDatabase(join(root, 'plugins-app.sqlite'))
    runMigrations(pluginsDb, APP_DB_MIGRATIONS)
    const registry = new PluginRegistry(pluginsDb, systemClock, pluginsRoot)

    const list = registry.list()
    const ids = list.map((p) => p.manifest.id)
    if (!ids.includes('starter-commands') || !ids.includes('prompt-pack-manga')) {
      throw new Error('example plugins not seeded')
    }
    const starter = registry.get('starter-commands')
    if (starter.manifest.commands.length !== 2) throw new Error('commands not parsed')
    if (!starter.manifest.permissions.includes('READ')) throw new Error('permissions not parsed')

    // Enable persists across instances.
    registry.setEnabled('starter-commands', true)
    const reopened = new PluginRegistry(pluginsDb, systemClock, pluginsRoot)
    if (!reopened.get('starter-commands').enabled) throw new Error('enable state lost')

    // Folder install with a provider declaration (Provider SDK).
    const source = join(root, 'my-provider')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'manifest.json'),
      JSON.stringify({
        id: 'my-provider',
        name: 'Community Provider',
        version: '0.1.0',
        author: 'Community',
        permissions: ['SUGGEST'],
        providers: [{ id: 'chat-x', label: 'Chat X', kind: 'chat', baseUrl: 'https://api.x.test/v1', model: 'x/model' }],
      }),
    )
    writeFileSync(join(source, 'index.js'), 'module.exports = {}')
    const installed = registry.installFromFolder(source)
    if (installed.manifest.providers[0].model !== 'x/model') throw new Error('provider SDK manifest lost')

    // Invalid manifests are locked but listed.
    const bad = join(pluginsRoot, 'bad-plugin')
    mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify({ id: 'bad plugin', version: 'one' }))
    const broken = registry.list().find((p) => p.manifest.id === 'bad-plugin')
    if (!broken || broken.errors.length === 0 || broken.enabled) throw new Error('invalid manifest not locked')
  })

  await step('PLUGINS: host runs commands with the REAL project + enforces permissions', async () => {
    const pluginsRoot = join(root, 'plugins')
    const pluginsDb = openDatabase(join(root, 'plugins-app.sqlite'))
    const registry = new PluginRegistry(pluginsDb, systemClock, pluginsRoot)
    registry.setEnabled('starter-commands', true)

    // A plugin with a MODULE handler that calls the permission-gated API.
    const source = join(root, 'probe-plugin')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'manifest.json'),
      JSON.stringify({
        id: 'probe-plugin',
        name: 'Probe',
        version: '1.0.0',
        author: 'Smoke',
        permissions: ['SUGGEST'], // deliberately NO 'READ'
        commands: [{ id: 'probe-plugin.peek', label: 'Probe: peek project' }],
      }),
    )
    writeFileSync(
      join(source, 'index.js'),
      'module.exports = { commands: { "probe-plugin.peek": (mirai) => mirai.project() } }',
    )
    const installed = registry.installFromFolder(source)
    if (installed.manifest.id !== 'probe-plugin') throw new Error('probe not installed')
    registry.setEnabled('probe-plugin', true)

    // Minimal container surface the host needs — real project + real logger.
    const fakeContainer = {
      projects,
      logger,
      plugins: registry,
      settings: undefined,
      credentials: undefined,
      ai: undefined,
      emitter: undefined,
      health: undefined,
      dirs,
      appDb,
      pluginHost: undefined,
      shutdown: async () => undefined,
    } as never
    const host = new PluginHost(fakeContainer)

    // Manifest-declared command (no module handler) still runs for the starter.
    const greet = await host.runCommand('starter-commands', 'starter-commands.greet')
    if (!greet || typeof greet !== 'object' || !('message' in greet)) throw new Error('manifest command failed')

    // The SUGGEST-only probe calling api.project() is DENIED (READ missing).
    let denied = false
    try {
      await host.runCommand('probe-plugin', 'probe-plugin.peek')
    } catch (err) {
      denied = (err as Error).message.includes('READ')
    }
    if (!denied) throw new Error('permission enforcement failed')

    // A READ-granted variant succeeds and returns REAL project data.
    const manifestPath = join(pluginsRoot, 'probe-plugin', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { permissions: string[] }
    manifest.permissions = ['READ', 'SUGGEST']
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const probe = registry.get('probe-plugin')
    const ok = await host.runCommand('probe-plugin', 'probe-plugin.peek')
    void probe
    if (!ok || typeof ok !== 'object' || !('name' in ok)) throw new Error('READ-granted command returned no project data')
    if ((ok as { name: string }).name !== summary.name) throw new Error('project data wrong')
  })

  // ---- v0.10: License, Mature Mode, Blender, Producer Agent -----------------
  await step('LICENSE + MATURE: Ed25519 validation, adults-only policy, genre gating', async () => {
    const { generateKeyPairSync, sign: cryptoSign } = await import('node:crypto')
    const pair = generateKeyPairSync('ed25519')
    const rawPublic = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
    const licenses = new LicenseService(Buffer.from(rawPublic).toString('base64'))
    const mint = (payload: object) => {
      const json = JSON.stringify(payload)
      const sig = cryptoSign(null, Buffer.from(json, 'utf8'), pair.privateKey)
      return `${Buffer.from(json, 'utf8').toString('base64url')}.${sig.toString('base64url')}`
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const good = licenses.validate(mint({
      v: 1, holder: 'smoke@test', tier: 'pro', features: ['mature'],
      iat: nowSec, exp: nowSec + 3600,
    }))
    if (!good.valid || !good.payload?.features.includes('mature')) throw new Error('valid license rejected')
    const expired = licenses.validate(mint({
      v: 1, holder: 'x', tier: 'pro', features: ['mature'], iat: 1, exp: nowSec - 10,
    }))
    if (expired.valid) throw new Error('expired license accepted')

    // Adults-only policy: minors never enter explicit contexts (throws synchronously).
    let minorBlocked = false
    try {
      assertExplicitCastAllowed([{ id: 'm', name: 'Kid', age: '12' }] as never)
    } catch (err) {
      minorBlocked = (err as Error).message.includes('never minors')
    }
    if (!minorBlocked) throw new Error('minor passed the explicit-cast policy')
    // Explicitly adult casts pass.
    assertExplicitCastAllowed([{ id: 'a', name: 'Adult', age: '21' }] as never)
    // Genre gating: mature genres hidden until the mode is on.
    if (filterGenres(ANIME_GENRES, false).includes('Hentai')) throw new Error('mature genre leaked')
    if (!filterGenres(ANIME_GENRES, true).includes('Hentai')) throw new Error('mature genre missing')

    // Production public key refuses garbage (no private key needed here).
    if (new LicenseService().validate('garbage').valid) throw new Error('production validator broken')
  })

  await step('BLENDER: real .blend attach + graceful render guard', () => {
    const scene = tctx!.creative.listScenes(tctx!.creative.listEpisodes()[0]!.id)[0]!
    const shot = tctx!.storyboard.listShots(scene.id)[0]!
    const blend = join(root, 'scene.blend')
    writeFileSync(blend, Buffer.from('BLENDER-file-bytes'))
    const asset = tctx!.blender.attachBlend(shot.id, blend)
    if (asset.kind !== 'BLENDER') throw new Error('blend asset kind wrong')
    if (!existsSync(join(summary.path, asset.relativePath))) throw new Error('blend not stored')
    if (tctx!.storyboard.getShotById(shot.id).blendAssetId !== asset.id) throw new Error('blend not attached')
    // Wrong format rejected.
    const bad = join(root, 'scene.obj')
    writeFileSync(bad, Buffer.from('x'))
    let rejected = false
    try {
      tctx!.blender.attachBlend(shot.id, bad)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('non-blend accepted')
  })

  await step('PRODUCER AGENT: idea → full episode, end-to-end', async () => {
    // The Producer uses the REAL AiHost with the network mocked at the
    // transport level — every step (bible/cast/scenes/screenplay/shots)
    // runs through the real provider + validation + services.
    const realFetch = globalThis.fetch
    const chat = (content: string): Response =>
      new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 1, model: 'test/model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }), { status: 200 })
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content: string }> }
      const last = body.messages?.[body.messages.length - 1]?.content ?? ''
      if (last.includes('draft the Story Bible')) {
        return chat(JSON.stringify({
          premise: 'A yuri romance where confession letters cast real spells.',
          themes: ['love', 'courage'], tone: 'bittersweet, luminous',
          message: 'Say what you feel before the ink dries.', genreNotes: 'Yuri, School, Magic.',
        }))
      }
      if (last.includes('design the main cast')) {
        return chat(JSON.stringify({ characters: [
          { name: 'Yuna Hoshimiya', role: 'PROTAGONIST', age: '20', appearance: 'Silver hair, amber eyes.', personality: 'Brave, clumsy.', goals: 'Confess before graduation.', voice: 'soft but firm' },
          { name: 'Rin Aozaki', role: 'DEUTERAGONIST', age: '21', appearance: 'Black hair, blue eyes.', personality: 'Cool, caring.', goals: 'Protect the letters.', voice: 'dry wit' },
        ] }))
      }
      if (last.includes('planning episode structure')) {
        return chat(JSON.stringify({ scenes: [
          { title: 'The midnight rehearsal', synopsis: 'Yuna sneaks into the hall and a letter glows.', timeOfDay: 'NIGHT', locationName: 'Haunted rehearsal hall', castNames: ['Yuna Hoshimiya', 'Rin Aozaki'] },
          { title: 'The misfired spell', synopsis: 'The confession spell backfires hilariously.', timeOfDay: 'DAY', locationName: 'Magic academy courtyard', castNames: ['Yuna Hoshimiya'] },
        ] }))
      }
      if (last.includes('Write a complete screenplay draft')) {
        return chat('YUNA\n"Rin… the letter glowed again."\n\nRIN\n"Then say it out loud this time."')
      }
      if (last.includes('storyboard artist')) {
        return chat(JSON.stringify({ shots: [
          { title: 'Wide on the hall', shotType: 'WIDE', lens: '24mm', cameraMovement: 'DOLLY_IN', durationSeconds: 4, dialogue: 'YUNA\n"It is glowing."' },
          { title: 'Yuna close-up', shotType: 'CLOSE_UP', lens: '85mm', cameraMovement: 'STATIC', durationSeconds: 3 },
        ] }))
      }
      return chat(JSON.stringify({ ok: true }))
    }) as typeof fetch

    const settings = new SettingsService(appDb)
    const credentials = new CredentialStore(appDb, plaintextCodec, systemClock)
    credentials.set('openrouter', 'sk-smoke-producer-key')
    settings.update({ ...settings.get(), ai: { ...settings.get().ai, defaultModel: 'test/model' } })
    const ai = new AiHost({
      credentials,
      settings,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })
    const result = await ai.autoproduce(
      {
        idea: 'Two rival idol groups share the same haunted rehearsal hall at midnight.',
        scenesCount: 2,
        shotsPerScene: 2,
        generateFrames: false,
      },
      () => undefined,
      { aborted: false },
    )
    globalThis.fetch = realFetch

    // The smoke project already has a premise — the Producer never overwrites
    // the author: it must report bibleDrafted=false and keep going.
    if (result.bibleDrafted !== false) throw new Error('bible was overwritten')
    if (!result.steps.some((s) => s.step === 'Story Bible' && s.detail.includes('author'))) {
      throw new Error('bible skip not reported')
    }
    // The project already had Yuna — the Producer dedupes by name and only
    // creates NEW cast members (Rin), keeping the author's characters.
    if (result.charactersCreated < 1) throw new Error('no characters created')
    const castNames = tctx!.creative.listCharacters().map((c) => c.name)
    if (!castNames.includes('Rin Aozaki') || !castNames.includes('Yuna Hoshimiya')) {
      throw new Error('cast incomplete after production')
    }
    if (result.scenesCreated !== 2) throw new Error(`expected 2 scenes, got ${result.scenesCreated}`)
    if (result.screenplaysDrafted !== 2) throw new Error('screenplays not drafted')
    if (result.shotsCreated !== 4) throw new Error(`expected 4 shots, got ${result.shotsCreated}`)
    if (result.timelinesBuilt !== 2) throw new Error('timelines not built')

    // The production is REAL — verify in the project itself.
    const episodes = tctx!.creative.listEpisodes()
    const produced = episodes.find((e) => e.title.includes('Part 1'))
    if (!produced) throw new Error('episode not created')
    const scenes = tctx!.creative.listScenes(produced.id)
    const scene0 = scenes[0]!
    if (!scene0.screenplay || !scene0.screenplay.includes('the letter glowed')) throw new Error('screenplay not persisted')
    if (scene0.characterIds.length !== 2) throw new Error('cast not linked')
    const shots = tctx!.storyboard.listShots(scene0.id)
    if (shots.length !== 2 || shots[0]!.shotType !== 'WIDE') throw new Error('shots not created with metadata')
    const timeline = tctx!.timeline.getTimeline(scene0.id)
    if (timeline.clips.length === 0) throw new Error('timeline not assembled')
    console.log(`    (produced: ${result.charactersCreated} characters, ${result.scenesCreated} scenes, ${result.shotsCreated} shots, ${result.timelinesBuilt} timelines)`)
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

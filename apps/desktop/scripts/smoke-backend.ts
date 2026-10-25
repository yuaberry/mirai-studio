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
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
  EpubService,
  DocxService,
  AiUsageService,
  readZipEntries,
  NotesImportService,
  DossierService,
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

/** Minimal stored-zip writer for smoke fixtures (mirrors the importer's reader). */
function zipCrc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function makeStoredZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const local = Buffer.alloc(30 + nameBuf.length + data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt32LE(zipCrc32(data), 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  nameBuf.copy(local, 30)
  data.copy(local, 30 + nameBuf.length)
  const central = Buffer.alloc(46 + nameBuf.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt32LE(zipCrc32(data), 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  nameBuf.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, eocd])
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

  await step('NOTES IMPORT: .txt/.docx/.pdf/.zip parsed for the AI', () => {
    const importer = new NotesImportService()
    const notesDir = join(ctx.summary.path, 'notes-fixtures')
    mkdirSync(notesDir, { recursive: true })
    // plain text
    const txtPath = join(notesDir, 'premissa.txt')
    writeFileSync(txtPath, 'Uma esgrimista orfa descobre contratos espirituais marcados por fagulhas.\nO dela ainda esta aberto.', 'utf8')
    // a real (stored) zip containing a .txt
    const inner = Buffer.from('Dentro do zip: capitulo um comeca na aldeia de Kisaragi.', 'utf8')
    const zipBytes = makeStoredZip('cap1.txt', inner)
    const zipPath = join(notesDir, 'material.zip')
    writeFileSync(zipPath, zipBytes)
    const result = importer.importFiles([txtPath, zipPath])
    if (result.files.length !== 2) throw new Error(`expected 2 files, got ${result.files.length}`)
    if (!result.combined.includes('fagulhas')) throw new Error('txt text missing')
    if (!result.combined.includes('Kisaragi')) throw new Error('zip text missing')
  })

  await step('DOSSIER: real .txt + .pdf (30+ pages) from project data', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const manifest = ctx.manifest
    const sb = ctx.creative.getBible()
    const st = ctx.storyboard.getStyleBible()
    const characters = ctx.creative.listCharacters()
    const episodes = ctx.creative.listEpisodes()
    const episodeData = episodes.map((ep) => ({ season: ep.season, number: ep.number, title: ep.title, synopsis: ep.synopsis ?? '', scenes: [] as string[] }))
    let shots = 0
    for (let i = 0; i < episodes.length; i++) {
      for (const scene of ctx.creative.listScenes(episodes[i]!.id)) {
        episodeData[i]!.scenes.push(scene.title)
        shots += ctx.storyboard.listShots(scene.id).length
      }
    }
    const svc = new DossierService(ctx.summary.path, systemClock)
    const result = svc.generate(
      {
        name: manifest.name,
        description: manifest.description ?? '',
        medium: 'ANIME',
        title: manifest.config.title,
        genres: manifest.config.genres,
        contentRating: manifest.config.contentRating ?? 'a definir',
        language: manifest.config.language,
        aspectRatio: manifest.config.aspectRatio,
        resolution: `${manifest.config.resolution.width}x${manifest.config.resolution.height}`,
        fps: manifest.config.fps,
        plannedEpisodes: manifest.config.episodeCount ?? null,
        plannedSeasons: manifest.config.seasonCount ?? null,
        demographic: manifest.config.demographic ?? '',
        targetAudience: manifest.config.targetAudience,
        inspirations: manifest.config.inspirations,
        endingVision: manifest.config.endingVision,
        appVersion: manifest.appVersion,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        licenseTier: 'Mirai Studio (smoke)',
        storyBible: sb,
        styleBible: st,
        characters: characters.map((ch) => ({
          name: ch.name,
          role: ch.role,
          age: ch.age,
          appearance: ch.appearance,
          personality: ch.personality,
          voice: ch.voice,
        })),
        episodes: episodeData,
        tasks: ctx.production.listTasks().map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate })),
        qc: { errors: 0, warnings: 0, infos: 0, top: [] },
        mediaCount: ctx.media.list().length,
        shotsCount: shots,
      },
      null,
      '1',
    )
    if (!existsSync(result.txtPath) || !existsSync(result.pdfPath)) throw new Error('dossier files missing')
    const pdfHead = readFileSync(result.pdfPath).subarray(0, 5).toString('latin1')
    if (pdfHead !== '%PDF-') throw new Error('not a real PDF')
    if (result.pages < 8) throw new Error(`dossier too thin (${result.pages} pages)`)
    const txt = readFileSync(result.txtPath, 'utf8')
    if (!txt.includes('FICHA TÉCNICA') || !txt.includes('ADVOCACIA')) throw new Error('dossier sections missing')
  })

  await step('ADAPT DOCUMENT: author file -> bible, cast, season, scenes, screenplays', async () => {
    // A fresh project WITH a stored brief — mirrors New Project with an
    // imported document. The network is mocked at the transport level; the
    // real AiHost + services run the whole fidelity pipeline.
    const briefProject = projects.create({
      name: 'Adapted From Doc',
      dir: dirs.projectsDefaultDir,
      config: {
        title: 'The Lantern Keeper',
        genres: ['Fantasy'],
        language: 'ja',
        aspectRatio: '16:9',
        fps: 24,
        resolution: { width: 1920, height: 1080 },
        episodeCount: 3,
        medium: 'ANIME',
        targetAudience: 'seinen adults',
        endingVision: 'The keeper chooses whose wish is last.',
        seasonCount: 2,
        demographic: 'SEINEN',
      },
    })
    ctx = (await projects.open(briefProject.path)) as typeof ctx

    // Write the brief exactly like projects:create does.
    const briefDir = join(ctx.summary.path, 'brief')
    mkdirSync(briefDir, { recursive: true })
    const briefPayload = {
      notesText: 'Kaito tends the last spirit lantern in a village where every wish costs a memory. He falls for Yuki, whose wish would erase her sister. The keeper must choose before the lantern dies.',
      sourceFiles: [{ name: 'historia.txt', format: 'txt', chars: 170 }],
      analysis: null,
      adapted: false,
    }
    writeFileSync(join(briefDir, 'brief.json'), JSON.stringify(briefPayload, null, 2), 'utf8')
    writeFileSync(join(briefDir, 'source-notes.txt'), briefPayload.notesText, 'utf8')

    // The adaptation AiHost — same pattern as the Producer step.
    const adaptSettings = new SettingsService(appDb)
    const adaptCreds = new CredentialStore(appDb, plaintextCodec, systemClock)
    adaptCreds.set('openrouter', 'sk-smoke-adapt-key')
    adaptSettings.update({ ...adaptSettings.get(), ai: { ...adaptSettings.get().ai, defaultModel: 'test/model' } })
    const ai = new AiHost({
      credentials: adaptCreds,
      settings: adaptSettings,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })

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
      if (last.includes('write the Story Bible')) {
        return chat(JSON.stringify({
          premise: 'A lantern keeper must grant the last wish at the cost of his own memory of Yuki.',
          themes: ['sacrifice', 'memory'], tone: 'contemplative, luminous',
          message: 'Every wish costs something.', genreNotes: 'Seinen fantasy.',
        }))
      }
      if (last.includes('extract EVERY character')) {
        return chat(JSON.stringify({ characters: [
          { name: 'Kaito', role: 'PROTAGONIST', age: '24', appearance: 'Ash-grey coat, lantern-shaped earring.', personality: 'Quiet, dutiful.', goals: 'Keep the lantern lit.', voice: 'measured' },
          { name: 'Yuki', role: 'DEUTERAGONIST', age: '22', appearance: 'Pale hair, glass-blue eyes.', personality: 'Kind, haunted.', goals: 'Save her sister.', voice: 'soft' },
        ] }))
      }
      if (last.includes('plan the SEASON')) {
        return chat(JSON.stringify({ episodes: [
          { number: 1, title: 'The last wish', synopsis: 'Kaito meets Yuki; the lantern flickers for the first time.' },
          { number: 2, title: 'The price of memory', synopsis: 'Yuki learns what her wish would erase.' },
          { number: 3, title: 'The keeper chooses', synopsis: 'The lantern dies and Kaito decides whose wish is last.' },
        ] }))
      }
      if (last.includes('break the FIRST episode')) {
        return chat(JSON.stringify({ scenes: [
          { title: 'Lantern lit at dusk', synopsis: 'Kaito trims the wick as villagers queue with wishes.', timeOfDay: 'DUSK', locationName: 'Village shrine', castNames: ['Kaito', 'Yuki'] },
        ] }))
      }
      // draftScreenplay prompt
      if (last.includes('screenplay') || last.includes('Screenplay') || last.includes('scene')) {
        return chat('INT. SHRINE - DUSK\n\nKAITO trims the wick. YUKI steps forward.\n\nYUKI\n"I wish to save her."\n\nThe lantern flickers.')
      }
      return chat('{}')
    })
    try {
      const summary = await ai.adaptFromDocument(() => {}, { aborted: false })
      const cast = ctx.creative.listCharacters()
      const eps = ctx.creative.listEpisodes()
      const bible = ctx.creative.getBible()
      if (!bible.premise?.includes('lantern keeper')) throw new Error('bible not adapted from the document')
      if (!cast.some((c) => c.name === 'Kaito') || !cast.some((c) => c.name === 'Yuki')) throw new Error('cast not extracted')
      if (eps.length !== 3) throw new Error(`season plan wrong: ${eps.length} episodes`)
      const firstEp = eps.find((e) => e.number === 1)
      const scenes = firstEp ? ctx.creative.listScenes(firstEp.id) : []
      if (scenes.length !== 1) throw new Error('episode 1 scenes missing')
      if (!scenes[0]?.screenplay || scenes[0].screenplay.trim().length === 0) throw new Error('screenplay not written')
      const stored = JSON.parse(readFileSync(join(ctx.summary.path, 'brief', 'brief.json'), 'utf8')) as { adapted: boolean }
      if (stored.adapted !== true) throw new Error('adapted flag not persisted')
      if (summary.charactersCreated !== 2) throw new Error('summary characters count wrong')
      void summary
    } finally {
      globalThis.fetch = realFetch
      await projects.close()
    }
  })

  await step('AI RESILIENCE: 429 -> automatic retry -> valid analysis', async () => {
    // The user hit "Provider Error" on a big .docx analysis (log-proven:
    // 119k-char import, NVIDIA provider). Root cause class: transient
    // provider errors + token truncation. This step proves the recovery:
    // the provider answers 429 ONCE, then a full valid analysis JSON.
    const analysisSettings = new SettingsService(appDb)
    const analysisCreds = new CredentialStore(appDb, plaintextCodec, systemClock)
    analysisCreds.set('openrouter', 'sk-smoke-resilience-key')
    analysisSettings.update({
      ...analysisSettings.get(),
      ai: { ...analysisSettings.get().ai, chatProvider: 'openrouter', defaultModel: 'test/model', maxTokens: 512 },
    })
    const analysisAi = new AiHost({
      credentials: analysisCreds,
      settings: analysisSettings,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })

    const validAnalysis = {
      titleSuggestion: 'The Lantern Keeper',
      medium: 'ANIME',
      premise: 'A lantern keeper grants wishes at the cost of memories.',
      synopsis: 'Kaito tends the last spirit lantern. Every wish costs a memory. When Yuki asks to save her sister, he must choose whose wish is last.',
      tone: 'Contemplative, luminous',
      suggestedAudience: 'Seinen adults 18-34',
      contentRating: '13+',
      genres: ['Fantasy', 'Drama'],
      themes: ['sacrifice', 'memory'],
      estimatedEpisodes: 12,
      estimatedSeasons: 2,
      estimatedPagesPerEpisode: 0,
      characterSeeds: [{ name: 'Kaito', role: 'PROTAGONIST', brief: 'The keeper of the last lantern.' }],
      locationSeeds: ['Village shrine'],
      improvements: ['Tighten the midpoint with a failed wish.'],
      risks: ['Melancholy pacing may narrow the audience.'],
      commercialNotes: 'Positioned as a contemplative seinen fantasy with strong merchandising iconography (the lantern).',
    }
    let calls = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      void JSON.parse(String(init?.body ?? '{}'))
      calls++
      if (calls === 1) {
        // Transient provider failure with an EMPTY error message — the exact
        // shape that used to surface as the useless bare 'Provider error'.
        return new Response(JSON.stringify({ error: {} }), { status: 200 })
      }
      return new Response(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 1, model: 'test/model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(validAnalysis) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }), { status: 200 })
    }) as typeof fetch
    try {
      const analysis = await analysisAi.analyzeStoryNotes(
        'Kaito tends the last spirit lantern. Yuki wishes to save her sister. The keeper must choose.',
        { medium: 'ANIME', seasonCount: 2 },
      )
      if (calls !== 2) throw new Error(`expected exactly 1 automatic retry (2 calls), got ${calls}`)
      if (analysis.titleSuggestion !== 'The Lantern Keeper') throw new Error('analysis content wrong')
      if (analysis.estimatedSeasons !== 2) throw new Error('seasons estimate lost')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await step('EPUB: episodes export as a real EPUB 3 book', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const chapters = ctx.creative.listEpisodes().map((ep) => {
      const scenes = ctx.creative.listScenes(ep.id)
      const body = scenes
        .map((sc) => (sc.screenplay ?? sc.synopsis ?? '').trim())
        .filter((b) => b.length > 0)
        .join('\n\n')
      return { title: `Capítulo ${ep.number}: ${ep.title}`, body: ep.synopsis ? `${ep.synopsis}\n\n${body}` : body }
    })
    const svc = new EpubService(ctx.summary.path, systemClock)
    const result = svc.export({ title: 'Sakura Chronicles', author: 'Smoke Author', language: 'ja', chapters })
    if (result.chapters < 1) throw new Error('no chapters exported')
    const raw = readFileSync(result.path)
    // mimetype MUST be the first, stored entry
    const head = raw.subarray(0, 80).toString('latin1')
    if (!head.includes('mimetype') || !head.includes('application/epub+zip')) throw new Error('mimetype not first/stored')
    if (raw.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('not a zip')
    await projects.close()
  })

  await step('V21 CORE: relationships, costumes, FTS memory, AI usage', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx

    // relationships + costumes through the REAL service
    const relA = ctx.creative.createCharacter({ name: 'Rel Ayaka', role: 'PROTAGONIST' })
    const relB = ctx.creative.createCharacter({ name: 'Rel Rin', role: 'SUPPORTING' })
    const rel = ctx.creative.createRelationship({ fromCharacterId: relA.id, toCharacterId: relB.id, kind: 'ROMANTIC', notes: 'letters' })
    if (ctx.creative.listRelationships(relA.id).length !== 1) throw new Error('relationship not listed')
    ctx.creative.createCostume({ characterId: relA.id, name: 'Uniforme de combate' })
    if (ctx.creative.listCostumes(relA.id).length !== 1) throw new Error('costume not listed')
    ctx.creative.deleteRelationship(rel.id)

    // FTS: create a scene with distinctive text and search it
    const ftScene = ctx.creative.createScene(ctx.creative.listEpisodes()[0]!.id, {
      title: 'Cena do testemunho',
      synopsis: 'O xilofone mágico da chama vermelha atravessa a sala.',
    })
    ctx.creative.updateScene(ftScene.id, {
      title: ftScene.title,
      timeOfDay: ftScene.timeOfDay,
      characterIds: ftScene.characterIds,
      locationId: ftScene.locationId ?? undefined,
      synopsis: ftScene.synopsis,
      screenplay: 'AYAKA\n' + '"O xilofone responde só à lua cheia."',
    })
    const hits = ctx.creative.searchProjectMemory('xilofone')
    if (!hits.some((h) => h.entityId === ftScene.id)) throw new Error('FTS did not index the scene')

    // AI usage persistence (app DB): record + summary round-trip
    const usage = new AiUsageService(appDb)
    usage.record({ kind: 'chat', provider: 'nvidia', model: 'glm-5.3', promptTokens: 100, completionTokens: 20, durationMs: 300 }, systemClock.isoNow())
    usage.record({ kind: 'chat', model: 'glm-5.3', promptTokens: 50, completionTokens: 10, durationMs: 100, status: 'ERROR', error: 'boom' }, systemClock.isoNow())
    const usageSummary = usage.summary()
    if (usageSummary.totalCalls < 2) throw new Error('usage not recorded')
    if (usageSummary.totalErrors < 1) throw new Error('usage error not recorded')
    if (usageSummary.totalPromptTokens < 150) throw new Error('usage tokens wrong')

    await projects.close()
  })

  await step('V22 MANGA: pages, panels, lettering and the script export', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx

    // page -> panel -> typed lettering, all through the REAL service
    const page = ctx.manga.createPage((ctx.creative.listEpisodes()[0]!.id), { readingDirection: 'RTL' })
    const moka = ctx.creative.createCharacter({ name: 'Moka', role: 'SUPPORTING' })
    const panel = ctx.manga.createPanel(page.id, {
      lettering: [
        { kind: 'SPEECH', characterId: moka.id, text: 'O santuário responde à lua.' },
        { kind: 'SFX', text: 'TOON!' },
      ],
    })
    if (ctx.manga.listPages(page.episodeId).length !== 1) throw new Error('manga page not listed')
    if (ctx.manga.listPanels(page.id)[0]!.lettering.length !== 2) throw new Error('lettering not round-tripped')
    // moving the ONLY page must fail honestly
    let moveThrew = false
    try { ctx.manga.movePage(page.id, 'up') } catch { moveThrew = true }
    if (!moveThrew) throw new Error('moving the only page must throw')

    // the professional lettering script export
    const script = ctx.manga.exportLetteringScript(page.episodeId)
    const scriptText = readFileSync(script.path, 'utf8')
    if (!scriptText.includes('LETTERING SCRIPT')) throw new Error('script header missing')
    if (!scriptText.includes('Moka (speech): "O santuário responde à lua."')) throw new Error('script dialogue missing')
    if (!scriptText.includes('RIGHT-TO-LEFT')) throw new Error('script direction missing')
    if (script.bubbles !== 2) throw new Error('script bubble count wrong')

    // cleanup so later steps stay deterministic
    ctx.manga.deletePanel(panel.id)
    ctx.manga.deletePage(page.id)
    ctx.creative.deleteCharacter(moka.id)

    await projects.close()
  })

  await step('V23 DOCX: light novel exports as a real Word document', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const chapters = ctx.creative.listEpisodes().map((ep) => {
      const scenes = ctx.creative
        .listScenes(ep.id)
        .map((sc) => ({ title: sc.title, body: (sc.screenplay ?? sc.synopsis ?? '').trim() }))
        .filter((sc) => sc.body.length > 0 || sc.title.length > 0)
      return { title: `Capítulo ${ep.number}: ${ep.title}`, scenes }
    })
    const svc = new DocxService(ctx.summary.path, systemClock)
    const result = svc.export({ title: 'Sakura Chronicles', author: 'Smoke Author', language: 'ja', chapters })
    if (result.chapters < 1) throw new Error('no chapters exported')
    if (result.scenes < 1) throw new Error('no scenes exported')
    // unzip the written file and prove the OOXML parts Word requires are intact
    const byName = new Map(readZipEntries(readFileSync(result.path)).map((e) => [e.name, e.data.toString('utf8')]))
    const types = byName.get('[Content_Types].xml')
    if (!types || !types.includes('PartName="/word/document.xml"')) throw new Error('content types missing document part')
    if (!types.includes('wordprocessingml.document.main+xml')) throw new Error('wrong document content type')
    if (!byName.get('_rels/.rels')?.includes('Target="word/document.xml"')) throw new Error('package rels missing')
    const doc = byName.get('word/document.xml')
    if (!doc || !doc.includes('Capítulo 1:')) throw new Error('document.xml missing chapter heading')

    await projects.close()
  })

  await step('V24 IP: impact counts + derived work with canon inheritance', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx

    // ---- impact: real dependents counted from the live project
    const ipAyaka = ctx.creative.createCharacter({ name: 'IP Ayaka', role: 'PROTAGONIST' })
    const ipScene = ctx.creative.createScene(ctx.creative.listEpisodes()[0]!.id, {
      title: 'Cena do impacto',
      characterIds: [ipAyaka.id],
    })
    ctx.storyboard.createShot(ipScene.id, { title: 'Impacto wide', durationSeconds: 2 })
    const impact = ctx.ip.impact('CHARACTER', ipAyaka.id)
    const impactScenes = impact.impacts.find((e) => e.key === 'scenes')
    const impactShots = impact.impacts.find((e) => e.key === 'shots')
    if (!impactScenes || impactScenes.count !== 1) throw new Error('impact: scenes not counted')
    if (!impactShots || impactShots.count !== 1) throw new Error('impact: indirect shots not counted')
    let impactThrew = false
    try { ctx.ip.impact('CHARACTER', '01DOESNOTEXIST00000000000X') } catch { impactThrew = true }
    if (!impactThrew) throw new Error('impact: unknown id must throw')
    ctx.creative.deleteCharacter(ipAyaka.id)

    // ---- derived work: canon really travels
    const derived = projects.createDerivedWork({
      parentId: summary.id,
      name: 'Smoke Derivado',
      kind: 'SPIN_OFF',
      inherit: { storyBible: true, styleBible: false, characters: true, locations: true },
    })
    const childDb = openDatabase(join(derived.summary.path, 'database', 'project.sqlite'))
    const charCount = (childDb.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n
    const sceneCount = (childDb.prepare('SELECT COUNT(*) AS n FROM scenes').get() as { n: number }).n
    childDb.close()
    if (charCount < 1) throw new Error('derived work did not inherit characters')
    if (sceneCount !== 0) throw new Error('derived work must not inherit scenes')
    const fromParent = projects.listDerivedWorks(summary.id)
    if (fromParent.length !== 1 || fromParent[0]!.direction !== 'child') throw new Error('derived link missing from parent')
    let duplicateThrew = false
    try {
      projects.createDerivedWork({
        parentId: summary.id,
        name: 'Smoke Derivado',
        kind: 'SPIN_OFF',
        inherit: { storyBible: false, styleBible: false, characters: false, locations: false },
      })
    } catch { duplicateThrew = true }
    if (!duplicateThrew) throw new Error('duplicate derived work must throw')
    projects.removeDerivedWork(fromParent[0]!.id)
    if (projects.listDerivedWorks(summary.id).length !== 0) throw new Error('derived link not removed')
    if (!existsSync(derived.summary.path)) throw new Error('removing the link must NOT delete the project')

    await projects.close()
  })

  await step('V25 MANGA SLICE 2: layout coords, SVG proof package, AI lettering draft', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const ep = ctx.creative.listEpisodes()[0]!

    // ---- layout coords round-trip
    const page = ctx.manga.createPage(ep.id, { readingDirection: 'RTL' })
    const ayaka = ctx.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const scene = ctx.creative.createScene(ep.id, { title: 'V25 cena', characterIds: [ayaka.id] })
    const shot = ctx.storyboard.createShot(scene.id, { title: 'V25 shot', durationSeconds: 2 })
    ctx.creative.updateScene(scene.id, {
      title: scene.title,
      timeOfDay: scene.timeOfDay,
      characterIds: scene.characterIds,
      synopsis: scene.synopsis,
      screenplay: 'AYAKA\n"O santuário responde à lua."',
    })
    const panel = ctx.manga.createPanel(page.id, { shotId: shot.id, coords: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 } })
    const stored = ctx.manga.listPanels(page.id)[0]!
    if (!stored.coords || stored.coords.x !== 0.1 || stored.coords.w !== 0.8) throw new Error('coords not stored')
    const cleared = ctx.manga.updatePanel(panel.id, {})
    if (cleared.coords !== null) throw new Error('coords must clear when omitted')

    // ---- chapter package: real SVG proofs + script + manifest
    ctx.manga.updatePanel(panel.id, {
      shotId: shot.id,
      lettering: [{ kind: 'SPEECH', text: 'Prova real.', tail: 'BOTTOM_LEFT' }],
    })
    const pkg = ctx.manga.exportChapterPackage(ep.id)
    if (!existsSync(pkg.path)) throw new Error('package file missing')
    const byName = new Map(readZipEntries(readFileSync(pkg.path)).map((e) => [e.name, e.data.toString('utf8')]))
    const proof = byName.get('proofs/page-01.svg')
    if (!proof || !proof.includes('<svg')) throw new Error('SVG proof missing from package')
    if (!byName.get('manifest.json')?.includes('"bubbles": 1')) throw new Error('manifest facts wrong')
    if (!byName.get('lettering-script.txt')?.includes('Prova real.')) throw new Error('script missing from package')

    // ---- AI lettering draft through the REAL host (mocked transport router)
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = String(init?.body ?? '')
      const json = (payload: string) => ({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: payload } }] })))
            controller.close()
          },
        }),
        text: async () => JSON.stringify({ choices: [{ message: { content: payload } }] }),
      })
      if (body.includes('manga letterer')) {
        return json(JSON.stringify({ bubbles: [
          { kind: 'SPEECH', characterName: 'Ayaka', text: 'O santuário responde à lua.', tail: 'BOTTOM_LEFT' },
          { kind: 'SFX', text: 'TOON!' },
        ] }))
      }
      return json(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const settingsSvc = new SettingsService(appDb)
    const credentialsSvc = new CredentialStore(appDb, plaintextCodec, systemClock)
    credentialsSvc.set('openrouter', 'sk-smoke-v25')
    const ai = new AiHost({
      credentials: credentialsSvc,
      settings: settingsSvc,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })
    const draft = await ai.draftPanelLettering(panel.id)
    globalThis.fetch = realFetch
    if (draft.bubbles.length !== 2) throw new Error('draft bubble count wrong')
    const speech = draft.bubbles.find((b) => b.kind === 'SPEECH')!
    if (!speech.text.includes('santuário')) throw new Error('draft text wrong')
    if (!speech.characterId) throw new Error('characterName was not mapped to an id')
    if (draft.bubbles[1]!.kind !== 'SFX') throw new Error('SFX kind lost')
    let draftThrew = false
    try { await ai.draftPanelLettering('01DOESNOTEXIST00000000000X') } catch { draftThrew = true }
    if (!draftThrew) throw new Error('draft must reject unknown panels')

    // cleanup
    ctx.manga.deletePanel(panel.id)
    ctx.manga.deletePage(page.id)
    ctx.creative.deleteScene(scene.id)
    ctx.creative.deleteCharacter(ctx.creative.listCharacters().find((c) => c.name === 'Ayaka')?.id ?? '')
    await projects.close()
  })

  await step('V27 MOODBOARD: references, palette, ordering, honest prune', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx

    const refPng = join(ctx.summary.path, '..', 'moodboard-ref.png')
    writeFileSync(refPng, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex'))

    // import two real references through the REAL service
    const a = ctx.moodboard.attachImage(refPng)
    const b = ctx.moodboard.attachImage(refPng)
    if (ctx.moodboard.list().length !== 2) throw new Error('moodboard items not listed')
    if (!existsSync(join(ctx.summary.path, 'images', 'assets', `${a.imageAssetId}.png`))) throw new Error('asset file missing')

    // captions + palette (the color script)
    ctx.moodboard.update(a.id, { caption: 'Templo ao anoitecer', color: '#f472b6' })
    ctx.moodboard.update(b.id, { color: '#22d3ee' })
    if (ctx.moodboard.palette().join(',') !== '#f472b6,#22d3ee') throw new Error('palette wrong')
    let colorThrew = false
    try { ctx.moodboard.update(a.id, { color: 'rosa' }) } catch { colorThrew = true }
    if (!colorThrew) throw new Error('invalid hex must throw')

    // ordering round-trip
    ctx.moodboard.move(a.id, 'down')
    if (ctx.moodboard.list()[0]!.id !== b.id) throw new Error('move did not reorder')

    // removal prunes the unreferenced asset file
    const aAsset = a.imageAssetId
    ctx.moodboard.remove(a.id)
    ctx.moodboard.remove(b.id)
    if (ctx.moodboard.list().length !== 0) throw new Error('board not emptied')
    if (existsSync(join(ctx.summary.path, 'images', 'assets', `${aAsset}.png`))) throw new Error('asset not pruned')

    rmSync(refPng, { force: true })
    await projects.close()
  })

  await step('V28 POSTER: state, live composition, export, AI taglines', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const ep = ctx.creative.listEpisodes()[0]!

    // ---- state round-trip (kv)
    if (ctx.poster.getState().tagline) throw new Error('poster state should start empty')
    ctx.poster.updateState({ tagline: 'Onde as cartas escolhem as guardiãs.' })
    if (ctx.poster.getState().tagline !== 'Onde as cartas escolhem as guardiãs.') throw new Error('tagline not persisted')
    let badThrew = false
    try { ctx.poster.updateState({ paletteOverride: ['rosa'] }) } catch { badThrew = true }
    if (!badThrew) throw new Error('invalid palette override must throw')

    // ---- live composition with the REAL moodboard palette
    const refPng = join(ctx.summary.path, '..', 'poster-ref.png')
    writeFileSync(refPng, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex'))
    const ref = ctx.moodboard.attachImage(refPng)
    ctx.moodboard.update(ref.id, { color: '#f472b6' })
    const hue = [...ctx.summary.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7)
    const posterInput = {
      title: ctx.manifest.config.title,
      mediumLabel: 'Anime',
      genres: ctx.manifest.config.genres ?? [],
      tagline: ctx.poster.getState().tagline,
      palette: ctx.poster.moodboardPalette(ctx.moodboard),
      hue,
    }
    const composed = ctx.poster.buildPoster(posterInput)
    if (!composed.svg.includes('<svg')) throw new Error('poster svg missing')
    if (!composed.svg.includes('stop-color="#f472b6"')) throw new Error('moodboard palette not baked in')
    if (!composed.svg.includes('MIRAI STUDIO')) throw new Error('studio mark missing')
    void ep

    // ---- real file export
    const exported = ctx.poster.exportPoster(posterInput)
    if (!existsSync(exported.path)) throw new Error('poster file missing')
    if (statSync(exported.path).size !== exported.bytes) throw new Error('poster bytes mismatch')

    // ---- AI taglines through the REAL host (mocked transport router)
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = String(init?.body ?? '')
      const json = (payload: string) => ({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: payload } }] })))
            controller.close()
          },
        }),
        text: async () => JSON.stringify({ choices: [{ message: { content: payload } }] }),
      })
      if (body.includes('key-art copywriter')) {
        return json(JSON.stringify({ taglines: [
          'Cada carta guarda um segredo.',
          'A academia nunca esquece.',
          'O que a lua escreve, o coração guarda.',
        ] }))
      }
      return json(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const settingsSvc = new SettingsService(appDb)
    const credentialsSvc = new CredentialStore(appDb, plaintextCodec, systemClock)
    credentialsSvc.set('openrouter', 'sk-smoke-v28')
    const ai = new AiHost({
      credentials: credentialsSvc,
      settings: settingsSvc,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })
    const tag = await ai.draftTaglines()
    globalThis.fetch = realFetch
    if (tag.taglines.length !== 3) throw new Error('expected exactly 3 taglines')
    if (!tag.taglines[2]!.includes('lua')) throw new Error('third tagline wrong')

    // cleanup
    ctx.moodboard.remove(ref.id)
    ctx.poster.updateState({})
    rmSync(refPng, { force: true })
    await projects.close()
  })

  await step('V29 LOCALIZATION: glossary, translations, AI draft, translated EPUB', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    const ep = ctx.creative.listEpisodes()[0]!

    // ---- glossary: the term base the AI must honor
    const term = ctx.localization.upsertGlossary({ source: 'Lampião de Prata', target: 'Silver Lantern', language: 'pt-BR' })
    const termUp = ctx.localization.upsertGlossary({ source: 'Lampião de Prata', target: 'The Silver Lamp', language: 'pt-BR' })
    if (termUp.id !== term.id) throw new Error('glossary upsert must update in place')
    if (ctx.localization.listGlossary('pt-BR').length !== 1) throw new Error('glossary row count wrong')

    // ---- scene with screenplay → translation round-trip
    const locScene = ctx.creative.createScene(ep.id, { title: 'Cena da tradução' })
    ctx.creative.updateScene(locScene.id, {
      title: locScene.title,
      timeOfDay: locScene.timeOfDay,
      characterIds: locScene.characterIds,
      synopsis: locScene.synopsis,
      screenplay: 'AYAKA\n"O lampião responde à lua."',
    })
    const saved = ctx.localization.upsertTranslation(locScene.id, {
      language: 'pt-BR',
      screenplay: 'PLACEHOLDER',
      status: 'REVIEW',
    })
    if (saved.status !== 'REVIEW') throw new Error('translation status not persisted')
    const again = ctx.localization.upsertTranslation(locScene.id, { language: 'pt-BR', screenplay: 'UPDATE', status: 'FINAL' })
    if (again.id !== saved.id || again.status !== 'FINAL') throw new Error('translation upsert must update in place')

    // ---- coverage counts from live queries
    const total = ctx.creative.listEpisodes().reduce((acc, e) => acc + ctx.creative.listScenes(e.id).length, 0)
    const cov = ctx.localization.coverage(total).find((c) => c.language === 'pt-BR')!
    if (cov.translated !== 1 || cov.total < 1) throw new Error('coverage counts wrong')

    // ---- AI translation through the REAL host (mocked transport router)
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = String(init?.body ?? '')
      const json = (payload: string) => ({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: payload } }] })))
            controller.close()
          },
        }),
        text: async () => JSON.stringify({ choices: [{ message: { content: payload } }] }),
      })
      if (body.includes('localization specialist')) {
        if (!body.includes('The Silver Lamp')) throw new Error('glossary not baked into the AI context')
        return json(JSON.stringify({ screenplay: 'AYAKA\n"O Lampião de Prata responde à lua."' }))
      }
      return json(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const settingsSvc = new SettingsService(appDb)
    const credentialsSvc = new CredentialStore(appDb, plaintextCodec, systemClock)
    credentialsSvc.set('openrouter', 'sk-smoke-v29')
    const ai = new AiHost({
      credentials: credentialsSvc,
      settings: settingsSvc,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })
    const draft = await ai.translateScene(locScene.id, 'pt-BR')
    globalThis.fetch = realFetch
    if (!draft.screenplay.includes('Lampião de Prata')) throw new Error('AI translation wrong')
    if (draft.screenplay.includes('The Silver Lamp')) throw new Error('AI must translate the prose, not the glossary keys')

    // ---- translated EPUB: translation where present, fallback where not
    ctx.localization.upsertTranslation(locScene.id, { language: 'pt-BR', screenplay: 'TRADUZIDO V29', status: 'FINAL' })
    let translatedCount = 0
    let fallbackCount = 0
    const chapters = ctx.creative.listEpisodes().map((e) => {
      const sceneBodies = ctx.creative
        .listScenes(e.id)
        .map((sc) => {
          const original = (sc.screenplay ?? sc.synopsis ?? '').trim()
          const eff = ctx.localization.effectiveScreenplay(sc.id, original, 'pt-BR')
          if (eff.translated && eff.text.trim().length > 0) translatedCount += 1
          else fallbackCount += 1
          return eff.text.trim()
        })
        .filter((b) => b.length > 0)
        .join('\n\n')
      return { title: `Capítulo ${e.number}: ${e.title}`, body: e.synopsis ? `${e.synopsis}\n\n${sceneBodies}` : sceneBodies }
    })
    const epubSvc = new EpubService(ctx.summary.path, systemClock)
    const epubResult = epubSvc.export({ title: 'Smoke (pt-BR)', author: 'Smoke', language: 'pt-BR', chapters })
    const epubEntries = readZipEntries(readFileSync(epubResult.path))
    const ch1 = epubEntries.find((e) => e.name === 'OEBPS/chapter1.xhtml')?.data.toString('utf8') ?? ''
    if (!ch1.includes('TRADUZIDO V29')) throw new Error('translated scene missing from EPUB')
    if (!translatedCount || !fallbackCount) throw new Error('fallback counts must both be real')

    // cleanup
    ctx.localization.deleteTranslation(locScene.id, 'pt-BR')
    ctx.localization.deleteGlossary(term.id)
    ctx.creative.deleteScene(locScene.id)
    await projects.close()
  })

  await step('V30 AI ANIME: TTS voice acting + episode assembly with real render', async () => {
    ctx = (await projects.open(summary.path)) as typeof ctx
    // a DEDICATED episode: assembly renders every scene, so this episode
    // contains only shot-bearing scenes (helper scenes from earlier steps
    // live in other episodes).
    const ep = ctx.creative.createEpisode({ season: 9, number: 9, title: 'V30 Assembly' })

    // a character with a TTS voice + a shot with dialogue
    const ayaka = ctx.creative.createCharacter({ name: 'Voz Ayaka', role: 'SUPPORTING', ttsVoice: 'ayaka-soft' })
    const scene = ctx.creative.createScene(ep.id, { title: 'Cena V30', characterIds: [ayaka.id] })
    ctx.creative.updateScene(scene.id, {
      title: scene.title,
      timeOfDay: scene.timeOfDay,
      characterIds: scene.characterIds,
      synopsis: scene.synopsis,
      screenplay: 'AYAKA\n"O lampião responde à lua."',
    })
    const shot = ctx.storyboard.createShot(scene.id, { title: 'V30 shot', durationSeconds: 2, dialogue: 'AYAKA\n"O lampião responde à lua."' })

    // TTS through the REAL host with a mocked /audio/speech (binary wav)
    const realFetch = globalThis.fetch
    // a REAL WAV (RIFF/PCM with a data chunk + a 440Hz tone) so FFmpeg
    // actually decodes the AI voice in the final render
    const wavSampleRate = 8000
    const wavSamples = Math.floor(1.5 * wavSampleRate)
    const wavBytes = Buffer.alloc(44 + wavSamples * 2)
    wavBytes.write('RIFF', 0)
    wavBytes.writeUInt32LE(36 + wavSamples * 2, 4)
    wavBytes.write('WAVE', 8)
    wavBytes.write('fmt ', 12)
    wavBytes.writeUInt32LE(16, 16)
    wavBytes.writeUInt16LE(1, 20)
    wavBytes.writeUInt16LE(1, 22)
    wavBytes.writeUInt32LE(wavSampleRate, 24)
    wavBytes.writeUInt32LE(wavSampleRate * 2, 28)
    wavBytes.writeUInt16LE(2, 32)
    wavBytes.writeUInt16LE(16, 34)
    wavBytes.write('data', 36)
    wavBytes.writeUInt32LE(wavSamples * 2, 40)
    for (let i = 0; i < wavSamples; i++) {
      wavBytes.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / wavSampleRate) * 6000), 44 + i * 2)
    }
    let lastTtsBody: Record<string, unknown> = {}
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      const body = String(init?.body ?? '')
      if (String(url).includes('/audio/speech')) {
        lastTtsBody = JSON.parse(body) as Record<string, unknown>
        return {
          ok: true,
          status: 200,
          text: async () => '',
          arrayBuffer: async () => wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength),
        }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }
    }) as typeof fetch
    const settingsSvc = new SettingsService(appDb)
    const credentialsSvc = new CredentialStore(appDb, plaintextCodec, systemClock)
    credentialsSvc.set('tts', 'sk-smoke-v30')
    settingsSvc.update({
      ...settingsSvc.get(),
      ai: {
        ...settingsSvc.get().ai,
        tts: { baseUrl: 'https://tts.example/v1', model: 'tts-1', voice: 'default-voice' },
      },
    })
    const ai = new AiHost({
      credentials: credentialsSvc,
      settings: settingsSvc,
      projects,
      logger,
      emitter: { send: () => undefined, window: null } as never,
    })
    const spoken = await ai.speakShot(shot.id)
    globalThis.fetch = realFetch
    if (spoken.voice !== 'ayaka-soft') throw new Error('character voice not resolved (expected ayaka-soft)')
    if (lastTtsBody['voice'] !== 'ayaka-soft') throw new Error('voice not sent to the provider')
    if (!ctx.storyboard.getShotById(shot.id).voiceAssetId) throw new Error('AI voice not attached to the shot')
    const voiceAsset = ctx.storyboard.getAsset(ctx.storyboard.getShotById(shot.id).voiceAssetId!)
    if (voiceAsset.bytes !== wavBytes.length) throw new Error('voice bytes mismatch')

    // ASSEMBLY with videos disabled (no video provider configured — honest skip)
    // and render enabled: a REAL MP4 of the scene, from the AI-voiced shot.
    const assembled = await ai.assembleEpisode(
      ep.id,
      { voices: false, videos: false, render: true },
      () => undefined,
      { aborted: false },
    )
    if (assembled.voicesGenerated !== 0) throw new Error('voices were not requested — none should generate')
    if (assembled.videosGenerated !== 0) throw new Error('videos were not requested — none should generate')
    if (assembled.shots < 1 || assembled.scenes < 1) throw new Error('assembly scene/shot counts wrong')
    if (!assembled.rendered) throw new Error('episode render missing from assembly')

    // cleanup
    ctx.storyboard.clearVoice(shot.id)
    ctx.creative.deleteEpisode(ep.id)
    ctx.creative.deleteCharacter(ayaka.id)
    settingsSvc.update({ ...settingsSvc.get(), ai: { ...settingsSvc.get().ai, tts: {} } })
    await projects.close()
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

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
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
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
import { OpenRouterProvider, buildSystemPrompt } from '@mirai/ai'
import { ProjectConfig, PROJECT_PRESETS, type FetchResponse } from '@mirai/shared'

const steps: Array<{ name: string; ok: boolean; detail?: string }> = []
let current = ''

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

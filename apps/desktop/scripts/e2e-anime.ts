/**
 * E2E — the experimental anime production, driven through the REAL app.
 *
 * This is not a unit test with a mocked transport: it boots the actual
 * Electron main process, opens the actual renderer window and drives the
 * actual IPC bridge (renderer → preload → ipcMain → services → network).
 *
 * The providers are the REAL ones, on the free stack:
 *   · script/bible/characters/scenes/shots → NVIDIA NIM (real key)
 *   · frames                                → Pollinations classic (no key)
 *   · dubbing                               → Google Translate speech (no key)
 *   · video                                 → Pollinations media (Wan 2.2 —
 *     a key is REQUIRED; the step documents the vendor's answer instead of
 *     pretending the video exists)
 *
 * The last two steps DELETE the project forever and prove that nothing of
 * the experiment is left on disk — folder, database, frames, audio, the
 * dossier and the backups.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { bootstrap, type Container } from '../src/main/bootstrap'
import { registerIpcHandlers } from '../src/main/ipc/register'
import { declareAssetScheme, registerAssetProtocol } from '../src/main/assets/assetProtocol'
import { ProjectConfig, PROJECT_PRESETS, type AppSettings } from '@mirai/shared'

// The credentials live in the app's userData and are encrypted with the OS
// keyring — the app name MUST match the installed app for the key to match.
app.setName('@mirai/desktop')
app.setPath('userData', join(homedir(), '.config/@mirai/desktop'))

/**
 * Resolves a file inside the built app (`out/`). The bundle may live in
 * `out/` itself or in `scripts/`, so both layouts are probed.
 */
function resolveAppOut(...parts: string[]): string {
  const candidates = [join(__dirname, ...parts), join(__dirname, '..', 'out', ...parts)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

const SHOT_DIR = '/tmp/opencode/e2e-shots'
const PROJECT_NAME = 'E2E Experimental — LGBT & Artes Marciais'
const IDEA = `A contemporary LGBT anime about martial arts. Two young adult women —
Haruka, a 24-year-old competitive jiujitsu athlete who works night shifts at a
24h gym, and Lin, a 23-year-old trans woman who teaches capoeira at a community
centre — meet during a city martial-arts festival. The story explores how they
find each other through sparring, mutual respect and the courage to be seen.
Tone: warm, modern, grounded in real urban Brazil, no fanservice, no
sensationalism — romance built on trust, boundaries and honest conversation.
Genre: sports drama + romance. Target: young adult audience.`

interface IpcOk<T> {
  ok: true
  data: T
}
interface IpcErr {
  ok: false
  error: { code: string; message: string }
}

const results: Array<{ step: string; ok: boolean; detail: string }> = []
let currentStep = ''

function log(line: string): void {
  console.log(`  ${line}`)
}

function pass(detail: string): void {
  results.push({ step: currentStep, ok: true, detail })
  console.log(`  ✓ ${currentStep} — ${detail}`)
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  results.push({ step: currentStep, ok: false, detail: message })
  console.log(`  ✕ ${currentStep} — ${message}`)
  throw err
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  currentStep = name
  try {
    const value = await fn()
    return value
  } catch (err) {
    return fail(err)
  }
}

/** Calls the REAL IPC bridge from inside the renderer. */
async function call<T = unknown>(win: BrowserWindow, channel: string, payload?: unknown): Promise<T> {
  const raw = (await win.webContents.executeJavaScript(
    `window.mirai.invoke(${JSON.stringify(channel)}, ${JSON.stringify(payload ?? {})})`,
  )) as IpcOk<T> | IpcErr
  if (!raw.ok) {
    throw new Error(`${channel} → [${raw.error.code}] ${raw.error.message}`)
  }
  return raw.data
}

/** Polls a job until it reaches a terminal state. */
async function waitJob(
  win: BrowserWindow,
  jobId: string,
  timeoutMs: number,
  label: string,
): Promise<{ status: string; result: unknown; error?: string }> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const { jobs } = await call<{ jobs: Array<{ id: string; status: string; result?: unknown; error?: string }> }>(
      win,
      'jobs:list',
    )
    const job = jobs.find((j) => j.id === jobId)
    if (job) {
      if (job.status !== last) {
        last = job.status
        log(`${label}: ${job.status}`)
      }
      if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        return job
      }
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s (last: ${last})`)
}

/** Job errors may be objects — print them as JSON, never "[object Object]". */
function describe(error: unknown): string {
  if (error === undefined || error === null) return 'no error detail'
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

async function screenshot(win: BrowserWindow, name: string): Promise<void> {
  try {
    mkdirSync(SHOT_DIR, { recursive: true })
    const image = await win.webContents.capturePage()
    writeFileSync(join(SHOT_DIR, `${name}.png`), image.toPNG())
    log(`screenshot: ${join(SHOT_DIR, `${name}.png`)}`)
  } catch (err) {
    log(`screenshot skipped (${(err as Error).message})`)
  }
}

/** The prefix every project of this experiment carries. */
const EXPERIMENT_PREFIX = 'E2E Experimental'

/** The live window — the emergency cleanup needs it. */
let activeWindow: BrowserWindow | null = null

/**
 * Removes every project of this experiment — including the ones left by a
 * previous, interrupted run. The experiment must never leave a residue.
 */
async function purgeExperiment(win: BrowserWindow): Promise<string[]> {
  const { projects } = await call<{ projects: Array<{ id: string; name: string }> }>(win, 'projects:list', {
    includeArchived: true,
  })
  const removed: string[] = []
  for (const project of projects) {
    if (!project.name.startsWith(EXPERIMENT_PREFIX)) continue
    try {
      await call(win, 'projects:delete', { id: project.id })
      removed.push(project.name)
    } catch (err) {
      console.error(`could not delete ${project.name}: ${(err as Error).message}`)
    }
  }
  return removed
}

async function main(): Promise<void> {
  console.log('\nMIRAI STUDIO — E2E: anime experimental (providers REAIS)\n' + '='.repeat(64))

  // ---------------------------------------------------------------- boot
  declareAssetScheme()
  await app.whenReady()

  let container!: Container
  let win!: BrowserWindow

  await step('BOOT: app real (container, IPC, renderer)', async () => {
    container = bootstrap()
    registerIpcHandlers(container)
    registerAssetProtocol(() => container.projects.current()?.storyboard ?? null)

    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#0a0c10',
      webPreferences: {
        preload: resolveAppOut('preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Offscreen rendering: the CI/headless machines have no display, and
        // an on-screen window never finishes its first paint there. The
        // renderer, the preload bridge and the IPC path are identical.
        offscreen: true,
      },
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`renderer failed to load (${code}) ${desc} — ${url}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`renderer process gone: ${details.reason}`)
    })
    await win.loadFile(resolveAppOut('renderer/index.html'))
    activeWindow = win
    // Give React a moment to mount.
    await new Promise((r) => setTimeout(r, 1_200))
    const title = await win.webContents.executeJavaScript('document.title')
    const hasBridge = await win.webContents.executeJavaScript('typeof window.mirai?.invoke === "function"')
    if (hasBridge !== true) throw new Error('the renderer IPC bridge is missing')
    pass(`window opened (title: "${title}"), IPC bridge alive`)
  })

  // ---------------------------------------------------------------- settings
  await step('PROVIDERS: configure the free stack (real settings write)', async () => {
    const { settings } = await call<{ settings: AppSettings }>(win, 'settings:get')
    const ai = {
      ...settings.ai,
      // A reasoning model writing a scene plan needs minutes, not seconds.
      requestTimeoutMs: 300_000,
      chatProvider: 'nvidia' as const,
      nvidia: {
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        // Measured against the real free tier: this model answers a full
        // cast plan in ~9s, while the reasoning models need 65-165s and
        // empty the rate-limit bucket.
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
      },
      image: {
        ...settings.ai.image,
        protocol: 'pollinations' as const,
        baseUrl: 'https://image.pollinations.ai',
        model: 'flux',
        size: '1344x768',
        noWatermark: true,
      },
      video: {
        ...settings.ai.video,
        protocol: 'pollinations' as const,
        baseUrl: 'https://gen.pollinations.ai',
        model: 'alibaba/wan-2.2-fast',
        size: '1344x768',
        fps: 24,
        quality: 'standard' as const,
        useReferenceFrame: true,
        noWatermark: true,
      },
      tts: {
        ...settings.ai.tts,
        protocol: 'google-translate' as const,
        baseUrl: 'https://translate.google.com',
        model: 'google-translate',
        voice: 'pt-BR',
      },
    }
    const { settings: after } = await call<{ settings: AppSettings }>(win, 'settings:update', {
      settings: { ...settings, ai },
    })
    if (after.ai.image.protocol !== 'pollinations') throw new Error('image protocol not persisted')
    if (after.ai.tts.protocol !== 'google-translate') throw new Error('tts protocol not persisted')
    if (after.ai.chatProvider !== 'nvidia') throw new Error('chat provider not persisted')
    pass('chat=NVIDIA nemotron · image=Pollinations(flux) · voice=Google Translate · video=Pollinations(Wan 2.2)')
  })

  await step('CREDENTIALS: the real key is present and encrypted', async () => {
    const { credentials } = await call<{ credentials: Array<{ key: string; configured: boolean; secure: boolean }> }>(
      win,
      'credentials:status',
    )
    const nvidia = credentials.find((c) => c.key === 'nvidia')
    if (!nvidia?.configured) throw new Error('no NVIDIA key configured')
    if (!nvidia.secure) throw new Error('the key is NOT encrypted — refusing to continue')
    pass('NVIDIA key present, encrypted with the OS keyring')
  })

  await step('MARKETPLACE: live vendor catalogs', async () => {
    const catalog = await call<{
      providers: Array<{ id: string; name: string }>
      models: Array<{ id: string; capability: string; free: boolean }>
      configured: string[]
      degraded: string[]
    }>(win, 'marketplace:catalog')
    const imageModels = catalog.models.filter((m) => m.capability === 'image')
    const videoModels = catalog.models.filter((m) => m.capability === 'video')
    if (catalog.providers.length < 5) throw new Error('provider cards missing')
    if (imageModels.length === 0) throw new Error('no live image model')
    if (videoModels.length === 0) throw new Error('no live video model')
    const wan = videoModels.find((m) => m.id.includes('wan-2.2'))
    if (!wan) throw new Error('Wan 2.2 missing from the live catalog')
    pass(
      `${catalog.providers.length} providers · ${catalog.models.length} live models · Wan 2.2 present (paid: ${!wan.free})`,
    )
    if (catalog.degraded.length > 0) log(`degraded: ${catalog.degraded.join(', ')}`)
  })

  // ---------------------------------------------------------------- project
  let projectId = ''
  let projectPath = ''

  await step('CLEANUP: leftovers of a previous run are removed first', async () => {
    const removed = await purgeExperiment(win)
    pass(removed.length === 0 ? 'nothing to clean' : `removed ${removed.length} leftover project(s)`)
  })

  await step('CREATE PROJECT (real folder on disk)', async () => {
    const preset = PROJECT_PRESETS.find((p) => p.id === 'anime-12')!
    const config = ProjectConfig.parse({
      title: PROJECT_NAME,
      genre: 'Sports drama, Romance',
      ...preset.config,
    })
    const { project } = await call<{ project: { id: string; path: string } }>(win, 'projects:create', {
      name: PROJECT_NAME,
      description: 'E2E experimental — LGBT atual + artes marciais.',
      dir: container.dirs.projectsDefaultDir,
      config,
    })
    projectId = project.id
    projectPath = project.path
    if (!existsSync(join(projectPath, 'project.mirai'))) throw new Error('manifest not written')
    if (!existsSync(join(projectPath, 'database', 'project.sqlite'))) throw new Error('project DB missing')
    pass(`created at ${projectPath}`)
  })

  await step('OPEN PROJECT', async () => {
    await call(win, 'projects:open', { path: projectPath })
    const current = await call<{ project: { id: string } | null }>(win, 'projects:current')
    if (current.project?.id !== projectId) throw new Error('the opened project is not the current one')
    pass('project is open in the studio')
  })

  // ---------------------------------------------------------------- producer
  await step('PRODUCER AGENT: bible → cast → scenes → shots → frames (real AI)', async () => {
    const { jobId } = await call<{ jobId: string }>(win, 'ai:autoproduce', {
      idea: IDEA,
      // The free chat endpoint rate-limits every call after a heavy one, so
      // the scope is 3 scenes × 2 shots — enough to exercise every stage of
      // the pipeline within the free tier's budget.
      scenesCount: 3,
      shotsPerScene: 2,
      generateFrames: true,
      episodeNumber: 1,
    })
    const job = await waitJob(win, jobId, 15 * 60_000, 'producer')
    if (job.status !== 'COMPLETED') {
      throw new Error(`producer job ${job.status}: ${describe(job.error)}`)
    }
    const summary = job.result as {
      charactersCreated: number
      scenesCreated: number
      screenplaysDrafted: number
      shotsCreated: number
      framesGenerated: number
      timelinesBuilt: number
      steps: Array<{ step: string; detail: string; ok: boolean }>
    }
    if (summary.charactersCreated < 2) throw new Error('no characters designed')
    if (summary.scenesCreated < 3) throw new Error('not enough scenes')
    if (summary.shotsCreated < 6) throw new Error('not enough shots')
    if (summary.framesGenerated < 1) throw new Error('no frame was generated')
    pass(
      `${summary.charactersCreated} characters · ${summary.scenesCreated} scenes · ${summary.screenplaysDrafted} screenplays · ${summary.shotsCreated} shots · ${summary.framesGenerated} frames · ${summary.timelinesBuilt} timelines`,
    )
    for (const s of summary.steps) log(`${s.ok ? '·' : '!'} ${s.step}: ${s.detail}`)
  })

  await screenshot(win, '04-project')

  // ---------------------------------------------------------------- dubbing
  await step('DUBBING: real voice per shot (Google Translate speech)', async () => {
    const { episodes } = await call<{ episodes: Array<{ id: string; sceneCount: number }> }>(win, 'episodes:list')
    if (episodes.length === 0) throw new Error('no episode produced')
    const episode = episodes[0]!
    const sceneList = await call<{ scenes: Array<{ id: string; title: string }> }>(win, 'scenes:list', {
      episodeId: episode.id,
    })
    let dubbed = 0
    let failed = 0
    for (const scene of sceneList.scenes) {
      const { shots } = await call<{ shots: Array<{ id: string; dialogue: string | null; title: string }> }>(
        win,
        'shots:list',
        { sceneId: scene.id },
      )
      for (const shot of shots) {
        if (!shot.dialogue || shot.dialogue.trim().length === 0) continue
        try {
          const result = await call<{ assetId: string; voice: string; text: string }>(win, 'ai:speakShot', {
            shotId: shot.id,
          })
          if (!result.assetId) throw new Error('no asset id')
          dubbed++
          log(`dubbed "${shot.title}" (${result.voice})`)
        } catch (err) {
          failed++
          log(`dub failed on "${shot.title}": ${(err as Error).message}`)
        }
      }
    }
    if (dubbed === 0) throw new Error(`no shot was dubbed (${failed} failures)`)
    pass(`${dubbed} shots dubbed with real audio${failed > 0 ? ` (${failed} failed)` : ''}`)
  })

  await step('CONSISTENCY: lock + check against a real generated frame', async () => {
    const { lock } = await call<{ lock: { palette?: unknown; modelSheets?: unknown } }>(
      win,
      'visual:consistencyLock',
    )
    if (!lock) throw new Error('no consistency lock')
    const { episodes } = await call<{ episodes: Array<{ id: string }> }>(win, 'episodes:list')
    const sceneList = await call<{ scenes: Array<{ id: string }> }>(win, 'scenes:list', {
      episodeId: episodes[0]!.id,
    })
    let checked = 0
    for (const scene of sceneList.scenes) {
      const { shots } = await call<{ shots: Array<{ id: string; frameAssetId: string | null }> }>(
        win,
        'shots:list',
        { sceneId: scene.id },
      )
      for (const shot of shots) {
        if (!shot.frameAssetId) continue
        const check = await call<{ score: number; findings: unknown[] }>(win, 'visual:checkConsistency', {
          frameAssetId: shot.frameAssetId,
          generationPrompt: 'studio consistency check',
        })
        if (typeof check.score !== 'number') throw new Error('consistency check returned no score')
        checked++
        log(`frame ${shot.id.slice(0, 8)} → score ${check.score}`)
        break
      }
      if (checked > 0) break
    }
    if (checked === 0) throw new Error('no generated frame to check')
    pass(`consistency engine checked ${checked} real frame(s)`)
  })

  await step('VIDEO: real Wan 2.2 attempt (documents the vendor answer)', async () => {
    const { episodes } = await call<{ episodes: Array<{ id: string }> }>(win, 'episodes:list')
    const sceneList = await call<{ scenes: Array<{ id: string }> }>(win, 'scenes:list', {
      episodeId: episodes[0]!.id,
    })
    const shotList = await call<{ shots: Array<{ id: string; frameAssetId: string | null }> }>(
      win,
      'shots:list',
      { sceneId: sceneList.scenes[0]!.id },
    )
    const withFrame = shotList.shots.find((s) => s.frameAssetId)
    if (!withFrame) throw new Error('no frame to animate')
    const { jobId } = await call<{ jobId: string }>(win, 'ai:generateVideo', {
      shotId: withFrame.id,
      seconds: 3,
    })
    const job = await waitJob(win, jobId, 5 * 60_000, 'video')
    if (job.status === 'COMPLETED') {
      pass('video generated and attached to the shot')
      return
    }
    // Expected without a vendor key: the adapter must fail GRACEFULLY.
    const detail = describe(job.error)
    if (!/key|401|credit|pollen/i.test(detail)) {
      throw new Error(`video failed with an unexpected error: ${detail}`)
    }
    pass(`vendor requires a key (handled gracefully): ${detail.slice(0, 160)}`)
  })

  await step('DOSSIÊ: real TXT + PDF', async () => {
    const { jobId } = await call<{ jobId: string }>(win, 'dossier:generate')
    const job = await waitJob(win, jobId, 5 * 60_000, 'dossier')
    if (job.status !== 'COMPLETED') {
      throw new Error(`dossier job ${job.status}: ${describe(job.error)}`)
    }
    const dossier = (job.result as { dossier: { txtPath: string; pdfPath: string; pages: number } }).dossier
    if (!existsSync(dossier.txtPath)) throw new Error('dossier txt missing')
    if (!existsSync(dossier.pdfPath)) throw new Error('dossier pdf missing')
    const pdfBytes = statSync(dossier.pdfPath).size
    if (pdfBytes < 1_000) throw new Error('dossier pdf is suspiciously small')
    pass(`${dossier.pages} pages → ${dossier.pdfPath} (${pdfBytes} bytes)`)
  })

  await step('RENDER: real playable MP4 (FFmpeg)', async () => {
    const { episodes } = await call<{ episodes: Array<{ id: string }> }>(win, 'episodes:list')
    const sceneList = await call<{ scenes: Array<{ id: string; title: string }> }>(win, 'scenes:list', {
      episodeId: episodes[0]!.id,
    })
    const { jobId } = await call<{ jobId: string }>(win, 'render:scene', {
      sceneId: sceneList.scenes[0]!.id,
      presetId: 'youtube-1080',
      quality: 'PREVIEW',
    })
    const job = await waitJob(win, jobId, 10 * 60_000, 'render')
    if (job.status !== 'COMPLETED') {
      throw new Error(`render job ${job.status}: ${describe(job.error)}`)
    }
    const result = job.result as { outputPath: string; fileBytes: number }
    if (!existsSync(result.outputPath)) throw new Error('no MP4 on disk')
    pass(`MP4: ${result.outputPath} (${(result.fileBytes / 1024).toFixed(0)} KB)`)
  })

  // ---------------------------------------------------------------- cleanup
  let dossierFiles: string[] = []
  await step('DELETE: erase the experiment forever', async () => {
    // Remember what must be gone afterwards.
    dossierFiles = readdirSync(join(projectPath, 'exports'), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(projectPath, 'exports', e.name))
    const result = await call<{ path: string; files: number; bytes: number }>(win, 'projects:delete', {
      id: projectId,
    })
    if (result.path !== projectPath) throw new Error('deleted a different folder')
    pass(`${result.files} files (${(result.bytes / 1024 / 1024).toFixed(1)} MB) erased`)
  })

  await step('ZERO RESIDUE: nothing of the experiment is left', async () => {
    const leftovers: string[] = []
    if (existsSync(projectPath)) leftovers.push(`project folder: ${projectPath}`)
    for (const file of dossierFiles) {
      if (existsSync(file)) leftovers.push(`dossier: ${file}`)
    }
    if (existsSync(join(container.dirs.backups, projectId))) {
      leftovers.push(`backups: ${join(container.dirs.backups, projectId)}`)
    }
    const { projects } = await call<{ projects: Array<{ id: string }> }>(win, 'projects:list', {
      includeArchived: true,
    })
    if (projects.some((p) => p.id === projectId)) leftovers.push('registry entry')
    const current = await call<{ project: unknown }>(win, 'projects:current')
    if (current.project) leftovers.push('project still open')
    if (leftovers.length > 0) throw new Error(`residue found:\n    - ${leftovers.join('\n    - ')}`)
    pass('folder, database, frames, audio, dossier, backups and registry entry — all gone')
  })

  await step('APP STILL HEALTHY after the experiment', async () => {
    const { health } = await call<{
      health: {
        nativeSqlite: string
        appDb: string
        secureStorage: boolean
        ffmpeg: { found: boolean; version: string | null } | null
      }
    }>(win, 'system:health')
    if (health.nativeSqlite !== 'ok' || health.appDb !== 'ok') throw new Error('the database is not healthy')
    if (!health.secureStorage) throw new Error('the credential vault is not encrypted')
    const { projects } = await call<{ projects: Array<{ name: string }> }>(win, 'projects:list', {
      includeArchived: true,
    })
    pass(
      `sqlite=${health.nativeSqlite} appDb=${health.appDb} vault=${health.secureStorage ? 'encrypted' : 'PLAIN'} ffmpeg=${health.ffmpeg?.found ? health.ffmpeg.version : 'absent'} · ${projects.length} project(s) left`,
    )
  })

  console.log('\n' + '='.repeat(64))
  const failedSteps = results.filter((r) => !r.ok)
  console.log(`E2E RESULT: ${results.length - failedSteps.length}/${results.length} steps passed`)
  if (failedSteps.length > 0) process.exitCode = 1
  await container.shutdown()
}

main()
  .catch(async (err) => {
    console.error('\nE2E FAILED:', err)
    process.exitCode = 1
    // The experiment never leaves a residue — even when a step fails.
    if (activeWindow) {
      try {
        const removed = await purgeExperiment(activeWindow)
        if (removed.length > 0) console.error(`emergency cleanup removed: ${removed.join(', ')}`)
      } catch (cleanupErr) {
        console.error('emergency cleanup failed:', cleanupErr)
      }
    }
  })
  .finally(() => {
    // The experiment never leaves a residue — even when a step fails.
    app.exit(process.exitCode === 1 ? 1 : 0)
  })

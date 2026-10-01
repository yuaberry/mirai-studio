/**
 * RenderService (Phase 4) — the FFmpeg render engine.
 * Produces real MP4 files from shot frames + voice lines.
 * The master flow: frame image + audio → FFmpeg → exports/<project>/<shot>.mp4
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  MiraiError,
  exportPresetById,
  type EntityId,
  type RenderOutput,
  type RenderQuality,
  type RenderResult,
  type SceneRenderResult,
  type TimelineBundle,
  type KeyframeRecord,
} from '@mirai/shared'
import type { StoryboardService } from '../storyboard/storyboardService'
import type { MediaService } from '../media/mediaService'
import type { TimelineService } from '../timeline/timelineService'
import type { CreativeService } from '../creative/creativeService'
import { buildSceneRenderSpec } from './sceneRenderBuilder'

export interface RenderOptions {
  shotId: EntityId
  /** Called with 0–100 progress. */
  reportProgress: (pct: number) => void
  /** Cooperative abort — checked between steps. */
  signal: { readonly aborted: boolean }
}

export interface SceneRenderOptions {
  sceneId: EntityId
  presetId: string
  quality: RenderQuality
  reportProgress: (pct: number) => void
  signal: { readonly aborted: boolean }
}

export interface EpisodeRenderOptions extends Omit<SceneRenderOptions, 'sceneId'> {
  episodeId: EntityId
}

export class RenderService {
  constructor(
    private readonly storyboard: StoryboardService,
    private readonly media: MediaService,
    private readonly projectRoot: string,
    private readonly creative: CreativeService,
    private readonly timeline: TimelineService,
  ) {}

  /** Detects FFmpeg availability and version (one-time, sync is fine). */
  static detect(): { available: boolean; version: string | null } {
    try {
      const result = spawnSync('ffmpeg', ['-version'], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
      })
      const output = result.stdout ?? ''
      const match = /ffmpeg version (\S+)/.exec(output)
      return { available: match !== null, version: match?.[1] ?? null }
    } catch {
      return { available: false, version: null }
    }
  }

  /**
   * Renders a single shot to MP4:
   * frame image (looped for duration) + optional voice audio → H.264/AAC MP4.
   * This is the REAL render — FFmpeg produces an actual playable video file.
   */
  async renderShot(options: RenderOptions): Promise<RenderResult> {
    const { shotId, reportProgress, signal } = options

    const shot = this.storyboard.getShotById(shotId)
    reportProgress(10)
    if (signal.aborted) throw new MiraiError('CANCELLED', 'Render cancelled by user.')

    // ---- Resolve inputs -----------------------------------------------------
    let framePath: string | null = null
    if (shot.frameAssetId) {
      framePath = this.storyboard.assetAbsolutePath(shot.frameAssetId)
      if (!existsSync(framePath)) {
        throw new MiraiError('PATH_INVALID', `Frame image not found: ${framePath}`)
      }
    }

    let voicePath: string | null = null
    if (shot.voiceAssetId) {
      voicePath = this.storyboard.assetAbsolutePath(shot.voiceAssetId)
      if (!existsSync(voicePath)) {
        throw new MiraiError('PATH_INVALID', `Voice audio not found: ${voicePath}`)
      }
    }

    if (!framePath && !voicePath) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Shot has neither a frame image nor a voice line — nothing to render. Import a frame or generate one first.',
      )
    }
    reportProgress(20)

    // ---- Output path ---------------------------------------------------------
    const exportsDir = join(this.projectRoot, 'exports')
    mkdirSync(exportsDir, { recursive: true })
    const outputFileName = `shot-${shot.orderIndex + 1}-${shot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`
    const outputPath = join(exportsDir, outputFileName)
    if (existsSync(outputPath)) {
      // Never overwrite — timestamp suffix
      const ts = Date.now()
      const outputName2 = outputFileName.replace('.mp4', `-${ts}.mp4`)
      const outputPath2 = join(exportsDir, outputName2)
      return this.executeFFmpeg(framePath, voicePath, outputPath2, shot.durationSeconds, reportProgress, signal, shotId)
    }

    return this.executeFFmpeg(framePath, voicePath, outputPath, shot.durationSeconds, reportProgress, signal, shotId)
  }

  private async executeFFmpeg(
    framePath: string | null,
    voicePath: string | null,
    outputPath: string,
    durationSeconds: number,
    reportProgress: (pct: number) => void,
    signal: { readonly aborted: boolean },
    shotId: EntityId,
  ): Promise<RenderResult> {
    // ---- Build FFmpeg args -----------------------------------------------------
    const args: string[] = ['-y'] // overwrite output

    if (framePath) {
      args.push('-loop', '1', '-i', framePath)
    }
    if (voicePath) {
      args.push('-i', voicePath)
    }

    // Video codec settings — H.264 with animation tuning (like real anime studios use)
    args.push(
      '-c:v', 'libx264',
      '-tune', 'animation',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-t', String(durationSeconds),
    )

    // Audio: AAC if voice exists, otherwise silent
    if (voicePath) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
    } else {
      args.push('-an') // no audio
    }

    // Resolution: from frame image or default 1920x1080
    // FFmpeg will scale the image to fit 1920x1080 if it's the only video input
    if (framePath) {
      args.push('-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2')
    }

    args.push('-movflags', '+faststart', outputPath)

    reportProgress(30)
    if (signal.aborted) throw new MiraiError('CANCELLED', 'Render cancelled before FFmpeg started.')

    // ---- Execute FFmpeg -----------------------------------------------------------
    return new Promise<RenderResult>((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        // Parse FFmpeg progress from stderr
        const timeMatch = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr)
        if (timeMatch) {
          const seconds =
            parseInt(timeMatch[1]!, 10) * 3600 +
            parseInt(timeMatch[2]!, 10) * 60 +
            parseInt(timeMatch[3]!, 10)
          const pct = Math.min(90, Math.max(30, Math.round((seconds / durationSeconds) * 60) + 30))
          reportProgress(pct)
        }
        // Check for abort
        if (signal.aborted) {
          proc.kill('SIGKILL')
        }
      })

      proc.on('error', (err) => {
        reject(new MiraiError('INTERNAL', `FFmpeg failed to start: ${err.message}`))
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          const lastLines = stderr.split('\n').slice(-5).join('\n')
          reject(
            new MiraiError('INTERNAL', `FFmpeg exited with code ${code}. ${lastLines}`, {
              retryable: code === 1 && stderr.includes('Output file is empty'),
            }),
          )
          return
        }

        if (signal.aborted) {
          reject(new MiraiError('CANCELLED', 'Render cancelled during encoding.'))
          return
        }

        // ---- Verify output ----------------------------------------------------
        if (!existsSync(outputPath)) {
          reject(new MiraiError('INTERNAL', 'FFmpeg reported success but no output file was created.'))
          return
        }
        const stats = statSync(outputPath)
        reportProgress(100)

        resolve({
          shotId,
          outputPath,
          durationSeconds,
          fileBytes: stats.size,
          hasAudio: voicePath !== null,
          hasVideo: framePath !== null,
          format: 'mp4',
          codec: 'h264',
          resolution: '1920x1080',
        })
      })
    })
  }

  // =========================================================================
  // Phase 6 — Scene & episode renders, Export Center
  // =========================================================================

  /**
   * Renders a WHOLE scene timeline into one MP4: every video clip (frames,
   * camera moves, effects, compositing) and every audio clip (voice, music,
   * SFX, ambience with volumes/pans/automation) — REAL FFmpeg, REAL output.
   */
  async renderScene(options: SceneRenderOptions): Promise<SceneRenderResult> {
    const { sceneId, presetId, quality, reportProgress, signal } = options
    const bundle = this.timeline.getTimeline(sceneId)
    if (bundle.clips.length === 0) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'This scene has no timeline — build it in the Timeline editor first.',
      )
    }
    reportProgress(5)
    if (signal.aborted) throw new MiraiError('CANCELLED', 'Render cancelled.')

    const preset = exportPresetById(presetId)
    const scene = this.creative.getSceneById(sceneId)

    // Resolve asset placeholders → absolute paths inside the project.
    const camera = new Map<string, Map<string, KeyframeRecord[]>>()
    const automation = new Map<string, KeyframeRecord[]>()
    for (const kf of this.timeline.keyframesForScene(sceneId)) {
      const key = `${kf.targetType}:${kf.targetId}`
      if (kf.targetType === 'CAMERA') {
        let byParam = camera.get(kf.targetId)
        if (!byParam) {
          byParam = new Map()
          camera.set(kf.targetId, byParam)
        }
        const arr = byParam.get(kf.param) ?? []
        arr.push(kf)
        byParam.set(kf.param, arr)
      } else {
        const arr = automation.get(key) ?? []
        arr.push(kf)
        automation.set(key, arr)
      }
    }

    const spec = buildSceneRenderSpec(bundle, camera, automation, { preset, quality })
    const args = spec.args.map((a) => this.resolveAssetArg(a, bundle))

    const exportsDir = this.ensureExportsDir()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeTitle = scene.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'scene'
    const outputPath = join(exportsDir, `scene-${safeTitle}-${stamp}.mp4`)
    const fullArgs = [...args, outputPath]

    reportProgress(10)
    await this.runFFmpeg(fullArgs, spec.totalSec, 10, 90, reportProgress, signal, `Scene "${scene.title}"`)
    const stats = statSync(outputPath)

    return {
      kind: 'SCENE',
      outputPath,
      durationSec: spec.totalSec,
      fileBytes: stats.size,
      presetId,
      quality,
      sceneTitles: [scene.title],
      resolution: `${preset.width}x${preset.height}`,
    }
  }

  /**
   * Renders a full episode: every scene with a timeline is rendered to a temp
   * file, then all are stitched losslessly (-c copy) into one episode MP4.
   * Scenes without timelines abort with a clear, actionable error.
   */
  async renderEpisode(options: EpisodeRenderOptions): Promise<SceneRenderResult> {
    const { episodeId, presetId, quality, reportProgress, signal } = options
    const scenes = this.creative.listScenes(episodeId)
    if (scenes.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'This episode has no scenes.')
    }
    const unbuilt: string[] = []
    for (const scene of scenes) {
      const bundle = this.timeline.getTimeline(scene.id)
      if (bundle.clips.length === 0) unbuilt.push(scene.title)
    }
    if (unbuilt.length > 0) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Build these scenes in the Timeline editor before rendering the episode: ${unbuilt.join(', ')}.`,
      )
    }

    const preset = exportPresetById(presetId)
    const episode = this.creative.getEpisodeById(episodeId)
    const exportsDir = this.ensureExportsDir()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const partsDir = join(exportsDir, `.parts-${stamp}`)
    mkdirSync(partsDir, { recursive: true })

    const partPaths: string[] = []
    try {
      const perScene = 80 / scenes.length
      for (let i = 0; i < scenes.length; i++) {
        if (signal.aborted) throw new MiraiError('CANCELLED', 'Render cancelled.')
        const scene = scenes[i]!
        const base = 5 + i * perScene
        const part = await this.renderSceneToPart(
          scene.id,
          presetId,
          quality,
          join(partsDir, `part${String(i).padStart(4, '0')}.mp4`),
          (pct) => reportProgress(Math.round(base + (pct / 100) * perScene)),
          signal,
        )
        partPaths.push(part)
      }

      // Lossless stitch — identical codecs/params across parts make this safe.
      const concatPath = join(partsDir, 'list.txt')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(concatPath, partPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
      reportProgress(90)
      const stamp2 = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const safeTitle = episode.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'episode'
      const outputPath = join(exportsDir, `episode-S${episode.season}E${episode.number}-${safeTitle}-${stamp2}.mp4`)
      await this.runFFmpeg(
        ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', outputPath],
        Number.POSITIVE_INFINITY,
        90,
        96,
        reportProgress,
        signal,
        'Episode stitch',
      )
      const stats = statSync(outputPath)
      const durationSec = this.probeDuration(outputPath) ?? 0
      reportProgress(100)
      return {
        kind: 'EPISODE',
        outputPath,
        durationSec,
        fileBytes: stats.size,
        presetId,
        quality,
        sceneTitles: scenes.map((s) => s.title),
        resolution: `${preset.width}x${preset.height}`,
      }
    } finally {
      // Temp parts are disposable regardless of outcome.
      for (const part of partPaths) {
        try {
          unlinkSync(part)
        } catch {
          // already gone
        }
      }
      try {
        rmSync(partsDir, { recursive: true, force: true })
      } catch {
        // ignore — temp dir cleanup is best-effort
      }
    }
  }

  /** Scene render into an explicit part path (episode pipeline). */
  private async renderSceneToPart(
    sceneId: EntityId,
    presetId: string,
    quality: RenderQuality,
    partPath: string,
    reportProgress: (pct: number) => void,
    signal: { readonly aborted: boolean },
  ): Promise<string> {
    const bundle = this.timeline.getTimeline(sceneId)
    const preset = exportPresetById(presetId)
    const camera = new Map<string, Map<string, KeyframeRecord[]>>()
    const automation = new Map<string, KeyframeRecord[]>()
    for (const kf of this.timeline.keyframesForScene(sceneId)) {
      const key = `${kf.targetType}:${kf.targetId}`
      if (kf.targetType === 'CAMERA') {
        let byParam = camera.get(kf.targetId)
        if (!byParam) {
          byParam = new Map()
          camera.set(kf.targetId, byParam)
        }
        const arr = byParam.get(kf.param) ?? []
        arr.push(kf)
        byParam.set(kf.param, arr)
      } else {
        const arr = automation.get(key) ?? []
        arr.push(kf)
        automation.set(key, arr)
      }
    }
    const spec = buildSceneRenderSpec(bundle, camera, automation, { preset, quality })
    const args = spec.args.map((a) => this.resolveAssetArg(a, bundle))
    await this.runFFmpeg([...args, partPath], spec.totalSec, 0, 100, reportProgress, signal, 'Scene part')
    return partPath
  }

  /** Replace `{{ASSET:id}}` placeholders with absolute paths. */
  private resolveAssetArg(arg: string, bundle: TimelineBundle): string {
    const match = /^\{\{ASSET:(.+)\}\}$/.exec(arg)
    if (!match) return arg
    const assetId = match[1]!
    const abs = this.storyboard.assetAbsolutePath(assetId as EntityId)
    if (!existsSync(abs)) {
      throw new MiraiError('PATH_INVALID', `Asset file missing: ${abs}`)
    }
    void bundle
    return abs
  }

  private ensureExportsDir(): string {
    const dir = join(this.projectRoot, 'exports')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Shared FFmpeg runner: parses `time=` from stderr for progress,
   * honours cooperative abort, surfaces useful diagnostics.
   */
  private runFFmpeg(
    args: string[],
    totalSec: number,
    fromPct: number,
    toPct: number,
    reportProgress: (pct: number) => void,
    signal: { readonly aborted: boolean },
    label: string,
  ): Promise<void> {
    const span = toPct - fromPct
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      let lastPct = fromPct
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        if (totalSec !== Number.POSITIVE_INFINITY) {
          const m = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr.slice(-200))
          if (m) {
            const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 10
            const pct = Math.min(99, Math.round(fromPct + (sec / totalSec) * span))
            if (pct > lastPct) {
              lastPct = pct
              reportProgress(pct)
            }
          }
        }
        if (signal.aborted) proc.kill('SIGKILL')
      })
      proc.on('error', (err) => {
        reject(new MiraiError('INTERNAL', `FFmpeg failed to start (${label}): ${err.message}`))
      })
      proc.on('close', (code) => {
        if (signal.aborted) {
          reject(new MiraiError('CANCELLED', `${label} render cancelled.`))
          return
        }
        if (code !== 0) {
          const tail = stderr.split('\n').slice(-6).join(' | ')
          reject(new MiraiError('INTERNAL', `FFmpeg exited ${code} (${label}): ${tail}`))
          return
        }
        resolve()
      })
    })
  }

  /** ffprobe duration (null when unavailable). */
  probeDuration(outputPath: string): number | null {
    try {
      const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outputPath], {
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      })
      const parsed = Number.parseFloat((res.stdout ?? '').trim())
      return Number.isFinite(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /** Lists every produced file in exports/ with real stat + probe data. */
  listOutputs(): RenderOutput[] {
    const dir = this.ensureExportsDir()
    const out: RenderOutput[] = []
    let entries: string[]
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.mp4') && !f.startsWith('.'))
    } catch {
      return []
    }
    for (const fileName of entries.sort().reverse()) {
      const path = join(dir, fileName)
      try {
        const stats = statSync(path)
        const kind: RenderOutput['kind'] = fileName.startsWith('episode-')
          ? 'EPISODE'
          : fileName.startsWith('scene-')
            ? 'SCENE'
            : fileName.startsWith('shot-')
              ? 'SHOT'
              : 'OTHER'
        const durationSec = this.probeDuration(path)
        const resolution = this.probeResolution(path)
        out.push({
          path,
          fileName,
          kind,
          fileBytes: stats.size,
          createdAt: stats.mtime.toISOString(),
          durationSec,
          resolution,
        })
      } catch {
        // unreadable entry — skip
      }
    }
    return out
  }

  deleteOutput(path: string): void {
    const dir = this.ensureExportsDir()
    const normalized = join(path)
    if (!normalized.startsWith(dir)) {
      throw new MiraiError('PATH_INVALID', 'Refusing to delete a file outside exports/.')
    }
    if (!existsSync(normalized)) throw new MiraiError('NOT_FOUND', 'Output not found.')
    unlinkSync(normalized)
  }

  probeResolution(path: string): string | null {
    try {
      const res = spawnSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
        { encoding: 'utf8', timeout: 15_000, windowsHide: true },
      )
      const m = /(\d+),(\d+)/.exec((res.stdout ?? '').trim())
      return m ? `${m[1]}x${m[2]}` : null
    } catch {
      return null
    }
  }
}

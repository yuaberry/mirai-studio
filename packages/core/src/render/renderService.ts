/**
 * RenderService (Phase 4) — the FFmpeg render engine.
 * Produces real MP4 files from shot frames + voice lines.
 * The master flow: frame image + audio → FFmpeg → exports/<project>/<shot>.mp4
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MiraiError, type EntityId, type RenderResult } from '@mirai/shared'
import type { StoryboardService } from '../storyboard/storyboardService'
import type { MediaService } from '../media/mediaService'

export interface RenderOptions {
  shotId: EntityId
  /** Called with 0–100 progress. */
  reportProgress: (pct: number) => void
  /** Cooperative abort — checked between steps. */
  signal: { readonly aborted: boolean }
}

export class RenderService {
  constructor(
    private readonly storyboard: StoryboardService,
    private readonly media: MediaService,
    private readonly projectRoot: string,
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
}

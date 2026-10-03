/**
 * BlenderBridge (creative freedom) — headless Blender rendering for shots
 * with an attached .blend file. Blender's FFMPEG output becomes the shot's
 * REAL video asset, so the whole pipeline (preview + scene render) uses the
 * user's own 3D production seamlessly.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { MiraiError, type EntityId, type ShotRecord, type AssetRecord } from '@mirai/shared'
import type { StoryboardService } from '../storyboard/storyboardService'

const BLEND_EXTENSIONS = ['.blend', '.blend1']
const MAX_BLEND_BYTES = 500 * 1024 * 1024

export interface BlenderRenderResult {
  videoAssetId: EntityId
  outputPath: string
  fileBytes: number
  seconds: number
}

export class BlenderBridge {
  constructor(
    private readonly storyboard: StoryboardService,
    private readonly projectRoot: string,
    /** Optional override for tests/machines where `blender` isn't on PATH. */
    private readonly binaryPath?: string,
  ) {}

  /** Detects a Blender ≥ 3.x binary (sync, one-shot). */
  detect(): { available: boolean; version: string | null } {
    const bin = this.binaryPath ?? 'blender'
    try {
      const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
      const m = /Blender (\d+)\.(\d+)/.exec(res.stdout ?? '')
      return { available: m !== null, version: m ? `${m[1]}.${m[2]}` : null }
    } catch {
      return { available: false, version: null }
    }
  }

  /** Copies a real .blend file into the project and attaches it to the shot. */
  attachBlend(shotId: EntityId, sourcePath: string): AssetRecord {
    this.storyboard.getShotById(shotId)
    const ext = extname(sourcePath).toLowerCase()
    if (!BLEND_EXTENSIONS.includes(ext)) {
      throw new MiraiError('VALIDATION_ERROR', `Unsupported Blender file "${ext}" — expected .blend.`)
    }
    let size: number
    try {
      size = statSync(sourcePath).size
    } catch {
      throw new MiraiError('PATH_INVALID', `File not found: ${sourcePath}`)
    }
    if (size > MAX_BLEND_BYTES) {
      throw new MiraiError('VALIDATION_ERROR', `.blend is too large (${(size / 1024 / 1024).toFixed(0)} MB) — limit is 500 MB.`)
    }
    return this.storyboard.registerBlendFile(shotId, sourcePath, size)
  }

  /**
   * Renders the shot's .blend headlessly (`blender -b file.blend -s 1 -e N
   * -a -F FFMPEG`) into the project, registering the MP4 as the shot's video
   * asset. Cooperative abort + completion validation like the FFmpeg engine.
   */
  async renderShot(
    shot: ShotRecord,
    seconds: number,
    reportProgress: (pct: number) => void,
    signal: { readonly aborted: boolean },
  ): Promise<BlenderRenderResult> {
    const detect = this.detect()
    if (!detect.available) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        "Blender wasn't found. Install it (blender.org) or set a custom path in Settings → Providers.",
      )
    }
    const blendAsset = this.storyboard.getBlendAsset(shot.id)
    const blendPath = this.storyboard.assetAbsolutePath(blendAsset.id)
    if (!existsSync(blendPath)) {
      throw new MiraiError('PATH_INVALID', `The .blend file is missing on disk: ${blendPath}`)
    }
    const outDir = join(this.projectRoot, 'video', 'blender')
    mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outPath = join(outDir, `shot-${shot.id.slice(-8)}-${stamp}.mp4`)
    const frames = Math.max(1, Math.round(seconds * 24))
    const args = [
      '-b', blendPath,
      '-o', outPath.replace(/\.mp4$/, ''),
      '-s', '1',
      '-e', String(frames),
      '-a',
      '-F', 'FFMPEG',
      '-f', '24',
    ]
    reportProgress(10)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binaryPath ?? 'blender', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let tail = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-400)
        if (signal.aborted) proc.kill('SIGKILL')
      })
      proc.on('error', (err) => reject(new MiraiError('INTERNAL', `Blender failed to start: ${err.message}`)))
      proc.on('close', (code) => {
        if (signal.aborted) {
          reject(new MiraiError('CANCELLED', 'Blender render cancelled.'))
          return
        }
        if (code !== 0 || !existsSync(outPath)) {
          reject(new MiraiError('INTERNAL', `Blender exited ${code}${tail ? ` — ${tail}` : ''}. Ensure the .blend has a camera and FFMPEG output works.`))
          return
        }
        resolve()
      })
    })
    reportProgress(80)
    const bytes = statSync(outPath).size
    const asset = this.storyboard.registerGeneratedVideo(shot.id, readFileSync(outPath), 'video/mp4')
    reportProgress(100)
    return { videoAssetId: asset.id, outputPath: outPath, fileBytes: bytes, seconds }
  }
}

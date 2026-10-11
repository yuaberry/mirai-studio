/**
 * FFmpeg binary resolution (Phase 6 completion — bundled LGPL build).
 *
 * Priority: explicit env override → bundled static build (resources/ffmpeg)
 * → system PATH. The bundled build ships inside the app (asar-unpacked),
 * so renders work on machines with no system FFmpeg at all.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Dev-repo resources dir (matches apps/desktop/resources/ffmpeg) — 4 levels up
 *  from this module: render → src → core → packages → repo root. */
const DEV_RESOURCE_DIR = join(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'resources')

/** All plausible resource dirs (packaged app, electron-as-node, dev repo). */
function resourceDirs(): string[] {
  const dirs: string[] = []
  // Packaged Electron: resources/ lives next to the asar. Also present when
  // running under ELECTRON_RUN_AS_NODE — harmless to include.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string') dirs.push(resourcesPath)
  // Dev repo / vitest: the workspace layout apps/desktop/resources.
  if (existsSync(DEV_RESOURCE_DIR)) dirs.push(DEV_RESOURCE_DIR)
  return dirs
}

function bundled(name: 'ffmpeg' | 'ffprobe'): string | null {
  const envPath = name === 'ffmpeg' ? process.env['MIRAI_FFMPEG_PATH'] : process.env['MIRAI_FFPROBE_PATH']
  if (envPath && existsSync(envPath)) return envPath
  // Packaged: asarUnpack puts resources under app.asar.unpacked/resources/.
  const layouts: Array<(dir: string) => string> = [
    (dir) => join(dir, 'app.asar.unpacked', 'resources', 'ffmpeg', name),
    (dir) => join(dir, 'ffmpeg', name),
  ]
  for (const dir of resourceDirs()) {
    for (const resolve of layouts) {
      const candidate = resolve(dir)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** The FFmpeg binary to spawn — bundled when shipped, 'ffmpeg' from PATH otherwise. */
export function ffmpegBin(): string {
  return bundled('ffmpeg') ?? 'ffmpeg'
}

/** The FFprobe binary to spawn (same rule as ffmpegBin). */
export function ffprobeBin(): string {
  return bundled('ffprobe') ?? 'ffprobe'
}

/** Where the binary came from — surfaced in health/diagnostics. */
export function ffmpegSource(): 'bundled' | 'system' {
  return bundled('ffmpeg') !== null ? 'bundled' : 'system'
}

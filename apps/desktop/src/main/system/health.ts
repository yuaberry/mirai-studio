/**
 * Health report builder (spec §14 Diagnostics, §26 useful errors).
 * Detects: native SQLite, App DB reachability, secure storage, FFmpeg.
 */
import { spawnSync } from 'node:child_process'
import { ffmpegBin, ffmpegSource } from '@mirai/core'
import { app } from 'electron'
import DatabaseConstructor from 'better-sqlite3'
import type { HealthReport } from '@mirai/shared'
import type { AppDirs, Database, LoggerService } from '@mirai/core'

export interface HealthChecker {
  report(): HealthReport
}

interface Deps {
  dirs: AppDirs
  logger: LoggerService
  appDb: Database
  secure: () => boolean
}

/** Locate FFmpeg once per session — bundled build first, then system PATH. */
function detectFfmpeg(): HealthReport['ffmpeg'] {
  try {
    const result = spawnSync(ffmpegBin(), ['-version'], {
      encoding: 'utf8',
      timeout: 4_000,
      windowsHide: true,
    })
    if (result.status === 0 && result.stdout) {
      const match = /ffmpeg version (\S+)/.exec(result.stdout)
      const source = ffmpegSource()
      return {
        found: true,
        path: source === 'bundled' ? ffmpegBin() : 'ffmpeg (system PATH)',
        version: match?.[1] ?? 'unknown',
      }
    }
  } catch {
    // fallthrough
  }
  return { found: false, path: null, version: null }
}

export function createHealthChecker(deps: Deps): HealthChecker {
  let cachedFfmpeg: HealthReport['ffmpeg'] | null = null

  return {
    report(): HealthReport {
      let nativeSqlite: HealthReport['nativeSqlite'] = 'ok'
      let appDbStatus: HealthReport['appDb'] = 'ok'
      try {
        deps.appDb.prepare('SELECT 1').get()
      } catch (err) {
        appDbStatus = 'error'
        deps.logger.error('DB', 'Health check: App DB unreachable', {
          message: err instanceof Error ? err.message : String(err),
        })
      }
      try {
        const probe = new DatabaseConstructor(':memory:')
        probe.exec('SELECT 1')
        probe.close()
      } catch (err) {
        nativeSqlite = 'error'
        deps.logger.error('SYSTEM', 'Health check: native SQLite failed', {
          message: err instanceof Error ? err.message : String(err),
        })
      }
      if (!cachedFfmpeg) cachedFfmpeg = detectFfmpeg()

      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node ?? 'unknown',
        platform: process.platform,
        arch: process.arch,
        userDataPath: deps.dirs.root,
        projectsDefaultDir: deps.dirs.projectsDefaultDir,
        nativeSqlite,
        appDb: appDbStatus,
        secureStorage: deps.secure(),
        ffmpeg: cachedFfmpeg,
      }
    },
  }
}

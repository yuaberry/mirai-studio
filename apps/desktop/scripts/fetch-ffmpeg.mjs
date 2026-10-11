#!/usr/bin/env node
/**
 * Downloads John Van Sickle's static GPL FFmpeg build (with libx264 — the
 * encoder the render pipeline NEEDS for H.264 MP4s) into resources/ffmpeg/.
 * The binary is a separate process (spawn, never linked): Mirai Studio calls
 * it like any other system tool — GPL attaches to FFmpeg itself, and we
 * comply by shipping its license (GPLv3.txt, inside the archive) and pointing
 * to the corresponding source (johnvansickle.com provides the source tarball
 * per release). Packaging ships it inside the app: renders work with no
 * system FFmpeg at all.
 *
 * Skips the download when the binaries are already present.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RES = join(HERE, '..', 'resources', 'ffmpeg')
const BIN_FFMPEG = join(RES, 'ffmpeg')
const BIN_FFPROBE = join(RES, 'ffprobe')

if (existsSync(BIN_FFMPEG) && existsSync(BIN_FFPROBE)) {
  console.log('[fetch-ffmpeg] bundled FFmpeg already present — skipping.')
  process.exit(0)
}

const URL = process.env['MIRAI_FFMPEG_URL'] ?? 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
const TMP = join(HERE, '..', 'resources', 'ffmpeg-download.tar.xz')
mkdirSync(RES, { recursive: true })

console.log(`[fetch-ffmpeg] downloading ${URL} …`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
// Node 18's fetch body is a web ReadableStream (no .pipe) — buffer once.
writeFileSync(TMP, Buffer.from(await res.arrayBuffer()))
console.log(`[fetch-ffmpeg] downloaded, extracting …`)

const tar = spawnSync('tar', ['-xJf', TMP, '-C', RES, '--strip-components=1'], {
  encoding: 'utf8',
  timeout: 300_000,
})
rmSync(TMP, { force: true })
if (tar.status !== 0) throw new Error(`Extraction failed: ${tar.stderr}`)
if (!existsSync(BIN_FFMPEG) || !existsSync(BIN_FFPROBE)) {
  throw new Error('Extraction finished but ffmpeg/ffprobe not found — check the archive layout.')
}
console.log(`[fetch-ffmpeg] bundled FFmpeg ready at ${RES}`)

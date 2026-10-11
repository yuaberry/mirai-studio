#!/usr/bin/env node
/**
 * Downloads the static LGPL FFmpeg build (John Van Sickle's release — GPL
 * build with libx264 would force GPL on the whole app; the LGPL build links
 * no GPL codecs and is safe to ship) into resources/ffmpeg/.
 * Packaging ships it inside the app: renders work with no system FFmpeg.
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

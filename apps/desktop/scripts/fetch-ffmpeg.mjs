#!/usr/bin/env node
/**
 * Downloads the static GPL FFmpeg build for the CURRENT platform (or
 * --platform override) into resources/ffmpeg/ so the app renders video on
 * machines with no system FFmpeg.
 *
 *   linux: johnvansickle static (tar.xz — what we ship today)
 *   win:   gyan.dev essentials (zip — ffmpeg.exe/ffprobe.exe)
 *   mac:   osxexperts build (zip — arm64; Intel per release files)
 *
 * The binary is a separate process (spawn, never linked): GPL attaches to
 * the FFmpeg binary; we comply by shipping its license text (GPLv3.txt is
 * inside the archives) and pointing to the corresponding sources
 * (johnvansickle.com/ffmpeg, gyan.dev/ffmpeg/builds, osxexperts.net).
 * Skips the download when the binaries are already present.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RES = join(HERE, '..', 'resources', 'ffmpeg')

const argPlatform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : undefined
const platform = argPlatform ?? process.platform

const TARGETS = {
  linux: {
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    kind: 'tar',
  },
  win32: {
    // Requesting the essentials build WITHOUT the 7z variant — zip layout:
    // ffmpeg-<ver>-essentials_build/bin/ffmpeg.exe + ffprobe.exe
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    kind: 'zip',
  },
  // macOS: VERIFIED direct binaries (macos-latest is arm64). ffmpeg from
  // eugeneware/ffmpeg-static (GPL build); ffprobe from joshwnj/ffprobe-static.
  // Intel Macs: swap to darwin-x64 paths.
  darwin: {
    kind: 'direct',
    files: {
      ffmpeg: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64',
      ffprobe: 'https://raw.githubusercontent.com/joshwnj/ffprobe-static/master/bin/darwin/arm64/ffprobe',
    },
  },
}

const binaryNames = (base) =>
  platform === 'win32' ? [`${base}.exe`, base] : [base]
const BIN_NAMES = platform === 'win32' ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg', 'ffprobe']
const HAVE = BIN_NAMES.every((n) => existsSync(join(RES, n)))

if (HAVE) {
  console.log(`[fetch-ffmpeg] ${platform}: binaries already present — skipping.`)
  process.exit(0)
}

const target = TARGETS[platform]
if (!target) {
  console.error(`[fetch-ffmpeg] unsupported platform: ${platform}`)
  process.exit(1)
}

if (target.kind === 'direct') {
  mkdirSync(RES, { recursive: true })
  for (const [base, url] of Object.entries(target.files)) {
    for (const name of binaryNames(base)) {
      const out = join(RES, name)
      console.log(`[fetch-ffmpeg] ${platform}: downloading ${url} …`)
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Download failed: HTTP ${r.status} for ${url}`)
      writeFileSync(out, Buffer.from(await r.arrayBuffer()))
      // Direct downloads must keep the executable bit for the packaged app.
      chmodSync(out, 0o755)
      console.log(`  -> ${out} (${(statSync(out).size / 1_000_000).toFixed(1)} MB, +x)`)
    }
  }
  console.log(`[fetch-ffmpeg] ${platform}: binaries ready at ${RES}`)
  process.exit(0)
}

mkdirSync(RES, { recursive: true })
const TMP = join(HERE, '..', 'resources', 'ffmpeg-download-' + platform + '.' + target.kind)
console.log(`[fetch-ffmpeg] ${platform}: downloading ${target.url} …`)
const res = await fetch(target.url)
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${target.url}`)
writeFileSync(TMP, Buffer.from(await res.arrayBuffer()))
console.log(`[fetch-ffmpeg] downloaded ${(statSync(TMP).size / 1_000_000).toFixed(1)} MB, extracting …`)

// Universal extraction: bsdtar (Windows 10+/macOS/Linux all ship a tar that
// reads zip via libarchive; gyan zip has one top-level folder, osxexperts
// zips keep binaries at the root).
const EXTRACT = join(HERE, '..', 'resources', 'ffmpeg-extract')
rmSync(EXTRACT, { recursive: true, force: true })
mkdirSync(EXTRACT, { recursive: true })
const tar = spawnSync('tar', ['-xf', TMP, '-C', EXTRACT], { encoding: 'utf8', timeout: 300_000 })
rmSync(TMP, { force: true })
if (tar.status !== 0) throw new Error(`Extraction failed (is bsdtar available?): ${tar.stderr}`)

/** Find a binary by name anywhere in the extracted tree. */
function findBinary(name) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = walk(p)
        if (found) return found
      } else if (entry.name === name && !entry.isDirectory()) {
        return p
      }
    }
    return null
  }
  return walk(EXTRACT)
}

let missing = []
for (const name of BIN_NAMES) {
  const src = findBinary(name)
  if (!src) {
    missing.push(name)
    continue
  }
  cpSync(src, join(RES, name))
}
rmSync(EXTRACT, { recursive: true, force: true })
if (missing.length > 0) {
  throw new Error(`Extraction finished but ${missing.join(', ')} not found — check the archive layout for ${target.url}`)
}
console.log(`[fetch-ffmpeg] ${platform}: binaries ready at ${RES}`)

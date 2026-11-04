#!/usr/bin/env node
/**
 * Packaged-app boot smoke test — the release gate that catches packaging
 * regressions the dev build and the unit tests cannot see.
 *
 * It boots the PACKAGED desktop binary (not the dev server) against a
 * throwaway user-data directory and fails when:
 *   - a native module cannot be loaded (e.g. sharp's @img binary missing
 *     from the app archive → the main process dies and NO window appears);
 *   - the main window never becomes ready.
 *
 * Usage: node scripts/smoke-packaged.mjs [path-to-binary] [--static-only]
 *
 *   --static-only  skips the window boot (no display needed) — still runs
 *                  the native-runtime preflight and the rasterizer check,
 *                  which is what validates the dependency closure on the
 *                  Windows/macOS CI runners.
 *
 * Exit code 0 = the packaged app is sound (and, unless --static-only, it
 * booted and showed its window).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const DEFAULT_BINARY = join(APP_DIR, 'release', 'linux-unpacked', 'mirai-studio')

const BOOT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 400

/**
 * Patterns that mean the main process failed. Electron prints "A JavaScript
 * error occurred in the main process" and the underlying error next.
 */
const FATAL_PATTERNS = [
  /Could not load the "?[\w-]+"? module/i,
  /A JavaScript error occurred in the main process/i,
  /Uncaught Exception/i,
  /Uncaught TypeError/i,
  /ERR_MODULE_NOT_FOUND/i,
  /ERR_DLOPEN_FAILED/i,
  /was compiled against a different Node\.js version/i,
]

function fail(message, detail) {
  console.error(`\n✗ PACKAGED BOOT SMOKE FAILED: ${message}`)
  if (detail) console.error(detail)
  process.exit(1)
}

/** Collect every log file the app wrote (mirai.log + rotated ones). */
function readLogs(logDir) {
  if (!existsSync(logDir)) return ''
  return readdirSync(logDir)
    .filter((name) => name.startsWith('mirai') && name.endsWith('.log'))
    .map((name) => {
      try {
        return readFileSync(join(logDir, name), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

/**
 * Preflight: the native runtime MUST be present and unpacked. A missing
 * `.node`/`.so` is exactly what makes the app fail to open.
 */
function assertNativeRuntime(binary) {
  const resources = join(dirname(binary), 'resources')
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules')
  if (!existsSync(unpacked)) {
    fail('app.asar.unpacked/node_modules is missing — the app archive is malformed.', unpacked)
  }
  const required = [
    { label: 'better-sqlite3', probe: join(unpacked, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node') },
    { label: 'sharp', probe: join(unpacked, 'sharp', 'package.json') },
  ]
  for (const { label, probe } of required) {
    if (!existsSync(probe)) fail(`native dependency "${label}" is not unpacked from the app archive.`, probe)
  }
  // sharp's platform binary lives in a separate @img/* package.
  const imgDir = join(unpacked, '@img')
  if (!existsSync(imgDir)) {
    fail('sharp platform binaries (@img/*) are missing from the app archive.', imgDir)
  }
  const imgEntries = readdirSync(imgDir)
  const hasSharpBinary = imgEntries.some((entry) => {
    const libDir = join(imgDir, entry, 'lib')
    if (!existsSync(libDir)) return false
    return readdirSync(libDir).some((file) => file.endsWith('.node'))
  })
  if (!hasSharpBinary) {
    fail('no sharp native binding (*.node) found inside @img/*.', JSON.stringify(imgEntries))
  }
  return { imgEntries, unpacked }
}

/**
 * Functional gate: the native rasterizer must load FROM THE APP ARCHIVE and
 * produce a real PNG. A packaged sharp whose native binding is missing
 * throws exactly here — while the app itself still starts.
 */
function assertSharpRasterizes(binary) {
  const appRoot = join(dirname(binary), 'resources', 'app.asar')
  const probe = `
    const { createRequire } = require('module');
    const req = createRequire(${JSON.stringify(join(appRoot, 'out', 'main', 'index.js'))});
    const mod = req('sharp');
    const sharp = mod.default ?? mod;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#c0392b"/></svg>');
    sharp(svg).png().toBuffer().then((buf) => {
      if (!buf || buf.length < 100) { console.error('RASTER_EMPTY'); process.exit(1); }
      console.log('RASTER_OK ' + buf.length);
    }).catch((err) => { console.error('RASTER_FAIL ' + err.message); process.exit(1); });
  `
  const result = spawnSync(binary, ['-e', probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (!output.includes('RASTER_OK')) {
    fail('sharp could not rasterize from the packaged app archive.', output.slice(-2500))
  }
  return output.trim().split('\n').pop()
}

async function main() {
  const args = process.argv.slice(2)
  const staticOnly = args.includes('--static-only')
  const binaryArg = args.find((a) => !a.startsWith('--'))
  const binary = resolve(binaryArg ?? DEFAULT_BINARY)
  if (!existsSync(binary)) {
    fail(`packaged binary not found: ${binary}. Build it first (bun run package:dir).`)
  }
  if (!statSync(binary).isFile()) fail(`packaged binary is not a file: ${binary}`)

  const preflight = assertNativeRuntime(binary)
  console.log(`✓ native runtime present (${preflight.imgEntries.join(', ')})`)

  const raster = assertSharpRasterizes(binary)
  console.log(`✓ sharp rasterizes from the package (${raster})`)

  if (staticOnly) {
    console.log('✓ static package checks passed (window boot skipped)')
    process.exit(0)
  }

  const profile = mkdtempSync(join(tmpdir(), 'mirai-packaged-smoke-'))
  const logDir = join(profile, 'logs')
  let output = ''
  let exited = false
  let exitInfo = ''

  const child = spawn(binary, ['--no-sandbox', `--user-data-dir=${profile}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const collect = (chunk) => {
    output += chunk.toString()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('exit', (code, signal) => {
    exited = true
    exitInfo = `exit code=${code} signal=${signal}`
  })

  const stop = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
  }

  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let ready = false
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    const logs = readLogs(logDir)
    const haystack = `${output}\n${logs}`

    for (const pattern of FATAL_PATTERNS) {
      if (pattern.test(haystack)) {
        stop()
        rmSync(profile, { recursive: true, force: true })
        fail(`the packaged app crashed on startup (${pattern}).`, haystack.slice(-2500))
      }
    }

    if (logs.includes('Main window ready')) {
      ready = true
      break
    }

    if (exited) {
      stop()
      rmSync(profile, { recursive: true, force: true })
      fail(`the packaged app exited before the window was ready (${exitInfo}).`, output.slice(-2500))
    }
  }

  stop()
  // Give the OS a moment to release the profile directory.
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })

  if (!ready) {
    fail(`the packaged app did not become ready within ${BOOT_TIMEOUT_MS / 1000}s.`, output.slice(-2500))
  }

  console.log('✓ packaged app booted and showed its main window')
  process.exit(0)
}

main().catch((err) => fail('unexpected error', err?.stack ?? String(err)))

#!/usr/bin/env node
/**
 * Packaged-app boot smoke test — the release gate that catches packaging
 * regressions the dev build and the unit tests cannot see.
 *
 * It boots the PACKAGED desktop binary (not the dev server) against a
 * throwaway user-data directory and fails when:
 *   - a native module cannot be loaded (e.g. sharp's @img binary missing
 *     from the app archive → the main process dies and NO window appears);
 *   - the wrong sharp runtime is shipped for the platform (on Linux the
 *     native build collides with the system glib that Electron leaks into
 *     the process and aborts with `VImage8.h: assertion failed`);
 *   - sharp's runtime would resolve against a SYSTEM libvips instead of the
 *     bundled one (different ABI -> the process aborts inside libvips);
 *   - glib reports a type-registry error (two glib instances fighting over
 *     the same GTypes - electron/electron#46323);
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
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
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
 * Where electron-builder put the app resources.
 * - Linux/Windows: <binary dir>/resources
 * - macOS: <binary dir>/../Resources   (the .app bundle layout)
 *
 * The directory that actually holds `app.asar` wins — the macOS bundle also
 * has a `Contents/MacOS/resources` folder that is NOT the app archive.
 */
function resolveResourcesDir(binary) {
  const candidates = [
    join(dirname(binary), 'resources'),
    join(dirname(binary), '..', 'Resources'),
  ]
  const withArchive = candidates.filter((dir) => existsSync(join(dir, 'app.asar')))
  const dir = withArchive[0] ?? candidates.find((candidate) => existsSync(candidate))
  if (!dir) {
    fail(`app resources directory not found near ${binary}.`, candidates.join('\n'))
  }
  return resolve(dir)
}

/**
 * Minimal READ-ONLY reader for the asar archive (the packaged app's own
 * bundle format). `asar extract-file` writes into the CURRENT directory and
 * is therefore unusable here — this reads the archive in place.
 */
function readAsarFile(asarPath, innerPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    readSync(fd, sizeBuf, 0, 8, 0)
    // pickle: [UInt32 payloadSize][UInt32 headerPickleSize]
    const headerSize = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    readSync(fd, headerBuf, 0, headerSize, 8)
    const stringSize = headerBuf.readUInt32LE(4)
    const header = JSON.parse(headerBuf.subarray(8, 8 + stringSize).toString('utf8'))
    let node = header
    for (const part of innerPath.split('/')) {
      node = node?.files?.[part]
      if (!node) return null
    }
    if (node.files || typeof node.size !== 'number') return null
    const buf = Buffer.alloc(node.size)
    readSync(fd, buf, 0, node.size, 8 + headerSize + Number(node.offset))
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Preflight: the sharp runtime MUST be present and unpacked — and it MUST be
 * the right one for the platform:
 *
 *   Linux : sharp's WEBASSEMBLY build (@img/sharp-wasm32). The native build
 *           is FORBIDDEN there: its embedded glib collides with the system
 *           glib that Electron's Linux binary leaks into the process
 *           (electron/electron#46323), which aborts the app with
 *           `VImage8.h: assertion failed: (!a.vobject || VIPS_IS_OBJECT(...))`.
 *   macOS / Windows : the native build (@img/sharp-<platform>) together with
 *           its bundled libvips (@img/sharp-libvips-<platform>).
 *
 * A missing `.node`/`.so`/`.wasm` is exactly what makes the app fail to open.
 */
function assertSharpRuntime(resources) {
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

  // sharp's platform runtime lives in a separate @img/* package.
  const imgDir = join(unpacked, '@img')
  if (!existsSync(imgDir)) {
    fail('sharp platform binaries (@img/*) are missing from the app archive.', imgDir)
  }
  const imgEntries = readdirSync(imgDir)

  const binding = process.platform === 'linux' ? assertWasmRuntime(imgDir, imgEntries, resources) : assertNativeRuntime(imgDir, imgEntries)

  // Diagnostics: the CI log must show exactly what was shipped.
  const tree = []
  for (const entry of imgEntries) {
    const pkgDir = join(imgDir, entry)
    let pkgVersion = '?'
    try {
      pkgVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version ?? '?'
    } catch {
      /* keep the placeholder */
    }
    tree.push(`  ${entry}@${pkgVersion}`)
    const libDir = join(pkgDir, 'lib')
    if (!existsSync(libDir)) continue
    for (const file of readdirSync(libDir)) {
      const stat = statSync(join(libDir, file))
      if (stat.isFile()) tree.push(`    lib/${file} (${stat.size} bytes)`)
    }
  }

  return { imgEntries, unpacked, binding, tree }
}

/**
 * Linux runtime: the WebAssembly build, with NO native sharp/libvips
 * package next to it (the native one carries the conflicting glib).
 */
function assertWasmRuntime(imgDir, imgEntries, resources) {
  const native = imgEntries.filter(
    (entry) => entry.startsWith('sharp-linux') || entry.startsWith('sharp-libvips-linux'),
  )
  if (native.length) {
    fail(
      `the native sharp runtime (${native.join(', ')}) must NOT be shipped on Linux — its ` +
        'embedded glib collides with the system glib that Electron loads and aborts the ' +
        'process (electron/electron#46323). The WebAssembly runtime must be used instead.',
      native.join('\n'),
    )
  }
  const wasmDir = join(imgDir, 'sharp-wasm32')
  if (!existsSync(wasmDir)) {
    fail(
      'sharp\'s WebAssembly runtime (@img/sharp-wasm32) is missing from the app archive — ' +
        'the native one cannot be used on Linux.',
      JSON.stringify(imgEntries),
    )
  }
  const wasmBinary = join(wasmDir, 'lib', 'sharp-wasm32.node.wasm')
  const wasmLoader = join(wasmDir, 'lib', 'sharp-wasm32.node.js')
  for (const probe of [wasmBinary, wasmLoader]) {
    if (!existsSync(probe)) fail('the sharp WebAssembly runtime is incomplete.', probe)
  }
  // The WASM host runtime is pure JS — it lives inside the asar archive.
  const emnapiManifest = readAsarFile(join(resources, 'app.asar'), 'node_modules/@emnapi/runtime/package.json')
  if (!emnapiManifest) {
    fail(
      '@emnapi/runtime is missing from the app archive — sharp\'s WebAssembly runtime ' +
        'cannot start without it.',
      join(resources, 'app.asar') + '!/node_modules/@emnapi/runtime/package.json',
    )
  }
  const emnapiVersion = JSON.parse(emnapiManifest).version
  return {
    kind: 'wasm',
    packageName: 'sharp-wasm32',
    runtimePath: wasmBinary,
    libvipsVersion: readVipsVersion(wasmDir),
    emnapiVersion,
  }
}

/** macOS / Windows runtime: the native addon plus its bundled libvips. */
function assertNativeRuntime(imgDir, imgEntries) {
  const wasm = imgEntries.filter((entry) => entry === 'sharp-wasm32')
  if (wasm.length) {
    fail(
      `sharp's WebAssembly runtime (${wasm.join(', ')}) must NOT be shipped on ${process.platform} — ` +
        'only Linux needs it, and the native runtime is faster.',
      wasm.join('\n'),
    )
  }
  // The sharp addon (sharp-<platform>.node) — the N-API binding.
  let addon = null
  for (const entry of imgEntries) {
    const libDir = join(imgDir, entry, 'lib')
    if (!existsSync(libDir)) continue
    const binding = readdirSync(libDir).find((file) => file.endsWith('.node'))
    if (binding) {
      addon = join(libDir, binding)
      break
    }
  }
  if (!addon) {
    fail('no sharp native binding (*.node) found inside @img/*.', JSON.stringify(imgEntries))
  }

  // The bundled libvips — it MUST be there. A system libvips has a
  // different ABI and aborts the process (VImage8.h assertion).
  let libvips = null
  let libvipsVersion = null
  for (const entry of imgEntries) {
    if (!entry.startsWith('sharp-libvips-')) continue
    const pkgDir = join(imgDir, entry)
    const libDir = join(pkgDir, 'lib')
    if (!existsSync(libDir)) continue
    const binary = readdirSync(libDir).find(
      (file) => file.startsWith('libvips-cpp.so') || (file.startsWith('libvips') && file.endsWith('.dylib')),
    )
    if (!binary) continue
    libvips = join(libDir, binary)
    libvipsVersion = readVipsVersion(pkgDir)
    break
  }
  if (!libvips) {
    fail(
      'the bundled libvips (@img/sharp-libvips-*) is missing from the app archive — sharp would ' +
        'fall back to the system libvips and abort the process.',
      JSON.stringify(imgEntries),
    )
  }
  if (!libvipsVersion) {
    fail('the bundled libvips package has no versions.json — the runtime cannot be verified.', libvips)
  }
  return { kind: 'native', packageName: 'sharp-libvips', runtimePath: addon, libvips, libvipsVersion }
}

/** The libvips version a runtime package was built with. */
function readVipsVersion(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'versions.json'), 'utf8')).vips ?? null
  } catch {
    return null
  }
}

/**
 * Diagnostic: a libvips installed on the machine shares the SONAME with the
 * bundled one (`libvips-cpp.so.42`). When the bundled copy is not where the
 * loader expects it, the system one is used instead — different ABI, the
 * process aborts. The CI log must show whether that conflict exists.
 */
function reportSystemLibvips() {
  if (process.platform !== 'linux') return null
  const result = spawnSync('ldconfig', ['-p'], { encoding: 'utf8', timeout: 15_000 })
  const lines = `${result.stdout ?? ''}`
    .split('\n')
    .filter((line) => line.includes('libvips'))
  if (!lines.length) return null
  console.log('  system libvips (conflict source if the bundled copy is not found):')
  for (const line of lines) console.log(`    ${line.trim()}`)
  return lines
}

/**
 * The dynamic linker must resolve sharp's libvips dependency to the file
 * that ships with the app. `ldd`/`otool -L` use the very same lookup rules
 * as the loader, so this is the exact answer for "what will be loaded".
 *
 * Only the native runtime has a libvips dependency — the WebAssembly build
 * carries its own libvips inside the module.
 */
function assertLinkedRuntime(binding) {
  if (binding.kind !== 'native') return null
  const platform = process.platform
  if (platform === 'win32') return null
  const tool = platform === 'darwin' ? 'otool' : 'ldd'
  const result = spawnSync(tool, [platform === 'darwin' ? '-L' : '', binding.runtimePath].filter(Boolean), {
    encoding: 'utf8',
    timeout: 30_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (!output) return null
  if (/not found/i.test(output)) {
    fail(`the dynamic linker cannot resolve a dependency of the sharp addon (${tool}).`, output.slice(-2000))
  }
  const libvipsName = binding.libvips.split('/').pop()
  const lines = output.split('\n').filter((line) => line.includes(libvipsName))
  if (!lines.length) {
    fail(`the sharp addon is not linked against the bundled libvips (${libvipsName}).`, output.slice(-2000))
  }
  // Linux: `ldd` prints the file the loader would really open — it MUST be
  // the bundled one (a system libvips has the same SONAME and a different
  // ABI). macOS resolves through @rpath inside the .app bundle, so the
  // output is only a diagnostic there.
  if (platform === 'linux') {
    const resolved = (lines[0].match(/=>\s*(\S+)/) || [])[1]
    if (resolved && resolve(resolved) !== resolve(binding.libvips)) {
      fail(
        `the sharp addon would load "${resolved}" instead of the bundled libvips "${binding.libvips}".`,
        output.slice(-2000),
      )
    }
  }
  return output
}

/**
 * The shipped bundle MUST pin sharp to its own libvips. Without the guard,
 * a libvips installed on the user's machine is picked up by the loader and
 * aborts the process with an ABI mismatch.
 */
function assertLibvipsGuard(resources) {
  const asar = join(resources, 'app.asar')
  const mainJs = readAsarFile(asar, 'out/main/index.js')
  if (!mainJs) {
    fail(`packaged main bundle not found inside the app archive: ${asar}!/out/main/index.js`)
  }
  if (!mainJs.includes('SHARP_IGNORE_GLOBAL_LIBVIPS')) {
    fail('the shipped bundle does not pin sharp to its bundled libvips (SHARP_IGNORE_GLOBAL_LIBVIPS missing).')
  }
  if (!mainJs.includes('MIRAI_BUNDLED_LIBVIPS_RUNTIME')) {
    fail('the shipped bundle does not verify the loaded libvips against the bundled runtime.')
  }
}
/**
 * glib reports a GObject that crosses two different glib instances with
 * these messages — the exact symptom of the Electron/Linux sharp crash
 * (electron/electron#46323). A healthy runtime prints none of them.
 */
const GLIB_ERROR_PATTERNS = [
  /GLib-GObject-CRITICAL/i,
  /GLib-ERROR/i,
  /assertion failed: \(!a\.vobject/i,
  /VIPS_IS_OBJECT/i,
]

/** Fails when the output carries a glib type-registry error. */
function assertNoGlibErrors(output, where) {
  for (const pattern of GLIB_ERROR_PATTERNS) {
    if (pattern.test(output)) {
      fail(
        `the packaged app produced a glib type-registry error (${pattern}) in ${where} — ` +
          'two different glib instances are fighting over the same GTypes ' +
          '(electron/electron#46323).',
        output.slice(-2500),
      )
    }
  }
}

/**
 * Functional gate: the rasterizer must load FROM THE APP ARCHIVE and
 * produce a real PNG. A packaged sharp whose runtime is missing or broken
 * throws exactly here — while the app itself still starts.
 *
 * The probe also reports the libvips version that was actually loaded, which
 * runtime was bound (native or WebAssembly) and (on Linux) the file the
 * kernel mapped — that is how a substituted system libvips or a glib
 * collision becomes visible in the CI log.
 */
function assertSharpRasterizes(binary, resources, expected) {
  const appRoot = join(resources, 'app.asar')
  const probe = `
    const { createRequire } = require('module');
    const fs = require('fs');
    const req = createRequire(${JSON.stringify(join(appRoot, 'out', 'main', 'index.js'))});
    const mod = req('sharp');
    const sharp = mod.default ?? mod;
    const versions = sharp.versions || {};
    console.log('RASTER_VIPS ' + versions.vips);
    console.log('RASTER_BINDING ' + (versions.emscripten ? 'wasm' : 'native'));
    try {
      const modules = Object.keys(require.cache).filter((p) => p.includes('sharp-'));
      if (modules.length) console.log('RASTER_MODULE ' + modules.join(' '));
    } catch { /* ignore */ }
    try {
      const maps = fs.readFileSync('/proc/self/maps', 'utf8');
      const libs = [...new Set(maps.split('\\n')
        .map((l) => (l.match(/^\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+(.*)$/) || [])[1])
        .filter(Boolean).filter((p) => p.includes('libvips') || p.includes('sharp-wasm32')))];
      if (libs.length) console.log('RASTER_LIB ' + libs.join(' '));
    } catch { /* not Linux */ }
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#c0392b"/></svg>');
    sharp(svg).png().toBuffer().then((buf) => {
      if (!buf || buf.length < 100) { console.error('RASTER_EMPTY'); process.exit(1); }
      console.log('RASTER_OK ' + buf.length);
    }).catch((err) => { console.error('RASTER_FAIL ' + err.message); process.exit(1); });
  `
  const result = spawnSync(binary, ['-e', probe], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // Mirrors what the app does before loading sharp: always use the
      // bundled libvips (a system one has a different ABI).
      SHARP_IGNORE_GLOBAL_LIBVIPS: '1',
    },
    encoding: 'utf8',
    timeout: 120_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (!output.includes('RASTER_OK')) {
    fail('sharp could not rasterize from the packaged app archive.', output.slice(-2500))
  }
  assertNoGlibErrors(output, 'the rasterizer probe')
  const loaded = (output.match(/RASTER_VIPS\s+(\S+)/) || [])[1]
  if (loaded && expected.libvipsVersion && loaded !== expected.libvipsVersion) {
    fail(
      `the packaged app loaded libvips ${loaded} instead of the bundled ${expected.libvipsVersion} — ` +
        'the system libvips must never be used.',
      output.slice(-2500),
    )
  }
  const bound = (output.match(/RASTER_BINDING\s+(\S+)/) || [])[1]
  if (bound && bound !== expected.kind) {
    fail(
      `the packaged app bound sharp's ${bound} runtime instead of the ${expected.kind} runtime ` +
        'required for this platform.',
      output.slice(-2500),
    )
  }
  const mapped = (output.match(/RASTER_LIB\s+(.*)/) || [])[1]
  return {
    summary: (output.match(/RASTER_OK\s+(\d+)/) || [])[0] ?? 'RASTER_OK',
    loaded,
    bound,
    mapped,
  }
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

  const resources = resolveResourcesDir(binary)
  const preflight = assertSharpRuntime(resources)
  console.log(`✓ sharp runtime present (${preflight.imgEntries.join(', ')})`)
  console.log(preflight.tree.join('\n'))
  console.log(
    `  runtime: ${preflight.binding.kind} (${preflight.binding.packageName}), ` +
      `libvips ${preflight.binding.libvipsVersion}`,
  )
  if (preflight.binding.kind === 'wasm') {
    console.log(`  @emnapi/runtime: ${preflight.binding.emnapiVersion}`)
  }

  const linked = assertLinkedRuntime(preflight.binding)
  if (linked) console.log('✓ the sharp addon resolves the bundled libvips')
  reportSystemLibvips()

  assertLibvipsGuard(resources)
  console.log('✓ sharp pinned to the bundled libvips')

  const raster = assertSharpRasterizes(binary, resources, preflight.binding)
  console.log(
    `✓ sharp rasterizes from the package (${raster.summary}, libvips ${raster.loaded}, ` +
      `${raster.bound} runtime)`,
  )
  if (raster.mapped) console.log(`  mapped: ${raster.mapped}`)

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

    // A glib type-registry error does not necessarily kill the process, but
    // it means two glib instances share the same GTypes — the app is one
    // rendering away from an abort (electron/electron#46323).
    for (const pattern of GLIB_ERROR_PATTERNS) {
      if (pattern.test(haystack)) {
        stop()
        rmSync(profile, { recursive: true, force: true })
        fail(
          `the packaged app produced a glib type-registry error on startup (${pattern}).`,
          haystack.slice(-2500),
        )
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

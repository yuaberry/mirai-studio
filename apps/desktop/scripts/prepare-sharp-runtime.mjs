#!/usr/bin/env node
/**
 * Prepares sharp's runtime for the platform being packaged.
 *
 * WHY THIS EXISTS
 * ---------------
 * Electron's Linux binaries link the SYSTEM glib and leak its symbols into
 * the process (electron/electron#46323). sharp's prebuilt libvips embeds its
 * own glib STATICALLY, while sharp's addon has no glib in DT_NEEDED — so the
 * addon's `g_type_check_instance_is_a` / `g_object_ref` resolve against the
 * system glib while the GTypes are registered in the embedded one. The two
 * registries only agree by coincidence (same version + same registration
 * order); on a newer distribution (Ubuntu 26.04 / glib 2.84+) they diverge and
 * libvips aborts the whole process:
 *
 *   VImage8.h:134: vips::VObject& vips::VObject::operator=(...)
 *   assertion failed: (!a.vobject || VIPS_IS_OBJECT(a.vobject))
 *
 * There is no way to fix that from JS: `process.dlopen` rejects
 * RTLD_DEEPBIND ("invalid mode for dlopen()") and the system glib is always
 * loaded BEFORE sharp's addon (it is in the Electron binary's DT_NEEDED), so
 * no runtime `dlopen` flag can win the global symbol scope.
 *
 * The fix used by the upstream projects that hit the same crash is to ship
 * sharp's WebAssembly build on Linux: the WASM runtime carries its own glib
 * inside the sandboxed module — no dynamic symbol interposition at all — and
 * sharp's own loader falls back to it automatically when the native platform
 * package is absent.
 *
 *   https://sharp.pixelplumbing.com/install#electron-and-linux
 *
 * WHAT IT DOES
 * ------------
 *   Linux : installs @img/sharp-wasm32 (pinned) + @emnapi/runtime (pinned)
 *           and REMOVES the native @img/sharp-linux-* / @img/sharp-libvips-
 *           linux-* packages, whose glib conflict is the crash.
 *   macOS / Windows : keeps the native runtime and removes the WASM one
 *           (no glib conflict there — the native build is faster).
 *
 * The changes happen in node_modules only: `bun install` restores the
 * original layout, so nothing here mutates tracked files.
 *
 * Usage: node scripts/prepare-sharp-runtime.mjs [--platform linux|darwin|win32]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const MODULES = join(APP_DIR, 'node_modules')
const IMG_DIR = join(MODULES, '@img')

const argPlatform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : undefined
const platform = argPlatform ?? process.platform

const NPM_REGISTRY = 'https://registry.npmjs.org'

/** Reads a package's manifest, or null when it is not installed. */
function readManifest(dir) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The exact version the app pins for a package. A range would let the
 * package manager pick an incompatible release (that is exactly how
 * @emnapi/runtime >= 1.4 broke @img/sharp-wasm32@0.33.5).
 */
function pinnedVersion(appManifest, name) {
  const range =
    appManifest.dependencies?.[name] ?? appManifest.optionalDependencies?.[name] ?? null
  if (!range) {
    throw new Error(
      `[prepare-sharp] ${name} is not declared in apps/desktop/package.json — add it with an exact version.`,
    )
  }
  if (!/^\d+\.\d+\.\d+([-+].*)?$/.test(range)) {
    throw new Error(
      `[prepare-sharp] ${name} must be pinned to an exact version (found "${range}") — ` +
        'a range can resolve to an incompatible release.',
    )
  }
  return range
}

/** Downloads an npm tarball and extracts it into `dest` (package root). */
async function installFromNpm(name, version, dest) {
  const tarball = `${NPM_REGISTRY}/${name}/-/${name.split('/').pop()}-${version}.tgz`
  console.log(`[prepare-sharp] downloading ${name}@${version} …`)
  const response = await fetch(tarball)
  if (!response.ok) {
    throw new Error(`[prepare-sharp] download failed: HTTP ${response.status} for ${tarball}`)
  }
  const tmp = join(MODULES, `.${name.split('/').pop()}-${version}.tgz`)
  writeFileSync(tmp, Buffer.from(await response.arrayBuffer()))

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const tar = spawnSync('tar', ['-xzf', tmp, '-C', dest, '--strip-components=1'], {
    encoding: 'utf8',
    timeout: 300_000,
  })
  rmSync(tmp, { force: true })
  if (tar.status !== 0) {
    throw new Error(`[prepare-sharp] extraction failed for ${name}@${version}: ${tar.stderr}`)
  }
}

/** Removes a package from the app's node_modules (symlink or real folder). */
function removePackage(dir) {
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/** Human-readable size, for the build log. */
function sizeOf(path) {
  try {
    return `${(statSync(path).size / 1_000_000).toFixed(1)} MB`
  } catch {
    return '?'
  }
}

if (!existsSync(MODULES)) {
  throw new Error(`[prepare-sharp] ${MODULES} not found — run "bun install" first.`)
}

const appManifest = readManifest(APP_DIR)
if (!appManifest) {
  throw new Error(`[prepare-sharp] apps/desktop/package.json not found.`)
}
if (!existsSync(IMG_DIR)) {
  mkdirSync(IMG_DIR, { recursive: true })
}

const wasmName = '@img/sharp-wasm32'
const wasmVersion = pinnedVersion(appManifest, wasmName)
const emnapiVersion = pinnedVersion(appManifest, '@emnapi/runtime')

if (platform === 'linux') {
  // --- 1. @emnapi/runtime: the WASM host runtime. ---------------------------
  const emnapiDir = join(MODULES, '@emnapi', 'runtime')
  const emnapi = readManifest(emnapiDir)
  if (!emnapi || emnapi.version !== emnapiVersion) {
    console.log(
      `[prepare-sharp] @emnapi/runtime ${emnapi?.version ?? 'missing'} -> ${emnapiVersion}`,
    )
    await installFromNpm('@emnapi/runtime', emnapiVersion, emnapiDir)
  }
  const installedEmnapi = readManifest(emnapiDir)
  if (!installedEmnapi || installedEmnapi.version !== emnapiVersion) {
    throw new Error(
      `[prepare-sharp] @emnapi/runtime@${emnapiVersion} could not be installed ` +
        `(found ${installedEmnapi?.version ?? 'nothing'}).`,
    )
  }

  // --- 2. @img/sharp-wasm32: sharp's WebAssembly runtime. -------------------
  // The package declares `cpu: ["wasm32"]`, so every package manager SKIPS it
  // on x64/arm64 — it has to be fetched explicitly.
  const wasmDir = join(IMG_DIR, 'sharp-wasm32')
  const wasm = readManifest(wasmDir)
  const wasmBinary = join(wasmDir, 'lib', 'sharp-wasm32.node.wasm')
  if (!wasm || wasm.version !== wasmVersion || !existsSync(wasmBinary)) {
    console.log(`[prepare-sharp] ${wasmName} ${wasm?.version ?? 'missing'} -> ${wasmVersion}`)
    await installFromNpm(wasmName, wasmVersion, wasmDir)
  }
  const installedWasm = readManifest(wasmDir)
  if (!installedWasm || installedWasm.version !== wasmVersion) {
    throw new Error(
      `[prepare-sharp] ${wasmName}@${wasmVersion} could not be installed ` +
        `(found ${installedWasm?.version ?? 'nothing'}).`,
    )
  }
  if (!existsSync(wasmBinary)) {
    throw new Error(`[prepare-sharp] ${wasmBinary} is missing — the WASM runtime is incomplete.`)
  }
  console.log(
    `[prepare-sharp] linux: WASM runtime ready ` +
      `(${wasmName}@${wasmVersion}, ${sizeOf(wasmBinary)}; @emnapi/runtime@${emnapiVersion}).`,
  )

  // --- 3. Drop the native runtime: its embedded glib is the crash. ----------
  const removed = []
  for (const entry of readdirSync(IMG_DIR)) {
    if (!entry.startsWith('sharp-linux') && !entry.startsWith('sharp-libvips-linux')) continue
    if (removePackage(join(IMG_DIR, entry))) removed.push(entry)
  }
  if (removed.length) {
    console.log(
      `[prepare-sharp] linux: removed the native runtime (${removed.join(', ')}) — ` +
        'its glib conflicts with Electron (electron/electron#46323).',
    )
  }
} else {
  // --- Native platforms: the prebuilt binding, no glib conflict. -------------
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch
  const nativeName = `@img/sharp-${platform}-${arch}`
  const nativeDir = join(IMG_DIR, `sharp-${platform}-${arch}`)
  const native = readManifest(nativeDir)
  if (!native) {
    throw new Error(
      `[prepare-sharp] ${nativeName} is not installed — run "bun install" before packaging ` +
        `(${platform} ${arch}).`,
    )
  }
  const binding = join(nativeDir, 'lib')
  const hasBinding =
    existsSync(binding) &&
    readdirSync(binding).some((file) => file.endsWith('.node') || file.endsWith('.dylib'))
  if (!hasBinding) {
    throw new Error(`[prepare-sharp] ${nativeName} has no native binding in ${binding}.`)
  }
  console.log(`[prepare-sharp] ${platform}: native runtime ready (${nativeName}@${native.version}).`)

  // The WASM build is Linux-only — do not ship it to macOS/Windows.
  if (removePackage(join(IMG_DIR, 'sharp-wasm32'))) {
    console.log(`[prepare-sharp] ${platform}: removed the WASM runtime (Linux-only).`)
  }
}

console.log('[prepare-sharp] done.')

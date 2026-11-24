import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Mirai Studio desktop build.
 * - main: Node backend (bundled; `better-sqlite3` stays external — native module).
 * - preload: minimal sandbox-compatible CJS bridge.
 * - renderer: React app (workspace packages @mirai/* are devDependencies,
 *   so they get BUNDLED — no runtime .ts resolution issues).
 */

// v2.1: the REAL app version, from this package's manifest, inlined into the
// main bundle. `app.getVersion()` falls back to ELECTRON's version when the
// app runs unpackaged — which is how "Mirai Studio v33.4.11" ended up in the
// sidebar of a dev run once. The sidebar/status labels must never lie.
const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version as string

export default defineConfig({
  main: {
    // The guard in health.ts falls back to app.getVersion() when this
    // constant is absent (e.g. when the source runs under plain bun).
    define: {
      __MIRAI_APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})

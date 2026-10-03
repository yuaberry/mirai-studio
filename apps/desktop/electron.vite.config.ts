import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Mirai Studio desktop build.
 * - main: Node backend (bundled; `better-sqlite3` stays external — native module).
 * - preload: minimal sandbox-compatible CJS bridge.
 * - renderer: React app (workspace packages @mirai/* are devDependencies,
 *   so they get BUNDLED — no runtime .ts resolution issues).
 */
export default defineConfig({
  main: {
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

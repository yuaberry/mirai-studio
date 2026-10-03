/**
 * Global typing for the preload bridge (renderer side).
 * The preload exposes `window.mirai` via contextBridge; the renderer wraps it
 * with the fully typed client in lib/ipc.ts.
 */
import type { IpcEventChannel, IpcResult } from '@mirai/shared'

export interface MiraiBridge {
  invoke(channel: string, payload?: unknown): Promise<IpcResult<unknown>>
  on(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    mirai: MiraiBridge
  }
}

/**
 * Types describing what the preload bridge exposes (kept for documentation).
 * The renderer-side global Window declaration lives in
 * src/renderer/src/types/global.d.ts.
 */
import type { IpcEventChannel, IpcResult } from '@mirai/shared'

export interface MiraiBridge {
  invoke(channel: string, payload?: unknown): Promise<IpcResult<unknown>>
  on(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void
  platform: NodeJS.Platform
}

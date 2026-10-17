/**
 * Preload bridge — the ONLY surface between renderer and main.
 * contextIsolation is ON, sandbox is ON: no Node in the renderer.
 * The bridge is deliberately generic; the renderer wraps it with fully typed
 * helpers (see renderer/src/lib/ipc.ts) built from the shared contracts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface MiraiEventEnvelope {
  channel: string
  payload: unknown
}

const api = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, envelope: MiraiEventEnvelope): void => {
      if (envelope && envelope.channel === channel) {
        listener(envelope.payload)
      }
    }
    ipcRenderer.on('mirai:event', wrapped)
    return () => {
      ipcRenderer.removeListener('mirai:event', wrapped)
    }
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('mirai', api)

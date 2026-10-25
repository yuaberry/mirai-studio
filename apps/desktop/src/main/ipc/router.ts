/**
 * Typed IPC router (main side). Every channel is validated on the way IN
 * (request) and on the way OUT (response) — a bug in a service surfaces as
 * a precise VALIDATION/INTERNAL error, never as a runtime undefined.
 */
import { ipcMain } from 'electron'
import {
  ipcContracts,
  toErrorPayload,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
} from '@mirai/shared'

export type IpcHandler<C extends IpcChannel> = (
  request: IpcRequest<C>,
) => Promise<IpcResponse<C>> | IpcResponse<C>

export function handleIpc<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<unknown>> => {
    let request: IpcRequest<C>
    try {
      request = ipcContracts[channel].request.parse(raw) as IpcRequest<C>
    } catch (err) {
      return { ok: false, error: toErrorPayload(err) }
    }
    try {
      const output = await handler(request)
      const response = ipcContracts[channel].response.parse(output) as IpcResponse<C>
      return { ok: true, data: response }
    } catch (err) {
      return { ok: false, error: toErrorPayload(err) }
    }
  })
}

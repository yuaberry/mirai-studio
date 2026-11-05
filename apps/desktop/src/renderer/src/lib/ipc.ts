/**
 * Typed IPC client — the ONLY way the renderer talks to the main process.
 * Full static types flow from the shared contracts table.
 */
import {
  fromErrorPayload,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcRequestInput,
  type IpcResponse,
  type IpcResult,
} from '@mirai/shared'

export async function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequestInput<C>,
): Promise<IpcResponse<C>> {
  const result = (await window.mirai.invoke(channel, payload)) as IpcResult<IpcResponse<C>>
  if (!result.ok) {
    throw fromErrorPayload(result.error)
  }
  return result.data
}

export function onEvent<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void,
): () => void {
  return window.mirai.on(channel, listener as (payload: unknown) => void)
}

export const platform = () => window.mirai.platform

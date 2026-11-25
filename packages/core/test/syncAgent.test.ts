/**
 * SyncAgent — a metade do computador do tempo real.
 *
 * O teste É o protocolo: um agente com um `runOp` de mentira (que anota o
 * que recebeu) contra um servidor HTTP real. O celular enfileira; o agente
 * pega, executa, reporta progresso e devolve o resultado. Se qualquer
 * ponta quebrar, falha aqui — não na mão do usuário.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncStore } from '../../../apps/server/src/syncStore'
import { createMiraiServer } from '../../../apps/server/src/httpServer'
import { AccountStore } from '../../../apps/server/src/accountStore'
import { PublishStore } from '../../../apps/server/src/publishStore'
import { SyncAgent } from '../src/collaboration/syncAgent'

/** Extrai os eventos de um trecho de SSE (para espiar o canal). */

describe('SyncAgent (real HTTP)', () => {
  let root: string
  let sync: SyncStore
  let server: ReturnType<typeof createMiraiServer>['server']
  let base: string
  let accounts: AccountStore

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'mirai-agent-'))
    accounts = new AccountStore(root)
    sync = new SyncStore(root)
    const store = new PublishStore({ root })
    const created = createMiraiServer({ store, accounts, sync, port: 0, serverName: 'Agent test' })
    server = created.server
    const { port } = await created.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    accounts.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })

  it('executes what the phone queued and returns the result', async () => {
    const received: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const agent = new SyncAgent({
      baseUrl: base,
      runOp: async (kind, payload, report) => {
        received.push({ kind, payload })
        report(10, 'começando')
        report(90, 'quase')
        return { produced: 'S1E1' }
      },
      pollIntervalMs: 20,
      log: () => undefined,
    })

    // o celular enfileira
    const queued = await fetch(`${base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'produceEpisode', projectId: 'AAAAAAAAAAAA', payload: { targetMinutes: 23 } }),
    })
    const { opId } = (await queued.json()) as { opId: string }

    // o agente roda UM ciclo
    const { ranOpId } = await agent.pollOnce()
    expect(ranOpId).toBe(opId)

    // o executor recebeu a operação REAL
    expect(received).toHaveLength(1)
    expect(received[0]!.kind).toBe('produceEpisode')
    expect(received[0]!.payload).toEqual({ targetMinutes: 23 })

    // o servidor sabe do progresso e do resultado
    const op = sync.getOp(opId)!
    expect(op.status).toBe('COMPLETED')
    expect(op.progress).toBe(100)
    expect(op.result).toEqual({ produced: 'S1E1' })
  })

  it('a failing operation fails loudly — no silent success', async () => {
    const agent = new SyncAgent({
      baseUrl: base,
      runOp: async () => {
        throw new Error('o provider de imagem recusou')
      },
      pollIntervalMs: 20,
      log: () => undefined,
    })
    const queued = await fetch(`${base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'renderCamera', projectId: 'AAAAAAAAAAAA', payload: {} }),
    })
    const { opId } = (await queued.json()) as { opId: string }
    await agent.pollOnce()
    const op = sync.getOp(opId)!
    expect(op.status).toBe('FAILED')
    expect(op.error).toContain('provider de imagem recusou')
  })

  it('an unreachable server is an answer, not a crash', async () => {
    const agent = new SyncAgent({
      baseUrl: 'http://127.0.0.1:1',
      runOp: async () => undefined,
      pollIntervalMs: 20,
      log: () => undefined,
    })
    const { ranOpId } = await agent.pollOnce()
    expect(ranOpId).toBeNull()
    expect(agent.lastError).toBeTruthy()
  })

  it('the phone SEES the whole cycle over SSE', async () => {
    const controller = new AbortController()
    const seen: string[] = []
    const stream = (async () => {
      const res = await fetch(`${base}/events?since=0`, { signal: controller.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (const frame of buffer.split('\n\n')) {
          const data = frame.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim()
          if (data && !data.startsWith(':')) seen.push(JSON.parse(data).type)
          buffer = buffer.slice(buffer.indexOf(frame) + frame.length + 2)
        }
        if (seen.includes('op.completed')) break
      }
    })()

    await fetch(`${base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'speakShot', projectId: 'AAAAAAAAAAAA', payload: { shotId: 'x' } }),
    })
    const agent = new SyncAgent({
      baseUrl: base,
      runOp: async (_kind, _payload, report) => {
        report(40, 'dublando')
        return { ok: true }
      },
      pollIntervalMs: 20,
      log: () => undefined,
    })
    await agent.pollOnce()
    controller.abort()
    await stream.catch(() => undefined)
    expect(seen).toEqual(expect.arrayContaining(['op.queued', 'op.progress', 'op.completed']))
  })
})
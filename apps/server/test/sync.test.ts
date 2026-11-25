/**
 * The real-time channel — the phone and the computer on the SAME account.
 *
 * These tests are E2E over REAL HTTP: a SSE connection is opened, an
 * operation is queued from "the phone", claimed and completed by "the
 * computer", and the phone must SEE it arrive while connected — and also
 * see the ones it missed when it reconnects with `since`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../src/accountStore'
import { PublishStore } from '../src/publishStore'
import { SyncStore } from '../src/syncStore'
import { createMiraiServer } from '../src/httpServer'

interface Boot {
  base: string
  accounts: AccountStore
  sync: SyncStore
  close: () => Promise<void>
}

async function boot(): Promise<Boot> {
  const root = mkdtempSync(join(tmpdir(), 'mirai-sync-'))
  const accounts = new AccountStore(root)
  const store = new PublishStore({ root })
  const sync = new SyncStore(root)
  const { server, listen } = createMiraiServer({ store, accounts, sync, port: 0, serverName: 'Sync test' })
  const { port } = await listen(0, '127.0.0.1')
  return {
    base: `http://127.0.0.1:${port}`,
    accounts,
    sync,
    close: () => new Promise<void>((resolve) => { accounts.close(); server.closeAllConnections(); server.close(() => resolve()) }),
  }
}

/** Opens the SSE stream and collects events until `predicate` or timeout. */
async function readSse(
  base: string,
  since: number,
  token: string | undefined,
  predicate: (events: SyncEventView[]) => boolean,
  timeoutMs = 8_000,
): Promise<SyncEventView[]> {
  const controller = new AbortController()
  const collected: SyncEventView[] = []
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/events?since=${since}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
    if (res.status !== 200) return collected
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // A SSE frame is `id: N\ndata: {...}\n\n` — consume only complete ones.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
        if (!dataLine) continue
        try {
          collected.push(JSON.parse(dataLine.slice(5).trim()) as SyncEventView)
        } catch {
          /* keep-alive/comment */
        }
      }
      if (predicate(collected)) break
    }
  } catch {
    // timeout abort — o que foi coletado é o resultado
  } finally {
    clearTimeout(timer)
  }
  return collected
}

interface SyncEventView {
  seq: number
  type: string
  opId?: string
  projectId?: string
}

describe('sync channel (real HTTP)', () => {
  let srv: Boot
  beforeEach(async () => {
    srv = await boot()
  })
  afterEach(async () => {
    await srv.close()
  })

  it('delivers events LIVE to a connected phone and on reconnect with since', async () => {
    // 1. o celular conecta ANTES de qualquer coisa acontecer
    const live = readSse(srv.base, 0, undefined, (events) => events.some((e) => e.type === 'op.queued'))

    // 2. "o telefone" enfileira uma operação
    const queued = await fetch(`${srv.base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'produceEpisode', projectId: 'AAAAAAAAAAAA', payload: { targetMinutes: 23 } }),
    })
    const { opId } = (await queued.json()) as { opId: string }
    expect(opId).toBeTruthy()

    const liveEvents = await live
    expect(liveEvents.map((e) => e.type)).toContain('op.queued')

    // 3. o computador pega a fila, executa e devolve — o celular vê ao vivo
    const done = readSse(srv.base, 0, undefined, (events) => events.some((e) => e.type === 'op.completed'))
    const claimed = await (await fetch(`${srv.base}/ops/pending`)).json() as { op: { id: string; status: string } }
    expect(claimed.op.id).toBe(opId)
    expect(claimed.op.status).toBe('RUNNING')

    await fetch(`${srv.base}/ops/${opId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 50, message: 'metade do episódio' }),
    })
    await fetch(`${srv.base}/ops/${opId}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: { episode: 'E01' } }),
    })
    const afterDone = await done
    expect(afterDone.map((e) => e.type)).toEqual(expect.arrayContaining(['op.progress', 'op.completed']))

    // 4. RECONEXÃO: com since=0 o celular vê TUDO, inclusive o que perdeu
    const replayed = await readSse(srv.base, 0, undefined, () => false, 2_500)
    const seqs = replayed.map((e) => e.seq)
    expect(new Set(seqs).size).toBe(seqs.length) // o log é ordenado e sem duplicatas
    expect(replayed.map((e) => e.type)).toEqual(expect.arrayContaining(['op.queued', 'op.progress', 'op.completed']))
  })

  it('survives a server restart: the log replays from disk', async () => {
    srv.sync.emit({ type: 'project.published', projectId: 'AAAAAAAAAAAA', summary: 'antes do restart' })
    const seqBefore = srv.sync.eventsSince(0).length
    // um SyncStore NOVO sobre o MESMO diretório (o restart do processo)
    const root = mkdtempSync(join(tmpdir(), 'mirai-sync-'))
    const first = new SyncStore(root)
    first.emit({ type: 'project.published', projectId: 'AAAAAAAAAAAA', summary: 'sobrevive' })
    const second = new SyncStore(root)
    expect(second.eventsSince(0)).toHaveLength(1)
    expect(second.eventsSince(0)[0]?.summary).toBe('sobrevive')
    void seqBefore
    rmSync(root, { recursive: true, force: true })
  })

  it('scopes events to the account that queued them', async () => {
    // register NÃO devolve token — o login devolve (igual à rota /register)
    await srv.accounts.register('dona.uma', 'senha-super-segura-1')
    const { token } = await srv.accounts.login('dona.uma', 'senha-super-segura-1')
    const registered = await fetch(`${srv.base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'dona.outra', password: 'senha-super-segura-2' }),
    })
    const { token: otherToken } = (await registered.json()) as { token: string }

    // Abre o feed da DONA.UMA e mantém a leitura por uma janela curta: a
    // asserção é sobre o que NÃO deve chegar, então não há evento para
    // esperar — a janela fecha sozinha.
    const seen = readSse(srv.base, 0, token, () => false, 2_000)
    const other = await fetch(`${srv.base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ kind: 'renderCamera', projectId: 'BBBBBBBBBBBB', payload: {} }),
    })
    expect(other.status).toBe(201)
    await new Promise((r) => setTimeout(r, 600))
    const mine = await seen
    // a operação da OUTRA conta não vaza para o feed desta
    expect(mine.filter((e) => e.projectId === 'BBBBBBBBBBBB')).toHaveLength(0)
  })

  it('rejects an unknown operation honestly', async () => {
    const res = await fetch(`${srv.base}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'inventada', projectId: 'AAAAAAAAAAAA' }),
    })
    expect(res.status).toBe(400)
  })

  it('publishing a project wakes the phone (live project.published)', async () => {
    const seen = readSse(srv.base, 0, undefined, (events) => events.some((e) => e.type === 'project.published'))
    await fetch(`${srv.base}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Sync Teste',
        author: {
          displayName: 'Zey Hashimoto',
          socialName: '',
          companyName: 'Hashimoto Studio',
          maker: 'studio',
          pronouns: 'she/her',
          bio: 'Makes fan anime.',
          avatarPath: '',
        },
        bundleB64: Buffer.from('PK\u0003\u0004fake').toString('base64'),
      }),
    })
    const events = await seen
    expect(events.map((e) => e.type)).toContain('project.published')
  })
})
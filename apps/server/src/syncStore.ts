/**
 * SyncStore — o canal de tempo real entre o celular e o computador.
 *
 * O USUÁRIO PEDIU: logar com a MESMA conta nos dois dispositivos e ver a
 * mesma coisa EM TEMPO REAL nos dois. Não é injeção local — é um canal.
 *
 * Modelo (três peças, todas auditáveis):
 *   1. EVENTOS: um log append-only com seq monotônica. Um cliente conecta
 *      em /events (SSE) e recebe tudo desde o seu `since` — inclusive o
 *      que aconteceu enquanto estava offline. O log é a fonte da verdade;
 *      o SSE é só a entrega.
 *   2. OPERAÇÕES: o celular NÃO tem os serviços do estúdio (projetos, GPU,
 *      banco). Ele ENFILEIRA uma operação; o computador — que tem tudo —
 *      pega a fila, executa e devolve o resultado. O celular então vê o
 *      progresso pelo mesmo canal de eventos.
 *   3. SNAPSHOTS: quando o computador publica, um evento leva o manifesto.
 *
 * Tudo em memória + JSONL em disco: um restart do servidor não perde o que
 * já aconteceu (o usuário não deve perder o histórico por um reboot).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncEvent, SyncOp } from '@mirai/shared'


const EVENT_LIMIT = 5_000

export class SyncStore {
  private events: SyncEvent[] = []
  private seq = 0
  private ops = new Map<string, SyncOp>()
  private listeners = new Set<(event: SyncEvent) => void>()
  private logFile: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.logFile = join(dir, 'sync-events.jsonl')
    this.replay()
  }

  /** Replays the on-disk log so a restart loses nothing. */
  private replay(): void {
    if (!existsSync(this.logFile)) return
    for (const line of readFileSync(this.logFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as SyncEvent
        this.events.push(event)
        this.seq = Math.max(this.seq, event.seq)
      } catch {
        // a linha corrompida não pode derrubar o canal inteiro
      }
    }
  }

  /** Appends an event, persists it and wakes every SSE listener. */
  emit(event: Omit<SyncEvent, 'seq' | 'at'> & { at?: number }): SyncEvent {
    this.seq += 1
    const full: SyncEvent = { ...event, seq: this.seq, at: event.at ?? Date.now() }
    this.events.push(full)
    if (this.events.length > EVENT_LIMIT) this.events.splice(0, this.events.length - EVENT_LIMIT)
    appendFileSync(this.logFile, `${JSON.stringify(full)}\n`)
    for (const listener of this.listeners) listener(full)
    return full
  }

  eventsSince(seq: number, owner?: string): SyncEvent[] {
    return this.events.filter(
      (e) => e.seq > seq && (owner === undefined || e.owner === undefined || e.owner === owner),
    )
  }

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ------------------------------------------------------------------- ops

  enqueue(kind: SyncOp['kind'], projectId: string, payload: Record<string, unknown>): SyncOp {
    const now = Date.now()
    const op: SyncOp = {
      id: `op_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind,
      projectId,
      payload,
      status: 'QUEUED',
      progress: 0,
      message: 'na fila',
      createdAt: now,
      updatedAt: now,
    }
    this.ops.set(op.id, op)
    // O evento é emitido pela ROTA (com o dono da sessão): um enqueue nu
    // não sabe quem pediu, e emitir aqui vazaria a operação de uma conta
    // para o feed de outra.
    return op
  }

  claimNext(): SyncOp | null {
    const queued = [...this.ops.values()].filter((op) => op.status === 'QUEUED').sort((a, b) => a.createdAt - b.createdAt)
    const op = queued[0]
    if (!op) return null
    op.status = 'RUNNING'
    op.updatedAt = Date.now()
    return op
  }

  progressOp(opId: string, progress: number, message: string): void {
    const op = this.ops.get(opId)
    if (!op) return
    op.progress = progress
    op.message = message
    op.updatedAt = Date.now()
    this.emit({ type: 'op.progress', opId, projectId: op.projectId, summary: `${op.kind}: ${message}`, data: { progress } })
  }

  completeOp(opId: string, result: unknown): void {
    const op = this.ops.get(opId)
    if (!op) return
    op.status = 'COMPLETED'
    op.progress = 100
    op.result = result
    op.message = 'concluído'
    op.updatedAt = Date.now()
    this.emit({ type: 'op.completed', opId, projectId: op.projectId, summary: `${op.kind} concluído`, data: result })
  }

  failOp(opId: string, error: string): void {
    const op = this.ops.get(opId)
    if (!op) return
    op.status = 'FAILED'
    op.error = error
    op.message = error
    op.updatedAt = Date.now()
    this.emit({ type: 'op.failed', opId, projectId: op.projectId, summary: `${op.kind} falhou: ${error}` })
  }

  getOp(opId: string): SyncOp | undefined {
    return this.ops.get(opId)
  }

  listOps(): SyncOp[] {
    return [...this.ops.values()].sort((a, b) => b.createdAt - a.createdAt)
  }
}
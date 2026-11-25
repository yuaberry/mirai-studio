/**
 * SyncAgent — o lado do computador do canal em tempo real.
 *
 * O USUÁRIO PEDIU: mandar a requisição pelo CELULAR e ver os dois
 * dispositivos em tempo real. Este agente é a metade que tem os serviços:
 *
 *   · a cada poucos segundos, pergunta ao servidor qual é a próxima
 *     operação enfileirada pelo celular (`GET /ops/pending`);
 *   · executa com os serviços REAIS do projeto (o `runOp` injetado pelo
 *     app — AiHost, RenderService, o que for);
 *   · devolve progresso e resultado (`POST /ops/:id/progress|done`), e o
 *     servidor entrega os dois ao celular pelo canal de eventos.
 *
 * O laço é INJETÁVEL (fetch + runOp), então os testes exercitam o
 * protocolo inteiro contra um servidor HTTP real sem subir o estúdio.
 */
import type { SyncOpKind } from '@mirai/shared'

export interface SyncAgentOptions {
  /** Base URL of the collaboration server, e.g. http://127.0.0.1:8787 */
  baseUrl: string
  /** Session token of the logged-in account (the events stay scoped). */
  token?: string
  pollIntervalMs?: number
  /** Injected transport (tests replace it). */
  fetchFn?: typeof fetch
  /** Executes the operation with the project's REAL services. */
  runOp: (kind: SyncOpKind, payload: Record<string, unknown>, report: (progress: number, message: string) => void) => Promise<unknown>
  /** Where progress goes (the logger, in the app). */
  log?: (message: string) => void
}

export class SyncAgent {
  private readonly opts: SyncAgentOptions
  private readonly fetchFn: typeof fetch
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  /** Set when the server is unreachable — the loop keeps trying. */
  public lastError: string | null = null
  public lastPollAt = 0

  constructor(opts: SyncAgentOptions) {
    this.opts = opts
    this.fetchFn = opts.fetchFn ?? fetch
  }

  private authHeaders(): Record<string, string> {
    return this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}
  }

  /** One poll cycle: claim the next op (if any) and run it. */
  async pollOnce(): Promise<{ ranOpId: string | null }> {
    this.lastPollAt = Date.now()
    this.lastError = null
    try {
      const res = await this.fetchFn(`${this.opts.baseUrl}/ops/pending`, { headers: this.authHeaders() })
      if (!res.ok) throw new Error(`pending answered HTTP ${res.status}`)
      const { op } = (await res.json()) as { op: { id: string; kind: SyncOpKind; projectId: string; payload: Record<string, unknown> } | null }
      if (!op) return { ranOpId: null }

      this.opts.log?.(`sync: executando ${op.kind} (${op.id}) para o celular`)
      try {
        const result = await this.opts.runOp(op.kind, op.payload, (progress, message) => {
          void this.post(`/ops/${op.id}/progress`, { progress, message })
        })
        await this.post(`/ops/${op.id}/done`, { result })
        this.opts.log?.(`sync: ${op.kind} concluído`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await this.post(`/ops/${op.id}/done`, { error: message })
        this.opts.log?.(`sync: ${op.kind} falhou — ${message}`)
      }
      return { ranOpId: op.id }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      // O servidor pode estar fora: o laço continua tentando, em silêncio
      // honesto (o UI mostra o último erro quando perguntado).
      return { ranOpId: null }
    }
  }

  private async post(path: string, body: unknown): Promise<void> {
    try {
      await this.fetchFn(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(body),
      })
    } catch {
      // um progresso perdido não derruba a operação — o resultado final
      // ainda será entregue na próxima tentativa
    }
  }

  /** Starts the polling loop. Idempotent. */
  start(): void {
    if (this.running) return
    this.running = true
    const loop = () => {
      if (!this.running) return
      void this.pollOnce().finally(() => {
        this.timer = setTimeout(loop, this.opts.pollIntervalMs ?? 4_000)
      })
    }
    loop()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
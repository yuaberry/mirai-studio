/**
 * HuggingFaceVideoProvider — o caminho GRATUITO de animação (v2.1).
 *
 * O usuário escolheu: (2) HF quando houver token, e (3) o motor próprio já
 * implementado. Este adapter é o (2).
 *
 * POR QUE UM ADAPTER PRÓPRIO
 * --------------------------
 * A animação de personagem de verdade (LivePortrait, AnimateDiff, Wan 2.2)
 * roda nos espaços ZeroGPU do Hugging Face — grátis, mas em FILA. O endpoint
 * é o HTTP do Gradio, não uma API OpenAI; o adapter fala esse dialeto:
 *   1. POST /gradio_api/call/{fn}  com o prompt + a imagem de referência
 *   2. GET  /gradio_api/call/{fn}/{eventId} até o status COMPLETED
 *   3. baixa o vídeo resultante
 *
 * O transporte é INJETADO (FetchLike), então os testes exercitam o fluxo
 * inteiro sem rede. Sem token, o provider responde honestamente o que
 * falta — não há voz de vídeo fingindo existir.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

export interface HuggingFaceVideoOptions {
  /** Texto descrevendo o movimento (ex.: "a garota pisca e sorri, cabelo balança"). */
  prompt: string
  /** URL da imagem de referência (data: ou http:) ou caminho local já servido. */
  imageUrl: string
  /** Frames do clipe (a maioria dos espaços fixa em 16–24). */
  numFrames?: number
  signal?: AbortSignal
}

export interface HuggingFaceVideoResult {
  bytes: Buffer
  mimeType: string
  /** O eventId da fila — para diagnóstico quando a fila é longa. */
  eventId: string
}

/** O dialeto Gradio do espaço ZeroGPU. */
export interface GradioEndpoints {
  /** ex.: https://xxx.gradio_run.com/gradio_api/call/predict */
  callUrl: string
  /** Nome da função no espaço (varia: predict, generate, infer…). */
  fnName: string
}

export class HuggingFaceVideoProvider {
  readonly id = 'huggingface-video'

  constructor(
    private readonly opts: {
      token: string
      endpoints: GradioEndpoints
      fetchFn: FetchLike
      /** Tempo máximo de fila+geração (ZeroGPU pode levar minutos). */
      timeoutMs?: number
    },
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      'Content-Type': 'application/json',
    }
  }

  async generate(options: HuggingFaceVideoOptions): Promise<HuggingFaceVideoResult> {
    if (!this.opts.token.trim()) {
      throw new MiraiError(
        'CREDENTIALS_UNAVAILABLE',
        'O caminho gratuito de animação pede um token do Hugging Face (leitura é suficiente).',
      )
    }
    // 1. enfileirar no espaço
    const fn = this.opts.endpoints.fnName
    const callUrl = `${this.opts.endpoints.callUrl}/${encodeURIComponent(fn)}`
    let queued: FetchResponse
    try {
      queued = await this.opts.fetchFn(
        callUrl,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            data: [options.prompt, options.imageUrl, options.numFrames ?? 16],
          }),
          signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 15 * 60_000),
        },
      )
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Não foi falar com o espaço do Hugging Face: ${(err as Error).message}`, {
        retryable: true,
      })
    }
    if (queued.status === 401 || queued.status === 403) {
      throw new MiraiError('CREDENTIALS_UNAVAILABLE', 'O token do Hugging Face foi recusado pelo espaço.', {
        retryable: false,
      })
    }
    if (!queued.ok) {
      throw new MiraiError('AI_PROVIDER_ERROR', `O espaço respondeu HTTP ${queued.status} ao enfileirar.`, {
        retryable: queued.status >= 500,
      })
    }
    const queuedBody = JSON.parse(await queued.text()) as { event_id?: string }
    const eventId = queuedBody.event_id
    if (!eventId) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'O espaço não devolveu um event_id — a fila não aceitou o pedido.')
    }

    // 2. esperar a fila (ZeroGPU: minutos)
    const deadline = Date.now() + (this.opts.timeoutMs ?? 15 * 60_000)
    for (;;) {
      const poll = await this.opts.fetchFn(`${callUrl}/${eventId}`, { method: 'GET', headers: this.headers() })
      if (!poll.ok) {
        throw new MiraiError('AI_PROVIDER_ERROR', `A fila respondeu HTTP ${poll.status}.`, { retryable: poll.status >= 500 })
      }
      const text = await poll.text()
      // o stream SSE do Gradio: "data: [...]" até o evento "process_completed"
      if (text.includes('process_completed')) {
        const url = extractVideoUrl(text)
        if (!url) {
          throw new MiraiError('AI_PROVIDER_ERROR', 'O espaço completou sem devolver o vídeo.')
        }
        const file = await this.opts.fetchFn(url, { method: 'GET', headers: { Authorization: `Bearer ${this.opts.token}` } })
        if (typeof file.arrayBuffer !== 'function') {
          throw new MiraiError('AI_PROVIDER_ERROR', 'O vídeo do espaço não pôde ser lido.')
        }
        const bytes = Buffer.from(await file.arrayBuffer())
        if (bytes.byteLength < 1000) {
          throw new MiraiError('AI_PROVIDER_ERROR', 'O espaço devolveu um vídeo vazio.', { retryable: true })
        }
        return { bytes, mimeType: 'video/mp4', eventId }
      }
      if (Date.now() > deadline) {
        throw new MiraiError('AI_OFFLINE', 'A fila do ZeroGPU demorou demais — tente de novo (a fila é longa em horário de pico).', {
          retryable: true,
        })
      }
      await new Promise((r) => setTimeout(r, 3_000))
      if (options.signal?.aborted) throw new MiraiError('CANCELLED', 'Cancelado.')
    }
  }
}

/** Acha a URL do vídeo no JSON do stream do Gradio. */
export function extractVideoUrl(sseText: string): string | null {
  // O Gradio escapeia as barras dentro do JSON (\/); casamos a URL entre
  // aspas e devolvemos a forma navegável, independente do escape usado.
  const match = /"url"\s*:\s*"([^"]+\.(?:mp4|webm|gif))"/i.exec(sseText)
  return match ? match[1]!.replace(/\\/g, '') : null
}
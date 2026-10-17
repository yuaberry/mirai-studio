/**
 * OpenRouterProvider — the REAL provider (spec §38/§41).
 *
 * Implements chat, streaming and model discovery against the OpenRouter API
 * (OpenAI-compatible shapes). The HTTP transport is an injected port
 * (`FetchLike`), so tests exercise the provider end-to-end without a network
 * and the app can never accidentally depend on a specific HTTP stack.
 */
import { MiraiError, type AiModelInfo } from '@mirai/shared'
import {
  type AIProvider,
  type ChatOptions,
  type ChatResult,
  type FetchLike,
  type FetchResponse,
  type ProviderCapabilities,
  type StreamChunk,
} from './types'
import { parseSseDataEvents } from './sse'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterOptions {
  apiKey: string
  fetchFn: FetchLike
  baseUrl?: string
  /** App attribution headers recommended by OpenRouter. */
  appName?: string
  appUrl?: string
  /** Overall request timeout in ms; 0 disables. */
  timeoutMs?: number
}

const CAPABILITIES: ProviderCapabilities = {
  chat: true,
  stream: true,
  structured: 'prompt', // JSON extracted robustly — no per-model response_format assumption
  listModels: true,
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; code?: number }
}

interface StreamCompletionChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface ModelsResponse {
  data?: Array<{
    id: string
    name?: string
    context_length?: number
    pricing?: { prompt?: string; completion?: string }
  }>
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter'
  readonly capabilities = CAPABILITIES

  constructor(private readonly opts: OpenRouterOptions) {}

  // -------------------------------------------------------------------- chat

  async chat(options: ChatOptions): Promise<ChatResult> {
    const response = await this.request(
      '/chat/completions',
      'POST',
      {
        model: options.model,
        messages: options.messages,
        stream: false,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        include_usage: true,
      },
      options.signal,
    )

    const payload = this.parseJson<ChatCompletionResponse>(await response.text())
    if (payload.error) {
      throw providerErrorFromMessage(payload.error.message ?? 'Provider error', false)
    }
    const content = payload.choices?.[0]?.message?.content ?? ''
    return {
      content,
      usage: normalizeUsage(payload.usage),
    }
  }

  // ------------------------------------------------------------------ stream

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk> {
    const response = await this.request(
      '/chat/completions',
      'POST',
      {
        model: options.model,
        messages: options.messages,
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        include_usage: true,
      },
      options.signal,
    )
    if (!response.body) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Provider returned no stream body.')
    }

    for await (const data of parseSseDataEvents(response.body)) {
      if (data === '[DONE]') return
      if (data.length === 0) continue
      let chunk: StreamCompletionChunk
      try {
        chunk = JSON.parse(data) as StreamCompletionChunk
      } catch {
        continue // ignore keep-alives / malformed lines
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? ''
      const usage = normalizeUsage(chunk.usage)
      if (delta.length > 0 || usage) {
        yield { delta, usage }
      }
    }
  }

  // -------------------------------------------------------------- listModels

  async listModels(): Promise<AiModelInfo[]> {
    // OpenRouter's model catalog is public — discovery works before any key
    // is configured (the chat endpoint is what requires credentials).
    const response = await this.request('/models', 'GET', undefined, undefined)
    const payload = this.parseJson<ModelsResponse>(await response.text())
    const models = payload.data ?? []
    return models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextLength: model.context_length ?? null,
      isFree: model.pricing?.prompt === '0' && model.pricing?.completion === '0',
      promptPricePerToken: parsePrice(model.pricing?.prompt),
      completionPricePerToken: parsePrice(model.pricing?.completion),
    }))
  }

  // ----------------------------------------------------------------- private

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<FetchResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (this.opts.appUrl) headers['HTTP-Referer'] = this.opts.appUrl
    if (this.opts.appName) headers['X-Title'] = this.opts.appName

    const timeoutMs = this.opts.timeoutMs ?? 0
    const signals: AbortSignal[] = []
    if (signal) signals.push(signal)
    if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs))
    const combined = combineSignals(signals)

    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(`${this.opts.baseUrl ?? OPENROUTER_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined ?? undefined,
      })
    } catch (err) {
      if (signal?.aborted) {
        throw new MiraiError('CANCELLED', 'Request aborted by user.')
      }
      throw new MiraiError('AI_OFFLINE', `Could not reach the AI provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }

    if (!response.ok) {
      throw await providerErrorFromResponse(response)
    }
    return response
  }

  private parseJson<T>(text: string): T {
    try {
      return JSON.parse(text) as T
    } catch {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Provider returned invalid JSON.', {
        retryable: false,
        details: { excerpt: text.slice(0, 200) },
      })
    }
  }
}

// ---------------------------------------------------------------------- utils

function combineSignals(signals: AbortSignal[]): AbortSignal | null {
  if (signals.length === 0) return null
  if (signals.length === 1) return signals[0]!
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals)
  }
  return signals[0]! // graceful degradation on exotic runtimes
}

function normalizeUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): ChatResult['usage'] {
  if (!usage || usage.prompt_tokens === undefined || usage.completion_tokens === undefined) {
    return null
  }
  return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
}

async function providerErrorFromResponse(response: FetchResponse): Promise<never> {
  let providerMessage: string | null = null
  let code: number | undefined
  try {
    const payload = JSON.parse(await response.text()) as ChatCompletionResponse
    providerMessage = payload.error?.message ?? null
    code = payload.error?.code
  } catch {
    // non-JSON error body
  }
  const status = code ?? response.status
  const retryable = status === 429 || status >= 500
  const friendly = friendlyStatusMessage(status, providerMessage)
  throw new MiraiError('AI_PROVIDER_ERROR', friendly, {
    retryable,
    details: { status },
  })
}

function friendlyStatusMessage(status: number, providerMessage: string | null): string {
  if (status === 401) return 'Invalid API key — re-enter your OpenRouter key in Settings → AI.'
  if (status === 402) return 'OpenRouter reports insufficient credits for this request.'
  if (status === 429) return 'Rate limited by the provider — wait a moment and retry.'
  if (status >= 500) return `Provider error (${status}) — this is on their side; retrying may help.`
  return providerMessage ?? `Provider error (HTTP ${status}).`
}

function providerErrorFromMessage(message: string, retryable: boolean): MiraiError {
  return new MiraiError('AI_PROVIDER_ERROR', message, { retryable })
}

function parsePrice(value: string | undefined): number | null {
  if (value === undefined) return null
  const price = Number(value)
  return Number.isFinite(price) ? price : null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * AI provider ports (spec §2.3 Provider Agnostic).
 *
 * The whole AI core is transport-free: `FetchLike` is injected, which makes
 * every provider testable without a network. Capabilities are declared,
 * never assumed — the UI enables features from this list, not from guesses.
 */
import type { AiModelInfo, ChatMessage } from '@mirai/shared'

export interface ChatOptions {
  /** Provider-specific model id (required by OpenRouter). */
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatResult {
  content: string
  usage: ChatUsage | null
}

export interface StreamChunk {
  delta: string
  /** Present on the final chunk when the provider reports usage. */
  usage: ChatUsage | null
}

export interface ProviderCapabilities {
  chat: boolean
  stream: boolean
  /** 'prompt' = structured JSON via prompt engineering + robust parsing. */
  structured: false | 'prompt' | 'response_format'
  listModels: boolean
}

export interface AIProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  chat(options: ChatOptions): Promise<ChatResult>
  stream(options: ChatOptions): AsyncGenerator<StreamChunk>
  listModels(): Promise<AiModelInfo[]>
}

/** Minimal fetch port (subset used by providers). */
export interface FetchLike {
  (url: string, init: FetchInit): Promise<FetchResponse>
}

export interface FetchInit {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface FetchResponse {
  ok: boolean
  status: number
  /** Response body as text (non-streaming calls). */
  text(): Promise<string>
  /** Binary body (video downloads). Present on real fetch Responses. */
  arrayBuffer?(): Promise<ArrayBuffer>
  /** SSE body for streaming calls. */
  body?: ReadableStream<Uint8Array> | null
}

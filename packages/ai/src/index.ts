/**
 * @mirai/ai — AI core. Transport-free by design: providers receive
 * an injected fetch port; the main process wires the real network.
 */

export { OpenRouterProvider, OPENROUTER_BASE_URL } from './openrouter'
export type { OpenRouterOptions } from './openrouter'
export { ModelRegistry } from './registry'
export type { ModelRegistryOptions, RegistryResult } from './registry'
export { buildSystemPrompt, estimateTokens } from './contextBuilder'
export type {
  ContextData,
  ContextCharacter,
  ContextScene,
} from './contextBuilder'
export { parseSseDataEvents } from './sse'
export type {
  AIProvider,
  ChatOptions,
  ChatResult,
  ChatUsage,
  StreamChunk,
  ProviderCapabilities,
  FetchLike,
  FetchInit,
  FetchResponse,
} from './types'

/** Estimate the USD cost of a completed request from catalog prices. */
export function estimateCostUsd(
  usage: { promptTokens: number; completionTokens: number },
  model: { promptPricePerToken: number | null; completionPricePerToken: number | null },
): number | null {
  if (model.promptPricePerToken === null || model.completionPricePerToken === null) {
    return null
  }
  return (
    usage.promptTokens * model.promptPricePerToken +
    usage.completionTokens * model.completionPricePerToken
  )
}

// ------------------------------------------------------- image generation
export { OpenAIImagesProvider } from './images'
export type { ImageOptions, ImageResult } from './images'
export { buildImagePrompt, draftScreenplayInstruction } from './consistency'
export type { ConsistencyData, ConsistencyScene, ConsistencyShot } from './consistency'

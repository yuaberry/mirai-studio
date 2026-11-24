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
  FetchHeaders,
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
export { OpenAITtsProvider } from './tts'
export type { TtsOptions, TtsResult } from './tts'
export type { ImageOptions, ImageResult } from './images'
export { buildImagePrompt, draftScreenplayInstruction, draftPanelLetteringInstruction, draftTaglinesInstruction, translateSceneInstruction } from './consistency'
export type { ConsistencyData, ConsistencyScene, ConsistencyShot } from './consistency'

// ------------------------------------------------------- video generation
export { OpenAIVideoProvider } from './video'
export type { VideoOptions, VideoResult } from './video'

// ------------------------------------------------- pollinations (REST)
export {
  PollinationsImagesProvider,
  PollinationsVideoProvider,
  normalizePrompt,
  POLLINATIONS_IMAGE_BASE_URL,
  POLLINATIONS_MEDIA_BASE_URL,
} from './pollinations'
export type {
  PollinationsImageOptions,
  PollinationsVideoOptions,
  PollinationsMediaResult,
} from './pollinations'

// --------------------------------------------- google translate (keyless)
export { GoogleTranslateTtsProvider, parseGoogleVoice, splitText } from './googleTts'
export type { GoogleTtsOptions, GoogleTtsResult } from './googleTts'

// ---------------------------------------------------- local GPU (zero cost)
// A1111 / ComfyUI running on the user's own machine: no API key, no invoice,
// no vendor logo. This is the only way to reach studio-grade anime without
// paying a cloud provider.
export {
  LocalImageProvider,
  parseLocalBaseUrl,
  formatVramGib,
  LOCAL_A1111_DEFAULT_PORT,
  LOCAL_COMFYUI_DEFAULT_PORT,
  LOCAL_MIN_VRAM_IMAGE_BYTES,
  LOCAL_MIN_VRAM_VIDEO_BYTES,
} from './local'
export type {
  LocalFlavor,
  LocalImageOptions,
  LocalMediaResult,
  LocalVideoOptions,
  LocalPreflight,
  LocalSystemStats,
} from './local'
export { ANIME_NEGATIVE_PROMPT } from './consistency'

// ---------------------------------------------------------------- Edge TTS

// v2.1: keyless neural voices, clock-authenticated — nothing to expire.
export {
  edgeSpeak,
  listEdgeVoices,
  buildSsml,
  buildConfigMessage,
  buildSsmlMessage,
  edgeWssUrl,
  escapeXml,
  sanitizeText,
  jsTimestamp,
  wssHeaders,
  voicesHeaders,
  generateSecMsGec,
  generateSecMsGecV2,
  adjustClockSkewSeconds,
  parseHttpDate,
  SEC_MS_GEC_VERSION,
  CHROMIUM_FULL_VERSION,
  WssFrameParser,
  buildHandshakeRequest,
  encodeClientFrame,
  splitHeadersAndData,
  createTlsSocket,
} from './edgeTts'
export type { EdgeTtsOptions, EdgeTtsResult, EdgeVoice, WssSocket, WssFrame, WssSocketFactory } from './edgeTts'

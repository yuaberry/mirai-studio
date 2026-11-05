/**
 * AI Marketplace — the catalog of REAL providers and models the app can
 * actually drive, plus the live catalog the main process fetches.
 *
 * Rules that shaped this file:
 *   - every entry names a protocol the app IMPLEMENTS (no fake providers);
 *   - every entry says honestly whether it needs a key, whether it is free,
 *     whether the output carries a watermark and where the key comes from;
 *   - the live model list is fetched from the vendors' own public catalogs,
 *     never hardcoded.
 */
import { z } from 'zod'

/** What a provider is used for. */
export const AiCapability = z.enum(['chat', 'image', 'video', 'tts'])
export type AiCapability = z.infer<typeof AiCapability>

/**
 * Wire protocol of the endpoint. The app has one adapter per protocol, so
 * this value decides WHICH code talks to the vendor.
 */
export const ProviderProtocol = z.enum(['openai', 'pollinations', 'google-translate'])
export type ProviderProtocol = z.infer<typeof ProviderProtocol>

/** A provider the user can select for a capability. */
export const MarketplaceProvider = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capability: AiCapability,
  protocol: ProviderProtocol,
  /** Base URL of the endpoint (empty for "bring your own" custom providers). */
  baseUrl: z.string(),
  /** Model id suggested when the provider is selected. */
  model: z.string().optional(),
  /** The provider needs an API key stored in the credential vault. */
  requiresKey: z.boolean(),
  /** Works at zero cost (free tier / no key at all). */
  freeTier: z.boolean(),
  /**
   * The output carries no provider logo or watermark.
   *
   * This flag is a MEASURED fact, not a promise: a provider whose output is
   * stamped says `false`, and the card does not advertise "no watermark".
   */
  watermarkFree: z.boolean(),
  /** Processing happens in the vendor's cloud (never on the user's machine). */
  cloud: z.boolean(),
  /** Where the user obtains a key / free credits. */
  signupUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  /** One honest line for the card. */
  summary: z.string(),
  /** Limitations the user must know about. */
  notes: z.string().optional(),
  /** Credential slot this provider uses (undefined = no key needed). */
  credentialKey: z.enum(['openrouter', 'nvidia', 'image', 'videogen', 'tts']).optional(),
})
export type MarketplaceProvider = z.infer<typeof MarketplaceProvider>

/** A model inside a provider's live catalog. */
export const MarketplaceModel = z.object({
  id: z.string().min(1),
  name: z.string(),
  capability: AiCapability,
  /** Provider this model belongs to. */
  providerId: z.string().min(1),
  /** Usable at zero cost. */
  free: z.boolean(),
  /** Price string exactly as the vendor reports it (empty when unknown). */
  price: z.string().default(''),
  /** Advertised output resolutions (video/image). */
  resolutions: z.array(z.string()).default([]),
  /** Advertised durations in seconds (video). */
  durations: z.array(z.number()).default([]),
  /** Vendor health / popularity note. */
  notes: z.string().optional(),
})
export type MarketplaceModel = z.infer<typeof MarketplaceModel>

/** The full marketplace answer: curated providers + live models + status. */
export const MarketplaceCatalog = z.object({
  providers: z.array(MarketplaceProvider),
  models: z.array(MarketplaceModel),
  /** Provider ids that are ready to use right now (key present or not needed). */
  configured: z.array(z.string()),
  /** ISO timestamp of the live fetch. */
  fetchedAt: z.string(),
  /** Providers whose live catalog could not be fetched (never fatal). */
  degraded: z.array(z.string()).default([]),
})
export type MarketplaceCatalog = z.infer<typeof MarketplaceCatalog>

/**
 * CURATED PROVIDERS — every single one is implemented by the app:
 *
 *   openai              → OpenAIImagesProvider / OpenAIVideoProvider / OpenAITtsProvider
 *   pollinations        → PollinationsImagesProvider / PollinationsVideoProvider
 *   google-translate    → GoogleTranslateTtsProvider
 *
 * There is no entry the app cannot drive: an entry we cannot use would be a
 * fake button.
 */
export const MARKETPLACE_PROVIDERS: readonly MarketplaceProvider[] = [
  {
    id: 'openrouter-chat',
    name: 'OpenRouter',
    capability: 'chat',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    requiresKey: true,
    freeTier: true,
    watermarkFree: true,
    cloud: true,
    signupUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    summary: 'Chat, reasoning and structured JSON — hundreds of models, many tagged :free.',
    notes: 'Free models are rate-limited; a paid balance unlocks the stronger ones.',
    credentialKey: 'openrouter',
  },
  {
    id: 'nvidia-chat',
    name: 'NVIDIA NIM',
    capability: 'chat',
    protocol: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'minimaxai/minimax-m3.1-flash',
    requiresKey: true,
    freeTier: true,
    watermarkFree: true,
    cloud: true,
    signupUrl: 'https://build.nvidia.com',
    docsUrl: 'https://docs.api.nvidia.com',
    summary: 'OpenAI-compatible chat endpoint with GLM, Nemotron, Mistral and more.',
    notes: 'The catalog is read live from the vendor — models come and go.',
    credentialKey: 'nvidia',
  },
  {
    id: 'pollinations-image',
    name: 'Pollinations (Image)',
    capability: 'image',
    protocol: 'pollinations',
    baseUrl: 'https://image.pollinations.ai',
    model: 'flux',
    requiresKey: false,
    freeTier: true,
    // MEASURED, not assumed: the classic endpoint stamps its logo on every
    // image and `nologo=true` does NOT remove it (the bytes are identical).
    // Only the paid pollen key changes that — the card must not lie.
    watermarkFree: false,
    cloud: true,
    signupUrl: 'https://enter.pollinations.ai/keys',
    docsUrl: 'https://gen.pollinations.ai/docs',
    summary: 'Free image generation with NO key — the classic endpoint serves Flux and friends.',
    notes:
      'Free tier: one image every 45s per IP (the app waits it out) and the vendor logo IS stamped on the output. A pollen key removes both limits.',
    credentialKey: 'image',
  },
  {
    id: 'pollinations-video',
    name: 'Pollinations (Video — Wan 2.2)',
    capability: 'video',
    protocol: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    model: 'alibaba/wan-2.2-fast',
    requiresKey: true,
    freeTier: false,
    watermarkFree: true,
    cloud: true,
    signupUrl: 'https://enter.pollinations.ai/keys',
    docsUrl: 'https://gen.pollinations.ai/docs',
    summary: 'Text/image-to-video catalog with Wan 2.2, Seedance, Veo, Kling and Grok.',
    notes:
      'Every video model in the catalog is paid (pollen per second) — the free tier covers images and text. The vendor\'s nologo switch is sent on every request; it could not be verified without a key.',
    credentialKey: 'videogen',
  },
  {
    id: 'pollinations-speech',
    name: 'Pollinations (Voice)',
    capability: 'tts',
    protocol: 'openai',
    baseUrl: 'https://gen.pollinations.ai/v1',
    model: 'openai/tts-1',
    requiresKey: true,
    freeTier: true,
    watermarkFree: true,
    cloud: true,
    signupUrl: 'https://enter.pollinations.ai/keys',
    docsUrl: 'https://gen.pollinations.ai/docs',
    summary: 'OpenAI-compatible speech endpoint — tts-1 plus neural voice catalogs.',
    notes: 'The model list is read live; voices differ per model.',
    credentialKey: 'tts',
  },
  {
    id: 'google-translate-speech',
    name: 'Google Translate Voice',
    capability: 'tts',
    protocol: 'google-translate',
    baseUrl: 'https://translate.google.com',
    requiresKey: false,
    freeTier: true,
    watermarkFree: true,
    cloud: true,
    docsUrl: 'https://translate.google.com',
    summary: 'Instant dubbing with NO key — one natural voice per language.',
    notes: 'Unofficial endpoint: one voice per locale (pt-BR, pt-PT, en-US…), rate-limited and undocumented.',
  },
  {
    id: 'custom-image',
    name: 'Custom OpenAI-compatible (Image)',
    capability: 'image',
    protocol: 'openai',
    baseUrl: '',
    requiresKey: true,
    freeTier: false,
    watermarkFree: false,
    cloud: true,
    summary: 'Any endpoint that speaks POST /images/generations.',
    notes:
      'Paste the base URL and the model in Settings → Providers. Whether the output carries a watermark depends on that vendor.',
    credentialKey: 'image',
  },
  {
    id: 'custom-video',
    name: 'Custom OpenAI-compatible (Video)',
    capability: 'video',
    protocol: 'openai',
    baseUrl: '',
    requiresKey: true,
    freeTier: false,
    watermarkFree: false,
    cloud: true,
    summary: 'Any endpoint that speaks POST /videos/generations (+ job polling).',
    notes:
      'Paste the base URL and the model in Settings → Providers. Whether the output carries a watermark depends on that vendor.',
    credentialKey: 'videogen',
  },
  {
    id: 'custom-tts',
    name: 'Custom OpenAI-compatible (Voice)',
    capability: 'tts',
    protocol: 'openai',
    baseUrl: '',
    requiresKey: true,
    freeTier: false,
    watermarkFree: false,
    cloud: true,
    summary: 'Any endpoint that speaks POST /audio/speech.',
    notes:
      'Paste the base URL and the model in Settings → Providers. Whether the output carries a watermark depends on that vendor.',
    credentialKey: 'tts',
  },
]

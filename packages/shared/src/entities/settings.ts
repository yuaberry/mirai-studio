/**
 * Application-level settings (stored in the App DB, not per-project).
 * Unknown/missing fields are merged with defaults so the app can evolve
 * without breaking older installs.
 */
import { z } from 'zod'

export const AppSettings = z.object({
  general: z
    .object({
      locale: z.enum(['en', 'pt-BR', 'ja']).default('en'),
      /** Autosave debounce window for editors (Phase 1). */
      autosaveIntervalMs: z.number().int().min(1_000).max(300_000).default(5_000),
      /** Ask for confirmation on destructive actions. */
      confirmDestructive: z.boolean().default(true),
    })
    .default({}),
  ai: z
    .object({
      /** Which chat provider the assistant uses. */
      chatProvider: z.enum(['openrouter', 'nvidia']).default('openrouter'),
      /** Model id used by the active chat provider. */
      defaultModel: z.string().optional(),
      /** NVIDIA NIM (OpenAI-compatible chat endpoint — e.g. GLM). */
      nvidia: z
        .object({
          baseUrl: z.string().url().default('https://integrate.api.nvidia.com/v1'),
          model: z.string().default('nvidia/z-ai/glm-5.3'),
        })
        .default({}),
      /** Image generation provider (OpenAI Images-compatible endpoint). */
      image: z
        .object({
          baseUrl: z.string().optional(),
          model: z.string().optional(),
          /** e.g. '1024x1024' | '1344x768' | '768x1344'. */
          size: z.string().default('1344x768'),
        })
        .default({}),
      /** Video generation provider (OpenAI-videos-compatible endpoint). */
      video: z
        .object({
          baseUrl: z.string().optional(),
          model: z.string().optional(),
          /** e.g. '1344x768'. */
          size: z.string().default('1344x768'),
        })
        .default({}),
      temperature: z.number().min(0).max(2).default(0.7),
      maxTokens: z.number().int().min(1).max(1_000_000).default(2_048),
      streaming: z.boolean().default(true),
      requestTimeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
      maxRetries: z.number().int().min(0).max(10).default(2),
    })
    .default({}),
  appearance: z
    .object({
      /** Phase 0 ships dark-only; the token keeps future themes honest. */
      theme: z.enum(['dark']).default('dark'),
      density: z.enum(['comfortable', 'compact']).default('comfortable'),
    })
    .default({}),
  editing: z
    .object({
      /** Master fader of the playback mixer (0 = silent, 1 = unity). */
      masterVolume: z.number().min(0).max(1.5).default(1),
      /** Magnetic snapping on the timeline. */
      snapping: z.boolean().default(true),
      /** Loop playback at the end of the timeline. */
      loop: z.boolean().default(false),
      /** Dock sizes (px) persisted between sessions — key → px/fraction. */
      layout: z.record(z.string(), z.number()).default({}),
      /** Dock panels hidden by the user (panel ids). */
      hiddenPanels: z.array(z.string()).default([]),
    })
    .default({}),
  /** User shortcut overrides: actionId → combo (missing = default). */
  shortcuts: z.record(z.string(), z.string()).default({}),
})
export type AppSettings = z.infer<typeof AppSettings>

export const DEFAULT_APP_SETTINGS: AppSettings = AppSettings.parse({})

/** Keys used by the credential store. 'nvidia' = NIM key, 'image' = image-gen key. */
export const CREDENTIAL_KEYS = ['openrouter', 'nvidia', 'image', 'videogen'] as const
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number]

export const zCredentialKey = z.enum(CREDENTIAL_KEYS)

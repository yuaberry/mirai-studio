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
      /** Model id used when a task does not pin a specific model. */
      defaultModel: z.string().optional(),
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
})
export type AppSettings = z.infer<typeof AppSettings>

export const DEFAULT_APP_SETTINGS: AppSettings = AppSettings.parse({})

/** Keys used by the credential store (Phase 0 wires OpenRouter only). */
export const CREDENTIAL_KEYS = ['openrouter'] as const
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number]

export const zCredentialKey = z.enum(CREDENTIAL_KEYS)

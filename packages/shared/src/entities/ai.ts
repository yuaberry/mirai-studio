/**
 * AI Core wire types: chat messages, model catalog entries and the
 * context scope the user consents to send to the provider (spec §15 —
 * context leaving the machine must be explicit).
 */
import { z } from 'zod'

export const CHAT_ROLES = ['system', 'user', 'assistant'] as const
export type ChatRole = (typeof CHAT_ROLES)[number]
export const zChatRole = z.enum(CHAT_ROLES)

export const ChatMessage = z.object({
  role: zChatRole,
  content: z.string().min(1).max(200_000),
})
export type ChatMessage = z.infer<typeof ChatMessage>

/** Model catalog entry (OpenRouter discovery, cached by the registry). */
export const AiModelInfo = z.object({
  id: z.string().min(1),
  name: z.string(),
  contextLength: z.number().int().nullable(),
  isFree: z.boolean(),
  /** USD per token, null when unknown. Free models carry 0. */
  promptPricePerToken: z.number().nullable(),
  completionPricePerToken: z.number().nullable(),
})
export type AiModelInfo = z.infer<typeof AiModelInfo>

/**
 * What project context the user allows to be sent with a chat request.
 * Everything is opt-in — defaults are all false (spec §15).
 */
export const AiContextScope = z.object({
  includeBible: z.boolean().default(false),
  includeCharacters: z.boolean().default(false),
  sceneId: z.string().optional(),
})
export type AiContextScope = z.input<typeof AiContextScope>

export const DEFAULT_AI_CONTEXT_SCOPE: AiContextScope = {
  includeBible: false,
  includeCharacters: false,
}

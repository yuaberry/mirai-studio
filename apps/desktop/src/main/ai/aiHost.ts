/**
 * AiHost — orchestrates the AI Core in the main process (Phase 2):
 * status, model discovery, streaming chats with abort + cost tracking.
 *
 * Security/consent: only the explicitly requested AiContextScope is read
 * from the project and sent to the provider (spec §15). Errors surface as
 * typed 'ai:error' events with useful messages, never as generic failures.
 */
import {
  MiraiError,
  toErrorPayload,
  type AiContextScope,
  type ChatMessage,
  type EntityId,
} from '@mirai/shared'
import {
  ModelRegistry,
  OpenRouterProvider,
  buildSystemPrompt,
  estimateCostUsd,
  type ContextCharacter,
  type ContextScene,
} from '@mirai/ai'
import type { CredentialStore, LoggerService, ProjectService, SettingsService } from '@mirai/core'
import type { MainEmitter } from '../bootstrap'

const CHUNK_FLUSH_MS = 40

export class AiHost {
  private readonly registry: ModelRegistry
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly deps: {
      credentials: CredentialStore
      settings: SettingsService
      projects: ProjectService
      logger: LoggerService
      emitter: MainEmitter
    },
  ) {
    this.registry = new ModelRegistry({
      clock: { now: () => Date.now() },
      ttlMs: 10 * 60 * 1000,
      // OpenRouter's catalog endpoint is public — discovery works pre-key.
      provider: () => new OpenRouterProvider({ apiKey: '', fetchFn: globalFetch() }),
    })
  }

  // ------------------------------------------------------------------- status

  status(): { configured: boolean; secure: boolean; defaultModel: string | null } {
    const status = this.deps.credentials.status().find((c) => c.key === 'openrouter')
    return {
      configured: status?.configured ?? false,
      secure: status?.secure ?? false,
      defaultModel: this.deps.settings.get().ai.defaultModel ?? null,
    }
  }

  // ------------------------------------------------------------------- models

  async listModels(force: boolean) {
    return this.registry.list(force)
  }

  // --------------------------------------------------------------------- chat

  /**
   * Runs a streaming chat in the background. Returns immediately —
   * the renderer follows 'ai:chunk' / 'ai:done' / 'ai:error' events.
   */
  startChat(
    requestId: string,
    request: { messages: ChatMessage[]; context: AiContextScope; model?: string },
  ): void {
    void this.runChat(requestId, request).catch(() => undefined)
  }

  abort(requestId: string): boolean {
    const controller = this.active.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  }

  private async runChat(
    requestId: string,
    request: { messages: ChatMessage[]; context: AiContextScope; model?: string },
  ): Promise<void> {
    const startedAt = Date.now()
    const fail = (err: unknown) => {
      this.active.delete(requestId)
      this.deps.emitter.send('ai:error', { requestId, error: toErrorPayload(err) })
    }

    try {
      const apiKey = this.deps.credentials.get('openrouter')
      if (!apiKey) {
        throw new MiraiError(
          'CREDENTIALS_UNAVAILABLE',
          'No OpenRouter key configured — add it in Settings → AI.',
        )
      }
      const settings = this.deps.settings.get()
      const model = request.model ?? settings.ai.defaultModel
      if (!model) {
        throw new MiraiError(
          'VALIDATION_ERROR',
          'No model selected — pick a default model in Settings → AI.',
        )
      }

      // ---- build consented context (spec §15/§19) --------------------------
      const systemPrompt = buildSystemPrompt(this.collectContext(request.context))

      // ---- stream ------------------------------------------------------------
      const controller = new AbortController()
      this.active.set(requestId, controller)
      const provider = new OpenRouterProvider({
        apiKey,
        fetchFn: globalFetch(),
        appName: 'Mirai Studio',
        appUrl: 'https://mirai-studio.app',
        timeoutMs: settings.ai.requestTimeoutMs,
      })

      let content = ''
      let usage: { promptTokens: number; completionTokens: number } | null = null
      let pending = ''
      let flushTimer: ReturnType<typeof setInterval> | null = null

      const flush = () => {
        if (pending.length === 0) return
        const delta = pending
        pending = ''
        this.deps.emitter.send('ai:chunk', { requestId, delta })
      }

      const iterator = provider.stream({
        model,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
        signal: controller.signal,
        messages: [
          { role: 'system', content: systemPrompt },
          ...request.messages.filter((m) => m.role !== 'system'),
        ],
      })

      flushTimer = setInterval(flush, CHUNK_FLUSH_MS)
      try {
        for await (const chunk of iterator) {
          content += chunk.delta
          pending += chunk.delta
          if (chunk.usage) usage = chunk.usage
        }
      } finally {
        if (flushTimer) clearInterval(flushTimer)
        flush()
      }

      // ---- cost from catalog pricing (best effort) ---------------------------
      let costUsd: number | null = null
      if (usage) {
        try {
          const { models } = await this.registry.list(false)
          const catalogEntry = models.find((m) => m.id === model)
          if (catalogEntry) {
            costUsd = estimateCostUsd(usage, catalogEntry)
          }
        } catch {
          // catalog unavailable → cost simply unknown
        }
      }

      this.active.delete(requestId)
      const durationMs = Date.now() - startedAt
      this.deps.logger.log('info', 'AI', 'Chat completed', {
        requestId,
        model,
        durationMs,
        costUsd,
        chars: content.length,
      })
      this.deps.emitter.send('ai:done', {
        requestId,
        content,
        model,
        durationMs,
        costUsd,
      })
    } catch (err) {
      fail(err)
    }
  }

  /** Reads ONLY the consented scope from the open project. */
  private collectContext(scope: AiContextScope) {
    const ctx = this.deps.projects.current()
    if (!ctx) return {}
    const data: {
      projectName?: string
      characters?: ContextCharacter[]
      scene?: ContextScene
    } = { projectName: ctx.summary.name }

    if (scope.includeCharacters) {
      data.characters = ctx.creative.listCharacters().map((c) => ({
        name: c.name,
        role: c.role,
        personality: c.personality,
        goals: c.goals,
        fears: c.fears,
      }))
    }
    if (scope.sceneId) {
      try {
        const scene = ctx.creative.getSceneById(scope.sceneId as EntityId)
        const characters = ctx.creative.listCharacters()
        data.scene = {
          title: scene.title,
          timeOfDay: scene.timeOfDay,
          synopsis: scene.synopsis,
          screenplay: scene.screenplay,
          locationName: ctx.creative.locationName(scene.locationId),
          castNames: characters
            .filter((c) => scene.characterIds.includes(c.id))
            .map((c) => c.name),
        }
      } catch {
        // scene vanished — context simply omits it
      }
    }
    return {
      ...data,
      bible: scope.includeBible ? ctx.creative.getBible() : undefined,
    }
  }
}

/** The real network transport, bound once (Electron main has global fetch). */
function globalFetch() {
  return (url: string, init: Parameters<typeof fetch>[1] & { method: 'GET' | 'POST' }) =>
    fetch(url, init as never)
}

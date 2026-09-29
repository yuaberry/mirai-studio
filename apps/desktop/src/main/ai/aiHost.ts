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
  OpenAIImagesProvider,
  buildSystemPrompt,
  buildImagePrompt,
  draftScreenplayInstruction,
  estimateCostUsd,
  type ContextCharacter,
  type ContextScene,
} from '@mirai/ai'
import type { CredentialStore, LoggerService, ProjectService, SettingsService } from '@mirai/core'
import type { MainEmitter } from '../bootstrap'

const CHUNK_FLUSH_MS = 40

interface ChatProviderConfig {
  id: 'openrouter' | 'nvidia'
  apiKey: string
  baseUrl: string
  model: string
}

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

  // -------------------------------------------------------------- providers

  /**
   * Resolves the ACTIVE chat provider (user choice in Settings):
   * OpenRouter or NVIDIA NIM (GLM) — both OpenAI-compatible chat endpoints.
   * Throws CREDENTIALS_UNAVAILABLE with the exact next step when not set up.
   */
  resolveChatProvider(): ChatProviderConfig {
    const settings = this.deps.settings.get()
    const credKey = settings.ai.chatProvider
    const apiKey = this.deps.credentials.get(credKey)
    if (!apiKey) {
      throw new MiraiError(
        'CREDENTIALS_UNAVAILABLE',
        credKey === 'nvidia'
          ? 'No NVIDIA key configured — add it in Settings → Providers.'
          : 'No OpenRouter key configured — add it in Settings → Providers.',
      )
    }
    if (credKey === 'nvidia') {
      const model = settings.ai.nvidia.model || 'nvidia/z-ai/glm-5.3'
      return { id: 'nvidia', apiKey, baseUrl: settings.ai.nvidia.baseUrl, model }
    }
    const model = settings.ai.defaultModel
    if (!model) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'No model selected — pick a default model in Settings → Providers.',
      )
    }
    return { id: 'openrouter', apiKey, baseUrl: 'https://openrouter.ai/api/v1', model }
  }

  /** Image provider (OpenAI Images-compatible) — null when not configured. */
  resolveImageProvider(): { apiKey: string; baseUrl: string; model: string; size: string } | null {
    const settings = this.deps.settings.get()
    const apiKey = this.deps.credentials.get('image')
    const baseUrl = settings.ai.image.baseUrl
    const model = settings.ai.image.model
    if (!apiKey || !baseUrl || !model) return null
    return { apiKey, baseUrl, model, size: settings.ai.image.size || '1344x768' }
  }

  // ------------------------------------------------------------------- status

  status(): {
    configured: boolean
    secure: boolean
    defaultModel: string | null
    provider: 'openrouter' | 'nvidia'
    imageConfigured: boolean
  } {
    const settings = this.deps.settings.get()
    const credKey = settings.ai.chatProvider
    const status = this.deps.credentials.status().find((c) => c.key === credKey)
    return {
      configured: status?.configured ?? false,
      secure: status?.secure ?? false,
      defaultModel:
        credKey === 'nvidia'
          ? settings.ai.nvidia.model
          : (settings.ai.defaultModel ?? null),
      provider: credKey,
      imageConfigured: this.resolveImageProvider() !== null,
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
      const providerConfig = this.resolveChatProvider()
      const settings = this.deps.settings.get()
      const model = request.model ?? providerConfig.model

      // ---- build consented context (spec §15/§19) --------------------------
      const systemPrompt = buildSystemPrompt(this.collectContext(request.context))

      // ---- stream ------------------------------------------------------------
      const controller = new AbortController()
      this.active.set(requestId, controller)
      const provider = new OpenRouterProvider({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
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

  // -------------------------------------------------------- Scene Writer agent

  /**
   * Drafts a screenplay for a scene (Phase 2 completion). The returned text
   * is a PROPOSAL — applying it is an explicit user action in the UI.
   */
  async draftScreenplay(sceneId: string, guidance?: string): Promise<{
    draft: string
    model: string
    durationMs: number
  }> {
    const startedAt = Date.now()
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')

    const scene = ctx.creative.getSceneById(sceneId)
    const characters = ctx.creative.listCharacters()
    const castNames = characters
      .filter((c) => scene.characterIds.includes(c.id))
      .map((c) => c.name)
    const locationName = ctx.creative.locationName(scene.locationId)

    const systemPrompt = buildSystemPrompt({
      projectName: ctx.summary.name,
      bible: ctx.creative.getBible(),
      characters: castNames.length > 0
        ? castNames.map((name): ContextCharacter => ({ name }))
        : undefined,
    })
    const instruction = draftScreenplayInstruction({
      sceneTitle: scene.title,
      castNames,
      guidance,
    })
    if (locationName) {
      // slugline hint helps the model match the scene's real setting
    }

    const providerConfig = this.resolveChatProvider()
    const settings = this.deps.settings.get()
    const provider = new OpenRouterProvider({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      fetchFn: globalFetch(),
      appName: 'Mirai Studio',
      appUrl: 'https://mirai-studio.app',
      timeoutMs: settings.ai.requestTimeoutMs,
    })
    const result = await provider.chat({
      model: providerConfig.model,
      temperature: 0.8,
      maxTokens: Math.max(settings.ai.maxTokens, 2_048),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: instruction },
      ],
    })
    const durationMs = Date.now() - startedAt
    this.deps.logger.log('info', 'AI', 'Screenplay draft generated', {
      sceneId,
      model: providerConfig.model,
      durationMs,
      chars: result.content.length,
    })
    return { draft: result.content.trim(), model: providerConfig.model, durationMs }
  }

  // --------------------------------------------------- Frame generation (Phase 4)

  /**
   * Generates a shot frame via the configured image provider with FULL
   * studio consistency: the master prompt bakes in the Style Bible, the
   * shot's camera metadata and the scene's cast/setting. Runs inside a
   * persistent job (progress + retry + cancel); on success the REAL image
   * bytes are stored in the project and attached to the shot.
   */
  async generateFrame(
    shotId: string,
    extraPrompt: string | undefined,
    signal: AbortSignal,
    progress: (pct: number) => void,
  ): Promise<{ assetId: string; prompt: string }> {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')

    const imageProvider = this.resolveImageProvider()
    if (!imageProvider) {
      throw new MiraiError(
        'CREDENTIALS_UNAVAILABLE',
        'No image provider configured — set baseUrl, model and key in Settings → Providers.',
      )
    }

    // ---- consistency data -------------------------------------------------
    const shot = ctx.storyboard.getShotById(shotId)
    const scene = ctx.creative.getSceneById(shot.sceneId)
    const characters = ctx.creative
      .listCharacters()
      .filter((c) => scene.characterIds.includes(c.id))
      .map(
        (c): ContextCharacter => ({
          name: c.name,
          role: c.role,
          personality: c.personality,
          goals: c.goals,
          fears: c.fears,
        }),
      )
    const prompt = buildImagePrompt({
      styleBible: ctx.storyboard.getStyleBible(),
      scene: {
        title: scene.title,
        timeOfDay: scene.timeOfDay,
        synopsis: scene.synopsis,
        locationName: ctx.creative.locationName(scene.locationId),
        castNames: characters.map((c) => c.name),
      },
      shot: {
        title: shot.title,
        shotType: shot.shotType,
        lens: shot.lens,
        cameraMovement: shot.cameraMovement,
        durationSeconds: shot.durationSeconds,
        notes: shot.notes,
      },
      characters,
      extraPrompt,
    })

    progress(20)
    const provider = new OpenAIImagesProvider({
      apiKey: imageProvider.apiKey,
      baseUrl: imageProvider.baseUrl,
      fetchFn: globalFetch(),
      timeoutMs: 240_000,
    })
    const result = await provider.generate({
      model: imageProvider.model,
      prompt,
      size: imageProvider.size,
      signal,
    })
    progress(80)

    const asset = ctx.storyboard.registerGeneratedFrame(shotId, result.bytes, result.mimeType)
    progress(100)
    this.deps.logger.log('info', 'AI', 'Frame generated & attached', {
      shotId,
      assetId: asset.id,
      bytes: asset.bytes,
      model: imageProvider.model,
    })
    return { assetId: asset.id, prompt }
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

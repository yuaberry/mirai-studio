/**
 * AiHost — orchestrates the AI Core in the main process (Phase 2):
 * status, model discovery, streaming chats with abort + cost tracking.
 *
 * Security/consent: only the explicitly requested AiContextScope is read
 * from the project and sent to the provider (spec §15). Errors surface as
 * typed 'ai:error' events with useful messages, never as generic failures.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MiraiError,
  toErrorPayload,
  ScreenplayAnalysis,
  DirectorNotes,
  ContinuityFinding,
  BibleDraftPlan,
  CharacterPlanList,
  ScenePlanList,
  ShotPlanList,
  SeasonPlanList,
  StoryNotesAnalysis,
  StoredBrief,
  type AiContextScope,
  type AutoproduceSummary,
  type ChatMessage,
  type EntityId,
} from '@mirai/shared'
import { assertExplicitCastAllowed, maturePipelineActive } from '@mirai/core'
import type { DossierAiSections, DossierData } from '@mirai/core'
import {
  ModelRegistry,
  OpenRouterProvider,
  OpenAIImagesProvider,
  OpenAIVideoProvider,
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
      /** v0.21: real usage persistence (cost dashboard). Optional so
       * tests/smoke can construct without it. */
      aiUsage?: { record(e: import('@mirai/core').AiUsageEntry): void }
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

  /** Video provider (OpenAI-videos-compatible) — null when not configured. */
  resolveVideoProvider(): {
    apiKey: string
    baseUrl: string
    model: string
    size: string
    fps: number
    quality: 'standard' | 'hd' | 'ultra'
    useReferenceFrame: boolean
  } | null {
    const settings = this.deps.settings.get()
    const apiKey = this.deps.credentials.get('videogen')
    const video = settings.ai.video
    if (!apiKey || !video?.baseUrl || !video.model) return null
    return {
      apiKey,
      baseUrl: video.baseUrl,
      model: video.model,
      size: video.size || '1920x1080',
      fps: video.fps ?? 24,
      quality: video.quality ?? 'hd',
      useReferenceFrame: video.useReferenceFrame ?? true,
    }
  }

  /**
   * Generates a REAL video for a shot via the configured video provider,
   * with the same studio-consistency prompt discipline as image generation
   * (Style Bible + camera metadata + scene/cast baked in) plus motion
   * direction. The bytes are stored in the project and attached to the shot.
   */
  async generateVideo(
    shotId: string,
    extraPrompt: string | undefined,
    seconds: number,
    signal: AbortSignal,
    progress: (pct: number) => void,
  ): Promise<{ assetId: string; prompt: string }> {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')
    const videoProvider = this.resolveVideoProvider()
    if (!videoProvider) {
      throw new MiraiError(
        'CREDENTIALS_UNAVAILABLE',
        'No video provider configured — set baseUrl, model and key in Settings → Providers.',
      )
    }
    const shot = ctx.storyboard.getShotById(shotId)
    const scene = ctx.creative.getSceneById(shot.sceneId)
    const characters = ctx.creative
      .listCharacters()
      .filter((c) => scene.characterIds.includes(c.id))
      .map((c) => ({ name: c.name }))
    if (this.matureActive(ctx)) {
      assertExplicitCastAllowed(
        ctx.creative.listCharacters().filter((c) => scene.characterIds.includes(c.id)),
      )
    }
    // IMAGE-TO-VIDEO: the shot's storyboard keyframe becomes the reference —
    // the provider animates YOUR art (character design + composition stay
    // consistent from board to clip). Falls back to text-only when absent.
    let imageB64: string | undefined
    if (videoProvider.useReferenceFrame && shot.frameAssetId) {
      try {
        const framePath = ctx.storyboard.assetAbsolutePath(shot.frameAssetId)
        const frameBytes = await import('node:fs').then((fs) => fs.readFileSync(framePath))
        imageB64 = frameBytes.toString('base64')
      } catch (err) {
        this.deps.logger.warn('AI', `Reference frame unavailable: ${(err as Error).message}`)
      }
    }
    const prompt = [
      buildImagePrompt({
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
        mature: this.matureActive(ctx),
      }),
      'MOTION: animate with the camera movement above, subtle natural motion, stable character design across all frames, 24fps, no text overlays, no scene cuts.',
    ].join('\n\n')
    progress(10)
    const provider = new OpenAIVideoProvider({
      apiKey: videoProvider.apiKey,
      baseUrl: videoProvider.baseUrl,
      fetchFn: globalFetch(),
      timeoutMs: 300_000,
    })
    const result = await provider.generate({
      model: videoProvider.model,
      prompt,
      seconds,
      size: videoProvider.size,
      fps: videoProvider.fps,
      quality: videoProvider.quality,
      ...(imageB64 !== undefined ? { imageB64 } : {}),
      signal,
    })
    progress(80)
    const asset = ctx.storyboard.registerGeneratedVideo(shotId, result.bytes, result.mimeType)
    this.deps.logger.log('info', 'AI', 'Video generated and attached', {
      shotId,
      assetId: asset.id,
      bytes: result.bytes.length,
      referenceFrame: imageB64 !== undefined,
      fps: videoProvider.fps,
      quality: videoProvider.quality,
    })
    return { assetId: asset.id, prompt }
  }

  // ------------------------------------------------------------- mature mode (Pro)

  /** Mature pipeline = user-enabled mature mode AND the project rated 18+. */
  private matureActive(ctx: NonNullable<ReturnType<ProjectService['current']>>): boolean {
    const settings = this.deps.settings.get()
    return maturePipelineActive(ctx.manifest, settings.content?.matureEnabled ?? false)
  }

  // ------------------------------------------------------------- producer agent

  /**
   * THE PRODUCER AGENT — takes the user's anime idea and produces a full
   * episode: bible → characters → scenes → screenplays → shots → (frames)
   * → timelines. Every step is a real service call; the model only PLANS,
   * the studio EXECUTES.
   */
  async autoproduce(
    options: import('@mirai/shared').AutoproduceOptions,
    progress: (pct: number) => void,
    signal: { readonly aborted: boolean },
  ): Promise<AutoproduceSummary> {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')
    const steps: AutoproduceSummary['steps'] = []
    const push = (step: string, detail: string, ok = true) => steps.push({ step, detail, ok })
    const guard = () => {
      if (signal.aborted) throw new MiraiError('CANCELLED', 'Production cancelled.')
    }

    const mature = this.matureActive(ctx)
    const matureLine = mature
      ? ' This production is rated 18+ and may include mature themes — all characters are adults, write them accordingly (state adult ages).'
      : ''
    const instruction = `PRODUCER BRIEF: ${options.idea}\n\nProject: "${ctx.summary.name}" (${ctx.summary.description ?? 'no description'}).${matureLine}`

    // ---- 1. bible draft (only when empty — never overwrite the author) ------
    let bibleDrafted = false
    const bible = ctx.creative.getBible()
    if (!bible.premise || bible.premise.trim().length === 0) {
      guard()
      const plan = await this.chatJson(
        `You are the story editor of an anime studio. From the brief below, draft the Story Bible.\n\n${instruction}\n\nReturn JSON: { premise: string (2-4 sentences), themes: string[] (3-6), tone: string, message: string (what the audience takes away), genreNotes: string }.`,
        BibleDraftPlan,
        0.7,
      )
      ctx.creative.updateBible({
        ...bible,
        premise: plan.premise,
        themes: plan.themes.join(', '),
        tone: plan.tone,
        message: plan.message,
        genreNotes: plan.genreNotes,
      })
      bibleDrafted = true
      push('Story Bible', 'Premise, themes, tone and message drafted.')
    } else {
      push('Story Bible', "Already written — kept the author's version.")
    }
    progress(5)

    // ---- 2. characters -----------------------------------------------------
    guard()
    const characterPlans = await this.chatJson(
      `You are the character designer of an anime studio. From the brief below, design the main cast (${options.scenesCount > 4 ? '3-4' : '2-3'} characters).\n\n${instruction}\n\nReturn JSON: { characters: [{ name, role (one of PROTAGONIST/DEUTERAGONIST/SUPPORTING/ANTAGONIST/CAMEO/OTHER), age (stated explicitly — e.g. "21"; ${mature ? 'ALL characters must be clearly adults (18+)' : 'age-appropriate to the story'}), appearance (visual, concrete — hair, eyes, build, signature outfit), personality, goals, voice (how they speak) }] }.`,
      CharacterPlanList,
      0.7,
    )
    const existingNames = new Set(ctx.creative.listCharacters().map((c) => c.name.toLowerCase()))
    const createdCharacters: Array<{ id: string; name: string }> = []
    for (const plan of characterPlans) {
      if (existingNames.has(plan.name.toLowerCase())) continue
      const created = ctx.creative.createCharacter(plan)
      createdCharacters.push({ id: created.id, name: created.name })
    }
    push('Characters', `${createdCharacters.length} designed (${createdCharacters.map((c) => c.name).join(', ') || 'existing cast kept'}).`)
    progress(15)

    // ---- 3. episode + scene plan -------------------------------------------
    guard()
    const scenePlans = await this.chatJson(
      `You are the series director planning episode structure. From the brief below, plan the FIRST episode as ${options.scenesCount} scenes with a clear dramatic arc (setup → development → turn → climax landing).\n\n${instruction}\n\nReturn JSON: { scenes: [{ title, synopsis (2-4 sentences), timeOfDay (one of DAY/NIGHT/DAWN/DUSK/UNSPECIFIED), locationName, castNames (from the cast list above; max 4 per scene) }] }.`,
      ScenePlanList,
      0.6,
    )
    // Episode number: next free slot unless provided.
    const episodes = ctx.creative.listEpisodes()
    const season = episodes.length > 0 ? episodes[0]!.season : 1
    const number =
      options.episodeNumber ??
      (episodes.length > 0 ? Math.max(...episodes.map((e) => e.number)) + 1 : 1)
    const episode = ctx.creative.createEpisode({
      season,
      number,
      title: `${options.idea.split(/[.,;\n]/)[0]!.trim().slice(0, 60) || 'Episode'} — Part 1`,
      synopsis: `Autoproduced from the idea: ${options.idea.slice(0, 500)}`,
    })
    // Locations (unique by name).
    const locationIds = new Map<string, string>()
    const castByName = new Map(ctx.creative.listCharacters().map((c) => [c.name, c.id] as const))
    let scenesCreated = 0
    for (const plan of scenePlans) {
      let locationId: string | undefined
      if (plan.locationName && !locationIds.has(plan.locationName)) {
        const created = ctx.creative.createLocation({
          name: plan.locationName,
          description: `Setting for "${plan.title}" — ${plan.synopsis.slice(0, 200)}`,
        })
        locationIds.set(plan.locationName, created.id)
        locationId = created.id
      } else if (plan.locationName) {
        locationId = locationIds.get(plan.locationName)!
      }
      ctx.creative.createScene(episode.id, {
        title: plan.title,
        synopsis: plan.synopsis,
        timeOfDay: plan.timeOfDay,
        locationId,
        characterIds: plan.castNames.map((n) => castByName.get(n)).filter((id): id is string => id !== undefined),
      })
      scenesCreated++
    }
    push('Episode structure', `Episode S${season}E${number} with ${scenesCreated} scenes planned.`)
    progress(25)

    // ---- 4. screenplays ------------------------------------------------------
    guard()
    const scenes = ctx.creative.listScenes(episode.id)
    let screenplaysDrafted = 0
    for (const scene of scenes) {
      guard()
      try {
        const draft = await this.draftScreenplay(scene.id)
        ctx.creative.updateScene(scene.id, {
          title: scene.title,
          timeOfDay: scene.timeOfDay,
          characterIds: scene.characterIds,
          locationId: scene.locationId ?? undefined,
          synopsis: scene.synopsis ?? undefined,
          screenplay: draft.draft,
        })
        screenplaysDrafted++
      } catch (err) {
        push('Screenplay', `Scene "${scene.title}" draft failed: ${(err as Error).message}`, false)
      }
    }
    push('Screenplays', `${screenplaysDrafted}/${scenes.length} scenes written by the Scene Writer.`)
    progress(50)

    // ---- 5. storyboard shots --------------------------------------------------
    guard()
    let shotsCreated = 0
    for (const scene of scenes) {
      guard()
      const shotPlans = await this.chatJson(
        `You are the storyboard artist. Break the scene below into ${options.shotsPerScene} shots with a clear visual rhythm.\n\nSCENE: ${scene.title}\nSYNOPSIS: ${scene.synopsis ?? ''}\nSCREENPLAY:\n${(scene.screenplay ?? '').slice(0, 2_000)}\nCAST: ${scene.characterIds.length > 0 ? ctx.creative.listCharacters().filter((c) => scene.characterIds.includes(c.id)).map((c) => c.name).join(', ') : 'the protagonist'}\n\nReturn JSON: { shots: [{ title, shotType (one of EXTREME_CLOSE_UP/CLOSE_UP/MEDIUM/WIDE/EXTREME_WIDE/OVER_THE_SHOULDER/POV/TWO_SHOT/AERIAL/MACRO), lens (one of 14mm/24mm/35mm/50mm/85mm/135mm), cameraMovement (one of STATIC/PAN_LEFT/PAN_RIGHT/TILT_UP/TILT_DOWN/DOLLY_IN/DOLLY_OUT/TRACKING_LEFT/TRACKING_RIGHT/CRANE_UP/CRANE_DOWN/ZOOM_IN/ZOOM_OUT), durationSeconds (0.5-30), dialogue (optional, in "NAME\nline" screenplay format) }] }.`,
        ShotPlanList,
        0.6,
      )
      for (const plan of shotPlans) {
        ctx.storyboard.createShot(scene.id, plan)
        shotsCreated++
      }
    }
    push('Storyboard', `${shotsCreated} shots boarded across ${scenes.length} scenes.`)
    progress(65)

    // ---- 6. frames (optional — only when the user opted in) -------------------
    let framesGenerated = 0
    if (options.generateFrames) {
      if (this.resolveImageProvider() === null) {
        push('Keyframes', 'Skipped — no image provider configured (Settings → Providers).', false)
      } else {
        for (const scene of scenes) {
          for (const shot of ctx.storyboard.listShots(scene.id)) {
            guard()
            try {
              const frameSignal = new AbortController().signal
              await this.generateFrame(shot.id, undefined, frameSignal, () => undefined)
              framesGenerated++
            } catch (err) {
              push('Keyframes', `Shot "${shot.title}" frame failed: ${(err as Error).message}`, false)
              break // provider issue — stop hammering, the story is still complete
            }
          }
        }
        push('Keyframes', `${framesGenerated} frames generated with studio-consistency prompts.`)
      }
    } else {
      push('Keyframes', 'Skipped (disabled — generate per shot or via Batch later).')
    }
    progress(85)

    // ---- 7. timelines ----------------------------------------------------------
    guard()
    let timelinesBuilt = 0
    for (const scene of scenes) {
      try {
        ctx.timeline.buildFromScene(scene.id, true)
        timelinesBuilt++
      } catch {
        // scenes with zero shots build empty timelines — skip quietly
      }
    }
    push('Timelines', `${timelinesBuilt} scene timelines assembled (ready to edit & render).`)
    progress(95)

    ctx.storyboard.addDecision({
      kind: 'other',
      summary: `Producer Agent: autoproduced Episode S${season}E${number} from the idea "${options.idea.slice(0, 300)}" — ${createdCharacters.length}, ${scenesCreated} scenes, ${shotsCreated} shots.`,
      sceneId: scenes[0]?.id,
    })
    progress(100)

    return {
      bibleDrafted,
      charactersCreated: createdCharacters.length,
      scenesCreated,
      screenplaysDrafted,
      shotsCreated,
      framesGenerated,
      timelinesBuilt,
      episodeTitle: episode.title,
      steps,
    }
  }

  // ------------------------------------------------------------------- phase 8 analysis

  /** Shared JSON-mode chat call with zod validation of the provider output. */
  /** One structured call: transport + JSON extraction + schema validation. */
  private async chatJsonAttempt<T>(
    instruction: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } } },
    temperature: number,
    maxTokensFloor: number,
    modelOverride?: string,
  ): Promise<T> {
    const providerConfig = this.resolveChatProvider()
    const settings = this.deps.settings.get()
    const model = modelOverride ?? providerConfig.model
    const provider = new OpenRouterProvider({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      fetchFn: globalFetch(),
      appName: 'Mirai Studio',
      appUrl: 'https://mirai-studio.app',
      timeoutMs: settings.ai.requestTimeoutMs,
    })
    const startedAt = Date.now()
    const kind = 'chat'
    const usageDeps = this.deps.aiUsage
    let result: Awaited<ReturnType<typeof provider.chat>>
    try {
      result = await provider.chat({
        model,
        temperature,
        maxTokens: Math.max(settings.ai.maxTokens, maxTokensFloor),
        messages: [
          {
            role: 'system',
            content:
              'You are a professional anime production analysis engine. Respond ONLY with a single valid JSON object matching the requested shape — no markdown fences, no commentary. Keep the JSON COMPLETE: never sacrifice closing brackets to finish a thought.',
          },
          { role: 'user', content: instruction },
        ],
      })
      usageDeps?.record({
        kind,
        provider: providerConfig.id,
        model,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        durationMs: Date.now() - startedAt,
        status: 'OK',
      })
    } catch (err) {
      usageDeps?.record({
        kind,
        provider: providerConfig.id,
        model,
        durationMs: Date.now() - startedAt,
        status: 'ERROR',
        error: (err as Error).message,
      })
      throw err
    }
    const raw = result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A cut-off response is the classic maxTokens truncation: the JSON
      // never closes. Surface the ACTIONABLE cause and stay retryable.
      const truncated = raw.length > 0 && !/[}\\]$"']\s*$/.test(raw)
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        truncated
          ? 'A resposta do modelo veio cortada (provável limite de tokens) — aumente o limite em Settings → IA ou use um modelo com contexto maior.'
          : 'The model returned invalid JSON — try again.',
        {
          retryable: true,
          details: { excerpt: raw.slice(0, 160) },
        },
      )
    }
    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The model response did not match the expected shape.', {
        retryable: true,
        details: validated.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    return validated.data
  }

  /**
   * Structured call with ONE automatic retry for transient provider errors
   * (rate limits, overloads, truncated responses). The user should not have
   * to click "analyze" twice because of a single 429.
   */
  private async chatJsonCore<T>(
    instruction: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } } },
    temperature: number,
    maxTokensFloor = 2_048,
  ): Promise<T> {
    try {
      return await this.chatJsonAttempt(instruction, schema, temperature, maxTokensFloor)
    } catch (err) {
      if (err instanceof MiraiError && err.retryable) {
        this.deps.logger.warn('AI', `Provider error (will retry once): ${err.message}`)
        await new Promise((r) => setTimeout(r, 1_500))
        try {
          return await this.chatJsonAttempt(instruction, schema, temperature, maxTokensFloor)
        } catch (retryErr) {
          // FALLBACK CHAIN (v0.21, Phase 2): when a fallback model is
          // configured, one last attempt rides it before giving up.
          const fallback = this.deps.settings.get().ai.fallbackModel?.trim()
          if (fallback && fallback.length > 0) {
            this.deps.logger.warn('AI', `Primary model failed twice — falling back to ${fallback}`)
            return this.chatJsonAttempt(instruction, schema, temperature, maxTokensFloor, fallback)
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  private async chatJson<T>(
    instruction: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } } },
    temperature: number,
    maxTokensFloor = 2_048,
  ): Promise<T> {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')
    return this.chatJsonCore(instruction, schema, temperature, maxTokensFloor)
  }

  /** Provider round-trip WITHOUT a project — used by notes analysis (v0.15). */
  private sceneContext(sceneId: string) {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')
    const scene = ctx.creative.getSceneById(sceneId)
    const characters = ctx.creative.listCharacters()
    const cast = characters.filter((c) => scene.characterIds.includes(c.id))
    const shots = ctx.storyboard.listShots(sceneId)
    return {
      ctx,
      scene,
      cast,
      shots,
      describe(): string {
        const lines = [
          `SCENE: ${scene.title}`,
          `TIME OF DAY: ${scene.timeOfDay}`,
          `LOCATION: ${ctx.creative.locationName(scene.locationId) ?? 'unspecified'}`,
          `SYNOPSIS: ${scene.synopsis ?? '—'}`,
          `CAST: ${cast.map((c) => c.name).join(', ') || '—'}`,
        ]
        if (scene.screenplay) lines.push(`SCREENPLAY:\n${scene.screenplay}`)
        if (shots.length > 0) {
          lines.push(
            `SHOTS:\n${shots
              .map(
                (s, i) =>
                  `${i + 1}. "${s.title}" — ${s.shotType}, ${s.lens}, ${s.cameraMovement}, ${s.durationSeconds}s${s.dialogue ? `, dialogue: ${s.dialogue.replace(/\n/g, ' ')}` : ''}`,
              )
              .join('\n')}`,
          )
        }
        if (cast.length > 0) {
          lines.push(
            `CHARACTER SHEETS:\n${cast
              .map((c) => `- ${c.name} (${c.role}): appearance ${c.appearance ?? '—'}`)
              .join('\n')}`,
          )
        }
        return lines.join('\n\n')
      },
    }
  }

  /** Phase 8 — structured screenplay analysis (pacing, dialogue, repetition). */
  async analyzeScreenplay(sceneId: string): Promise<import('@mirai/shared').ScreenplayAnalysis> {
    const { scene, describe } = this.sceneContext(sceneId)
    if (!scene.screenplay || scene.screenplay.trim().length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'This scene has no screenplay to analyze yet.')
    }
    return this.chatJson(
      `Analyze this anime scene's screenplay like a head writer.\n\n${describe()}\n\nReturn JSON: { pacingScore: 0-10, dialogueQuality: 0-10, strengths: string[], issues: string[], suggestions: string[], repetitionFlags: string[], voiceNotes: string[] } — max 4 items per array, each item one concrete sentence.`,
      ScreenplayAnalysis,
      0.3,
    )
  }

  /** Phase 8 — AI Director notes (narrative, composition, rhythm, emotion, camera). */
  async directorNotes(sceneId: string): Promise<import('@mirai/shared').DirectorNotes> {
    const { describe } = this.sceneContext(sceneId)
    return this.chatJson(
      `You are the series director of a professional anime studio. Give production notes for this scene.\n\n${describe()}\n\nReturn JSON: { narrative: string[], composition: string[], rhythm: string[], emotion: string[], camera: string[], perShot: [{ shotTitle: string, suggestion: string }] } — narrative/composition/rhythm/emotion/camera: max 3 concrete sentences each; perShot: one suggestion per listed shot (use its exact title).`,
      DirectorNotes,
      0.5,
    )
  }

  /** Phase 8 — Continuity Engine (AI-assisted, structured findings). */
  async continuityCheck(
    sceneId: string,
    progress?: (pct: number) => void,
  ): Promise<Array<import('@mirai/shared').ContinuityFinding>> {
    const { ctx, scene, cast, describe } = this.sceneContext(sceneId)
    // Rule-based pre-pass (fast, deterministic, real):
    const findings: Array<{ severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; detail: string }> = []
    if (scene.screenplay) {
      const speakers = [
        ...new Set(
          scene.screenplay
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => /^[A-Z][A-Z0-9_ -]{1,40}$/.test(l))
            .map((l) => l.toUpperCase()),
        ),
      ]
      for (const speaker of speakers) {
        const match = cast.find((c) => c.name.toUpperCase().replace(/\s+/g, ' ') === speaker)
        if (!match) {
          findings.push({
            severity: 'WARNING',
            title: `Dialogue speaker "${speaker}" is not in the scene cast`,
            detail: 'Either add the character to the scene cast or fix the speaker tag — the AI context and voice pipeline use the cast.',
          })
        }
      }
    }
    progress?.(40)
    const aiFindings = await this.chatJson(
      `You are the continuity supervisor of an anime production. Check this scene for continuity issues: costume/appearance contradictions, impossible locations, temporal inconsistencies, character behavior conflicts.\n\n${describe()}\n\nReturn JSON: { findings: [{ severity: "ERROR"|"WARNING"|"INFO", title: string, detail: string }] } — only report REAL issues, max 8; if the scene is consistent return an empty list.`,
      { safeParse: (v: unknown) => ContinuityFinding.array().max(30).safeParse(v) },
      0.2,
    )
    void ctx
    // Merge, dedupe by title.
    const byTitle = new Map<string, { severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; detail: string }>()
    for (const f of [...findings, ...aiFindings]) byTitle.set(f.title, f)
    return [...byTitle.values()]
  }

  /** Phase 8 — orchestrated production review of one scene (3 steps). */
  async productionReview(
    sceneId: string,
    progress: (pct: number) => void,
    signal: { readonly aborted: boolean },
  ): Promise<import('@mirai/shared').ProductionReview> {
    const { scene } = this.sceneContext(sceneId)
    progress(5)
    const analysis = await this.analyzeScreenplay(sceneId)
    if (signal.aborted) throw new MiraiError('CANCELLED', 'Review cancelled.')
    progress(40)
    const director = await this.directorNotes(sceneId)
    if (signal.aborted) throw new MiraiError('CANCELLED', 'Review cancelled.')
    progress(75)
    const continuity = await this.continuityCheck(sceneId, (p) => progress(60 + p * 0.15))
    progress(95)
    const review = { sceneTitle: scene.title, analysis, director, continuity }
    const ctx = this.deps.projects.current()
    ctx?.storyboard.addDecision({
      kind: 'production-review',
      summary: `Production review of "${scene.title}" — pacing ${analysis.pacingScore}/10, dialogue ${analysis.dialogueQuality}/10, ${continuity.length} continuity finding(s).`,
      sceneId,
    })
    progress(100)
    return review
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
      mature: this.matureActive(ctx),
    })
    // Pro: the adults-only policy is enforced in code before any mature prompt.
    if (this.matureActive(ctx)) {
      assertExplicitCastAllowed(
        ctx.creative.listCharacters().filter((c) => scene.characterIds.includes(c.id)),
      )
    }

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

  // ---------------------------------------------- v0.18: adapt the document

  /**
   * ADAPT FROM DOCUMENT — the user sent their story notes; this builds the
   * project AROUND THAT STORY (fidelity-first: the document is canon).
   * Pipeline: bible <- notes · cast <- notes · full season plan <- notes ·
   * scenes+screenplays for episode 1. Runs as a job (ai:adaptNotes).
   */
  async adaptFromDocument(
    progress: (pct: number) => void,
    signal: { readonly aborted: boolean },
  ): Promise<AutoproduceSummary> {
    const ctx = this.deps.projects.current()
    if (!ctx) throw new MiraiError('NOT_FOUND', 'Open a project first.')

    // Read the stored brief (written by projects:create when the user
    // imported a document in New Project).
    const briefPath = join(ctx.summary.path, 'brief', 'brief.json')
    if (!existsSync(briefPath)) {
      throw new MiraiError('VALIDATION_ERROR', 'This project has no imported document to adapt.')
    }
    const stored = StoredBrief.parse(JSON.parse(readFileSync(briefPath, 'utf8')))
    if (stored.notesText.trim().length < 40) {
      throw new MiraiError('VALIDATION_ERROR', 'The stored document is too short to adapt.')
    }

    const manifest = ctx.manifest
    const mature = this.matureActive(ctx)
    const guard = () => {
      if (signal.aborted) throw new MiraiError('CANCELLED', 'Adaptation cancelled.')
    }

    // The grounded instruction: the AUTHOR'S DOCUMENT IS THE CANON.
    const notesExcerpt = stored.notesText.slice(0, 60_000)
    const cfg = manifest.config
    const mediumLine: Record<string, string> = {
      ANIME: `MATÉRIA: anime — episodes of ${cfg.episodeLengthMinutes ?? 22} minutes; plan with TV beats (hook in the first minute, act breaks) and a season arc with a landing.`,
      MANGA: `MATÉRIA: mangá — chapters of ${cfg.pagesPerChapter ?? 40} pages; each episode = one chapter ending on a page-turner cliffhanger.`,
      WEBTOON: `MATÉRIA: webtoon — vertical-scroll episodes; plan with scroll beats and one strong cliffhanger per episode.`,
      LIGHT_NOVEL: 'MATÉRIA: light novel — chapters in prose; episodes = chapter structure with an intercalated POV rhythm.',
      NOVEL: 'MATÉRIA: romance — chapters in literary prose; episodes follow the novel\'s act structure.',
      OTHER: 'MATÉRIA: other — structure episodes in the format the document itself suggests.',
    }
    const briefLines = [
      `TÍTULO: ${cfg.title}`,
      mediumLine[cfg.medium ?? 'OTHER'] ?? mediumLine.OTHER,
      cfg.targetAudience ? `PÚBLICO-ALVO: ${cfg.targetAudience}` : '',
      cfg.inspirations ? `REFERÊNCIAS/INSPIRAÇÕES: ${cfg.inspirations}` : '',
      cfg.setting ? `MUNDO/ÉPOCA: ${cfg.setting}` : '',
      cfg.endingVision ? `DESEJO DE DESFECHO DO AUTOR: ${cfg.endingVision}` : '',
      cfg.episodeCount ? `EPISÓDIOS/CAPÍTULOS POR TEMPORADA: ${cfg.episodeCount}` : '',
      cfg.seasonCount && cfg.seasonCount > 1
        ? `VISÃO DA IP COMPLETA: ${cfg.seasonCount} temporadas/arcos — a temporada 1 precisa FECHAR seu próprio arco e ao mesmo tempo semear o arco maior da IP`
        : '',
      cfg.demographic ? `DEMOGRAFIA (eixo da indústria): ${cfg.demographic}` : '',
      stored.analysis ? `ANÁLISE PROFISSIONAL PRÉVIA DA IA: ${JSON.stringify({
        titleSuggestion: stored.analysis.titleSuggestion,
        premise: stored.analysis.premise,
        themes: stored.analysis.themes,
        suggestedAudience: stored.analysis.suggestedAudience,
      })}` : '',
    ].filter(Boolean)

    const instruction = [
      'ADAPTAÇÃO FIEL — O DOCUMENTO DO AUTOR É O CÂNON.',
      'Extract, structure and adapt ONLY what the document supports. Never invent plot that contradicts it; when structure needs a gap filled, keep it minimal and coherent, marked "[sugestão]".',
      ...briefLines,
      `DOCUMENTO DO AUTOR:\n${notesExcerpt}`,
    ].join('\n\n')

    const steps: AutoproduceSummary['steps'] = []
    const push = (step: string, detail: string, ok = true) => steps.push({ step, detail, ok })
    let bibleDrafted = false
    let scenesCreated = 0
    let screenplaysDrafted = 0

    // ---- 1. Story Bible from the document (never overwrite the author) ----
    const bible = ctx.creative.getBible()
    if (!bible.premise || bible.premise.trim().length === 0) {
      guard()
      const plan = await this.chatJson(
        `You are the story editor. From the author's document below, write the Story Bible — extracted from the story itself, not invented.\n\n${instruction}\n\nReturn JSON: { premise (2-4 sentences, the story's actual core conflict), themes (3-6), tone, message, genreNotes }.`,
        BibleDraftPlan,
        0.4,
        4_096,
      )
      ctx.creative.updateBible({
        ...bible,
        premise: plan.premise,
        themes: plan.themes.join(', '),
        tone: plan.tone,
        message: plan.message,
        genreNotes: plan.genreNotes,
      })
      push('Story Bible', 'Extraído fielmente do documento (premissa, temas, tom, mensagem).')
      bibleDrafted = true
    } else {
      push('Story Bible', "Já escrito — a versão do autor foi mantida.")
    }
    progress(10)

    // ---- 2. Cast from the document ---------------------------------------
    guard()
    const castPlan = await this.chatJson(
      `You are the character designer. From the author's document below, extract EVERY character the story supports (up to 8, prioritized by narrative weight). Use the document's own names, ages, traits and descriptions — never invent characters.\n\n${instruction}\n\nReturn JSON: { characters: [{ name, role (PROTAGONIST/DEUTERAGONIST/SUPPORTING/ANTAGONIST/CAMEO/OTHER), age (stated explicitly — e.g. "21"${mature ? '; ALL characters verifiably ADULTS (18+) — hard rule' : ''}), appearance (concrete visual: hair, eyes, build, signature outfit — grounded in the document), personality, goals, voice }] }.`,
      CharacterPlanList,
      0.4,
      4_096,
    )
    const existingNames = new Set(ctx.creative.listCharacters().map((c) => c.name.toLowerCase()))
    const createdCast: string[] = []
    for (const plan of castPlan) {
      if (existingNames.has(plan.name.toLowerCase())) continue
      ctx.creative.createCharacter(plan)
      createdCast.push(plan.name)
    }
    push('Elenco', `${createdCast.length} personagens extraídos do documento (${createdCast.join(', ') || 'elenco existente mantido'}).`)
    progress(30)

    // ---- 3. FULL season plan from the document ----------------------------
    guard()
    const planned = Math.min(Math.max(cfg.episodeCount ?? stored.analysis?.estimatedEpisodes ?? 12, 1), 24)
    const seasonVision =
      cfg.seasonCount && cfg.seasonCount > 1
        ? ` The full IP plans ${cfg.seasonCount} seasons — season 1 must LAND its own arc while seeding the larger one (plant, don't resolve, the long-range threads).`
        : ''
    const seasonPlan = await this.chatJson(
      `You are the series director. From the author's document below, plan the SEASON (${planned} episodes) following the story's ACTUAL arc: beginning, developments, turn, climax, landing the author wrote (or pointed toward).${seasonVision}\n\n${instruction}\n\nReturn JSON: { episodes: [{ number (1..${planned}), title, synopsis (2-4 sentences grounded in the document) }] } — exactly ${planned} episodes.`,
      SeasonPlanList,
      0.5,
    )
    const episodes = ctx.creative.listEpisodes()
    const season = episodes.length > 0 ? episodes[0]!.season : 1
    const startNumber = episodes.length > 0 ? Math.max(...episodes.map((e) => e.number)) + 1 : 1
    const createdEpisodes: Array<{ id: string; number: number; title: string }> = []
    for (const ep of seasonPlan) {
      const number = startNumber + ep.number - 1
      const created = ctx.creative.createEpisode({
        season,
        number,
        title: ep.title,
        synopsis: ep.synopsis,
      })
      createdEpisodes.push({ id: created.id, number, title: created.title })
    }
    push('Plano da temporada', `${createdEpisodes.length} episódios/capítulos estruturados do documento.`)
    progress(55)

    // ---- 4. Scenes for episode 1 -------------------------------------------
    guard()
    const firstEpisode = createdEpisodes.find((e) => e.number === startNumber)
    if (firstEpisode) {
      const scenePlans = await this.chatJson(
        `You are the series director. From the author's document below, break the FIRST episode into scenes with a clear dramatic arc (hook → development → turn → climax landing).\n\n${instruction}\n\nReturn JSON: { scenes: [{ title, synopsis (2-4 sentences), timeOfDay (DAY/NIGHT/DAWN/DUSK/UNSPECIFIED), locationName, castNames (names from the extracted cast; max 4 per scene) }] }.`,
        ScenePlanList,
        0.5,
        4_096,
      )
      const locationIds = new Map<string, string>()
      const castByName = new Map(ctx.creative.listCharacters().map((c) => [c.name, c.id] as const))
      for (const plan of scenePlans) {
        let locationId: string | undefined
        if (plan.locationName && !locationIds.has(plan.locationName)) {
          const loc = ctx.creative.createLocation({
            name: plan.locationName,
            description: `Cenário de "${plan.title}" — extraído do documento do autor.`,
          })
          locationIds.set(plan.locationName, loc.id)
          locationId = loc.id
        } else if (plan.locationName) {
          locationId = locationIds.get(plan.locationName)!
        }
        ctx.creative.createScene(firstEpisode.id, {
          title: plan.title,
          synopsis: plan.synopsis,
          timeOfDay: plan.timeOfDay,
          locationId,
          characterIds: plan.castNames
            .map((n) => castByName.get(n))
            .filter((id): id is string => id !== undefined),
        })
        scenesCreated++
      }
      push('Cenas do episódio 1', `${scenesCreated} cenas planejadas.`)
      progress(75)

      // ---- 5. Screenplays for episode 1's scenes ---------------------------
      const scenes = ctx.creative.listScenes(firstEpisode.id)
      for (const scene of scenes) {
        guard()
        try {
          const draft = await this.draftScreenplay(scene.id)
          ctx.creative.updateScene(scene.id, {
            title: scene.title,
            timeOfDay: scene.timeOfDay,
            characterIds: scene.characterIds,
            locationId: scene.locationId ?? undefined,
            synopsis: scene.synopsis ?? undefined,
            screenplay: draft.draft,
          })
          screenplaysDrafted++
        } catch (err) {
          push('Screenplay', `Cena "${scene.title}": ${(err as Error).message}`, false)
        }
      }
      push('Roteiros', `${screenplaysDrafted}/${scenes.length} cenas roteirizadas (os demais episódios seguem no Producer Agent).`)
    }
    progress(95)

    // ---- 6. Mark the brief adapted -----------------------------------------
    writeFileSync(briefPath, JSON.stringify({ ...stored, adapted: true }, null, 2), 'utf8')
    push('Documento', 'Marcado como adaptado — o dossiê refletirá o material desde a geração.')
    progress(100)

    this.deps.logger.info('AI', 'Document adapted into project', {
      project: ctx.summary.name,
      episodes: createdEpisodes.length,
    })
    return {
      bibleDrafted,
      charactersCreated: createdCast.length,
      scenesCreated,
      screenplaysDrafted,
      shotsCreated: 0,
      framesGenerated: 0,
      timelinesBuilt: 0,
      episodeTitle: firstEpisode?.title ?? '',
      steps,
    }
  }

  // -------------------------------------------------- v0.15: notes + dossier

  /**
   * Analyzes the user's imported story notes (BEFORE a project exists) and
   * returns a professional planning read: title, medium, premise, episode
   * estimates, cast seeds, improvements, risks and commercial notes.
   * Works without an open project — the New Project flow depends on it.
   */
  async analyzeStoryNotes(
    notesText: string,
    context?: {
      medium?: string
      demographic?: string
      seasonCount?: number
      targetAudience?: string
      inspirations?: string
      setting?: string
      endingVision?: string
    },
  ): Promise<import('@mirai/shared').StoryNotesAnalysis> {
    if (notesText.trim().length < 40) {
      throw new MiraiError('VALIDATION_ERROR', 'The imported notes are too short for a meaningful analysis.')
    }
    const excerpt = notesText.slice(0, 24_000)
    const authorLines = [
      context?.medium ? `MATÉRIA ESCOLHIDA PELO AUTOR: ${context.medium}` : '',
      context?.demographic ? `DEMOGRAFIA DECLARADA: ${context.demographic}` : '',
      context?.seasonCount ? `TEMPORADAS PLANEJADAS PARA A IP: ${context.seasonCount}` : '',
      context?.targetAudience ? `PÚBLICO-ALVO DECLARADO: ${context.targetAudience}` : '',
      context?.inspirations ? `INSPIRAÇÕES DECLARADAS: ${context.inspirations}` : '',
      context?.setting ? `MUNDO/ÉPOCA DECLARADO: ${context.setting}` : '',
      context?.endingVision ? `DESEJO DE DESFECHO DO AUTOR: ${context.endingVision}` : '',
    ].filter(Boolean)
    const authorBlock = authorLines.length > 0 ? `\n\nAUTHOR DECLARATIONS (honor these):\n${authorLines.join('\n')}\n` : ''
    return this.chatJsonCore(
      `You are the head of development of a professional anime/manga studio. The user sent REAL story notes (imported from their documents). Read them like a commercial publisher evaluating a submission, then return a professional planning analysis. Keep the JSON TIGHT — complete, concise sentences; never leave the JSON unclosed.${authorBlock}\n\nNOTES BEGIN\n${excerpt}\nNOTES END\n\nReturn JSON: { titleSuggestion (marketable title in the notes' language, max 120 chars), medium (ANIME, MANGA, LIGHT_NOVEL, NOVEL, WEBTOON or OTHER), premise (2-4 sentences, the core conflict), synopsis (1-2 paragraphs for a pitch document), tone, suggestedAudience, contentRating (ALL, 7+, 13+, 16+ or 18+ — infer conservatively; only 18+ if the notes are explicitly adult), genres (1-8 anime-taxonomy tags like Drama, Isekai, School, Romance), themes (1-8), estimatedEpisodes (professional planning estimate per season), estimatedSeasons (how many seasons/arcs the material supports as a full IP), estimatedPagesPerEpisode (manga/webtoon pages per chapter; 0 for anime), characterSeeds (up to 12: { name, role, brief } — only characters the notes support), locationSeeds (up to 10), improvements (2-10 concrete, professional sentences — structure, stakes, marketability), risks (0-8 commercial/structural risks), commercialNotes (positioning + monetization read, 1-2 paragraphs) }.\nGround EVERYTHING in the notes — never invent plot the notes don't support; suggest improvements, don't write the story.`,
      StoryNotesAnalysis,
      0.4,
    )
  }

  /**
   * Generates the AI-enriched strategic sections of the Project Dossier from
   * the REAL project data. Each section is multi-paragraph professional
   * prose — the dossier renders 30-45+ A4 pages with these.
   */
  async dossierAiSections(
    data: DossierData,
    reportProgress: (pct: number) => void = () => {},
    signal?: AbortSignal,
  ): Promise<DossierAiSections> {
    const about = [
      `TÍTULO: ${data.title}`,
      `MATÉRIA/FORMATO: ${data.medium}`,
      `CLASSIFICAÇÃO: ${data.contentRating}`,
      `GÊNEROS: ${data.genres.join(', ') || '—'}`,
      `EPISÓDIOS PLANEJADOS: ${data.plannedEpisodes ?? 'a definir'}`,
      `DESCRIÇÃO: ${data.description || '—'}`,
      `PREMISSA: ${data.storyBible.premise ?? '—'}`,
      `TEMAS: ${data.storyBible.themes ?? '—'}`,
      `TOM: ${data.storyBible.tone ?? '—'}`,
      `ELENCO (${data.characters.length}): ${data.characters.map((c) => `${c.name} (${c.role})`).join('; ') || '—'}`,
      `EPISÓDIOS CRIADOS: ${data.episodes.length}`,
      `ESTADO DE PRODUÇÃO: ${data.shotsCount} shots, ${data.mediaCount} ativos, QC ${data.qc.errors}e/${data.qc.warnings}a/${data.qc.infos}i`,
    ].join('\n')

    const section = async (schemaName: string, shape: string, temperature: number): Promise<string> => {
      if (signal?.aborted) throw new MiraiError('CANCELLED', 'Dossier aborted.')
      const raw = await this.chatJsonCore(
        `You are a senior commercial analyst of a professional studio, writing strategic sections of a PROJECT DOSSIER (a formal pitch/planning document for producers, distributors and funders). Project data:\n\n${about}\n\nWrite the "${schemaName}" section. Return JSON: { text: string } where text is 3-5 paragraphs of dense, professional, commercial-grade prose in Brazilian Portuguese (no bullet lists, no headers inside — flowing paragraphs only). ${shape}`,
        zSectionText,
        temperature,
      )
      return raw.text
    }

    reportProgress(5)
    const executiveSummary = await section('Sumário executivo', 'Cover: what the work is, its identity and the single strongest commercial argument; the state of production; what this dossier demonstrates. End with the immediate next step recommendation.', 0.4)
    reportProgress(25)
    const marketPositioning = await section('Posicionamento de mercado', 'Define the exact market segment, the competitive differentiation with 2-4 verifiable points grounded in the project data, and the primary/secondary audience.', 0.4)
    reportProgress(45)
    const monetization = await section('Modelo de monetização', 'Revenue streams ranked by realistic priority for this format (distribution, licensing, merchandise, derived works), each with a one-line justification.', 0.4)
    reportProgress(60)
    const commercialStrategy = await section('Plano comercial integral', 'Three horizons (immediate, 12-18 months, 24-36 months): festivals/pitch, distribution, franchise expansion. Concrete actions per horizon, referencing the project real state.', 0.4)
    reportProgress(75)
    const legalRaw = await this.chatJsonCore(
      `You are a legal-savvy production analyst writing the "Notas jurídicas específicas do projeto" section of a Brazilian project dossier. Project data:\n\n${about}\n\nReturn JSON: { text } — 2-4 paragraphs in pt-BR about: titularidade/cadeia de direitos da obra original, recomendações de registro (LDA 9.610/98), contratos (cessões por escrito LDA art. 33, imagem/voz), proteção de dados (LGPD) e verificação de marca do título. Grounded in the project's real data; include the disclaimer attitude that this is planning documentation, not formal legal advice.`,
      zSectionText,
      0.3,
    )
    reportProgress(85)
    const lists = await this.chatJsonCore(
      `You are the head of production of a professional studio writing planning lists for a project dossier. Project data:\n\n${about}\n\nReturn JSON: { riskRegister: string[] (3-8 concrete commercial/structural risks, each with its mitigation in the same sentence), roadmap: string[] (4-8 actionable steps in chronological tractions, each naming a concrete deliverable), improvements: string[] (3-8 concrete professional improvements to the project as it stands) }. Brazilian Portuguese, one sentence per item.`,
      zDossierLists,
      0.4,
    )
    reportProgress(95)
    return {
      executiveSummary,
      commercialStrategy,
      marketPositioning,
      monetization,
      legalNotes: legalRaw.text,
      riskRegister: lists.riskRegister,
      roadmap: lists.roadmap,
      improvements: lists.improvements,
    }
  }
}

/** Dossier AI section shapes (validated model outputs). */
const zSectionText = {
  safeParse: (v: unknown) => {
    const ok = typeof v === 'object' && v !== null && typeof (v as { text?: unknown }).text === 'string' && (v as { text: string }).text.length > 80
    return ok
      ? { success: true as const, data: v as { text: string } }
      : { success: false as const, error: { issues: [{ message: 'Expected { text } with substantial content.', path: [] }] } }
  },
} satisfies { safeParse: (v: unknown) => { success: true; data: { text: string } } | { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } } }

const zDossierLists = {
  safeParse: (v: unknown) => {
    const o = v as { riskRegister?: unknown; roadmap?: unknown; improvements?: unknown }
    const arr = (x: unknown): x is string[] =>
      Array.isArray(x) && x.every((i) => typeof i === 'string' && i.length > 8) && x.length > 0
    const ok = arr(o.riskRegister) && arr(o.roadmap) && arr(o.improvements)
    return ok
      ? { success: true as const, data: { riskRegister: o.riskRegister as string[], roadmap: o.roadmap as string[], improvements: o.improvements as string[] } }
      : { success: false as const, error: { issues: [{ message: 'Expected riskRegister/roadmap/improvements string arrays.', path: [] }] } }
  },
} satisfies { safeParse: (v: unknown) => { success: true; data: { riskRegister: string[]; roadmap: string[]; improvements: string[] } } | { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } } }

/** The real network transport, bound once (Electron main has global fetch). */
function globalFetch() {
  return (url: string, init: Parameters<typeof fetch>[1] & { method: 'GET' | 'POST' }) =>
    fetch(url, init as never)
}

/**
 * Model Registry — dynamic model discovery with TTL cache (spec §38:
 * never assume a free model stays available; the catalog is refreshed live).
 */
import type { AiModelInfo } from '@mirai/shared'
import type { AIProvider } from './types'

export interface ModelRegistryOptions {
  /** Resolves the provider (lazily — credentials may appear later). */
  provider: () => AIProvider
  clock: { now(): number }
  /** Cache TTL for the catalog; default 10 minutes. */
  ttlMs?: number
}

export interface RegistryResult {
  models: AiModelInfo[]
  cached: boolean
}

export class ModelRegistry {
  private cache: { models: AiModelInfo[]; fetchedAt: number } | null = null

  constructor(private readonly opts: ModelRegistryOptions) {}

  async list(force = false): Promise<RegistryResult> {
    const ttl = this.opts.ttlMs ?? 10 * 60 * 1000
    if (
      !force &&
      this.cache &&
      this.opts.clock.now() - this.cache.fetchedAt < ttl
    ) {
      return { models: this.cache.models, cached: true }
    }
    const models = await this.opts.provider().listModels()
    this.cache = { models, fetchedAt: this.opts.clock.now() }
    return { models, cached: false }
  }
}

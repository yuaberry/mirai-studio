/**
 * MarketplaceService — the AI Marketplace catalog.
 *
 * The app never hardcodes "the model list": the vendors' own catalogs are
 * fetched live (Pollinations publishes /image/models and /video/models; the
 * chat catalog comes from the configured provider). The curated provider
 * cards live in @mirai/shared and every one of them is implemented by an
 * adapter in this repo — there is no entry the app cannot drive.
 *
 * Transport-free by design (the core is Electron-free): the fetch port is
 * injected, so the whole catalog is testable without a network.
 */
import {
  MARKETPLACE_PROVIDERS,
  type AiModelInfo,
  type CredentialKey,
  type MarketplaceCatalog,
  type MarketplaceModel,
  type MarketplaceProvider,
} from '@mirai/shared'
import type { Clock } from '../types'

/** Minimal fetch port (subset used by the marketplace). */
export interface MarketplaceFetch {
  (url: string, init: { method: 'GET'; headers?: Record<string, string>; signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
  }>
}

export interface MarketplaceServiceOptions {
  fetchFn: MarketplaceFetch
  clock: Clock
  /** Live chat models from the configured chat provider. */
  listChatModels: () => Promise<AiModelInfo[]>
  /** Whether a credential slot currently holds a key. */
  hasCredential: (key: CredentialKey) => boolean
}

/** Pollinations' public media catalog. */
const POLLINATIONS_IMAGE_MODELS = 'https://gen.pollinations.ai/image/models'
const POLLINATIONS_VIDEO_MODELS = 'https://gen.pollinations.ai/video/models'

/** One live entry as the vendor publishes it. */
interface VendorModel {
  name?: string
  id?: string
  title?: string
  paid_only?: boolean
  price?: Record<string, unknown> | string | number
  resolutions?: string[]
  resolution?: string
  durations?: number[]
  duration?: number
  description?: string
}

export class MarketplaceService {
  constructor(private readonly opts: MarketplaceServiceOptions) {}

  /** The curated provider cards (no network). */
  providers(): MarketplaceProvider[] {
    return MARKETPLACE_PROVIDERS.map((p) => ({ ...p }))
  }

  /** Provider ids that are ready to use right now. */
  configuredProviderIds(): string[] {
    const out: string[] = []
    for (const provider of MARKETPLACE_PROVIDERS) {
      if (!provider.requiresKey) {
        out.push(provider.id)
        continue
      }
      if (provider.credentialKey && this.opts.hasCredential(provider.credentialKey)) {
        out.push(provider.id)
      }
    }
    return out
  }

  /**
   * The full catalog: curated providers + LIVE models.
   *
   * A vendor that cannot be reached degrades its own list (the card stays,
   * the model list is skipped) — it never breaks the page.
   */
  async catalog(): Promise<MarketplaceCatalog> {
    const degraded: string[] = []
    const models: MarketplaceModel[] = []

    // --- chat models (from the configured provider) ------------------------
    try {
      const chat = await this.opts.listChatModels()
      for (const model of chat) {
        models.push({
          id: model.id,
          name: model.name,
          capability: 'chat',
          providerId: 'active-chat',
          free: model.isFree,
          price:
            model.promptPricePerToken === null
              ? ''
              : `$${(model.promptPricePerToken * 1_000_000).toFixed(2)}/M in · ${
                  model.completionPricePerToken === null
                    ? '?'
                    : (model.completionPricePerToken * 1_000_000).toFixed(2)
                }/M out`,
          resolutions: [],
          durations: [],
          notes: model.contextLength ? `${model.contextLength} ctx` : undefined,
        })
      }
    } catch {
      degraded.push('active-chat')
    }

    // --- Pollinations media catalogs ---------------------------------------
    const [imageModels, videoModels] = await Promise.all([
      this.fetchVendorModels(POLLINATIONS_IMAGE_MODELS, 'image', degraded),
      this.fetchVendorModels(POLLINATIONS_VIDEO_MODELS, 'video', degraded),
    ])
    models.push(...imageModels, ...videoModels)

    return {
      providers: this.providers(),
      models,
      configured: this.configuredProviderIds(),
      fetchedAt: this.opts.clock.isoNow(),
      degraded,
    }
  }

  private async fetchVendorModels(
    url: string,
    capability: 'image' | 'video',
    degraded: string[],
  ): Promise<MarketplaceModel[]> {
    try {
      const response = await this.opts.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as unknown
      const list = toVendorList(payload)
      const out: MarketplaceModel[] = []
      for (const entry of list) {
        const id = entry.name ?? entry.id
        if (!id) continue
        const providerId = capability === 'image' ? 'pollinations-image' : 'pollinations-video'
        out.push({
          id,
          name: entry.title ?? id,
          capability,
          providerId,
          free: entry.paid_only !== true,
          price: formatPrice(entry.price),
          resolutions: entry.resolutions ?? (entry.resolution ? [entry.resolution] : []),
          durations: entry.durations ?? (entry.duration ? [entry.duration] : []),
          notes: entry.description?.slice(0, 160),
        })
      }
      return out
    } catch {
      degraded.push(capability === 'image' ? 'pollinations-image' : 'pollinations-video')
      return []
    }
  }
}

/** The vendors publish a bare array today and an object envelope tomorrow. */
function toVendorList(payload: unknown): VendorModel[] {
  if (Array.isArray(payload)) return payload as VendorModel[]
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['data', 'models', 'items']) {
      const value = record[key]
      if (Array.isArray(value)) return value as VendorModel[]
    }
  }
  return []
}

/** Renders the vendor's price object as one short human string. */
function formatPrice(price: VendorModel['price']): string {
  if (price === undefined || price === null) return ''
  if (typeof price === 'number') return `${price} pollen/s`
  if (typeof price === 'string') return price
  const entries = Object.entries(price)
  if (entries.length === 0) return ''
  const parts = entries.map(([key, value]) => `${key}: ${String(value)}`)
  return parts.join(' · ')
}

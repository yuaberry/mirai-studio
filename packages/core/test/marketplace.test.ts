/**
 * MarketplaceService — the LIVE catalog.
 *
 * The contract that matters: the app never invents models. It reads the
 * vendors' own catalogs and, when a vendor is unreachable, says so in
 * `degraded` instead of showing an empty page as if nothing were wrong.
 */
import { describe, expect, it } from 'vitest'
import { MarketplaceService, type MarketplaceFetch } from '../src/marketplace/marketplaceService'
import { MARKETPLACE_PROVIDERS } from '@mirai/shared'

const clock = {
  isoNow: () => '2026-11-05T00:00:00.000Z',
  now: () => new Date('2026-11-05T00:00:00.000Z'),
}

function serviceWith(
  fetchFn: MarketplaceFetch,
  overrides: Partial<ConstructorParameters<typeof MarketplaceService>[0]> = {},
) {
  return new MarketplaceService({
    fetchFn,
    clock,
    listChatModels: async () => [],
    hasCredential: () => false,
    ...overrides,
  })
}

const IMAGE_CATALOG = [
  { name: 'black-forest-labs/flux.1-schnell', title: 'FLUX.1 Schnell', paid_only: false, resolutions: ['1024x1024'] },
  { name: 'openai/gpt-image-2', title: 'GPT Image 2', paid_only: true, price: { amount: 12 } },
]

const VIDEO_CATALOG = [
  { name: 'alibaba/wan-2.2-fast', title: 'Wan 2.2 Fast', paid_only: true, durations: [5, 10] },
  { name: 'google/veo-3.1-fast', title: 'Veo 3.1 Fast', paid_only: true },
]

function fakeFetch(payloads: Record<string, unknown>): MarketplaceFetch {
  return async (url) => {
    for (const [needle, payload] of Object.entries(payloads)) {
      if (url.includes(needle)) {
        return { ok: true, status: 200, json: async () => payload }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

describe('MarketplaceService.providers', () => {
  it('exposes the curated cards — every one of them implemented in the app', () => {
    const service = serviceWith(fakeFetch({}))
    const providers = service.providers()

    expect(providers.length).toBe(MARKETPLACE_PROVIDERS.length)
    // No duplicate ids, and every card names a protocol the app speaks.
    const ids = new Set(providers.map((p) => p.id))
    expect(ids.size).toBe(providers.length)
    for (const provider of providers) {
      expect(['openai', 'pollinations', 'google-translate']).toContain(provider.protocol)
    }
  })

  it('does not promise a watermark-free output the vendor does not deliver', () => {
    const service = serviceWith(fakeFetch({}))
    const pollinationsImage = service.providers().find((p) => p.id === 'pollinations-image')

    // MEASURED: the classic endpoint stamps its logo — `nologo=true` does
    // not remove it. The card must say so.
    expect(pollinationsImage?.watermarkFree).toBe(false)
    expect(pollinationsImage?.notes).toMatch(/logo/i)
  })
})

describe('MarketplaceService.configuredProviderIds', () => {
  it('lists the keyless providers as ready', () => {
    const service = serviceWith(fakeFetch({}), { hasCredential: () => false })
    const configured = service.configuredProviderIds()

    expect(configured).toContain('pollinations-image')
    expect(configured).toContain('google-translate-speech')
    expect(configured).not.toContain('nvidia-chat')
  })

  it('lists a provider as ready only when its key is present', () => {
    const service = serviceWith(fakeFetch({}), {
      hasCredential: (key) => key === 'nvidia',
    })
    const configured = service.configuredProviderIds()

    expect(configured).toContain('nvidia-chat')
    expect(configured).not.toContain('openrouter-chat')
  })
})

describe('MarketplaceService.catalog', () => {
  it('reads the live media catalogs and the chat catalog', async () => {
    const service = serviceWith(
      fakeFetch({ '/image/models': IMAGE_CATALOG, '/video/models': VIDEO_CATALOG }),
      {
        listChatModels: async () => [
          {
            id: 'vendor/free-model',
            name: 'Free Model',
            contextLength: 32_000,
            isFree: true,
            promptPricePerToken: 0,
            completionPricePerToken: 0,
          },
        ],
      },
    )

    const catalog = await service.catalog()

    expect(catalog.degraded).toEqual([])
    expect(catalog.providers.length).toBeGreaterThan(0)

    const chat = catalog.models.filter((m) => m.capability === 'chat')
    expect(chat.length).toBe(1)
    expect(chat[0]!.providerId).toBe('active-chat')
    expect(chat[0]!.free).toBe(true)

    const image = catalog.models.filter((m) => m.capability === 'image')
    expect(image.length).toBe(2)
    expect(image.find((m) => m.id === 'black-forest-labs/flux.1-schnell')?.free).toBe(true)
    expect(image.find((m) => m.id === 'openai/gpt-image-2')?.free).toBe(false)

    const video = catalog.models.filter((m) => m.capability === 'video')
    expect(video.length).toBe(2)
    expect(video.find((m) => m.id === 'alibaba/wan-2.2-fast')?.durations).toEqual([5, 10])
  })

  it('degrades the page instead of breaking it when a vendor is down', async () => {
    const service = serviceWith(
      async (url) => {
        if (url.includes('/image/models')) {
          return { ok: false, status: 503, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => VIDEO_CATALOG }
      },
      {
        listChatModels: async () => {
          throw new Error('provider offline')
        },
      },
    )

    const catalog = await service.catalog()

    expect(catalog.degraded).toContain('pollinations-image')
    expect(catalog.degraded).toContain('active-chat')
    // The rest of the catalog still works.
    expect(catalog.models.filter((m) => m.capability === 'video').length).toBe(2)
    expect(catalog.providers.length).toBeGreaterThan(0)
  })

  it('accepts an object envelope from the vendor', async () => {
    const service = serviceWith(
      fakeFetch({
        '/image/models': { data: IMAGE_CATALOG },
        '/video/models': { models: VIDEO_CATALOG },
      }),
    )

    const catalog = await service.catalog()

    expect(catalog.models.filter((m) => m.capability === 'image').length).toBe(2)
    expect(catalog.models.filter((m) => m.capability === 'video').length).toBe(2)
  })
})

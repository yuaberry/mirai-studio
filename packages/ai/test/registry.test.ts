import { describe, expect, it } from 'vitest'
import type { AiModelInfo } from '@mirai/shared'
import { ModelRegistry } from '../src/registry'
import type { AIProvider } from '../src/types'
import { makeClock } from './fakes'

function makeProvider(models: AiModelInfo[], counter: { calls: number }): AIProvider {
  return {
    id: 'openrouter',
    capabilities: { chat: true, stream: true, structured: 'prompt', listModels: true },
    chat: async () => ({ content: '', usage: null }),
    stream: async function* () {},
    listModels: async () => {
      counter.calls += 1
      return models
    },
  }
}

const MODELS: AiModelInfo[] = [
  { id: 'm/a', name: 'A', contextLength: 1000, isFree: true, promptPricePerToken: 0, completionPricePerToken: 0 },
]

describe('ModelRegistry', () => {
  it('caches within the TTL and refreshes on force', async () => {
    const counter = { calls: 0 }
    const clock = makeClock()
    const registry = new ModelRegistry({
      provider: () => makeProvider(MODELS, counter),
      clock,
      ttlMs: 600,
    })

    const first = await registry.list()
    expect(first.cached).toBe(false)
    const second = await registry.list()
    expect(second.cached).toBe(true)
    expect(counter.calls).toBe(1)

    clock.advance(601)
    const third = await registry.list()
    expect(third.cached).toBe(false)
    expect(counter.calls).toBe(2)

    const forced = await registry.list(true)
    expect(forced.cached).toBe(false)
    expect(counter.calls).toBe(3)
  })
})

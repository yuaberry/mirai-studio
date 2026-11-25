/**
 * HuggingFaceVideoProvider — o caminho gratuito de animação.
 *
 * O dialeto do Gradio (enfileirar → esperar → baixar) é exercitado com
 * transporte fingido: a fila completa, o vídeo desce. Um 401 honesto e um
 * token vazio também. Quando o usuário ligar o token de verdade, o que
 * muda é só o transporte.
 */
import { describe, expect, it } from 'vitest'
import { HuggingFaceVideoProvider, extractVideoUrl } from '../src/huggingFaceVideo'

const endpoints = { callUrl: 'https://space.gradio_run.com/gradio_api/call', fnName: 'predict' }

/** Fetch fingido: enfileira, depois completa, depois serve o "vídeo". */
function fakeFetch(queueSteps = 1): typeof fetch {
  let step = 0
  return (async (url: string, _init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/predict') && !u.includes('/e')) {
      return new Response(JSON.stringify({ event_id: 'evt-1' }), { status: 200 })
    }
    if (u.includes('/predict/e') || u.includes('/predict/e') || u.split('/').pop() === 'evt-1') {
      step += 1
      if (step <= queueSteps) {
        return new Response('data: {"msg": "queued"}\n\n', { status: 200 })
      }
      return new Response(
        'data: [{"video": {"video": {"url": "https://cdn/clip.mp4"}, "duration": 2}}]\n\nevent: process_completed\n\n',
        { status: 200 },
      )
    }
    if (u.includes('cdn/clip.mp4')) {
      return new Response(Buffer.from('VIDEOBYTES'.repeat(300)) as never, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

describe('HuggingFaceVideoProvider', () => {
  it('queues, waits the ZeroGPU queue and downloads the clip', async () => {
    const provider = new HuggingFaceVideoProvider({
      token: 'hf_test',
      endpoints,
      fetchFn: fakeFetch(1),
    })
    const result = await provider.generate({ prompt: 'a garota pisca', imageUrl: 'http://img/x.png' })
    expect(result.eventId).toBe('evt-1')
    expect(result.mimeType).toBe('video/mp4')
    expect(result.bytes.byteLength).toBeGreaterThan(1000)
  })

  it('refuses without a token — honest about what is missing', async () => {
    const provider = new HuggingFaceVideoProvider({ token: '', endpoints, fetchFn: fakeFetch() })
    await expect(provider.generate({ prompt: 'x', imageUrl: 'http://img/x.png' })).rejects.toThrow(/token do Hugging Face/i)
  })

  it('surfaces a refused token as CREDENTIALS_UNAVAILABLE', async () => {
    const fetch401 = (async () => new Response('', { status: 401 })) as unknown as typeof fetch
    const provider = new HuggingFaceVideoProvider({ token: 'hf_ruim', endpoints, fetchFn: fetch401 })
    await expect(provider.generate({ prompt: 'x', imageUrl: 'http://img/x.png' })).rejects.toThrow(/recusado/i)
  })
})

describe('extractVideoUrl', () => {
  it('finds the escaped Gradio URL and unescapes it', () => {
    expect(extractVideoUrl('data: [{"video": {"url": "https:\\/\\/cdn\\/clip.mp4"}}]')).toBe('https://cdn/clip.mp4')
  })
  it('returns null when there is no video', () => {
    expect(extractVideoUrl('data: []')).toBeNull()
  })
})
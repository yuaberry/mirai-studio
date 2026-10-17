/**
 * Real audio probing for the timeline: fetch asset bytes over the restricted
 * mirai-asset:// protocol, decode with the Web Audio API and extract peaks.
 * Results (peaks + true duration) are cached per asset.
 */

export interface ProbeResult {
  /** Normalized 0..1 peaks sampled across the whole file. */
  peaks: Float32Array
  /** True duration in seconds from the decoded buffer. */
  duration: number
}

const cache = new Map<string, ProbeResult>()
const inflight = new Map<string, Promise<ProbeResult>>()
let decodeContext: AudioContext | null = null

function ctx(): AudioContext {
  if (!decodeContext) decodeContext = new AudioContext()
  return decodeContext
}

const PEAK_BUCKETS = 600

export function probeAsset(assetUrl: string, assetId: string): Promise<ProbeResult> {
  const hit = cache.get(assetId)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(assetId)
  if (pending) return pending

  const job = (async (): Promise<ProbeResult> => {
    const res = await fetch(assetUrl)
    if (!res.ok) throw new Error(`Asset fetch failed: ${res.status}`)
    const bytes = await res.arrayBuffer()
    const buffer = await ctx().decodeAudioData(bytes.slice(0))
    const channel = buffer.getChannelData(0)
    const buckets = Math.min(PEAK_BUCKETS, Math.max(1, Math.floor(channel.length)))
    const peaks = new Float32Array(buckets)
    const step = channel.length / buckets
    let max = 0.0001
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * step)
      const end = Math.min(channel.length, Math.floor((i + 1) * step))
      let peak = 0
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]!)
        if (v > peak) peak = v
      }
      peaks[i] = peak
      if (peak > max) max = peak
    }
    for (let i = 0; i < buckets; i++) peaks[i] = peaks[i]! / max
    const result: ProbeResult = { peaks, duration: buffer.duration }
    cache.set(assetId, result)
    inflight.delete(assetId)
    return result
  })()

  inflight.set(assetId, job)
  return job
}

/** Synchronous cache lookup — returns null before the first probe finishes. */
export function cachedPeaks(assetId: string): ProbeResult | null {
  return cache.get(assetId) ?? null
}

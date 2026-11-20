/**
 * Episode runtime planner — the promise the IP form makes.
 *
 * The user types "episode length: 22 minutes" and expects the studio to fill
 * 22 minutes. These tests lock the arithmetic that makes that true — and lock
 * the HONEST part: the plan says how many separate video clips a backend that
 * cannot generate long video will need, instead of pretending one call does it.
 */
import { describe, expect, it } from 'vitest'
import {
  planEpisodeFromRuntime,
  describeEpisodePlan,
  SECONDS_PER_SHOT,
  MAX_AUTOPRODUCE_SCENES,
  MAX_AUTOPRODUCE_SHOTS,
  MAX_CLIP_SECONDS,
} from '../src/episodeRuntime'

describe('planEpisodeFromRuntime', () => {
  it('turns a short episode into a usable scene/shot plan', () => {
    // 5 minutes = 300 s → 38 shots at 8 s each → 10 scenes.
    const plan = planEpisodeFromRuntime(5)
    // The plan must COVER the target, so it may round UP a little.
    expect(plan.estimatedSeconds).toBeGreaterThanOrEqual(300)
    expect(plan.estimatedSeconds).toBeLessThan(400)
    expect(plan.shotsPerScene).toBeGreaterThan(1)
    expect(plan.shotsTotal).toBeGreaterThan(0)
    // 38 shots × 1 clip each (8 s < 15 s max clip).
    expect(plan.clipsNeeded).toBe(plan.shotsTotal)
  })

  it('fills a HALF-HOUR episode like a broadcast one', () => {
    const plan = planEpisodeFromRuntime(30)
    // 30 min = 1800 s = 225 shots, which exceeds the per-pass ceiling — so the
    // plan is honest about the cap instead of pretending it covers 30 minutes.
    expect(plan.clamped).toBe(true)
    // Each pass still builds a real chunk: ~21 minutes of screen time.
    expect(plan.estimatedSeconds).toBeGreaterThan(20 * 60)
    // A broadcast episode is HUNDREDS of clips, never one generation.
    expect(plan.clipsNeeded).toBeGreaterThan(150)
    expect(plan.clipsNeeded).toBeLessThan(300)
    expect(plan.shotsTotal).toBeGreaterThan(150)
  })

  it('caps a request that exceeds what one pass can build — and SAYS SO', () => {
    // 240 minutes is beyond any single pass; the plan must not silently lie.
    const plan = planEpisodeFromRuntime(240)

    expect(plan.clamped).toBe(true)
    expect(plan.clampReason).toContain('capped')
    expect(plan.clampReason).toContain('Re-run on the same episode')
    expect(plan.scenesCount).toBeLessThanOrEqual(MAX_AUTOPRODUCE_SCENES)
    expect(plan.shotsTotal).toBeLessThanOrEqual(MAX_AUTOPRODUCE_SHOTS)
    // The reported runtime is the CAPPED one — what this pass really builds.
    expect(plan.estimatedSeconds).toBeLessThan(240 * 60)
  })

  it('charges one clip per 15-second block when shots run long', () => {
    // A 30-second shot needs TWO clips: no backend makes 30 s.
    const plan = planEpisodeFromRuntime(1, 30)
    expect(plan.clipsNeeded).toBe(plan.shotsTotal * 2)
  })

  it('clamps nonsense input instead of dividing by zero', () => {
    expect(planEpisodeFromRuntime(0).estimatedSeconds).toBeGreaterThan(0)
    expect(planEpisodeFromRuntime(-5).estimatedSeconds).toBeGreaterThan(0)
    // 0 total shot seconds must not produce Infinity shots.
    expect(Number.isFinite(planEpisodeFromRuntime(10, 0).shotsTotal)).toBe(true)
  })
})

describe('describeEpisodePlan', () => {
  it('prints the scene/shot/runtime/clip line the UI shows', () => {
    const text = describeEpisodePlan(planEpisodeFromRuntime(5))
    expect(text).toContain('scenes')
    expect(text).toContain('shots')
    expect(text).toContain('video clips to animate')
    expect(text).toMatch(/\d+m\d\d?s/)
  })

  it('shows the cap plainly when the plan was clamped', () => {
    const text = describeEpisodePlan(planEpisodeFromRuntime(240))
    expect(text).toContain('CAPPED')
    expect(text).toContain('capped')
  })
})

describe('the constants behind the math', () => {
  it('are the measured ones, not aspirational', () => {
    // A shot carries ~8 s of screen time in a normal broadcast rhythm.
    expect(SECONDS_PER_SHOT).toBe(8)
    // No video backend this app drives makes more than 15 s per call — this is
    // the ceiling that makes a long episode cost many clips.
    expect(MAX_CLIP_SECONDS).toBe(15)
  })
})
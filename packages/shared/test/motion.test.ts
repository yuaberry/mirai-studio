/**
 * Motion — the single source of truth for how the interface moves.
 *
 * The contract that matters:
 *   1. `enabled: false` (and 'off'/'instant') produce a ZERO duration — the
 *      interface must be able to stop moving entirely.
 *   2. The OS "reduce motion" preference WINS over the app setting when
 *      respected — an operating system is not something an app may override.
 *   3. Every speed maps to a distinct duration and curve; a speed that changes
 *      nothing would be a decorative select.
 *   4. The DOM attributes are what CSS reads: `data-motion` + `--motion-ms`.
 */
import { describe, expect, it } from 'vitest'
import {
  MOTION_MS,
  MOTION_EASE,
  DEFAULT_MOTION,
  resolveMotion,
  motionStyleVars,
  describeMotion,
  systemPrefersReducedMotion,
  type MotionSettings,
} from '../src/motion'

const base: MotionSettings = { ...DEFAULT_MOTION }

describe('motion durations', () => {
  it('maps every speed to a distinct duration', () => {
    const values = Object.values(MOTION_MS)
    // off and instant are both 0 by design (no wait), the rest differ.
    expect(MOTION_MS.calm).toBeGreaterThan(MOTION_MS.normal)
    expect(MOTION_MS.normal).toBeGreaterThan(MOTION_MS.swift)
    expect(MOTION_MS.swift).toBeGreaterThan(0)
    expect(MOTION_MS.off).toBe(0)
    expect(MOTION_MS.instant).toBe(0)
    expect(new Set(values).size).toBeGreaterThanOrEqual(3)
  })

  it('gives every speed a curve', () => {
    for (const speed of Object.keys(MOTION_MS) as Array<keyof typeof MOTION_MS>) {
      expect(MOTION_EASE[speed]).toBeTruthy()
    }
  })
})

describe('resolveMotion', () => {
  it('an enabled setting animates', () => {
    const r = resolveMotion(base)
    expect(r.active).toBe(true)
    expect(r.ms).toBe(MOTION_MS.normal)
    expect(r.dataMotion).toBe('on')
    expect(r.keyframes).toContain('var(--motion-ms)')
  })

  it('the master switch stops EVERYTHING', () => {
    const r = resolveMotion({ ...base, enabled: false, speed: 'calm' })
    expect(r.active).toBe(false)
    expect(r.ms).toBe(0)
    expect(r.dataMotion).toBe('off')
    // No keyframes, no transition: the interface does not move.
    expect(r.keyframes).toBe('none')
  })

  it('"off" and "instant" also mean zero', () => {
    expect(resolveMotion({ ...base, speed: 'off' }).ms).toBe(0)
    expect(resolveMotion({ ...base, speed: 'instant' }).ms).toBe(0)
  })

  it('the OS preference WINS when respected', () => {
    const r = resolveMotion({ ...base, speed: 'swift' }, true)
    expect(r.active).toBe(false)
    expect(r.ms).toBe(0)
    expect(r.dataMotion).toBe('off')
  })

  it('the user MAY ignore the OS preference', () => {
    const r = resolveMotion({ ...base, respectSystemPreference: false, speed: 'swift' }, true)
    expect(r.active).toBe(true)
    expect(r.ms).toBe(MOTION_MS.swift)
  })

  it('"none" transition still animates but never on page change', () => {
    const r = resolveMotion({ ...base, transition: 'none' })
    expect(r.active).toBe(true)
    expect(r.keyframes).toBe('none')
  })
})

describe('motionStyleVars', () => {
  it('writes the two CSS custom properties the rules multiply', () => {
    const vars = motionStyleVars(resolveMotion({ ...base, speed: 'swift' }))
    expect(vars['--motion-ms']).toBe(`${MOTION_MS.swift}ms`)
    expect(vars['--motion-ease']).toBe(MOTION_EASE.swift)
  })

  it('"off" writes 0ms so a rule cannot animate by accident', () => {
    const vars = motionStyleVars(resolveMotion({ ...base, enabled: false }))
    expect(vars['--motion-ms']).toBe('0ms')
  })
})

describe('describeMotion', () => {
  it('says what the user chose, in words', () => {
    expect(describeMotion({ ...base, speed: 'swift' })).toContain('Swift')
    expect(describeMotion({ ...base, speed: 'swift' })).toContain('140ms')
    expect(describeMotion({ ...base, enabled: false })).toContain('Motion off')
  })

  it('names the OS reason when the system asked first', () => {
    const text = describeMotion(base, true)
    expect(text).toContain('reduced motion')
    expect(text).toContain('off')
  })
})

describe('systemPrefersReducedMotion', () => {
  it('never throws in a non-browser environment', () => {
    // The shared package runs under Node/vitest, where matchMedia is absent.
    expect(() => systemPrefersReducedMotion()).not.toThrow()
    expect(typeof systemPrefersReducedMotion()).toBe('boolean')
  })
})
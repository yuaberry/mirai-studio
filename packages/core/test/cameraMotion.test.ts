/**
 * cameraMotion — the free motion path for long episodes.
 *
 * The contract that matters:
 *   1. Every preset produces a REAL FFmpeg command (a preset that builds no
 *      args is a decorative select).
 *   2. `locked` is honest: NO zoompan, a plain scale+pad (a static frame).
 *   3. The moves stay INSIDE the image: zoompan crops, so pans/tilts run on a
 *      zoomed crop (z > 1) — an expression that travels past the edge would
 *      expose black bars.
 *   4. The frame's own resolution wins — the camera move never upscales.
 */
import { describe, expect, it } from 'vitest'
import {
  CAMERA_MOTION_PRESETS,
  CAMERA_MOTION_LABELS,
  cameraMoveArgs,
  encodeTier,
  evenSize,
  frameCount,
  suggestMotion,
  zoompanExpression,
  type CameraMotionPreset,
} from '../src/render/cameraMotion'

const preset = {
  id: 'youtube-1080',
  label: 'YouTube 1080p',
  description: 'test',
  width: 1920,
  height: 1080,
  fps: 24,
  videoKbps: 12_000,
  audioKbps: 192,
}

const spec = (presetId: CameraMotionPreset) => ({
  preset: presetId,
  durationSec: 4,
  fps: 24,
  width: 1280,
  height: 720,
})

describe('the presets', () => {
  it('are all named and selectable', () => {
    expect(CAMERA_MOTION_PRESETS.length).toBeGreaterThanOrEqual(8)
    for (const id of CAMERA_MOTION_PRESETS) {
      expect(CAMERA_MOTION_LABELS[id]).toBeTruthy()
    }
  })
})

describe('zoompanExpression', () => {
  it('gives every moving preset a zoompan filter', () => {
    for (const id of CAMERA_MOTION_PRESETS) {
      const expr = zoompanExpression(spec(id))
      if (id === 'locked') {
        expect(expr).toBeNull()
      } else {
        expect(expr, id).toContain('zoompan=')
        expect(expr, id).toContain('s=1280x720')
        expect(expr, id).toContain('fps=24')
        expect(expr, id).toContain('d=1')
      }
    }
  })

  it('pans and tilels travel INSIDE a zoomed crop (z > 1)', () => {
    for (const id of ['panLeft', 'panRight', 'tiltUp', 'tiltDown', 'drift', 'handheld'] as const) {
      const expr = zoompanExpression(spec(id))!
      expect(expr, id).toMatch(/z='1\.\d+'/) // a fixed zoomed crop
      expect(expr, id).toContain('/zoom') // the window accounts for the crop
    }
  })

  it('push-in grows from 1 and never past the max zoom', () => {
    const expr = zoompanExpression(spec('pushIn'))!
    expect(expr).toContain('min(1+(')
    expect(expr).toContain('/96')
  })

  it('drives the move by the output frame number `on`', () => {
    const expr = zoompanExpression(spec('panRight'))!
    expect(expr).toContain('on/96')
  })
})

describe('cameraMoveArgs', () => {
  it('loops the still for the clip duration and encodes yuv420p', () => {
    const args = cameraMoveArgs('/img.png', '/out.mp4', spec('pushIn'), 'MASTER', preset)
    expect(args).toContain('-loop')
    expect(args).toContain('/img.png')
    expect(args).toContain('-an')
    expect(args).toContain('yuv420p')
    expect(args).toContain('libx264')
    expect(args[args.length - 1]).toBe('/out.mp4')
    // The duration is bound BOTH on input and output.
    expect(args).toContain('4.000')
  })

  it('locked uses scale+pad instead of zoompan', () => {
    const args = cameraMoveArgs('/img.png', '/out.mp4', spec('locked'), 'PREVIEW', preset)
    const vf = args[args.indexOf('-vf') + 1] ?? ''
    expect(vf).not.toContain('zoompan')
    expect(vf).toContain('force_original_aspect_ratio=decrease')
  })

  it('picks the encoder tier from the quality', () => {
    expect(encodeTier('CINEMA')).toEqual({ preset: 'slower', crf: '14', premium: true })
    expect(encodeTier('MASTER').crf).toBe('16')
    expect(encodeTier('PREVIEW').preset).toBe('ultrafast')
  })
})

describe('evenSize', () => {
  it('rounds odd AI frame sizes down to even (yuv420p demands it)', () => {
    // A 1015x580 Pollinations image — odd width — must not reach the encoder.
    expect(evenSize(1015, 580)).toEqual({ width: 1014, height: 580 })
    expect(evenSize(1344, 768)).toEqual({ width: 1344, height: 768 })
  })

  it('feeds the EVEN size into the zoompan expression', () => {
    const expr = zoompanExpression({ ...spec('pushIn'), width: 1015, height: 580 })!
    expect(expr).toContain('s=1014x580')
  })
})

describe('frameCount', () => {
  it('maps duration to frames at the clip fps', () => {
    expect(frameCount({ ...spec('pushIn'), durationSec: 2.5, fps: 24 })).toBe(60)
    expect(frameCount({ ...spec('pushIn'), durationSec: 0.1 })).toBe(2) // rounds down
    expect(frameCount({ ...spec('pushIn'), durationSec: 0 })).toBe(1) // never zero
  })
})

describe('suggestMotion', () => {
  it("executes the shot's OWN camera movement (STATIC/PAN/DOLLY_IN…)", () => {
    expect(suggestMotion({ cameraMovement: 'STATIC' })).toBe('locked')
    expect(suggestMotion({ cameraMovement: 'PAN' })).toBe('panRight')
    expect(suggestMotion({ cameraMovement: 'DOLLY_IN' })).toBe('pushIn')
    expect(suggestMotion({ cameraMovement: 'DOLLY_OUT' })).toBe('pushOut')
    expect(suggestMotion({ cameraMovement: 'HANDHELD' })).toBe('handheld')
    expect(suggestMotion({ cameraMovement: 'ZOOM_OUT' })).toBe('pushOut')
  })

  it('derives a sensible move from the shot type when none is declared', () => {
    expect(suggestMotion({ shotType: 'ESTABLISHING' })).toBe('panRight')
    expect(suggestMotion({ shotType: 'CLOSE_UP' })).toBe('pushIn')
    expect(suggestMotion({ shotType: 'TWO_SHOT' })).toBe('locked')
  })

  it('gives long shots a drift and everything else a push-in', () => {
    expect(suggestMotion({ durationSec: 7 })).toBe('drift')
    expect(suggestMotion({ durationSec: 3 })).toBe('pushIn')
  })
})
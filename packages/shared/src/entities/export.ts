/**
 * Export & render entities (Phase 6) — the Export Center model:
 * quality modes, professional presets and produced file records.
 */
import { z } from 'zod'

export const RENDER_QUALITIES = ['PREVIEW', 'MASTER'] as const
export type RenderQuality = (typeof RENDER_QUALITIES)[number]
export const zRenderQuality = z.enum(RENDER_QUALITIES)

export const QUALITY_LABEL: Record<RenderQuality, string> = {
  PREVIEW: 'Preview (fast, low size)',
  MASTER: 'Master (full quality)',
}

export interface ExportPreset {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly width: number
  readonly height: number
  readonly fps: number
  /** Video bitrate in kbps. */
  readonly videoKbps: number
  /** Audio bitrate in kbps. */
  readonly audioKbps: number
}

/** Professional delivery targets (broadcast & platform standards). */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'youtube-1080',
    label: 'YouTube 1080p',
    description: 'The standard for web releases and studio pitching.',
    width: 1920,
    height: 1080,
    fps: 24,
    videoKbps: 12_000,
    audioKbps: 192,
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K',
    description: 'Maximum quality for streaming platforms.',
    width: 3840,
    height: 2160,
    fps: 24,
    videoKbps: 45_000,
    audioKbps: 192,
  },
  {
    id: 'tv-broadcast',
    label: 'TV Broadcast',
    description: 'High-bitrate master for broadcasters and festivals.',
    width: 1920,
    height: 1080,
    fps: 24,
    videoKbps: 20_000,
    audioKbps: 256,
  },
  {
    id: 'web',
    label: 'Web (efficient)',
    description: 'Light files for websites and previews.',
    width: 1920,
    height: 1080,
    fps: 24,
    videoKbps: 6_000,
    audioKbps: 128,
  },
  {
    id: 'cinema',
    label: 'Cinema Master',
    description: '4K archival master with maximum bitrate.',
    width: 3840,
    height: 2160,
    fps: 24,
    videoKbps: 80_000,
    audioKbps: 256,
  },
  {
    id: 'mobile',
    label: 'Mobile',
    description: '720p for phones and quick sharing.',
    width: 1280,
    height: 720,
    fps: 24,
    videoKbps: 4_000,
    audioKbps: 128,
  },
  {
    id: 'social-vertical',
    label: 'Social Media (vertical)',
    description: '9:16 for Shorts / TikTok / Reels.',
    width: 1080,
    height: 1920,
    fps: 24,
    videoKbps: 8_000,
    audioKbps: 128,
  },
]

export function exportPresetById(id: string): ExportPreset {
  const preset = EXPORT_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`Unknown export preset: ${id}`)
  return preset
}

export const DEFAULT_PRESET_ID = 'youtube-1080'

/** A produced file in the project's exports/ folder. */
export const RenderOutput = z.object({
  /** Absolute path of the file. */
  path: z.string().min(1),
  fileName: z.string().min(1),
  kind: z.enum(['SCENE', 'EPISODE', 'SHOT', 'OTHER']),
  fileBytes: z.number().int().min(0),
  createdAt: z.string(),
  /** Duration in seconds when ffprobe is available, else null. */
  durationSec: z.number().nullable(),
  /** Width x height when probeable, else null. */
  resolution: z.string().nullable(),
})
export type RenderOutput = z.infer<typeof RenderOutput>

/** Result payload of a scene/episode render job. */
export const SceneRenderResult = z.object({
  kind: z.enum(['SCENE', 'EPISODE']),
  outputPath: z.string(),
  durationSec: z.number(),
  fileBytes: z.number().int(),
  presetId: z.string(),
  quality: zRenderQuality,
  /** Episode renders: the scenes that were stitched, in order. */
  sceneTitles: z.array(z.string()),
  resolution: z.string(),
})
export type SceneRenderResult = z.infer<typeof SceneRenderResult>

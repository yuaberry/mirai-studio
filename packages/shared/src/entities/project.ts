/**
 * Project entity model: configuration, manifest (project.mirai), registry summary.
 * Paths are NEVER used as identity — a project is identified by its ULID.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { zProjectStatus } from '../status'

/** Canonical folder layout inside every Mirai project (spec §5). */
export const PROJECT_FOLDERS = [
  'database',
  'characters',
  'locations',
  'props',
  'episodes',
  'scenes',
  'storyboard',
  'images',
  'videos',
  'audio',
  'music',
  'subtitles',
  'exports',
  'cache',
  'metadata',
] as const
export type ProjectFolder = (typeof PROJECT_FOLDERS)[number]

export const ASPECT_RATIOS = ['16:9', '4:3', '2.39:1', '1:1', '9:16'] as const
export const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 60] as const
export const CONTENT_RATINGS = ['ALL', '7+', '13+', '16+', '18+'] as const

export const zResolution = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(4320),
})

export const ProjectConfig = z.object({
  title: z.string().min(1).max(120),
  genre: z.string().max(80).optional(),
  language: z.string().min(2).max(16).default('ja'),
  aspectRatio: z.enum(ASPECT_RATIOS).default('16:9'),
  resolution: zResolution.default({ width: 1920, height: 1080 }),
  fps: z
    .number()
    .refine((v) => (FPS_OPTIONS as readonly number[]).includes(v), {
      message: 'Unsupported FPS value',
    })
    .default(24),
  visualStyle: z.string().max(120).optional(),
  episodeCount: z.number().int().min(0).max(10_000).optional(),
  contentRating: z.enum(CONTENT_RATINGS).optional(),
})
export type ProjectConfig = z.infer<typeof ProjectConfig>

/**
 * project.mirai — the portable manifest at the root of a project folder.
 * schemaVersion gates migrations when opening older projects.
 */
export const ProjectManifest = z.object({
  schemaVersion: z.literal(1),
  id: zEntityId,
  name: z.string().min(1).max(80),
  description: z.string().max(2_000).optional(),
  status: zProjectStatus.default('ACTIVE'),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
  appVersion: z.string().min(1),
  config: ProjectConfig,
})
export type ProjectManifest = z.infer<typeof ProjectManifest>

/** Registry row: what the Project Hub displays. */
export const ProjectSummary = z.object({
  id: zEntityId,
  name: z.string(),
  description: z.string().optional(),
  path: z.string().min(1),
  status: zProjectStatus,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
  lastOpenedAt: zIsoDate.nullable(),
  appVersion: z.string(),
})
export type ProjectSummary = z.infer<typeof ProjectSummary>

/** A project opened in the workspace (summary + manifest). */
export const OpenedProject = ProjectSummary.extend({
  manifest: ProjectManifest,
})
export type OpenedProject = z.infer<typeof OpenedProject>

/** Template presets offered at project creation (spec §32). */
export interface ProjectPreset {
  id: string
  label: string
  description: string
  config: Partial<ProjectConfig>
}

export const PROJECT_PRESETS: ProjectPreset[] = [
  {
    id: 'anime-12',
    label: 'Anime — 12 Episodes',
    description: 'One cour season. Standard broadcast format.',
    config: { episodeCount: 12, aspectRatio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 24 },
  },
  {
    id: 'anime-24',
    label: 'Anime — 24 Episodes',
    description: 'Two cour season.',
    config: { episodeCount: 24, aspectRatio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 24 },
  },
  {
    id: 'ova',
    label: 'OVA / Special',
    description: 'Single original video animation.',
    config: { episodeCount: 1, aspectRatio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 24 },
  },
  {
    id: 'short-film',
    label: 'Short Film',
    description: 'Standalone short production.',
    config: { episodeCount: 1, aspectRatio: '2.39:1', fps: 24 },
  },
  {
    id: 'manga',
    label: 'Manga / Comic',
    description: 'Pages instead of episodes — prompt-heavy workflow.',
    config: { episodeCount: 0, aspectRatio: '4:3' },
  },
  {
    id: 'visual-novel',
    label: 'Visual Novel',
    description: 'VN with dialogue-heavy scenes.',
    config: { aspectRatio: '16:9', resolution: { width: 1600, height: 900 }, fps: 30 },
  },
  {
    id: 'music-video',
    label: 'Music Video',
    description: 'Single musical piece with video.',
    config: { episodeCount: 1, aspectRatio: '16:9', fps: 30 },
  },
  {
    id: 'web-series',
    label: 'Web Series',
    description: 'Vertical or horizontal episodic content.',
    config: { episodeCount: 8, aspectRatio: '9:16', resolution: { width: 1080, height: 1920 }, fps: 30 },
  },
]

export function presetById(id: string): ProjectPreset | undefined {
  return PROJECT_PRESETS.find((preset) => preset.id === id)
}

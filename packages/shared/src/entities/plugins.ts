/**
 * Plugin entities (Phase 9) — the extensibility model:
 * strict manifest schema, the permission model, contributed capabilities
 * (commands, prompts, export presets, providers) and the curated marketplace
 * registry format.
 */
import { z } from 'zod'
import { zIsoDate } from '../ids'

// ---------------------------------------------------------------- permissions

/** The permission model — every capability is gated by these. */
export const PLUGIN_PERMISSIONS = [
  'READ',
  'SUGGEST',
  'EDIT',
  'CREATE',
  'DELETE',
  'EXPORT',
] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]
export const zPluginPermission = z.enum(PLUGIN_PERMISSIONS)

export const PERMISSION_LABEL: Record<PluginPermission, string> = {
  READ: 'Read project data',
  SUGGEST: 'Contribute suggestions (prompts, presets, commands)',
  EDIT: 'Edit existing entities',
  CREATE: 'Create entities',
  DELETE: 'Delete entities',
  EXPORT: 'Trigger exports & renders',
}

// ---------------------------------------------------------------- capabilities

export const PluginCommand = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,60}(\.[a-z0-9][a-z0-9-]{0,60})$/, 'command ids look like "pack.action"')
    .max(120),
  label: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
})
export type PluginCommand = z.infer<typeof PluginCommand>

export const PluginPrompt = z.object({
  category: z.enum(['MANGA_PANEL', 'CHARACTER', 'SCENE', 'ANIME_STYLE', 'NEGATIVE', 'STORY', 'UTILITY']),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(8_000),
  tags: z.string().max(200).optional(),
})
export type PluginPrompt = z.infer<typeof PluginPrompt>

export const PluginExportPreset = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/).max(80),
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  width: z.number().int().min(256).max(7680),
  height: z.number().int().min(256).max(4320),
  fps: z.number().int().min(12).max(60),
  videoKbps: z.number().int().min(500).max(200_000),
  audioKbps: z.number().int().min(64).max(512),
})
export type PluginExportPreset = z.infer<typeof PluginExportPreset>

/**
 * Provider SDK: plugins DECLARE provider configs (OpenAI-compatible
 * endpoints). Users stay in control — the Plugins page APPLIES a declared
 * provider into Settings (never automatic).
 */
export const PluginProvider = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/).max(80),
  label: z.string().min(1).max(120),
  kind: z.enum(['chat', 'image', 'video']),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(200),
  notes: z.string().max(300).optional(),
})
export type PluginProvider = z.infer<typeof PluginProvider>

// ---------------------------------------------------------------- manifest

export const PluginManifest = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/).max(80),
    name: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'semver (e.g. 1.0.0)'),
    description: z.string().max(500).optional(),
    author: z.string().min(1).max(120),
    /** Declared permissions — enforced at every API call inside the host. */
    permissions: z.array(zPluginPermission).min(1).max(6),
    commands: z.array(PluginCommand).max(20).default([]),
    prompts: z.array(PluginPrompt).max(50).default([]),
    exportPresets: z.array(PluginExportPreset).max(20).default([]),
    providers: z.array(PluginProvider).max(10).default([]),
  })
  .refine(
    (m) =>
      m.commands.every((c) => c.id.startsWith(`${m.id}.`) || c.id.includes('.')),
    { message: 'Command ids must be namespaced (e.g. "myplugin.action").' },
  )
export type PluginManifest = z.infer<typeof PluginManifest>

// ---------------------------------------------------------------- runtime record

export const PluginRecord = z.object({
  manifest: PluginManifest,
  enabled: z.boolean(),
  /** Where the plugin was found (app-level plugins folder). */
  folder: z.string(),
  /** Validation errors when the manifest is broken (still listed, disabled). */
  errors: z.array(z.string()).default([]),
  createdAt: zIsoDate,
})
export type PluginRecord = z.infer<typeof PluginRecord>

// ---------------------------------------------------------------- marketplace

/** A curated marketplace entry (foundation — specs, not a store). */
export const MarketplaceEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  author: z.string().min(1).max(120),
  permissions: z.array(zPluginPermission).max(6),
  /** e.g. "github:yuaberry/mirai-plugin-examples" */
  source: z.string().min(1).max(300),
  installHint: z.string().max(500).optional(),
})
export type MarketplaceEntry = z.infer<typeof MarketplaceEntry>

/** The bundled curated registry (seeded to app data, readable offline). */
export const CURATED_MARKETPLACE: readonly MarketplaceEntry[] = [
  {
    id: 'starter-commands',
    name: 'Starter Commands',
    description:
      'Example command plugin shipped with Mirai Studio — greets the project and counts scenes (READ + SUGGEST).',
    author: 'Mirai Studio Developers',
    permissions: ['READ', 'SUGGEST'],
    source: 'bundled:examples/starter-commands',
    installHint: 'Already installed as a built-in example — see it on the Installed tab.',
  },
  {
    id: 'prompt-pack-manga',
    name: 'Manga Prompt Pack',
    description:
      'Example SUGGEST plugin contributing extra manga prompt-library entries (bundled example).',
    author: 'Mirai Studio Developers',
    permissions: ['SUGGEST'],
    source: 'bundled:examples/prompt-pack-manga',
    installHint: 'Already installed as a built-in example — see it on the Installed tab.',
  },
  {
    id: 'community-provider-adapter',
    name: 'Community Provider Adapter',
    description:
      'The Provider SDK template: declare chat/image/video endpoints (OpenAI-compatible) that users can apply in Settings. Publish yours by hosting a folder with manifest.json + index.js and listing it here.',
    author: 'Mirai Studio Developers',
    permissions: ['SUGGEST'],
    source: 'github:yuaberry/mirai-studio — docs/plugins',
    installHint: 'Create a folder with manifest.json declaring `providers` and install it from the Installed tab.',
  },
]

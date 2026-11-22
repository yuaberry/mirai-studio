/**
 * Collaboration (v2.1) — publishing and importing each other's anime.
 *
 * WHAT THIS IS
 * -------------
 * A project is a FOLDER with a SQLite database, assets, briefs and exports.
 * Publishing therefore means: zip the folder, upload it with a manifest that
 * says WHO made it (the public profile card, already shipped), and what is in
 * it. Importing means: download, verify, unzip into the user's projects dir.
 *
 * The client talks to ONE server the user configures in Settings. There is no
 * hosted instance in this repo on purpose — running a registry is an ops
 * decision the user owns, and pretending to host one would be a fake button.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * Real-time collaborative editing (needs CRDTs), accounts (needs a database,
 * password hashing and recovery), and permission revocation. What ships is the
 * honest core: publish, discover, download, fork. Those cover "show my work and
 * get someone else's" without faking the rest.
 */
import { z } from 'zod'
import { PublicProfileCard } from './profile'

/** One file inside the published bundle. */
export const PublishFileEntry = z.object({
  /** Relative path inside the zip (never absolute — a path escape is fatal). */
  path: z.string().min(1).max(500),
  bytes: z.number().int().min(0).max(2_000_000_000),
})
export type PublishFileEntry = z.infer<typeof PublishFileEntry>

/** The manifest that travels with a published project. */
export const PublishManifest = z.object({
  /** Server-assigned id. */
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  tagline: z.string().max(300).default(''),
  /** Who made it — the public card, never the internal profile. */
  author: PublicProfileCard,
  /** The anime's own tags (genres, medium), as the user wrote them. */
  tags: z.array(z.string().max(40)).max(30).default([]),
  medium: z.string().max(40).default('ANIME'),
  /** Sha256 of the uploaded zip, so a download can prove what it is. */
  checksum: z.string().min(8).max(128).default(''),
  fileCount: z.number().int().min(0).default(0),
  totalBytes: z.number().int().min(0).default(0),
  publishedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Downloads other users performed — the only social signal we show. */
  downloads: z.number().int().min(0).default(0),
})
export type PublishManifest = z.infer<typeof PublishManifest>

/** What the server returns for a browse. */
export const PublishCatalog = z.object({
  projects: z.array(PublishManifest),
  /** The server said something about its health (version, public name). */
  serverName: z.string().default(''),
})
export type PublishCatalog = z.infer<typeof PublishCatalog>

/** The result of a publish/import, surfaced as a toast. */
export const PublishResult = z.object({
  ok: z.boolean(),
  id: z.string().default(''),
  message: z.string(),
  /** Where the imported project now lives locally (imports only). */
  localPath: z.string().default(''),
})
export type PublishResult = z.infer<typeof PublishResult>

/** Server status the client shows before asking the user to configure it. */
export const ServerStatus = z.object({
  configured: z.boolean(),
  reachable: z.boolean(),
  serverName: z.string().default(''),
  url: z.string().default(''),
  hasToken: z.boolean(),
  error: z.string().default(''),
})
export type ServerStatus = z.infer<typeof ServerStatus>

/** The validate-then-unzip rules an import must satisfy. */
export function sanitizeRelativePath(rel: string): string {
  // A zip must never escape its destination directory (zip-slip).
  const parts = rel.split(/[\\/]+/).filter((p) => p.length > 0 && p !== '.' && p !== '..')
  return parts.join('/')
}
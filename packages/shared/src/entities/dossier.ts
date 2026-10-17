/**
 * Story-notes import + Project Dossier (v0.15).
 *
 * The user can import real documents (.txt/.md/.docx/.odt/.pdf/.zip —
 * Google Docs exports included) for the AI to read; the AI extracts a
 * professional analysis that pre-fills the New Project form. Later, the
 * Dossier generator renders the whole project (identity, planning,
 * characters, production status, commercial strategy, legal advocacy)
 * into downloadable .txt + .pdf documents.
 */
import { z } from 'zod'
import { zIsoDate } from '../ids'
import { CONTENT_RATINGS, zProjectMedium } from './project'

// ------------------------------------------------------------------ medium

// ------------------------------------------------------------- notes import

export const SUPPORTED_NOTE_FORMATS = [
  'txt',
  'md',
  'docx',
  'odt',
  'pdf',
  'zip',
  'csv',
  'json',
  'markdown',
] as const
export type NoteFormat = (typeof SUPPORTED_NOTE_FORMATS)[number]

export const ImportedNoteFile = z.object({
  /** Display name (zip entries keep their inner path). */
  name: z.string().min(1).max(300),
  format: z.enum(SUPPORTED_NOTE_FORMATS),
  chars: z.number().int().min(0),
  truncated: z.boolean(),
  /** Empty when the file yielded no extractable text. */
  text: z.string(),
})
export type ImportedNoteFile = z.infer<typeof ImportedNoteFile>

export const NotesImportResult = z.object({
  files: z.array(ImportedNoteFile),
  totalChars: z.number().int().min(0),
  /** All texts concatenated with file headers — what the AI reads. */
  combined: z.string(),
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
})
export type NotesImportResult = z.infer<typeof NotesImportResult>

// --------------------------------------------------- AI notes analysis

export const StoryNotesAnalysis = z.object({
  titleSuggestion: z.string().min(1).max(120),
  medium: zProjectMedium,
  premise: z.string().min(1).max(2_000),
  synopsis: z.string().min(1).max(4_000),
  tone: z.string().min(1).max(600),
  suggestedAudience: z.string().min(1).max(300),
  contentRating: z.enum(CONTENT_RATINGS).optional(),
  /** Anime-taxonomy genre tags (validated loosely; the form caps at 12). */
  genres: z.array(z.string().min(1).max(40)).min(1).max(12),
  themes: z.array(z.string().min(1).max(120)).min(1).max(8),
  estimatedEpisodes: z.number().int().min(1).max(10_000),
  /** Pages per episode/chapter (manga/webtoon) — 0 when not applicable. */
  estimatedPagesPerEpisode: z.number().int().min(0).max(500),
  characterSeeds: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.string().min(1).max(60),
        brief: z.string().min(1).max(600),
      }),
    )
    .min(0)
    .max(12),
  locationSeeds: z.array(z.string().min(1).max(120)).min(0).max(10),
  /** Professional improvement suggestions, one concrete sentence each. */
  improvements: z.array(z.string().min(1).max(600)).min(1).max(10),
  /** Commercial/structural risks the notes raise. */
  risks: z.array(z.string().min(1).max(600)).min(0).max(8),
  /** Positioning/monetization read of the material. */
  commercialNotes: z.string().min(1).max(2_000),
})
export type StoryNotesAnalysis = z.infer<typeof StoryNotesAnalysis>

// ------------------------------------------------------------------ dossier

export const DossierResult = z.object({
  txtPath: z.string().min(1),
  pdfPath: z.string().min(1),
  pages: z.number().int().min(1),
  txtBytes: z.number().int().min(0),
  pdfBytes: z.number().int().min(0),
  /** Dossier document version (per project). */
  version: z.string().min(1),
  generatedAt: zIsoDate,
  /** AI sections were generated (false = provider not configured). */
  aiEnriched: z.boolean(),
})
export type DossierResult = z.infer<typeof DossierResult>

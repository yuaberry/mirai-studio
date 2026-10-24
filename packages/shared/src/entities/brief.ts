/**
 * Project Brief (v0.18) — the author's source material, persisted inside the
 * project folder (brief/) so the AI can ADAPT THE USER'S STORY from the
 * document they imported: the raw notes, the analysis and the adaptation
 * marker. Filesystem-first: inspectable, portable, no migrations.
 */
import { z } from 'zod'
import { StoryNotesAnalysis } from './dossier'

export const BriefSourceFile = z.object({
  name: z.string().min(1).max(300),
  format: z.string().min(1).max(20),
  chars: z.number().int().min(0),
})
export type BriefSourceFile = z.infer<typeof BriefSourceFile>

/** What projects:create accepts and writes into brief/. */
export const ProjectBriefInput = z.object({
  /** The combined imported text — the story the AI adapts from. */
  notesText: z.string().min(1).max(400_000),
  sourceFiles: z.array(BriefSourceFile).max(80).default([]),
  /** The analysis returned by ai:analyzeNotes (grounding for the adaptation). */
  analysis: StoryNotesAnalysis.nullable().default(null),
})
export type ProjectBriefInput = z.infer<typeof ProjectBriefInput>

/** Written to brief/analysis.json + read back on adaptation. */
export const StoredBrief = ProjectBriefInput.extend({
  /** Set after the adaptation job completes — the Overview card keys on it. */
  adapted: z.boolean().default(false),
})
export type StoredBrief = z.infer<typeof StoredBrief>

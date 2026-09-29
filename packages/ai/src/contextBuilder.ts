/**
 * Context Builder (spec §19) — assembles the project context the assistant
 * is allowed to see, as compact markdown sections with a token estimate.
 * The main process supplies the DATA; this module never touches services.
 */
import type { StoryBible } from '@mirai/shared'

export interface ContextCharacter {
  name: string
  role: string
  personality?: string
  goals?: string
  fears?: string
}

export interface ContextScene {
  title: string
  timeOfDay: string
  synopsis?: string
  screenplay?: string
  locationName?: string
  castNames: string[]
}

export interface ContextData {
  projectName?: string
  bible?: StoryBible
  characters?: ContextCharacter[]
  scene?: ContextScene
}

const IDENTITY = `You are the AI assistant of Mirai Studio, a professional anime/animation production suite.
You help the creator write, analyze and develop their work: story bibles, characters, scenes, screenplays and manga prompts.
Be concise, concrete and craft-focused. When you suggest changes, respect the existing canon.
Answer in the language the user writes in.`

export function buildSystemPrompt(data: ContextData): string {
  const sections: string[] = [IDENTITY]

  if (data.projectName) {
    sections.push(`## PROJECT\nCurrent project: "${data.projectName}".`)
  }

  if (data.bible) {
    const bible = data.bible
    const lines: string[] = []
    if (bible.premise) lines.push(`- Premise: ${bible.premise}`)
    if (bible.themes) lines.push(`- Themes: ${bible.themes}`)
    if (bible.tone) lines.push(`- Tone: ${bible.tone}`)
    if (bible.message) lines.push(`- Message: ${bible.message}`)
    if (bible.genreNotes) lines.push(`- Genre notes: ${bible.genreNotes}`)
    if (bible.narrativeRules) lines.push(`- Narrative rules (canon, never contradict):\n${bible.narrativeRules}`)
    if (bible.coreConcepts) lines.push(`- Core concepts:\n${bible.coreConcepts}`)
    if (lines.length > 0) {
      sections.push(`## STORY BIBLE\n${lines.join('\n')}`)
    }
  }

  if (data.characters && data.characters.length > 0) {
    const cast = data.characters
      .map((c) => {
        const bits: string[] = [c.name]
        if (c.role) bits.push(c.role)
        if (c.personality) bits.push(c.personality)
        if (c.goals) bits.push(`Wants: ${c.goals}`)
        if (c.fears) bits.push(`Fears: ${c.fears}`)
        return `- ${bits.join(' — ')}`
      })
      .join('\n')
    sections.push(`## CAST\n${cast}`)
  }

  if (data.scene) {
    const scene = data.scene
    const lines: string[] = [`Title: ${scene.title}`]
    lines.push(`Time of day: ${scene.timeOfDay}`)
    if (scene.locationName) lines.push(`Location: ${scene.locationName}`)
    if (scene.castNames.length > 0) lines.push(`Cast: ${scene.castNames.join(', ')}`)
    if (scene.synopsis) lines.push(`Synopsis: ${scene.synopsis}`)
    if (scene.screenplay) lines.push(`Screenplay so far:\n${scene.screenplay}`)
    sections.push(`## CURRENT SCENE\n${lines.join('\n')}`)
  }

  if (sections.length === 1) {
    sections.push(
      'No project context was attached for this message — answer generally and note that opening a project and enabling context gives better, canon-aware help.',
    )
  }

  return sections.join('\n\n')
}

/** Rough estimate (~4 chars/token) for budget checks and UI hints. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Studio Consistency Prompt Builder — the heart of professional-looking
 * generation (spec §2.2, §18): every image request is assembled from the
 * project's Style Bible + the shot's camera metadata + the scene's cast and
 * setting, so frames look like ONE production, not random generations.
 */
import type { StyleBible } from '@mirai/shared'
import type { ContextCharacter } from './contextBuilder'

export interface ConsistencyScene {
  title: string
  timeOfDay: string
  synopsis?: string
  locationName?: string
  castNames: string[]
}

export interface ConsistencyShot {
  title: string
  shotType: string
  lens: string
  cameraMovement: string
  durationSeconds: number
  notes?: string
}

export interface ConsistencyData {
  styleBible: StyleBible
  scene: ConsistencyScene
  shot: ConsistencyShot
  characters: ContextCharacter[]
  extraPrompt?: string
}

/**
 * Builds the master image prompt. Structure mirrors how anime studios brief
 * key frames: framing first, then subject/action, then setting, then the
 * style anchors that must never change.
 */
export function buildImagePrompt(data: ConsistencyData): string {
  const sections: string[] = []

  // ---- 1. framing from the shot's camera metadata
  sections.push(
    `FRAMING: ${data.shot.shotType.replace(/_/g, ' ').toLowerCase()}, ${data.shot.lens} lens, ` +
      `${data.shot.cameraMovement.replace(/_/g, ' ').toLowerCase()} camera` +
      (data.shot.notes ? `. Direction: ${data.shot.notes}` : ''),
  )

  // ---- 2. subject & action from scene + cast
  const cast = data.characters.length > 0 ? data.characters : data.scene.castNames.map((n) => ({ name: n }))
  const castLine = cast.map((c) => c.name).join(' and ')
  const action =
    data.scene.synopsis ??
    `${castLine || 'the protagonist'} in "${data.scene.title}" — anime keyframe, cinematic composition`
  sections.push(
    `SUBJECT: ${castLine ? `${castLine} — ` : ''}${action}`.slice(0, 1_200),
  )

  // ---- 3. setting & light
  const setting: string[] = []
  if (data.scene.locationName) setting.push(`setting: ${data.scene.locationName}`)
  setting.push(`time of day: ${data.scene.timeOfDay.toLowerCase()}`)
  sections.push(`SETTING: ${setting.join(', ')}`)

  // ---- 4. the project's visual identity (Style Bible — canon)
  const sb = data.styleBible
  const styleLines: string[] = []
  if (sb.artDirection) styleLines.push(`Art direction: ${sb.artDirection}`)
  if (sb.lineart) styleLines.push(`Lineart: ${sb.lineart}`)
  if (sb.shading) styleLines.push(`Shading: ${sb.shading}`)
  if (sb.palette) styleLines.push(`Palette: ${sb.palette}`)
  if (sb.lighting) styleLines.push(`Lighting: ${sb.lighting}`)
  if (sb.proportions) styleLines.push(`Character proportions: ${sb.proportions}`)
  if (sb.eyesAndHair) styleLines.push(`Eyes & hair rendering: ${sb.eyesAndHair}`)
  if (sb.backgrounds) styleLines.push(`Backgrounds: ${sb.backgrounds}`)
  if (styleLines.length > 0) {
    sections.push(`STYLE (canon — never deviate):\n${styleLines.map((l) => `- ${l}`).join('\n')}`)
  }

  // ---- 5. professional output language
  sections.push(
    'OUTPUT: single anime production keyframe, TV-anime quality (comparable to top broadcast ' +
      'productions), 16:9, clean edges, no text, no watermark, no speech bubbles.',
  )

  if (data.extraPrompt && data.extraPrompt.trim().length > 0) {
    sections.push(`EXTRA DIRECTION FROM THE ARTIST:\n${data.extraPrompt.trim()}`)
  }

  return sections.join('\n\n')
}

/**
 * The Scene Writer agent's drafting instruction — the "screenwriter brain".
 * Returns a screenplay draft in the app's free format; applying is a
 * separate, explicit human approval.
 */
export function draftScreenplayInstruction(input: {
  sceneTitle: string
  castNames: string[]
  guidance?: string
}): string {
  const cast =
    input.castNames.length > 0
      ? `Available cast (use ONLY these): ${input.castNames.join(', ')}.`
      : 'No cast defined yet — you may introduce unnamed voices, but prefer the existing cast.'
  return `You are the scene writer of Mirai Studio. Write a complete screenplay draft for the scene "${input.sceneTitle}".

${cast}

FORMAT (plain text, exactly these blocks):
INT./EXT. LOCATION — TIME (slugline from the scene's setting, if known)
Action lines in present tense, one beat per line, visual and filmable.
CHARACTER NAME lines in caps, dialogue indented under them like:
  CHARACTER
  "dialogue"
Keep the scene tight (30–90 seconds of screen time). End on a strong beat.
${input.guidance ? `The artist's guidance for this draft: ${input.guidance}` : ''}
Return ONLY the screenplay text — no explanations, no markdown fences.`
}

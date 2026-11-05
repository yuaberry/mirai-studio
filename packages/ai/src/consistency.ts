/**
 * Studio Consistency Prompt Builder — the heart of professional-looking
 * generation (spec §2.2, §18): every image request is assembled from the
 * project's Style Bible + the shot's camera metadata + the scene's cast and
 * setting, so frames look like ONE production, not random generations.
 */
import type { StyleBible, ConsistencyLock } from '@mirai/shared'
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
  /**
   * Mature Content Mode (Pro): when true the production is rated 18+ and the
   * prompt may carry explicit artistic direction. The pipeline enforces the
   * adults-only policy before this flag ever reaches here.
   */
  mature?: boolean
  consistencyLock?: ConsistencyLock
  imageB64?: string
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

  // ---- 4b. studio consistency lock: model sheets + palette hex + character canon
  const lock = data.consistencyLock
  if (lock) {
    if (lock.palette.length > 0) {
      const hexes = lock.palette.map((p) => `${p.element}: ${p.hex}`).join(', ')
      sections.push(`PALETTE LOCK (use EXACTLY these hex colors — no deviation): ${hexes}`)
    }
    if (lock.modelSheets.length > 0) {
      const modelLines: string[] = []
      for (const sheet of lock.modelSheets) {
        const views = sheet.views.map((v) => `${v.view}${v.expression ? ` (${v.expression})` : ''}`).join(', ')
        modelLines.push(`- ${sheet.characterName}: ${sheet.canonAppearance ?? 'no description'}. Views: ${views}.`)
      }
      sections.push(
        `CHARACTER MODEL SHEETS (same person in every frame — match hair, eyes, outfit, proportions exactly):\n${modelLines.join('\n')}`,
      )
    }
    if (lock.lineart) sections.push(`LINEART (canon): ${lock.lineart}`)
    if (lock.shading) sections.push(`SHADING (canon): ${lock.shading}`)
    if (lock.proportions) sections.push(`PROPORTIONS (canon): ${lock.proportions}`)
    if (lock.eyesAndHair) sections.push(`EYES & HAIR (canon): ${lock.eyesAndHair}`)
    if (lock.backgrounds) sections.push(`BACKGROUNDS (canon): ${lock.backgrounds}`)
  }

  // ---- 4c. maturity contract (Pro): R-18 permitted, adults only, story-first
  if (data.mature) {
    sections.push(
      'CONTENT RATING: this production is rated 18+. Mature, sensual or explicit ' +
        'artistic content is permitted for this keyframe. All characters depicted ' +
        'are adults. Serve the story — intimacy and mature themes support the ' +
        'narrative, they never replace it.',
    )
  }

  // ---- 5. professional output language
  sections.push(
    'OUTPUT: single anime production keyframe, TV-anime quality (comparable to top broadcast ' +
      'productions), 16:9, clean edges, no text, no watermark, no speech bubbles.',
  )

  if (data.extraPrompt && data.extraPrompt.trim().length > 0) {
    sections.push(`EXTRA DIRECTION FROM THE ARTIST:\n${data.extraPrompt.trim()}`)
  }

  // ---- 6. reference image for image-to-image / image-to-video
  if (data.imageB64) {
    sections.push(
      'REFERENCE IMAGE: this generation must match the provided reference — same character design, ' +
        'same outfit, same hair color, same proportions, same lighting. Treat the reference as the ' +
        'canon anchor; do not invent new colors or details not present in it.',
    )
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

/**
 * The manga letterer's drafting instruction (v0.25, §8 slice 2): turn a
 * shot's screenplay into lettering bubbles for its comic panel. The
 * response is validated against the PanelLetteringDraft zod schema by
 * the host; applying is a separate, explicit human approval.
 */
export function draftPanelLetteringInstruction(input: {
  sceneTitle: string
  shotTitle: string
  screenplay: string
  castNames: string[]
}): string {
  const cast =
    input.castNames.length > 0
      ? `Cast (attribute dialogue with EXACT names): ${input.castNames.join(', ')}.`
      : 'No cast defined — leave characterName out for narrator lines.'
  const screenplay =
    input.screenplay.trim().length > 0
      ? input.screenplay.trim().slice(0, 4_000)
      : '(no screenplay written for this scene yet — propose minimal lines from the shot title)'
  return `You are the manga letterer of Mirai Studio. Turn the source material into lettering bubbles for ONE comic panel.

SCENE: ${input.sceneTitle}
SHOT (the panel adapts this): ${input.shotTitle}
SOURCE SCREENPLAY:
${screenplay}

${cast}

RULES:
- 1–6 bubbles. Speech kept SHORT (manga dialogue is terse — max ~2 sentences).
- Use kind SPEECH for dialogue (with characterName), SFX for onomatopoeia (text like DOON!, shhh…), CAPTION or NARRATION for scene text, THOUGHT for inner monologue.
- tail: BOTTOM_LEFT / BOTTOM_CENTER / BOTTOM_RIGHT / TOP_LEFT / TOP_CENTER / TOP_RIGHT / NONE (where the bubble points at the speaker).

Return ONLY a JSON object: { "bubbles": [{ "kind": "SPEECH", "characterName": "Ayaka", "text": "…", "tail": "BOTTOM_RIGHT" }] }`
}

/**
 * The Poster Studio's tagline instruction (v0.28, §7 slice 2): three
 * poster tagline candidates from the project's living bible facts. The
 * response is zod-enforced (exactly 3); picking one stays human.
 */
export function draftTaglinesInstruction(input: {
  title: string
  premise?: string
  themes?: string
  tone?: string
}): string {
  const facts = [
    input.premise ? `PREMISE: ${input.premise}` : null,
    input.themes ? `THEMES: ${input.themes}` : null,
    input.tone ? `TONE: ${input.tone}` : null,
  ].filter(Boolean)
  return `You are the key-art copywriter of Mirai Studio. Write EXACTLY 3 tagline candidates for the poster of "${input.title}".

${facts.length > 0 ? facts.join('\n') : 'No bible facts yet — sell the title itself with mood and mystery.'}

RULES:
- Each tagline: max ~14 words, punchy, poster-sized — the kind set in italic serif under a title.
- Distinct strategies: one emotional, one mysterious/teasing, one bold/thematic.
- Language: match the premise's language (default English if unclear).
Return ONLY a JSON object: { "taglines": ["…", "…", "…"] }`
}

/**
 * The Localization Lab's translation instruction (v0.29, §18): one
 * scene's screenplay into the target language, honoring the project's
 * GLOSSARY (the approved term base) and the work's tone. The response
 * is zod-validated; saving the translation stays a human decision.
 */
export function translateSceneInstruction(input: {
  sceneTitle: string
  targetLanguage: string
  screenplay: string
  premise?: string
  tone?: string
  glossary: Array<{ source: string; target: string }>
}): string {
  const glossary =
    input.glossary.length > 0
      ? `GLOSSARY (MANDATORY — use EXACTLY these translations, never localize them differently):
${input.glossary.map((g) => `- "${g.source}" → "${g.target}"`).join('\n')}`
      : 'No glossary terms for this language yet — keep names and coined terms consistent anyway.'
  const context = [
    input.premise ? `PREMISE (for tone, do NOT translate): ${input.premise}` : null,
    input.tone ? `TONE: ${input.tone}` : null,
  ].filter(Boolean)
  return `You are the localization specialist of Mirai Studio. Translate the ENTIRE scene screenplay into ${input.targetLanguage}.

SCENE: ${input.sceneTitle}
${context.length > 0 ? context.join('\n') : ''}

${glossary}

SOURCE SCREENPLAY (translate everything, keep the format: caps character names, quoted dialogue, action lines):
${input.screenplay}

RULES:
- Preserve the screenplay structure (names in caps, quotes, line breaks, beats).
- Keep character NAMES untranslated unless the glossary says otherwise.
- Sound effects get natural ${input.targetLanguage} onomatopoeia.
Return ONLY a JSON object: { "screenplay": "the full translated text with \\n for newlines" }`
}

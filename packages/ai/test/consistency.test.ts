import { describe, expect, it } from 'vitest'
import { buildImagePrompt, draftScreenplayInstruction, ANIME_NEGATIVE_PROMPT } from '../src/consistency'

const DATA = {
  styleBible: {
    artDirection: 'Luminous TV-anime with painted skies.',
    lineart: 'Fine, confident strokes.',
    palette: 'Sakura pink, dusk violet, cyan accents.',
    lighting: 'Golden-hour key light from the left.',
  },
  scene: {
    title: 'The rooftop promise',
    timeOfDay: 'NIGHT',
    synopsis: 'Yuna and Mio lean on the railing under city lights.',
    locationName: 'Academy Rooftop',
    castNames: ['Yuna', 'Mio'],
  },
  shot: {
    title: 'The promise — close',
    shotType: 'CLOSE_UP',
    lens: '85mm',
    cameraMovement: 'DOLLY_IN',
    durationSeconds: 4,
    notes: 'Push in on the last word.',
  },
  characters: [{ name: 'Yuna', role: 'PROTAGONIST' }],
}

describe('buildImagePrompt (studio consistency)', () => {
  it('bakes framing, subject, setting and the Style Bible canon into one prompt', () => {
    const prompt = buildImagePrompt(DATA)
    expect(prompt).toContain('close up')
    expect(prompt).toContain('85mm lens')
    expect(prompt).toContain('dolly in')
    expect(prompt).toContain('Push in on the last word.')
    expect(prompt).toContain('Yuna')
    expect(prompt).toContain('Academy Rooftop')
    expect(prompt).toContain('time of day: night')
    expect(prompt).toContain('Luminous TV-anime')
    expect(prompt).toContain('canon — never deviate')
    // Watermarks and text are excluded by the keyframe spec block.
    expect(prompt).toContain('ABSENT FROM THE IMAGE')
    expect(prompt).toContain('watermarks')
  })

  // THE FEATURE THAT WAS MISSING: the free keyless endpoint (flux /
  // Pollinations classic) ignored every stylistic adjective and delivered
  // PHOTOREALISTIC output — the one thing a Japanese-anime studio never
  // produces. Adjectives do not fix that; naming the MEDIUM does. These
  // assertions lock the contract so a prompt can never regress to "beautiful
  // image" again.
  it('locks the MEDIUM to 2D Japanese anime — never a photograph', () => {
    const prompt = buildImagePrompt(DATA)

    // 1. It says what the image IS.
    expect(prompt).toContain('MEDIUM (non-negotiable)')
    expect(prompt).toContain('2D JAPANESE ANIME CEL-ANIMATION KEYFRAME')
    expect(prompt).toContain('hand-drawn animation as broadcast on Japanese television')

    // 2. It names what it must NEVER look like — the generalist model has
    //    nowhere to drift to, because the unwanted media are excluded BY NAME.
    for (const forbidden of [
      'NOT a photograph',
      'NOT photorealistic',
      'NOT a 3D render',
      'NOT live action',
      'NOT documentary',
      'NOT a real person',
    ]) {
      expect(prompt).toContain(forbidden)
    }

    // 3. It names the production quality bar the user asked for.
    expect(prompt).toContain('STUDIO QUALITY REFERENCE')
    for (const studio of [
      'CloverWorks',
      'White Fox',
      'Studio Deen',
      'Toei Animation',
      'Kyoto Animation',
      'A-1 Pictures',
      'Wit Studio',
      'Ufotable',
    ]) {
      expect(prompt).toContain(studio)
    }

    // 4. The production language is specific, not "high quality anime".
    for (const term of ['cel-shaded', '16:9 broadcast', 'keyframe', 'cel-shaded colour blocks']) {
      expect(prompt.toLowerCase()).toContain(term.toLowerCase())
    }
  })

  it('exposes an anime negative prompt that rejects the unwanted media', () => {
    // A1111 / ComfyUI accept this verbatim as `negative_prompt`: the same
    // SDXL checkpoints drift to live-action photography within a few steps
    // unless the unwanted medium is named EXCLUSIVELY.
    expect(ANIME_NEGATIVE_PROMPT).toContain('photorealistic')
    expect(ANIME_NEGATIVE_PROMPT).toContain('3d render')
    expect(ANIME_NEGATIVE_PROMPT).toContain('live action')
    expect(ANIME_NEGATIVE_PROMPT).toContain('watermark')
    expect(ANIME_NEGATIVE_PROMPT).toContain('bad anatomy')
    // It must not accidentally exclude the medium we DO want.
    expect(ANIME_NEGATIVE_PROMPT.toLowerCase()).not.toContain('anime keyframe')
  })

  it('appends artist extra direction when present', () => {
    const prompt = buildImagePrompt({ ...DATA, extraPrompt: 'add falling petals' })
    expect(prompt).toContain('add falling petals')
  })

  it('works even with an empty Style Bible (still consistent framing/subject)', () => {
    const prompt = buildImagePrompt({ ...DATA, styleBible: {} })
    expect(prompt).toContain('close up')
    expect(prompt).not.toContain('STYLE (canon')
  })
})

describe('draftScreenplayInstruction', () => {
  it('constrains the writer to the scene cast and the format', () => {
    const instruction = draftScreenplayInstruction({
      sceneTitle: 'The rooftop promise',
      castNames: ['Yuna', 'Mio'],
      guidance: 'End on an interrupted confession.',
    })
    expect(instruction).toContain('The rooftop promise')
    expect(instruction).toContain('use ONLY these')
    expect(instruction).toContain('Yuna, Mio')
    expect(instruction).toContain('interrupted confession')
    expect(instruction).toContain('INT./EXT.')
  })
})

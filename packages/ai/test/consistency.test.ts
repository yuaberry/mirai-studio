import { describe, expect, it } from 'vitest'
import { buildImagePrompt, draftScreenplayInstruction } from '../src/consistency'

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
    expect(prompt).toContain('no text, no watermark')
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

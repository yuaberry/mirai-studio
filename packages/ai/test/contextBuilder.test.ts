import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, estimateTokens } from '../src/contextBuilder'

describe('buildSystemPrompt', () => {
  it('warns honestly when no context is attached', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('No project context was attached')
  })

  it('includes bible sections, cast and current scene when provided', () => {
    const prompt = buildSystemPrompt({
      projectName: 'Sakura Chronicles',
      bible: {
        premise: 'Two girls bond over magic.',
        tone: 'bittersweet',
        narrativeRules: 'Lumen magic requires a living anchor.',
      },
      characters: [
        { name: 'Yuna', role: 'PROTAGONIST', personality: 'Earnest', goals: 'Protect Mio', fears: 'Being left behind' },
        { name: 'Mio', role: 'DEUTERAGONIST' },
      ],
      scene: {
        title: 'The rooftop promise',
        timeOfDay: 'NIGHT',
        synopsis: 'A quiet conversation.',
        locationName: 'Academy Rooftop',
        castNames: ['Yuna', 'Mio'],
        screenplay: 'INT. ROOFTOP — NIGHT\n\nYUNA\n"I will protect you."',
      },
    })

    expect(prompt).toContain('Sakura Chronicles')
    expect(prompt).toContain('Two girls bond over magic.')
    expect(prompt).toContain('Lumen magic requires a living anchor.')
    expect(prompt).toContain('Protect Mio')
    expect(prompt).toContain('The rooftop promise')
    expect(prompt).toContain('"I will protect you."')
    expect(prompt).toContain('Academy Rooftop')
  })

  it('omits empty sections entirely', () => {
    const prompt = buildSystemPrompt({ bible: {}, characters: [] })
    expect(prompt).not.toContain('## STORY BIBLE')
    expect(prompt).not.toContain('## CAST')
  })

  it('estimates tokens at ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})
